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
const RAMP_STEP         = parseInt(process.env.RAMP_STEP ?? '10', 10);
const RAMP_INTERVAL_SEC = parseInt(process.env.RAMP_INTERVAL ?? '10', 10);
const FAIL_THRESHOLD    = parseFloat(process.env.FAIL_THRESHOLD ?? '0.2');
const MIN_BALANCE_SATS  = parseInt(process.env.MIN_BALANCE_SATS ?? '50000', 10);
const BATCH_SIZE        = parseInt(process.env.BATCH_SIZE ?? '20', 10);

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
console.log(`  Batch size:    ${BATCH_SIZE} txs/batch (broadcastMany)`);
console.log(`  Ramp:          +${RAMP_STEP} TPS every ${RAMP_INTERVAL_SEC}s`);
console.log(`  Fail threshold: ${(FAIL_THRESHOLD * 100).toFixed(0)}%`);
console.log('');

log('FUND', 'Checking UTXOs...');

// Try WoC first, then GorillaPool ordinals API (WoC caps at 1000 results)
let rawUtxos: any[] = [];

const wocUtxoResp = await fetch(
  `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
);
if (wocUtxoResp.ok) {
  const wocUtxos: any[] = await wocUtxoResp.json();
  rawUtxos = wocUtxos.map((u: any) => ({ tx_hash: u.tx_hash, tx_pos: u.tx_pos, value: u.value }));
  log('FUND', `WoC: ${rawUtxos.length} UTXOs`);
}

// If WoC hit 1000 cap or returned 0, try ordinals API for the full picture
if (rawUtxos.length >= 999 || rawUtxos.length === 0) {
  log('FUND', 'WoC capped at 1000 — trying GorillaPool ordinals API for full UTXO set...');
  try {
    const gpResp = await fetch(
      `https://ordinals.gorillapool.io/api/txos/address/${address}/unspent?limit=10000`,
    );
    if (gpResp.ok) {
      const gpUtxos: any[] = await gpResp.json();
      // Normalize to WoC format
      const gpNormalized = gpUtxos
        .filter((u: any) => !u.spend) // unspent only
        .map((u: any) => ({ tx_hash: u.txid, tx_pos: u.vout, value: u.satoshis }));
      if (gpNormalized.length > rawUtxos.length) {
        rawUtxos = gpNormalized;
        log('FUND', `GorillaPool ordinals: ${rawUtxos.length} UTXOs (more complete)`);
      }
    }
  } catch (e: any) {
    log('FUND', `Ordinals API failed: ${e.message} — using WoC data`);
  }
}

if (rawUtxos.length === 0) {
  console.error('  ERROR: No UTXOs found. Fund the address first!');
  console.error(`  Address: ${address}`);
  process.exit(1);
}

const totalBalance = rawUtxos.reduce((s: number, u: any) => s + u.value, 0);
log('FUND', `Total: ${rawUtxos.length} UTXOs, ${totalBalance.toLocaleString()} sats (${(totalBalance / 1e8).toFixed(4)} BSV)`);

if (totalBalance < MIN_BALANCE_SATS) {
  console.error(`  ERROR: Balance ${totalBalance} sats is below minimum ${MIN_BALANCE_SATS} sats. Fund the address.`);
  process.exit(1);
}

// Cap how much we'll use for this test
const budgetSats = Math.min(MAX_SATS, totalBalance);
log('FUND', `Test budget: ${budgetSats.toLocaleString()} sats`);

// ══════════════════════════════════════════════════════════════════
// Phase 2: Pre-Split (or reuse existing small UTXOs)
// ══════════════════════════════════════════════════════════════════

const p2pkh = new P2PKH();
const lockingScript = p2pkh.lock(address);

// Check: are there already enough small UTXOs from a previous split?
const smallUtxos = rawUtxos.filter((u: any) => u.value <= SPLIT_SATS * 2 && u.value >= 200);
const largeUtxos = rawUtxos.filter((u: any) => u.value > SPLIT_SATS * 2);

if (smallUtxos.length >= 50) {
  // ── Reuse existing split UTXOs (skip re-splitting) ──
  log('SPLIT', `Found ${smallUtxos.length} existing small UTXOs — reusing (no new split needed)`);

  // Fetch source tx for the parent (all small UTXOs likely share the same parent tx)
  const parentTxids = new Set<string>(smallUtxos.map((u: any) => u.tx_hash));
  const parentTxCache = new Map<string, Transaction>();

  for (const txid of parentTxids) {
    try {
      const txResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`);
      if (txResp.ok) {
        parentTxCache.set(txid, Transaction.fromHex(await txResp.text()));
      }
    } catch {}
  }
  log('SPLIT', `Fetched ${parentTxCache.size} parent transactions for signing`);

  // Cap to budget
  let poolSats = 0;
  for (const u of smallUtxos) {
    if (poolSats >= budgetSats) break;
    const sourceTx = parentTxCache.get(u.tx_hash);
    if (!sourceTx) continue;
    utxoPool.push({
      txid: u.tx_hash,
      vout: u.tx_pos,
      satoshis: u.value,
      sourceTx,
    });
    poolSats += u.value;
  }

  log('SPLIT', `Pool ready: ${utxoPool.length} UTXOs (${poolSats.toLocaleString()} sats). No split fee.`);

} else {
  // ── Need to create a fresh split ──
  log('SPLIT', 'Not enough small UTXOs — creating fresh split...');
  log('SPLIT', 'Fetching source transactions for signing...');

  interface FundingInput {
    txid: string;
    vout: number;
    sats: number;
    sourceTx: Transaction;
  }

  const fundingInputs: FundingInput[] = [];
  let gatheredSats = 0;

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
  const numSplits = Math.max(1, Math.min(maxSplits, 2000));

  log('SPLIT', `Creating ${numSplits} UTXOs of ${SPLIT_SATS} sats each...`);

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

  const wocResp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: splitHex }),
  });
  if (wocResp.ok) log('SPLIT', 'WoC backup broadcast confirmed');
  else log('SPLIT', `WoC backup: ${wocResp.status} (non-critical)`);

  log('SPLIT', `Split tx: ${splitTxid}`);
  log('SPLIT', `  https://whatsonchain.com/tx/${splitTxid}`);

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

  log('RAMP', 'Waiting 3s for split tx propagation...');
  await new Promise(r => setTimeout(r, 3000));
}

console.log('');

// ══════════════════════════════════════════════════════════════════
// Phase 3: Ramp-Up Broadcast Test
// ══════════════════════════════════════════════════════════════════

log('RAMP', 'Starting TPS ramp-up...');
console.log('');

let globalSeq = 0;
let maxSustainableTps = 0;

/**
 * Build a signed OP_RETURN tx ready for batch broadcast.
 * Returns the signed Transaction + metadata, or null if pool empty.
 */
async function buildTx(): Promise<{ tx: Transaction; fee: number; change: number; fundingSats: number } | null> {
  if (utxoPool.length === 0) return null;

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

  tx.addOutput({
    lockingScript: opReturnScript,
    satoshis: 0,
  });

  const change = funding.satoshis - fee;
  if (change > 546) {
    tx.addOutput({
      lockingScript,
      satoshis: change,
    });
  }

  await tx.sign();
  return { tx, fee, change, fundingSats: funding.satoshis };
}

/**
 * Broadcast a batch of signed txs via arc.broadcastMany() — one HTTP round-trip.
 * Returns per-tx results.
 */
async function broadcastBatch(txs: { tx: Transaction; fee: number; change: number }[]): Promise<{
  successes: number; failures: number; latencyMs: number; feesSpent: number; errors: string[];
}> {
  const t0 = Date.now();
  const result = { successes: 0, failures: 0, latencyMs: 0, feesSpent: 0, errors: [] as string[] };

  try {
    const rawTxs = txs.map(t => t.tx);
    const responses: any[] = await arc.broadcastMany(rawTxs);
    result.latencyMs = Date.now() - t0;

    for (let i = 0; i < responses.length; i++) {
      const r = responses[i];
      if (r?.status === 'error' || r?.txStatus === 'REJECTED') {
        result.failures++;
        const errMsg = r?.detail || r?.description || JSON.stringify(r);
        result.errors.push(errMsg);
      } else {
        result.successes++;
        result.feesSpent += txs[i].fee;
        totalSatsSpent += txs[i].fee;

        // Recycle change UTXO back into pool
        if (txs[i].change > 546) {
          const txid = txs[i].tx.id('hex') as string;
          utxoPool.push({
            txid,
            vout: 1,
            satoshis: txs[i].change,
            sourceTx: txs[i].tx,
          });
        }
      }
    }
  } catch (err: any) {
    result.latencyMs = Date.now() - t0;
    result.failures = txs.length;
    result.errors.push(err.message);
  }

  return result;
}

/**
 * Legacy single-tx broadcast (fallback for batch size 1).
 */
async function broadcastOne(built: { tx: Transaction; fee: number; change: number }): Promise<{
  successes: number; failures: number; latencyMs: number; feesSpent: number; errors: string[];
}> {
  const t0 = Date.now();
  try {
    const r = await built.tx.broadcast(arc);
    const latencyMs = Date.now() - t0;

    if ('status' in r && (r as any).status === 'error') {
      return { successes: 0, failures: 1, latencyMs, feesSpent: 0, errors: [JSON.stringify(r)] };
    }

    totalSatsSpent += built.fee;
    if (built.change > 546) {
      const txid = built.tx.id('hex') as string;
      utxoPool.push({ txid, vout: 1, satoshis: built.change, sourceTx: built.tx });
    }
    return { successes: 1, failures: 0, latencyMs, feesSpent: built.fee, errors: [] };
  } catch (err: any) {
    return { successes: 0, failures: 1, latencyMs: Date.now() - t0, feesSpent: 0, errors: [err.message] };
  }
}

/**
 * Run one ramp level: attempt `targetTps` tx/sec for `durationSec` seconds.
 * Uses batch broadcasting: builds `targetTps` txs, then broadcasts in batches of BATCH_SIZE.
 * This means we send ceil(targetTps / BATCH_SIZE) HTTP requests per second, not targetTps.
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

  const batchesPerSec = Math.ceil(targetTps / BATCH_SIZE);
  const txsPerBatch = Math.min(targetTps, BATCH_SIZE);
  const intervalMs = 1000 / batchesPerSec;
  const levelStart = Date.now();
  const levelEnd = levelStart + durationSec * 1000;

  log('RAMP', `  Batching: ${txsPerBatch} txs/batch × ${batchesPerSec} batches/sec = ${txsPerBatch * batchesPerSec} tx/sec target`);

  const pending: Promise<void>[] = [];
  let nextSendTime = levelStart;

  while (Date.now() < levelEnd && !aborted) {
    if (totalSatsSpent >= MAX_SATS) {
      log('RAMP', 'MAX_SATS budget reached -- stopping');
      aborted = true;
      break;
    }
    if (utxoPool.length < txsPerBatch) {
      log('RAMP', `UTXO pool low (${utxoPool.length}) -- stopping`);
      aborted = true;
      break;
    }

    const now = Date.now();
    if (now < nextSendTime) {
      await new Promise(r => setTimeout(r, Math.max(1, nextSendTime - now)));
    }
    nextSendTime = Date.now() + intervalMs;

    // Build a batch of signed txs
    const batch: { tx: Transaction; fee: number; change: number }[] = [];
    for (let i = 0; i < txsPerBatch; i++) {
      const built = await buildTx();
      if (!built) break;
      batch.push(built);
    }
    if (batch.length === 0) break;

    stats.attempts += batch.length;

    // Broadcast the batch (one HTTP request for N txs)
    const p = (batch.length === 1
      ? broadcastOne(batch[0])
      : broadcastBatch(batch)
    ).then(r => {
      stats.successes += r.successes;
      stats.failures += r.failures;
      stats.feesSpent += r.feesSpent;
      stats.totalLatencyMs += r.latencyMs;
      stats.minLatencyMs = Math.min(stats.minLatencyMs, r.latencyMs);
      stats.maxLatencyMs = Math.max(stats.maxLatencyMs, r.latencyMs);
      if (r.errors.length > 0 && stats.failures <= 5) {
        log('RAMP', `  Fail (${r.failures}/${batch.length}): ${r.errors[0].slice(0, 120)}`);
      }
    });
    pending.push(p);
  }

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
