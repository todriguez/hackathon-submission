#!/usr/bin/env bun
/**
 * fund-fleet.ts — BRC-42 per-container key derivation + funding for Docker fleet.
 *
 * Derives 13 unique child keys (8 floor + 5 apex) from the master WIF,
 * creates a fan-out funding tx, and writes .env.fleet with per-container WIFs.
 *
 * Usage:
 *   set -a && . ./.env.live && set +a
 *   bun scripts/fund-fleet.ts
 *   # Then: docker compose --env-file .env.fleet up -d
 */

import { PrivateKey, KeyDeriver, Transaction, P2PKH } from '@bsv/sdk';
import { writeFileSync, existsSync } from 'fs';

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const SATS_PER_CONTAINER = Number(process.env.SATS_PER_CONTAINER ?? '2000000'); // 2M sats = 0.02 BSV each
const NUM_CONTAINERS = 13; // 8 floor + 5 apex
const MAPI_URL = 'https://mapi.gorillapool.io/mapi/tx';
const FEE_RATE = 0.5;

const masterKey = PrivateKey.fromWif(WIF);
const deriver = new KeyDeriver(masterKey);
const p2pkh = new P2PKH();
const masterAddress = masterKey.toPublicKey().toAddress();
const masterLock = p2pkh.lock(masterAddress);

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  FLEET FUNDING — BRC-42 Per-Container Key Derivation');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Master: ${masterAddress}`);
console.log(`  Containers: ${NUM_CONTAINERS} (8 floor + 5 apex)`);
console.log(`  Per-container: ${SATS_PER_CONTAINER.toLocaleString()} sats`);
console.log('');

// Derive container keys
const containers: Array<{
  name: string;
  index: number;
  privKey: PrivateKey;
  wif: string;
  address: string;
}> = [];

for (let i = 0; i < NUM_CONTAINERS; i++) {
  const name = i < 8 ? `floor-${i}` : `apex-${i - 8}`;
  const privKey = deriver.derivePrivateKey(
    [2, 'fleet container funding'],
    `${name}`,
    'self',
  );
  const wif = privKey.toWif();
  const address = privKey.toPublicKey().toAddress();
  containers.push({ name, index: i, privKey, wif, address });
  console.log(`  ${name}: ${address}`);
}
console.log('');

// Discover master UTXOs via Bitails (paginated, includes unconfirmed)
console.log('  Discovering master UTXOs via Bitails...');
const masterUtxos: Array<{ tx_hash: string; tx_pos: number; value: number }> = [];
let fromOffset = 0;
while (true) {
  const resp = await fetch(`https://api.bitails.io/address/${masterAddress}/unspent?limit=10000&from=${fromOffset}`);
  if (!resp.ok) break;
  const data: any = await resp.json();
  const utxos = data.unspent ?? data;
  if (!Array.isArray(utxos) || utxos.length === 0) break;
  for (const u of utxos) {
    const sats = u.value ?? u.satoshis ?? 0;
    if (sats >= 500) {
      masterUtxos.push({ tx_hash: u.tx_hash ?? u.txid, tx_pos: u.tx_pos ?? u.vout, value: sats });
    }
  }
  console.log(`    Page ${Math.floor(fromOffset / 10000) + 1}: ${utxos.length} raw, ${masterUtxos.length} usable`);
  if (utxos.length < 10000) break;
  fromOffset += 10000;
}
masterUtxos.sort((a, b) => b.value - a.value);
const masterTotal = masterUtxos.reduce((s, u) => s + u.value, 0);
console.log(`  ${masterUtxos.length} UTXOs (${masterTotal.toLocaleString()} sats / ${(masterTotal / 1e8).toFixed(4)} BSV)`);

const needed = SATS_PER_CONTAINER * NUM_CONTAINERS + 50000;
if (masterTotal < needed) {
  console.error(`  Need ${needed.toLocaleString()} sats, have ${masterTotal.toLocaleString()}`);
  console.error(`  Send more BSV to: ${masterAddress}`);
  process.exit(1);
}

// Build fan-out: master → 13 containers
console.log('  Building fan-out transaction...');
const tx = new Transaction();
let inputTotal = 0;

// Use top N UTXOs
for (const u of masterUtxos.slice(0, 100)) {
  tx.addInput({
    sourceTXID: u.tx_hash,
    sourceOutputIndex: u.tx_pos,
    unlockingScriptTemplate: p2pkh.unlock(masterKey, 'all', false, u.value, masterLock),
  });
  inputTotal += u.value;
  if (inputTotal >= needed) break;
}

for (const c of containers) {
  const lock = p2pkh.lock(c.address);
  tx.addOutput({ lockingScript: lock, satoshis: SATS_PER_CONTAINER });
}

// Generous fee: 2 sat/byte estimated, then sign with correct change
const numInputs = tx.inputs.length;
const estSize = numInputs * 150 + (NUM_CONTAINERS + 1) * 34 + 10;
const fee = Math.ceil(estSize * 2); // 2 sat/byte
const change = inputTotal - (SATS_PER_CONTAINER * NUM_CONTAINERS) - fee;
if (change >= 546) {
  tx.addOutput({ lockingScript: masterLock, satoshis: change });
}

await tx.sign();
const txHex = tx.toHex();
const txid = tx.id('hex') as string;

console.log(`  Txid: ${txid}`);
console.log(`  Size: ${txHex.length / 2} bytes`);
console.log(`  Fee:  ${fee} sats`);

// Broadcast via MAPI
console.log('  Broadcasting via MAPI...');
const mapiResp = await fetch(MAPI_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rawtx: txHex }),
});
const mapiRaw = await mapiResp.text();
try {
  const outer = JSON.parse(mapiRaw);
  const inner = JSON.parse(outer.payload);
  if (inner.returnResult === 'success') {
    console.log('  ✓ MAPI accepted');
  } else {
    console.log(`  MAPI: ${inner.returnResult} — ${inner.resultDescription}`);
    // Fallback to WoC
    const wocBroadcast = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: txHex }),
    });
    if (wocBroadcast.ok) console.log('  ✓ WoC accepted');
    else console.error('  ✗ Both MAPI and WoC rejected');
  }
} catch {
  console.log(`  MAPI raw: ${mapiRaw.slice(0, 200)}`);
}

// Wait and verify
console.log('  Waiting 5s...');
await new Promise(r => setTimeout(r, 5000));
const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${txid}`);
console.log(`  ${check.ok ? '✓ ON-CHAIN' : '⚠ indexing delay'}`);
console.log('');

// Write .env.fleet
const envLines = [
  `# Generated by fund-fleet.ts at ${new Date().toISOString()}`,
  `# Fan-out txid: ${txid}`,
  `# Master: ${masterAddress}`,
  `ANCHOR_MODE=live`,
  `BROADCAST_VIA=mapi`,
  `MAPI_URL=https://mapi.gorillapool.io/mapi/tx`,
  `FEE_RATE=0.5`,
  `MIN_FEE=110`,
  `SPLIT_SATS=1000`,
  `ARC_URL=https://arc.gorillapool.io`,
  `CHANGE_ADDRESS=${masterAddress}`,
  `# Per-container WIFs — BRC-42 derived from master`,
];

// The docker-compose uses a single PRIVATE_KEY_WIF but we need per-container.
// Solution: write individual env files per container, or use a single env
// with the funding tx and let each container use its FUNDING_VOUT.
// Actually — each container needs its OWN WIF now (BRC-42 derived).
// docker-compose override approach: per-service environment blocks.

// Write a docker-compose.override.yml with per-container WIFs
const overrideServices: Record<string, any> = {};

for (const c of containers) {
  const serviceName = c.name;
  overrideServices[serviceName] = {
    environment: {
      PRIVATE_KEY_WIF: c.wif,
      CHANGE_ADDRESS: c.address,
      FUNDING_VOUT: String(c.index),
      BROADCAST_VIA: 'mapi',
      MAPI_URL: 'https://mapi.gorillapool.io/mapi/tx',
      ANCHOR_MODE: 'live',
      FEE_RATE: '0.5',
      MIN_FEE: '110',
    },
  };
}

// Also need the shared funding tx hex for pre-split
writeFileSync('data/fleet-funding-tx.hex', txHex);

// Write override YAML manually (avoid yaml dependency)
let yaml = `# Auto-generated by fund-fleet.ts — ${new Date().toISOString()}\n`;
yaml += `# Fan-out txid: ${txid}\n`;
yaml += `# BRC-42 derived keys — each container has unique WIF\n\n`;
yaml += `services:\n`;

for (const c of containers) {
  yaml += `  ${c.name}:\n`;
  yaml += `    environment:\n`;
  yaml += `      PRIVATE_KEY_WIF: "${c.wif}"\n`;
  yaml += `      CHANGE_ADDRESS: "${c.address}"\n`;
  yaml += `      FUNDING_VOUT: "${c.index}"\n`;
  yaml += `      FUNDING_TX_HEX_FILE: "/funding/fleet-funding-tx.hex"\n`;
  yaml += `      BROADCAST_VIA: "mapi"\n`;
  yaml += `      ANCHOR_MODE: "live"\n`;
  yaml += `      FEE_RATE: "0.5"\n`;
  yaml += `      MIN_FEE: "110"\n`;
  yaml += `\n`;
}

writeFileSync('docker-compose.override.yml', yaml);

// Also write .env.fleet for anything that needs the base env
const envContent = [
  `# Generated by fund-fleet.ts at ${new Date().toISOString()}`,
  `# Fan-out txid: ${txid}`,
  `ANCHOR_MODE=live`,
  `BROADCAST_VIA=mapi`,
  `FEE_RATE=0.5`,
  `MIN_FEE=110`,
  `SPLIT_SATS=1000`,
  `# Master key (for reference only — containers use BRC-42 derived keys)`,
  `PRIVATE_KEY_WIF=${WIF}`,
  `CHANGE_ADDRESS=${masterAddress}`,
].join('\n') + '\n';
writeFileSync('.env.fleet', envContent);

console.log('  Written:');
console.log('    docker-compose.override.yml  (per-container BRC-42 WIFs)');
console.log('    data/fleet-funding-tx.hex     (funding tx for pre-split)');
console.log('    .env.fleet                    (base env)');
console.log('');
console.log('  To launch:');
console.log('    docker compose --env-file .env.fleet up -d');
console.log('');
console.log('  Each container gets:');
for (const c of containers) {
  console.log(`    ${c.name}: ${c.address} (vout ${c.index}, ${SATS_PER_CONTAINER.toLocaleString()} sats)`);
}
console.log('');
