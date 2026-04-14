#!/usr/bin/env bun
/**
 * Pre-Fund — Split a funded UTXO into per-container chunks.
 *
 * Run this ONCE after funding the address. It creates a single fan-out tx
 * that gives each container its own UTXO. No races, no double-spends.
 *
 * Flow:
 *   1. Fund the address (from show-funding-addresses.ts)
 *   2. Run this script → creates fan-out tx, writes .env.live
 *   3. Launch Docker with --env-file .env.live
 *
 * Usage:
 *   PRIVATE_KEY_WIF=L364... bun run scripts/pre-fund.ts
 *   PRIVATE_KEY_WIF=L364... CHANGE_ADDRESS=1xxx bun run scripts/pre-fund.ts
 */

import { PrivateKey, Transaction, P2PKH, ARC } from '@bsv/sdk';
import { writeFileSync } from 'fs';

const WIF = process.env.PRIVATE_KEY_WIF;
if (!WIF) {
  console.error('ERROR: Set PRIVATE_KEY_WIF env var');
  process.exit(1);
}

const privKey = PrivateKey.fromWif(WIF);
const pubKey = privKey.toPublicKey();
const address = pubKey.toAddress();
const CHANGE_ADDRESS = process.env.CHANGE_ADDRESS || address;

const FLOOR_NODES = 8;
const APEX_AGENTS = 5;
const TOTAL_CONTAINERS = FLOOR_NODES + APEX_AGENTS; // 13

// Floor nodes get the bulk, apex gets less
// With 5 BSV (500M sats), floor gets ~90%, apex gets ~10%
const FLOOR_SHARE = 0.90;
const APEX_SHARE = 0.10;

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  PRE-FUND — Splitting UTXO into per-container chunks');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Address: ${address}`);
console.log(`  Change:  ${CHANGE_ADDRESS}`);
console.log('');

// ── Find funding UTXOs ──

console.log('  Polling WhatsOnChain for UTXOs...');

const resp = await fetch(
  `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
);
if (!resp.ok) {
  console.error(`  ERROR: WoC returned ${resp.status}`);
  process.exit(1);
}

const utxos: any[] = await resp.json();
if (utxos.length === 0) {
  console.error('  ERROR: No UTXOs found. Fund the address first!');
  console.error(`  Address: ${address}`);
  process.exit(1);
}

// Sum all UTXOs
const totalSats = utxos.reduce((s: number, u: any) => s + u.value, 0);
console.log(`  Found ${utxos.length} UTXOs totaling ${totalSats.toLocaleString()} sats (${(totalSats / 1e8).toFixed(4)} BSV)`);

// Fetch full tx hex for each UTXO (needed for signing)
const fundingInputs: Array<{ txid: string; vout: number; sats: number; sourceTx: Transaction }> = [];
for (const u of utxos) {
  const txResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${u.tx_hash}/hex`);
  const txHex = await txResp.text();
  fundingInputs.push({
    txid: u.tx_hash,
    vout: u.tx_pos,
    sats: u.value,
    sourceTx: Transaction.fromHex(txHex),
  });
}

// ── Build fan-out tx ──

const p2pkh = new P2PKH();
const lockingScript = p2pkh.lock(address);
const tx = new Transaction();

// Add all funding UTXOs as inputs
for (const inp of fundingInputs) {
  tx.addInput({
    sourceTXID: inp.txid,
    sourceOutputIndex: inp.vout,
    sourceTransaction: inp.sourceTx,
    unlockingScriptTemplate: p2pkh.unlock(privKey),
  });
}

// Estimate fee (generous)
const estInputBytes = fundingInputs.length * 148;
const estOutputBytes = (TOTAL_CONTAINERS + 1) * 34; // +1 for change
const estFee = Math.max(50, Math.ceil((10 + estInputBytes + estOutputBytes) * 0.5)); // 0.5 sat/byte, generous

const availSats = totalSats - estFee;
const floorPerNode = Math.floor((availSats * FLOOR_SHARE) / FLOOR_NODES);
const apexPerAgent = Math.floor((availSats * APEX_SHARE) / APEX_AGENTS);

console.log('');
console.log(`  Fee estimate: ${estFee} sats`);
console.log(`  Per floor node: ${floorPerNode.toLocaleString()} sats (${(floorPerNode / 1e8).toFixed(4)} BSV)`);
console.log(`  Per apex agent: ${apexPerAgent.toLocaleString()} sats (${(apexPerAgent / 1e8).toFixed(4)} BSV)`);
console.log('');

// vout 0..7 = floor nodes, vout 8..12 = apex agents
const assignments: Array<{ label: string; sats: number; vout: number }> = [];

for (let i = 0; i < FLOOR_NODES; i++) {
  tx.addOutput({ lockingScript, satoshis: floorPerNode });
  assignments.push({ label: `floor-${i}`, sats: floorPerNode, vout: i });
}

for (let i = 0; i < APEX_AGENTS; i++) {
  tx.addOutput({ lockingScript, satoshis: apexPerAgent });
  assignments.push({ label: `apex-${i}`, sats: apexPerAgent, vout: FLOOR_NODES + i });
}

// Change output (dust from rounding)
const allocated = floorPerNode * FLOOR_NODES + apexPerAgent * APEX_AGENTS;
const change = availSats - allocated;
if (change > 546) {
  tx.addOutput({ lockingScript, satoshis: change });
  console.log(`  Change output (vout ${TOTAL_CONTAINERS}): ${change} sats`);
}

// Sign and broadcast
await tx.sign();
const txHex = tx.toHex();
const txid = tx.id('hex') as string;

console.log(`  Tx size: ${txHex.length / 2} bytes`);
console.log('  Broadcasting via ARC + WoC (dual broadcast)...');

const arc = new ARC('https://arc.gorillapool.io');
const result = await tx.broadcast(arc);

if ('status' in result && (result as any).status === 'error') {
  console.error(`  ERROR: ARC rejected: ${JSON.stringify(result)}`);
  process.exit(1);
}

// ARC says ANNOUNCED but doesn't always propagate — backup via WoC direct to nodes
const wocResp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ txhex: txHex }),
});
if (wocResp.ok) {
  console.log('  ✓ WoC backup broadcast confirmed');
} else {
  console.log(`  ⚠ WoC backup: ${wocResp.status} ${await wocResp.text().catch(() => '')}`);
}

console.log(`  ✓ Fan-out tx: ${txid}`);
console.log(`  https://whatsonchain.com/tx/${txid}`);
console.log('');

// ── Print assignments ──

console.log('  Container assignments:');
for (const a of assignments) {
  console.log(`    ${a.label}: vout=${a.vout} → ${a.sats.toLocaleString()} sats`);
}

// ── Write .env.live ──

const envLines = [
  `# Generated by pre-fund.ts at ${new Date().toISOString()}`,
  `# Fan-out txid: ${txid}`,
  `PRIVATE_KEY_WIF=${WIF}`,
  `CHANGE_ADDRESS=${CHANGE_ADDRESS}`,
  `ANCHOR_MODE=live`,
  `FUNDING_TX_HEX=${txHex}`,
  // Per-container vouts are in docker-compose
];

writeFileSync('.env.live', envLines.join('\n') + '\n');
console.log('');
console.log('  Wrote .env.live');
console.log('');
console.log('  To launch:');
console.log('');
console.log('  docker compose -f docker-compose.casino-floor.yml --env-file .env.live up -d');
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
