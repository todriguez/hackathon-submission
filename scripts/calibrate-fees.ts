#!/usr/bin/env bun
/**
 * Fee calibration: test which sat/byte rate gets txs actually on-chain
 * via a given ARC provider.
 *
 * Method:
 *   1. Find a spendable UTXO at the funding address (from WoC or Bitails).
 *   2. Fan out to N × RATES buckets of 500-sat outputs.
 *   3. Spend each fan-out output to self at its test fee rate.
 *   4. Wait, then poll WoC /tx/:txid to see which landed.
 *
 * Usage:
 *   set -a && source .env.live && set +a
 *   bun run scripts/calibrate-fees.ts
 *
 * Env:
 *   PRIVATE_KEY_WIF (required)
 *   ARC_URL         (default: https://arc.gorillapool.io)
 *   SWEEP_TXID      (optional: a specific parent txid:vout:sats to spend)
 *   SWEEP_VOUT      (default: 0)
 *   SWEEP_SATS      (optional: override; else fetched from WoC/Bitails)
 */

import { PrivateKey, Transaction, P2PKH, ARC } from '@bsv/sdk';

const WIF = process.env.PRIVATE_KEY_WIF;
if (!WIF) { console.error('ERROR: Set PRIVATE_KEY_WIF'); process.exit(1); }

const priv = PrivateKey.fromWif(WIF);
const address = priv.toPublicKey().toAddress();
const arc = new ARC(process.env.ARC_URL ?? 'https://arc.gorillapool.io');
const p2pkh = new P2PKH();
const lockingScript = p2pkh.lock(address);

const RATES = [0.05, 0.1, 0.5];     // sat/byte
const PER_RATE = 20;                 // txs per rate
const TEST_OUTPUT_SATS = 500;        // per fan-out output
const TOTAL = RATES.length * PER_RATE; // 60

console.log('');
console.log('════════════════════════════════════════════');
console.log('  FEE CALIBRATION');
console.log('════════════════════════════════════════════');
console.log(`  Address : ${address}`);
console.log(`  ARC     : ${(arc as any).URL ?? process.env.ARC_URL ?? 'gorillapool'}`);
console.log(`  Rates   : ${RATES.join(', ')} sat/byte`);
console.log(`  Per rate: ${PER_RATE} txs  (total: ${TOTAL})`);
console.log('');

// ── 1. Find a parent UTXO ──

let parentTxid = process.env.SWEEP_TXID ?? '';
let parentVout = Number(process.env.SWEEP_VOUT ?? '0');
let parentSats = Number(process.env.SWEEP_SATS ?? '0');

if (!parentTxid) {
  console.log('  Finding spendable UTXO via Bitails...');
  const resp = await fetch(`https://api.bitails.io/address/${address}/unspent?limit=50`);
  const data: any = await resp.json();
  const arr: any[] = Array.isArray(data) ? data : (data.unspent ?? []);
  // Prefer the largest UTXO
  arr.sort((a, b) => (b.satoshis ?? b.value ?? 0) - (a.satoshis ?? a.value ?? 0));
  if (arr.length === 0) { console.error('  No UTXOs at address'); process.exit(1); }
  parentTxid = arr[0].txid ?? arr[0].tx_hash;
  parentVout = arr[0].vout ?? arr[0].tx_pos ?? 0;
  parentSats = arr[0].satoshis ?? arr[0].value ?? 0;
}
console.log(`  Parent : ${parentTxid}:${parentVout} (${parentSats.toLocaleString()} sats)`);

const needed = TOTAL * TEST_OUTPUT_SATS + 5000; // test outputs + fan-out fee headroom
if (parentSats < needed) {
  console.error(`  Parent too small: ${parentSats} < needed ${needed}`);
  process.exit(1);
}

// ── 2. Build fan-out tx at 1 sat/byte (safe, don't care about this one's rate) ──

const fanoutTx = new Transaction();
fanoutTx.addInput({
  sourceTXID: parentTxid,
  sourceOutputIndex: parentVout,
  unlockingScriptTemplate: p2pkh.unlock(priv, 'all', false, parentSats, lockingScript),
});
for (let i = 0; i < TOTAL; i++) {
  fanoutTx.addOutput({ lockingScript, satoshis: TEST_OUTPUT_SATS });
}
const fanoutBytes = 10 + 148 + TOTAL * 34;
const fanoutFee = Math.ceil(fanoutBytes * 1); // 1 sat/byte for the fan-out itself
const changeSats = parentSats - TOTAL * TEST_OUTPUT_SATS - fanoutFee;
if (changeSats > 546) fanoutTx.addOutput({ lockingScript, satoshis: changeSats });
await fanoutTx.sign();
const fanoutTxid = fanoutTx.id('hex') as string;

console.log('');
console.log(`  Fan-out tx: ${fanoutTxid}`);
console.log(`    ${TOTAL} × ${TEST_OUTPUT_SATS} sats + change ${changeSats} — fee ${fanoutFee} sats`);

console.log('  Broadcasting fan-out...');
try {
  const r: any = await fanoutTx.broadcast(arc);
  console.log(`  → ${JSON.stringify(r).slice(0, 200)}`);
} catch (e: any) {
  console.error(`  Fan-out broadcast failed: ${e.message}`);
  process.exit(1);
}
console.log(`  https://whatsonchain.com/tx/${fanoutTxid}`);

// Give the fan-out a moment to propagate so children are accepted
console.log('  Waiting 8s for propagation...');
await new Promise(r => setTimeout(r, 8000));

// ── 3. Build and broadcast one test tx per (rate, i), consuming fanout output (rateIdx*PER_RATE + i) ──

interface TestResult { rate: number; txid: string; fee: number; broadcastOk: boolean; broadcastMsg: string; onChain?: boolean; }
const results: TestResult[] = [];

let voutCursor = 0;
for (const rate of RATES) {
  console.log('');
  console.log(`  --- Rate ${rate} sat/byte ---`);
  for (let i = 0; i < PER_RATE; i++) {
    const tx = new Transaction();
    tx.addInput({
      sourceTXID: fanoutTxid,
      sourceOutputIndex: voutCursor,
      unlockingScriptTemplate: p2pkh.unlock(priv, 'all', false, TEST_OUTPUT_SATS, lockingScript),
    });
    // estimate size: 10 base + 148 per input + 34 per output
    const estBytes = 10 + 148 + 34;
    const fee = Math.max(1, Math.ceil(estBytes * rate));
    const outSats = TEST_OUTPUT_SATS - fee;
    if (outSats < 1) { console.log(`    skip i=${i}: output <1 sat`); voutCursor++; continue; }
    tx.addOutput({ lockingScript, satoshis: outSats });
    await tx.sign();
    const txid = tx.id('hex') as string;

    let broadcastOk = false, broadcastMsg = '';
    try {
      const r: any = await tx.broadcast(arc);
      const s = JSON.stringify(r);
      broadcastOk = !s.includes('"error"') && !s.toLowerCase().includes('rejected');
      broadcastMsg = s.slice(0, 120);
    } catch (e: any) { broadcastMsg = e.message; }

    results.push({ rate, txid, fee, broadcastOk, broadcastMsg });
    voutCursor++;
  }
  const okCount = results.filter(r => r.rate === rate && r.broadcastOk).length;
  console.log(`    broadcast ok: ${okCount}/${PER_RATE}`);
}

// ── 4. Wait then check WoC confirmation ──

console.log('');
console.log('  Waiting 90s then polling WoC...');
await new Promise(r => setTimeout(r, 90000));

for (const r of results) {
  if (!r.broadcastOk) continue;
  try {
    const resp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${r.txid}`);
    r.onChain = resp.status === 200;
  } catch { r.onChain = false; }
  await new Promise(s => setTimeout(s, 250)); // 4 req/sec, under WoC limit
}

// ── 5. Report ──

console.log('');
console.log('  ═══ RESULTS ═══');
for (const rate of RATES) {
  const subset = results.filter(r => r.rate === rate);
  const bc = subset.filter(r => r.broadcastOk).length;
  const onChain = subset.filter(r => r.onChain).length;
  const fee = subset[0]?.fee ?? 0;
  console.log(`  ${rate} sat/byte (fee=${fee}):  broadcast ${bc}/${subset.length}, on-chain ${onChain}/${subset.length}`);
}
console.log('');
console.log(`  Fan-out parent: https://whatsonchain.com/tx/${fanoutTxid}`);
console.log('');
