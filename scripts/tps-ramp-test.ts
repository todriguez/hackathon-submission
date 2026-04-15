#!/usr/bin/env bun
/**
 * TPS Ramp-Up Test -- Find max sustainable throughput before committing real budget.
 *
 * Phases:
 *   1. Verify funding (check UTXOs via WhatsOnChain)
 *   2. Pre-split into small UTXOs (500 sats default)
 *   3. Ramp up TPS: start at 1 tx/sec, increase by RAMP_STEP every RAMP_INTERVAL seconds
 *   4. Report: per-level stats table, max sustainable TPS, recommendations
 *
 * Budget control:
 *   MAX_SATS caps total spend (default 1,000,000 = 0.01 BSV).
 *   Ctrl+C stops cleanly and prints partial report.
 *
 * Usage:
 *   PRIVATE_KEY_WIF=L... bun run scripts/tps-ramp-test.ts
 *   PRIVATE_KEY_WIF=L... MAX_SATS=500000 RAMP_STEP=2 bun run scripts/tps-ramp-test.ts
 *
 * Env vars:
 *   PRIVATE_KEY_WIF   -- (required) Funded WIF private key
 *   ARC_URL           -- ARC endpoint (default: https://arc.gorillapool.io)
 *   API_KEY           -- ARC API key (optional, GorillaPool needs none)
 *   MAX_SATS          -- Cap total satoshis spent (default: 1000000)
 *   SPLIT_SATS        -- Sats per pre-split UTXO (default: 500)
 *   FEE_RATE          -- Sats/byte (default: 0.1)
 *   MIN_FEE           -- Minimum fee floor in sats (default: 25)
 *   RAMP_STEP         -- TPS increase per ramp level (default: 1)
 *   RAMP_INTERVAL     -- Seconds at each TPS level before ramping (default: 10)
 *   FAIL_THRESHOLD    -- Failure rate (0-1) that stops ramp (default: 0.2)
 *   MIN_BALANCE_SATS  -- Abort if balance below this (default: 50000)
 */

import { PrivateKey, Transaction, P2PKH, ARC, LockingScript } from '@bsv/sdk';

// ── Config from env ──

const WIF = process.env.PRIVATE_KEY_WIF;
if (!WIF) {
  console.error('ERROR: Set PRIVATE_KEY_WIF env var');
  process.exit(1);
}

const ARC_URL           = process.env.ARC_URL ?? 'https://arc.gorillapool.io';
const API_KEY           = process.env.API_KEY ?? '';
const MAX_SATS          = parseInt(process.env.MAX_SATS ?? '1000000', 10);
const SPLIT_SATS        = parseInt(process.env.SPLIT_SATS ?? '500', 10);
const FEE_RATE          = parseFloat(process.env.FEE_RATE ?? '0.1');
const MIN_FEE           = parseInt(process.env.MIN_FEE ?? '25', 10);
const RAMP_STEP         = parseInt(process.env.RAMP_STEP ?? '1', 10);
const RAMP_INTERVAL_SEC = parseInt(process.env.RAMP_INTERVAL ?? '10', 10);
const FAIL_THRESHOLD    = parseFloat(process.env.FAIL_THRESHOLD ?? '0.2');
const MIN_BALANCE_SATS  = parseInt(process.env.MIN_BALANCE_SATS ?? '50000', 10);

const privKey = PrivateKey.fromWif(WIF);
const pubKey  = privKey.toPublicKey();
const address = pubKey.toAddress();

const arc = API_KEY ? new ARC(ARC_URL, API_KEY) : new ARC(ARC_URL);

// ── Types ──

interface SplitUtxo {
  txid: string;
  vout: number;
  satoshis: number;
  sourceTx: Transaction;
}

interface LevelStats {
  tps: number;
  attempts: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  feesSpent: number;
}

// ── State ──

const utxoPool: SplitUtxo[] = [];
let totalSatsSpent = 0;
let aborted = false;
const levelResults: LevelStats[] = [];

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n  Ctrl+C received -- stopping ramp, printing report...');
  aborted = true;
});

// ── Helpers ──

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`  [${ts}] ${tag}: ${msg}`);
}

/** Build OP_RETURN locking script with test payload (~250 bytes) */
function buildOpReturnScript(seqNum: number): LockingScript {
  // OP_FALSE OP_RETURN <protocol_tag> <timestamp> <sequence> <padding>
  const tag = Buffer.from('semantos/tps-ramp-test/v1', 'utf8');
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Date.now()));
  const seq = Buffer.alloc(4);
  seq.writeUInt32BE(seqNum);
  // Pad to ~250 bytes total (tag 25 + ts 8 + seq 4 + pad ~200)
  const pad = Buffer.alloc(200);
  for (let i = 0; i < 200; i++) pad[i] = (seqNum + i) & 0xff;

  // Build script: OP_FALSE(0x00) OP_RETURN(0x6a) then push-data chunks
  const chunks: number[] = [];
  chunks.push(0x00); // OP_FALSE
  chunks.push(0x6a); // OP_RETURN

  for (const buf of [tag, timestamp, seq, pad]) {
    if (buf.length < 76) {
      chunks.push(buf.length);
    } else if (buf.length <= 0xff) {
      chunks.push(0x4c); // OP_PUSHDATA1
      chunks.push(buf.length);
    } else {
      chunks.push(0x4d); // OP_PUSHDATA2
      chunks.push(buf.length & 0xff);
      chunks.push((buf.length >> 8) & 0xff);
    }
    for (const b of buf) chunks.push(b);
  }

  return LockingScript.fromHex(Buffer.from(chunks).toString('hex'));
}

/** Estimate fee for an OP_RETURN test tx */
function estimateFee(): number {
  // ~10 overhead + 148 input + 250 OP_RETURN output + 34 change output = ~442 bytes
  return Math.max(MIN_FEE, Math.ceil(442 * FEE_RATE));
}

// ══════════════════════════════════════════════════════════════════
// Phase 1: Verify Funding
// ══════════════════════════════════════════════════════════════════

console.log('');
console.log('================================================================');
console.log('  TPS RAMP-UP TEST');
console.log('================================================================');
console.log(`  Address:       ${address}`);
console.log(`  ARC endpoint:  ${ARC_URL}`);
console.log(`  Max spend:     ${MAX_SATS.toLocaleString()} sats (${(MAX_SATS / 1e8).toFixed(4)} BSV)`);
console.log(`  Split size:    ${SPLIT_SATS} sats`);
console.log(`  Fee rate:      ${FEE_RATE} sat/byte`);
console.log(`  Ramp:          +${RAMP_STEP} TPS every ${RAMP_INTERVAL_SEC}s`);
console.log(`  Fail threshold: ${(FAIL_THRESHOLD * 100).toFixed(0)}%`);
console.log('');

log('FUND', 'Checking UTXOs via WhatsOnChain...');

const utxoResp = await fetch(
  `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
);
if (!utxoResp.ok) {
  console.error(`  ERROR: WoC returned ${utxoResp.status}`);
  process.exit(1);
}

const rawUtxos: any[] = await utxoResp.json();
if (rawUtxos.length === 0) {
  console.error('  ERROR: No UTXOs found. Fund the address first!');
  console.error(`  Address: ${address}`);
  process.exit(1);
}

const totalBalance = rawUtxos.reduce((s: number, u: any) => s + u.value, 0);
log('FUND', `Found ${rawUtxos.length} UTXOs totaling ${totalBalance.toLocaleString()} sats (${(totalBalance / 1e8).toFixed(4)} BSV)`);

if (totalBalance < MIN_BALANCE_SATS) {
  console.error(`  ERROR: Balance ${totalBalance} sats is below minimum ${MIN_BALANCE_SATS} sats. Fund the address.`);
  process.exit(1);
}

// Cap how much we'll use for this test
const budgetSats = Math.min(MAX_SATS, totalBalance);
log('FUND', `Test budget: ${budgetSats.toLocaleString()} sats`);

// ══════════════════════════════════════════════════════════════════
// Phase 2: Pre-Split
// ══════════════════════════════════════════════════════════════════

log('SPLIT', 'Fetching source transactions for signing...');

// Gather funding inputs (fetch full tx hex for each UTXO)
interface FundingInput {
  txid: string;
  vout: number;
  sats: number;
  sourceTx: Transaction;
}

const fundingInputs: FundingInput[] = [];
let gatheredSats = 0;

// Sort UTXOs largest first, gather enough to cover budget
const sortedUtxos = rawUtxos.sort((a: any, b: any) => b.value - a.value);
for (const u of sortedUtxos) {
  if (gatheredSats >= budgetSats) break;
  const txResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${u.tx_hash}/hex`);
  if (!txResp.ok) {
    log('SPLIT', `Warning: could not fetch tx ${u.tx_hash}, skipping`);
    continue;
  }
  const txHex = await txResp.text();
  fundingInputs.push({
    txid: u.tx_hash,
    vout: u.tx_pos,
    sats: u.value,
    sourceTx: Transaction.fromHex(txHex),
  });
  gatheredSats += u.value;
}

if (fundingInputs.length === 0) {
  console.error('  ERROR: Could not fetch any source transactions');
  process.exit(1);
}

log('SPLIT', `Using ${fundingInputs.length} UTXOs (${gatheredSats.toLocaleString()} sats) for split`);

// Calculate splits
const INPUT_SIZE = 148;
const OUTPUT_SIZE = 34;
const OVERHEAD = 10;
const splitFeeEst = Math.max(
  MIN_FEE,
  Math.ceil((OVERHEAD + fundingInputs.length * INPUT_SIZE + OUTPUT_SIZE * 2) * FEE_RATE),
);
const maxSplits = Math.floor(
  (Math.min(gatheredSats, budgetSats) - splitFeeEst) / (SPLIT_SATS + Math.ceil(OUTPUT_SIZE * FEE_RATE)),
);
const numSplits = Math.max(1, Math.min(maxSplits, 2000)); // cap at 2000 to keep tx reasonable

log('SPLIT', `Creating ${numSplits} UTXOs of ${SPLIT_SATS} sats each...`);

const p2pkh = new P2PKH();
const lockingScript = p2pkh.lock(address);
const splitTx = new Transaction();

for (const inp of fundingInputs) {
  splitTx.addInput({
    sourceTXID: inp.txid,
    sourceOutputIndex: inp.vout,
    sourceTransaction: inp.sourceTx,
    unlockingScriptTemplate: p2pkh.unlock(privKey),
  });
}

for (let i = 0; i < numSplits; i++) {
  splitTx.addOutput({ lockingScript, satoshis: SPLIT_SATS });
}

// Change
const totalSplitOut = numSplits * SPLIT_SATS;
const splitFee = Math.max(
  MIN_FEE,
  Math.ceil((OVERHEAD + fundingInputs.length * INPUT_SIZE + OUTPUT_SIZE * (numSplits + 1)) * FEE_RATE),
);
const splitChange = gatheredSats - totalSplitOut - splitFee;
if (splitChange > 546) {
  splitTx.addOutput({ lockingScript, satoshis: splitChange });
}

await splitTx.sign();
const splitHex = splitTx.toHex();
const splitTxid = splitTx.id('hex') as string;

log('SPLIT', `Tx size: ${(splitHex.length / 2).toLocaleString()} bytes, fee: ${splitFee} sats`);
log('SPLIT', 'Broadcasting split tx via ARC...');

const splitResult = await splitTx.broadcast(arc);
if ('status' in splitResult && (splitResult as any).status === 'error') {
  console.error(`  ERROR: ARC rejected split tx: ${JSON.stringify(splitResult)}`);
  process.exit(1);
}

// WoC backup broadcast
const wocResp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ txhex: splitHex }),
});
if (wocResp.ok) {
  log('SPLIT', 'WoC backup broadcast confirmed');
} else {
  log('SPLIT', `WoC backup: ${wocResp.status} (non-critical)`);
}

log('SPLIT', `Split tx: ${splitTxid}`);
log('SPLIT', `  https://whatsonchain.com/tx/${splitTxid}`);

// Populate UTXO pool
for (let i = 0; i < numSplits; i++) {
  utxoPool.push({
    txid: splitTxid,
    vout: i,
    satoshis: SPLIT_SATS,
    sourceTx: splitTx,
  });
}

totalSatsSpent += splitFee;
log('SPLIT', `Pool ready: ${utxoPool.length} UTXOs. Fees so far: ${totalSatsSpent} sats`);
console.log('');

// Small delay to let the split tx propagate before we start spending its outputs
log('RAMP', 'Waiting 3s for split tx propagation...');
await new Promise(r => setTimeout(r, 3000));

// ══════════════════════════════════════════════════════════════════
// Phase 3: Ramp-Up Broadcast Test
// ══════════════════════════════════════════════════════════════════

log('RAMP', 'Starting TPS ramp-up...');
console.log('');

let globalSeq = 0;
let maxSustainableTps = 0;

/**
 * Broadcast a single OP_RETURN test tx.
 * Returns { success, latencyMs, fee } or throws.
 */
async function broadcastOne(): Promise<{ success: boolean; latencyMs: number; fee: number; error?: string }> {
  if (utxoPool.length === 0) {
    return { success: false, latencyMs: 0, fee: 0, error: 'no UTXOs left' };
  }

  const funding = utxoPool.shift()!;
  const seq = globalSeq++;
  const fee = estimateFee();

  const opReturnScript = buildOpReturnScript(seq);
  const tx = new Transaction();

  tx.addInput({
    sourceTXID: funding.txid,
    sourceOutputIndex: funding.vout,
    sourceTransaction: funding.sourceTx,
    unlockingScriptTemplate: p2pkh.unlock(privKey),
  });

  // OP_RETURN output (0 sats -- unspendable)
  tx.addOutput({
    lockingScript: opReturnScript,
    satoshis: 0,
  });

  // Change back to pool
  const change = funding.satoshis - fee;
  if (change > 546) {
    tx.addOutput({
      lockingScript,
      satoshis: change,
    });
  }

  await tx.sign();

  const t0 = Date.now();
  try {
    const result = await tx.broadcast(arc);
    const latencyMs = Date.now() - t0;

    if ('status' in result && (result as any).status === 'error') {
      return { success: false, latencyMs, fee, error: JSON.stringify(result) };
    }

    // Recycle change UTXO back into pool
    if (change > 546) {
      const txid = tx.id('hex') as string;
      utxoPool.push({
        txid,
        vout: 1, // change is output index 1
        satoshis: change,
        sourceTx: tx,
      });
    }

    totalSatsSpent += fee;
    return { success: true, latencyMs, fee };
  } catch (err: any) {
    const latencyMs = Date.now() - t0;
    return { success: false, latencyMs, fee: 0, error: err.message };
  }
}

/**
 * Run one ramp level: attempt `targetTps` tx/sec for `durationSec` seconds.
 */
async function runLevel(targetTps: number, durationSec: number): Promise<LevelStats> {
  const stats: LevelStats = {
    tps: targetTps,
    attempts: 0,
    successes: 0,
    failures: 0,
    totalLatencyMs: 0,
    minLatencyMs: Infinity,
    maxLatencyMs: 0,
    feesSpent: 0,
  };

  const intervalMs = 1000 / targetTps;
  const levelStart = Date.now();
  const levelEnd = levelStart + durationSec * 1000;

  // We send transactions spaced by intervalMs, collecting results
  const pending: Promise<void>[] = [];
  let nextSendTime = levelStart;

  while (Date.now() < levelEnd && !aborted) {
    // Budget check
    if (totalSatsSpent >= MAX_SATS) {
      log('RAMP', 'MAX_SATS budget reached -- stopping');
      aborted = true;
      break;
    }

    // UTXO check
    if (utxoPool.length === 0) {
      log('RAMP', 'UTXO pool exhausted -- stopping');
      aborted = true;
      break;
    }

    const now = Date.now();
    if (now < nextSendTime) {
      // Wait until next slot
      await new Promise(r => setTimeout(r, Math.max(1, nextSendTime - now)));
    }
    nextSendTime = Date.now() + intervalMs;

    stats.attempts++;
    // Fire broadcast (don't await individually -- track in pending)
    const p = broadcastOne().then(r => {
      if (r.success) {
        stats.successes++;
        stats.feesSpent += r.fee;
      } else {
        stats.failures++;
        if (r.error && stats.failures <= 3) {
          log('RAMP', `  Fail: ${r.error.slice(0, 120)}`);
        }
      }
      stats.totalLatencyMs += r.latencyMs;
      stats.minLatencyMs = Math.min(stats.minLatencyMs, r.latencyMs);
      stats.maxLatencyMs = Math.max(stats.maxLatencyMs, r.latencyMs);
    });
    pending.push(p);
  }

  // Wait for all in-flight broadcasts to settle
  await Promise.allSettled(pending);

  if (stats.minLatencyMs === Infinity) stats.minLatencyMs = 0;
  return stats;
}

// Main ramp loop
let currentTps = RAMP_STEP;
while (!aborted) {
  log('RAMP', `--- Level: ${currentTps} tx/sec (${RAMP_INTERVAL_SEC}s) | Pool: ${utxoPool.length} UTXOs | Spent: ${totalSatsSpent.toLocaleString()} sats ---`);

  const stats = await runLevel(currentTps, RAMP_INTERVAL_SEC);
  levelResults.push(stats);

  const failRate = stats.attempts > 0 ? stats.failures / stats.attempts : 0;
  const avgLatency = stats.attempts > 0 ? Math.round(stats.totalLatencyMs / stats.attempts) : 0;
  const actualTps = stats.successes / RAMP_INTERVAL_SEC;

  log('RAMP', `  Results: ${stats.successes}/${stats.attempts} ok (${(failRate * 100).toFixed(1)}% fail), avg ${avgLatency}ms, actual ${actualTps.toFixed(1)} tx/s`);

  if (failRate <= FAIL_THRESHOLD && stats.successes > 0) {
    maxSustainableTps = actualTps;
  }

  if (failRate > FAIL_THRESHOLD) {
    log('RAMP', `  Failure rate ${(failRate * 100).toFixed(1)}% exceeds threshold ${(FAIL_THRESHOLD * 100).toFixed(0)}% -- stopping ramp`);
    break;
  }

  currentTps += RAMP_STEP;
}

// ══════════════════════════════════════════════════════════════════
// Phase 4: Report
// ══════════════════════════════════════════════════════════════════

console.log('');
console.log('================================================================');
console.log('  TPS RAMP-UP RESULTS');
console.log('================================================================');
console.log('');

// Table header
const hdr = [
  'TPS Target'.padEnd(12),
  'Attempts'.padStart(10),
  'Success'.padStart(10),
  'Fail'.padStart(8),
  'Fail%'.padStart(8),
  'Avg(ms)'.padStart(10),
  'Min(ms)'.padStart(10),
  'Max(ms)'.padStart(10),
  'Fees'.padStart(10),
].join(' | ');
console.log(`  ${hdr}`);
console.log(`  ${''.padEnd(hdr.length, '-')}`);

let totalTxs = 0;
let totalFees = 0;
for (const l of levelResults) {
  const failPct = l.attempts > 0 ? ((l.failures / l.attempts) * 100).toFixed(1) : '0.0';
  const avgMs = l.attempts > 0 ? Math.round(l.totalLatencyMs / l.attempts) : 0;
  const row = [
    String(l.tps).padEnd(12),
    String(l.attempts).padStart(10),
    String(l.successes).padStart(10),
    String(l.failures).padStart(8),
    `${failPct}%`.padStart(8),
    String(avgMs).padStart(10),
    String(l.minLatencyMs).padStart(10),
    String(l.maxLatencyMs).padStart(10),
    String(l.feesSpent).padStart(10),
  ].join(' | ');
  console.log(`  ${row}`);
  totalTxs += l.successes;
  totalFees += l.feesSpent;
}

console.log('');
console.log('  Summary:');
console.log(`    Max sustainable TPS:   ${maxSustainableTps.toFixed(1)} tx/sec`);
console.log(`    Total txs broadcast:   ${totalTxs.toLocaleString()}`);
console.log(`    Total fees spent:      ${totalFees.toLocaleString()} sats (${(totalFees / 1e8).toFixed(6)} BSV)`);
console.log(`    Total sats spent:      ${totalSatsSpent.toLocaleString()} sats (incl. split fee)`);
console.log(`    UTXOs remaining:       ${utxoPool.length}`);
console.log(`    Remaining in pool:     ~${(utxoPool.length * SPLIT_SATS).toLocaleString()} sats`);
console.log('');

// Recommendations for full run
if (maxSustainableTps > 0) {
  const targetDaily = 1_500_000;
  const safeMargin = 0.8; // run at 80% of max
  const safeTps = maxSustainableTps * safeMargin;
  const hoursNeeded = targetDaily / (safeTps * 3600);
  const estFeePerTx = totalFees > 0 ? totalFees / totalTxs : estimateFee();
  const estTotalFeeBsv = (targetDaily * estFeePerTx) / 1e8;

  console.log('  Recommendations for full 3 BSV run:');
  console.log(`    Safe operating TPS:    ${safeTps.toFixed(1)} tx/sec (80% of max)`);
  console.log(`    Streams needed:        ${Math.max(1, Math.ceil(safeTps / 5))} (at ~5 tx/s per stream)`);
  console.log(`    Est. hours for 1.5M:   ${hoursNeeded.toFixed(1)}h`);
  console.log(`    Est. fee per tx:       ${estFeePerTx.toFixed(1)} sats`);
  console.log(`    Est. total fees:       ${estTotalFeeBsv.toFixed(4)} BSV for ${(targetDaily / 1e6).toFixed(1)}M txs`);
  console.log(`    Funding needed:        ~${(estTotalFeeBsv * 1.2).toFixed(4)} BSV (with 20% margin)`);
  console.log('');
  console.log(`  Suggested env for full run:`);
  console.log(`    STREAMS=${Math.max(1, Math.ceil(safeTps / 5))}`);
  console.log(`    FEE_RATE=${FEE_RATE}`);
  console.log(`    SPLIT_SATS=${SPLIT_SATS}`);
}

console.log('');
console.log('================================================================');
console.log('');
