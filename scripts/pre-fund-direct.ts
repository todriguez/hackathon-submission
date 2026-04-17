#!/usr/bin/env bun
/**
 * Pre-Fund (direct) — one-shot fan-out from a known consolidated UTXO.
 *
 * Why this exists: scripts/pre-fund.ts polls WoC's /unspent endpoint for UTXO
 * discovery, which caps at 1000 entries per page. When a wallet has > 1000
 * UTXOs (e.g. after a big run that left thousands of dust change outputs),
 * the mega-parent UTXO produced by scripts/consolidate.ts may land on a later
 * page and never appear in the /unspent response. Pre-fund then picks dust
 * and fails with "Invalid hex string" when WoC returns an error body for a
 * parent tx it can't serve.
 *
 * This script sidesteps the discovery step entirely: it reads the known
 * consolidated UTXO from data/consolidated.json (txid, vout, sats) and the
 * raw parent tx hex from data/funding-tx.hex, then builds + signs + broadcasts
 * the fan-out tx directly. Same outputs as pre-fund.ts's legacyPreFund().
 *
 * Requires env: PRIVATE_KEY_WIF (fresh wallet), CHANGE_ADDRESS (fresh address).
 */

import { PrivateKey, P2PKH, Transaction, ARC } from '@bsv/sdk';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
const CHANGE_ADDRESS = process.env.CHANGE_ADDRESS ?? '';

if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const FLOOR_NODES = 8;
const APEX_AGENTS = 5;
const TOTAL_CONTAINERS = FLOOR_NODES + APEX_AGENTS; // 13
const FLOOR_SHARE = 0.90;
const APEX_SHARE = 0.10;

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  PRE-FUND (direct) — fan-out from known consolidated UTXO');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const privKey = PrivateKey.fromWif(WIF);
const address = privKey.toPublicKey().toAddress();
const changeAddr = CHANGE_ADDRESS || address;

console.log(`  Address: ${address}`);
console.log(`  Change:  ${changeAddr}`);

// Load the known mega-parent from consolidate.ts output
const consolidated = JSON.parse(readFileSync('data/consolidated.json', 'utf-8'));
const parentHex = readFileSync('data/funding-tx.hex', 'utf-8').trim();

if (consolidated.address !== address) {
  console.error(`ERROR: data/consolidated.json address ${consolidated.address} ≠ WIF address ${address}`);
  process.exit(1);
}

console.log(`  Parent:  ${consolidated.txid}`);
console.log(`  Vout:    ${consolidated.vout}`);
console.log(`  Input:   ${consolidated.sats.toLocaleString()} sats (${(consolidated.sats / 1e8).toFixed(6)} BSV)`);
console.log('');

const sourceTx = Transaction.fromHex(parentHex);
const expectedTxid = sourceTx.id('hex') as string;
if (expectedTxid !== consolidated.txid) {
  console.error(`ERROR: parent hex txid ${expectedTxid} ≠ consolidated.json txid ${consolidated.txid}`);
  process.exit(1);
}

// Verify the claimed vout/sats match the parent tx
const out = sourceTx.outputs[consolidated.vout];
if (!out || out.satoshis !== consolidated.sats) {
  console.error(`ERROR: parent vout ${consolidated.vout} satoshis ${out?.satoshis} ≠ expected ${consolidated.sats}`);
  process.exit(1);
}

// Build fan-out tx
const p2pkh = new P2PKH();
const lockingScript = p2pkh.lock(address);
const tx = new Transaction();

tx.addInput({
  sourceTXID: consolidated.txid,
  sourceOutputIndex: consolidated.vout,
  sourceTransaction: sourceTx,
  unlockingScriptTemplate: p2pkh.unlock(privKey),
});

// Fee: 1 input × 148 + 14 outputs × 34 + overhead ≈ 650 bytes @ 0.5 sat/byte ≈ 325 sats.
// Be generous: 50 sat floor + 1 sat/byte estimate = ~700 sats
const estBytes = 10 + 148 + (TOTAL_CONTAINERS + 1) * 34;
const estFee = Math.max(50, Math.ceil(estBytes * 0.5));
const availSats = consolidated.sats - estFee;
const floorPerNode = Math.floor((availSats * FLOOR_SHARE) / FLOOR_NODES);
const apexPerAgent = Math.floor((availSats * APEX_SHARE) / APEX_AGENTS);

console.log(`  Fee estimate: ${estFee} sats`);
console.log(`  Per floor node: ${floorPerNode.toLocaleString()} sats (${(floorPerNode / 1e8).toFixed(6)} BSV)`);
console.log(`  Per apex agent: ${apexPerAgent.toLocaleString()} sats (${(apexPerAgent / 1e8).toFixed(6)} BSV)`);
console.log('');

const assignments: Array<{ label: string; sats: number; vout: number }> = [];
for (let i = 0; i < FLOOR_NODES; i++) {
  tx.addOutput({ lockingScript, satoshis: floorPerNode });
  assignments.push({ label: `floor-${i}`, sats: floorPerNode, vout: i });
}
for (let i = 0; i < APEX_AGENTS; i++) {
  tx.addOutput({ lockingScript, satoshis: apexPerAgent });
  assignments.push({ label: `apex-${i}`, sats: apexPerAgent, vout: FLOOR_NODES + i });
}

const allocated = floorPerNode * FLOOR_NODES + apexPerAgent * APEX_AGENTS;
const change = availSats - allocated;
if (change > 546) {
  tx.addOutput({ lockingScript, satoshis: change });
  console.log(`  Change output (vout ${TOTAL_CONTAINERS}): ${change} sats`);
}

await tx.sign();
const txHex = tx.toHex();
const txid = tx.id('hex') as string;

console.log(`  Tx size: ${txHex.length / 2} bytes`);
console.log('  Broadcasting via ARC (GorillaPool)...');

const arc = new ARC('https://arc.gorillapool.io');
const result: any = await tx.broadcast(arc);
if ('status' in result && result.status === 'error') {
  console.error(`  ERROR: ARC rejected: ${JSON.stringify(result)}`);
  process.exit(1);
}
console.log(`  ARC accepted: ${JSON.stringify(result).slice(0, 150)}`);

// WoC backup broadcast
try {
  const wocResp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: txHex }),
  });
  if (wocResp.ok) {
    console.log('  ✓ WoC backup broadcast confirmed');
  } else {
    const body = await wocResp.text().catch(() => '');
    if (body.includes('already-known') || body.includes('already in the mempool')) {
      console.log('  ✓ Tx already on network');
    } else {
      console.log(`  ⚠ WoC backup: ${wocResp.status} ${body.slice(0, 100)}`);
    }
  }
} catch (err: any) {
  console.log(`  ⚠ WoC backup error: ${err.message}`);
}

console.log(`  ✓ Fan-out txid: ${txid}`);
console.log(`  https://whatsonchain.com/tx/${txid}`);

// Wait for ARC to ingest (avoid orphan on children)
console.log('  Waiting for ARC to index fan-out...');
const arcUrl = process.env.ARC_URL ?? 'https://arc.gorillapool.io';
const waitStart = Date.now();
const waitCap = 90_000;
let arcSaw = false;
while (Date.now() - waitStart < waitCap) {
  try {
    const r = await fetch(`${arcUrl}/v1/tx/${txid}`);
    if (r.ok) {
      const body: any = await r.json().catch(() => ({}));
      const status: string = body?.txStatus ?? '';
      if (['SEEN_ON_NETWORK', 'MINED', 'ACCEPTED_BY_NETWORK', 'ANNOUNCED_TO_NETWORK', 'STORED', 'CONFIRMED'].includes(status)) {
        console.log(`  ✓ ARC indexed fan-out (${status}) after ${Date.now() - waitStart}ms`);
        arcSaw = true;
        break;
      } else if (status) {
        console.log(`  ARC status: ${status} — waiting...`);
      }
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
}
if (!arcSaw) {
  console.log(`  ⚠ ARC did not index fan-out within ${waitCap}ms — children may orphan. Proceeding anyway.`);
}

// Write funding hex (this IS the fan-out tx — floors/apex will decode it,
// pick their assigned vout, and pre-split from there)
mkdirSync('data', { recursive: true });
writeFileSync('data/funding-tx.hex', txHex);
console.log(`  Wrote data/funding-tx.hex (${(txHex.length / 2).toLocaleString()} bytes)`);
console.log('');

console.log('  Container assignments:');
for (const a of assignments) {
  console.log(`    ${a.label}: vout=${a.vout} → ${a.sats.toLocaleString()} sats`);
}

// Update .env.live with the new fan-out txid in the header comment only
// (all other env values should remain stable from the previous run)
console.log('');
console.log('  ✓ done — run scripts/preflight.sh next, then docker compose up.');
console.log('');
