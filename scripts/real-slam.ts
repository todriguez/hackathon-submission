#!/usr/bin/env bun
/**
 * real-slam.ts — CellToken broadcaster using ACTUAL unspent UTXOs.
 *
 * Key insight: P2PKH.unlock(privKey, 'all', false, sats, lockingScript)
 * accepts explicit sats + script, so we DON'T need to fetch source tx hex.
 * This eliminates the 47K WoC fetch bottleneck entirely.
 *
 * Pipeline:
 *   1. Discover real unspent UTXOs via Bitails (paginated)
 *   2. Build CellTokens with OP_FALSE OP_RETURN (no source tx fetch needed)
 *   3. Broadcast via WoC directly (proven 100% propagation rate)
 *   4. Audit CSV for every tx
 *
 * Usage:
 *   set -a && . ./.env.live && set +a
 *   bun scripts/real-slam.ts
 */

import { PrivateKey, Transaction, P2PKH, LockingScript } from '@bsv/sdk';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

// ── Config ──

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const MAX_TX = Number(process.env.MAX_TX ?? '0');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '2');  // WoC rate limit: 3/sec, 2 concurrent with 400ms gap = ~2 tx/s
const FEE_RATE = Number(process.env.FEE_RATE ?? '0.5');
const MIN_UTXO_SATS = Number(process.env.MIN_UTXO_SATS ?? '500');
const VERIFY_SAMPLE = Number(process.env.VERIFY_SAMPLE ?? '100');
// WoC rate limit: ~3 req/sec. Sequential with 400ms gap = ~2.5 tx/s sustained (under limit).
const BATCH_DELAY_MS = Number(process.env.BATCH_DELAY_MS ?? '400');
const MAX_RETRIES = 3;

const privKey = PrivateKey.fromWif(WIF);
const pubKey = privKey.toPublicKey();
const address = pubKey.toAddress();
const p2pkh = new P2PKH();
const changeLockingScript = p2pkh.lock(address);

mkdirSync('data', { recursive: true });

const AUDIT_FILE = 'data/real-slam-txids.csv';
if (!existsSync(AUDIT_FILE)) {
  writeFileSync(AUDIT_FILE, 'txid,type,input_sats,fee,size,timestamp\n');
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  REAL SLAM — CellToken broadcaster using ACTUAL UTXOs');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Address:     ${address}`);
console.log(`  Concurrency: ${CONCURRENCY}`);
console.log(`  Fee rate:    ${FEE_RATE} sat/byte`);
console.log(`  Min UTXO:    ${MIN_UTXO_SATS} sats`);
console.log(`  Batch delay: ${BATCH_DELAY_MS}ms`);
console.log('');

// ── Step 1: Discover UTXOs ──

console.log('  Discovering unspent UTXOs via Bitails...');

interface UtxoInfo {
  txid: string;
  vout: number;
  sats: number;
  height: number;
}

async function discoverUtxos(): Promise<UtxoInfo[]> {
  const all: UtxoInfo[] = [];
  let from = 0;
  const LIMIT = 10000;

  while (true) {
    const url = `https://api.bitails.io/address/${address}/unspent?limit=${LIMIT}&from=${from}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Bitails HTTP ${resp.status}`);

    const data: any = await resp.json();
    const utxos = data.unspent ?? data;
    if (!Array.isArray(utxos) || utxos.length === 0) break;

    for (const u of utxos) {
      const sats = u.value ?? u.satoshis;
      if (sats >= MIN_UTXO_SATS) {
        all.push({
          txid: u.tx_hash ?? u.txid,
          vout: u.tx_pos ?? u.vout,
          sats,
          height: u.height ?? 0,
        });
      }
    }

    console.log(`    Page ${Math.floor(from / LIMIT) + 1}: ${utxos.length} UTXOs (${all.length} usable ≥ ${MIN_UTXO_SATS} sats)`);
    if (utxos.length < LIMIT) break;
    from += LIMIT;
  }

  return all;
}

const utxos = await discoverUtxos();
const totalSats = utxos.reduce((s, u) => s + u.sats, 0);
console.log(`  Found ${utxos.length.toLocaleString()} usable UTXOs (${totalSats.toLocaleString()} sats / ${(totalSats / 1e8).toFixed(4)} BSV)`);
console.log('');

// ── Step 2: Verify first tx hits chain ──

console.log('  Verifying broadcast pipeline with test tx...');

async function buildCellTokenTx(utxo: UtxoInfo, seqNum: number): Promise<{
  txid: string;
  txHex: string;
  fee: number;
  change: number;
}> {
  const tx = new Transaction();

  tx.addInput({
    sourceTXID: utxo.txid,
    sourceOutputIndex: utxo.vout,
    // No sourceTransaction needed! SDK accepts sats + lockingScript directly.
    unlockingScriptTemplate: p2pkh.unlock(privKey, 'all', false, utxo.sats, changeLockingScript),
  });

  // OP_FALSE OP_RETURN with compact CellToken payload
  const payload = Array.from(new TextEncoder().encode(JSON.stringify({
    t: 'cell',
    n: seqNum,
    ts: Date.now(),
  })));
  const opReturnScript = new LockingScript([
    { op: 0 },       // OP_FALSE
    { op: 0x6a },    // OP_RETURN
    payload.length <= 75
      ? { op: payload.length, data: payload }
      : { op: 0x4c, data: payload },
  ]);

  tx.addOutput({ lockingScript: opReturnScript, satoshis: 0 });

  // Estimate size: ~220 bytes for 1-in-2-out (OP_RETURN + P2PKH change)
  const estSize = 220;
  const fee = Math.max(Math.ceil(estSize * FEE_RATE), 110);
  const change = utxo.sats - fee;

  // Only add change if above dust (546 sats)
  if (change >= 546) {
    tx.addOutput({ lockingScript: changeLockingScript, satoshis: change });
  }

  await tx.sign();

  const txHex = tx.toHex();
  const txid = tx.id('hex') as string;
  return { txid, txHex, fee, change: change >= 546 ? change : 0 };
}

async function broadcastViaWoc(txHex: string): Promise<{ ok: boolean; body: string; status: number }> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: txHex }),
      });
      const body = await resp.text();
      if (resp.status === 429) {
        // Rate limited — back off exponentially
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return { ok: resp.ok, body: body.slice(0, 300), status: resp.status };
    } catch (err: any) {
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return { ok: false, body: err.message, status: 0 };
    }
  }
  return { ok: false, body: 'max retries exceeded (429)', status: 429 };
}

// ARC broadcast — fire and forget for belt-and-suspenders propagation
async function broadcastViaArc(txHex: string): Promise<void> {
  try {
    await fetch(`https://arc.gorillapool.io/v1/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawTx: txHex }),
    });
  } catch {}
}

// Test with first UTXO
const testUtxo = utxos[0];
const testResult = await buildCellTokenTx(testUtxo, 0);
console.log(`  Test txid: ${testResult.txid}`);
console.log(`  Test fee:  ${testResult.fee} sats (${(testResult.fee / (testResult.txHex.length / 2)).toFixed(2)} sat/byte)`);

const testBroadcast = await broadcastViaWoc(testResult.txHex);
if (!testBroadcast.ok) {
  console.error(`  ✗ WoC rejected test tx: ${testBroadcast.body}`);
  console.error('  Pipeline is broken. Aborting.');
  process.exit(1);
}
console.log(`  ✓ WoC accepted: ${testBroadcast.body.slice(1, 67)}`);

// Verify it actually shows up
await new Promise(r => setTimeout(r, 8000));
const verifyResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${testResult.txid}`);
if (verifyResp.ok) {
  console.log(`  ✓ Verified on WoC — REAL on-chain tx!`);
} else {
  console.log(`  ⚠ WoC verification timeout (may still be indexing). Proceeding cautiously.`);
}

// Remove the test UTXO from the queue
utxos.shift();
let txCount = 1; // already did test tx
appendFileSync(AUDIT_FILE, `${testResult.txid},celltoken,${testUtxo.sats},${testResult.fee},${testResult.txHex.length / 2},${Date.now()}\n`);

// If change was recycled, add it back
if (testResult.change >= MIN_UTXO_SATS) {
  utxos.push({ txid: testResult.txid, vout: 1, sats: testResult.change, height: 0 });
}

console.log('');

// ── Step 3: SLAM ──

console.log('═══════════════════════════════════════════════════════════');
console.log('  SLAMMING — verified pipeline, WoC-direct broadcast');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const startTime = Date.now();
let errors = 0;
let wocOk = 1; // test tx
let wocFail = 0;
let wocDupe = 0;
let lastStatusTime = startTime;
let stopping = false;

process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\n  SIGINT — stopping after current batch...');
});

// Shuffle UTXOs to avoid hammering same source tx
for (let i = utxos.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [utxos[i], utxos[j]] = [utxos[j], utxos[i]];
}

let cursor = 0;

while (cursor < utxos.length && !stopping) {
  if (MAX_TX > 0 && txCount >= MAX_TX) {
    console.log(`  Reached MAX_TX=${MAX_TX}`);
    break;
  }

  // Take a batch
  const batchEnd = Math.min(cursor + CONCURRENCY, utxos.length, MAX_TX > 0 ? cursor + (MAX_TX - txCount) : utxos.length);
  const batch = utxos.slice(cursor, batchEnd);
  cursor = batchEnd;

  // Build and broadcast in parallel
  const results = await Promise.all(batch.map(async (utxo) => {
    try {
      const { txid, txHex, fee, change } = await buildCellTokenTx(utxo, txCount);
      // Primary: WoC (reliable propagation). Also fire to ARC in background.
      const [result] = await Promise.all([
        broadcastViaWoc(txHex),
        broadcastViaArc(txHex),
      ]);
      return { txid, txHex, fee, change, utxo, result };
    } catch (err: any) {
      return { txid: '', txHex: '', fee: 0, change: 0, utxo, result: { ok: false, body: err.message, status: 0 } };
    }
  }));

  for (const r of results) {
    if (r.result.ok) {
      wocOk++;
      txCount++;
      appendFileSync(AUDIT_FILE, `${r.txid},celltoken,${r.utxo.sats},${r.fee},${r.txHex.length / 2},${Date.now()}\n`);
    } else if (r.result.body.includes('txn-already-known')) {
      wocDupe++;
      txCount++;
    } else {
      wocFail++;
      errors++;
      if (errors <= 10 || errors % 100 === 0) {
        console.error(`  WoC reject #${errors}: ${r.result.body.slice(0, 150)}`);
      }
      if (errors > 1000) {
        console.error('  Too many errors — stopping');
        stopping = true;
      }
    }
  }

  // Rate limit: respect WoC ~3 req/sec
  await new Promise(r => setTimeout(r, BATCH_DELAY_MS));

  // Periodic status
  const now = Date.now();
  if (now - lastStatusTime > 10_000) {
    const elapsed = (now - startTime) / 1000;
    const rate = txCount / elapsed;
    const remaining = utxos.length - cursor;
    const eta = remaining / Math.max(rate, 0.1);
    console.log(`  [${txCount.toLocaleString()} ok | ${wocFail} fail | ${wocDupe} dupe | ${rate.toFixed(1)} tx/s | ${remaining.toLocaleString()} left | ETA: ${Math.round(eta)}s]`);
    lastStatusTime = now;
  }

  // Periodic verification
  if (VERIFY_SAMPLE > 0 && txCount > 0 && txCount % VERIFY_SAMPLE === 0 && results.length > 0) {
    const lastOk = results.filter(r => r.result.ok).pop();
    if (lastOk) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${lastOk.txid}`);
        const verifyStatus = check.ok ? '✓ ON-CHAIN' : `✗ NOT FOUND (${check.status})`;
        console.log(`  [verify@${txCount}] ${lastOk.txid.slice(0, 16)}... → ${verifyStatus}`);
      } catch {}
    }
  }
}

// ── Results ──

const elapsed = (Date.now() - startTime) / 1000;
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  REAL SLAM RESULTS');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  CellTokens created: ${txCount.toLocaleString()}`);
console.log(`  WoC accepted:       ${wocOk.toLocaleString()}`);
console.log(`  WoC rejected:       ${wocFail}`);
console.log(`  Duplicates:         ${wocDupe}`);
console.log(`  Errors:             ${errors}`);
console.log(`  Elapsed:            ${elapsed.toFixed(1)}s`);
console.log(`  Rate:               ${(txCount / elapsed).toFixed(2)} tx/s`);
console.log(`  Remaining UTXOs:    ${(utxos.length - cursor).toLocaleString()}`);
console.log(`  Audit file:         ${AUDIT_FILE}`);
console.log('');
