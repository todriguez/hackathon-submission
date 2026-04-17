#!/usr/bin/env bun
/**
 * BEEF Slam — Single-process CellToken broadcaster with BEEF envelope tracking.
 *
 * Uses the fan-out UTXOs from pre-fund-direct.ts directly. Each vout becomes
 * a stream that pre-splits into ~200 micro-UTXOs and then burns through them
 * building CellToken txs with change recycling.
 *
 * Unlike the docker fleet, this runs in ONE process:
 *   - No container orchestration overhead
 *   - No stale chaintip restore bugs
 *   - BEEF envelope wraps every tx — no ghost chains
 *   - Verifies first tx lands on-chain before proceeding (no phantom cascade)
 *   - Graceful shutdown writes BEEF to disk for restart-safety
 *
 * Usage:
 *   set -a && . ./.env.live && set +a
 *   bun scripts/beef-slam.ts
 *
 * Env:
 *   PRIVATE_KEY_WIF     — WIF for the funding address
 *   STREAMS             — Number of parallel streams (default: 8)
 *   SPLIT_SATS          — Sats per micro-UTXO (default: 2000)
 *   MAX_TX              — Stop after N txs (default: unlimited)
 *   VERIFY_INTERVAL     — Verify on-chain every N txs (default: 100)
 */

import { PrivateKey, Transaction, P2PKH, ARC, Beef } from '@bsv/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { DirectBroadcastEngine } from '../src/agent/direct-broadcast-engine';
import { BeefStore } from '../src/agent/beef-store';
import { CellStore } from '../src/protocol/cell-store';
import { MemoryAdapter } from '../src/protocol/adapters/memory-adapter';
import { Linearity } from '../src/protocol/constants';
import { createHash } from 'crypto';

// ── Config ──

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const STREAMS = Number(process.env.STREAMS ?? '16');
// 300 sats per micro-UTXO: enough for exactly 1 CellToken (136 sats fee+output)
// with 164 sats dust change that the engine discards. No chain depth buildup.
const SPLIT_SATS = Number(process.env.SPLIT_SATS ?? '300');
const MAX_TX = Number(process.env.MAX_TX ?? '0'); // 0 = unlimited
const VERIFY_INTERVAL = Number(process.env.VERIFY_INTERVAL ?? '500');
const ARC_URL = process.env.ARC_URL ?? 'https://arc.gorillapool.io';
// MAX_CHAIN_DEPTH: after this many txs per stream (change recycling), stop that
// stream and move to the next UTXO. BSV mempool limit is 25 unconfirmed ancestors.
// Set to 1 to disable change recycling entirely (1 UTXO = 1 CellToken, all depth-1).
const MAX_CHAIN_DEPTH = Number(process.env.MAX_CHAIN_DEPTH ?? '1');

const privKey = PrivateKey.fromWif(WIF);
const address = privKey.toPublicKey().toAddress();

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  BEEF SLAM — CellToken broadcaster with BEEF envelopes');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Address:  ${address}`);
console.log(`  Streams:  ${STREAMS}`);
console.log(`  ARC:      ${ARC_URL}`);
console.log('');

// ── Load funding ──

const consolidated = JSON.parse(readFileSync('data/consolidated.json', 'utf-8'));
const parentHex = readFileSync('data/funding-tx.hex', 'utf-8').trim();
const parentTx = Transaction.fromHex(parentHex);

// Check if the consolidated UTXO has been spent (i.e., fan-out exists)
// We use the fan-out tx as our funding source
const fanoutHex = readFileSync('data/funding-tx.hex', 'utf-8').trim();
const fanoutTx = Transaction.fromHex(fanoutHex);
const fanoutTxid = fanoutTx.id('hex') as string;

console.log(`  Fan-out:  ${fanoutTxid}`);
console.log(`  Outputs:  ${fanoutTx.outputs.length}`);

let totalAvailable = 0;
for (let i = 0; i < fanoutTx.outputs.length; i++) {
  const sats = Number(fanoutTx.outputs[i].satoshis);
  totalAvailable += sats;
  console.log(`    vout ${i}: ${sats.toLocaleString()} sats`);
}
console.log(`  Total:    ${totalAvailable.toLocaleString()} sats (${(totalAvailable / 1e8).toFixed(6)} BSV)`);
console.log('');

// ── Build usable vout list ──

const usableVouts: Array<{ vout: number; sats: number }> = [];
for (let i = 0; i < fanoutTx.outputs.length; i++) {
  const sats = Number(fanoutTx.outputs[i].satoshis);
  if (sats > 1000) {
    usableVouts.push({ vout: i, sats });
  }
}

// ── Setup engine ──

mkdirSync('data', { recursive: true });

const FIRE_AND_FORGET = (process.env.SYNC_MODE ?? 'batch') !== 'sync';
console.log(`  Mode:     ${FIRE_AND_FORGET ? 'fire-and-forget (batch)' : 'synchronous'}`);

const engine = new DirectBroadcastEngine({
  privateKeyWif: WIF,
  streams: STREAMS,
  splitSatoshis: SPLIT_SATS,
  arcUrl: ARC_URL,
  verbose: true,
  fireAndForget: FIRE_AND_FORGET,
  feeRate: 0.1,
  minFee: 135,
});

// Enable BEEF store
engine.enableBeefStore('data/beef-slam.beef', 5000);

// Enable audit log
engine.enableAuditLog('data/beef-slam-txids.csv');

// ── Verify first fan-out vout is really unspent ──

console.log('  Verifying fan-out is on-chain...');
const checkResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${fanoutTxid}`);
if (!checkResp.ok) {
  console.error(`  ERROR: Fan-out tx not found on WoC: ${checkResp.status}`);
  process.exit(1);
}
const checkData: any = await checkResp.json();
console.log('  ✓ Fan-out confirmed on-chain');

// Filter usable vouts to only unspent ones
const unspentVouts: Array<{ vout: number; sats: number }> = [];
for (const v of usableVouts) {
  const spent = checkData.vout?.[v.vout]?.spent?.txid;
  if (spent) {
    console.log(`    vout ${v.vout}: SPENT (by ${spent.slice(0, 16)}...)`);
  } else {
    console.log(`    vout ${v.vout}: UNSPENT (${v.sats.toLocaleString()} sats)`);
    unspentVouts.push(v);
  }
}
if (unspentVouts.length === 0) {
  console.error('  ERROR: All fan-out vouts are spent. Run pre-fund-direct.ts to create a new fan-out.');
  process.exit(1);
}
// Replace usableVouts with only unspent ones
usableVouts.length = 0;
usableVouts.push(...unspentVouts);
const totalUnspentSats = unspentVouts.reduce((s, v) => s + v.sats, 0);
console.log(`  ${unspentVouts.length} unspent vouts available: ${totalUnspentSats.toLocaleString()} sats`);
console.log('');

// ── Ingest all fan-out vouts and pre-split ──

console.log(`  Ingesting ${usableVouts.length} fan-out vouts...`);

// Ingest the first vout as the main funding, pre-split it
const firstFunding = await engine.ingestFunding(fanoutHex, usableVouts[0].vout);
console.log(`  Pre-splitting vout ${usableVouts[0].vout} (${usableVouts[0].sats.toLocaleString()} sats) into ~${Math.floor(usableVouts[0].sats / SPLIT_SATS)} micro-UTXOs...`);

try {
  await engine.preSplit(firstFunding);
  console.log('  ✓ Pre-split complete');
} catch (err: any) {
  console.error(`  ERROR: Pre-split failed: ${err.message}`);
  process.exit(1);
}

// ── Verify first broadcast actually lands on-chain ──

// For the verification test, temporarily force sync mode
const origFF = (engine as any).config.fireAndForget;
(engine as any).config.fireAndForget = false;

console.log('');
console.log('  Verifying first CellToken actually lands on-chain (sync mode)...');

const testCell = await engine.buildPokerCell(
  'beef-slam-test',
  0,
  'verify',
  { purpose: 'verify-first-tx-lands', timestamp: Date.now() },
);

const testResult = await engine.createCellToken(
  0,
  testCell.cellBytes,
  testCell.semanticPath,
  testCell.contentHash,
);

console.log(`  Test txid: ${testResult.txid}`);

// Verify via ARC status (faster than WoC indexing)
let verified = false;
const goodStatuses = ['SEEN_ON_NETWORK', 'MINED', 'ACCEPTED_BY_NETWORK', 'ANNOUNCED_TO_NETWORK', 'STORED', 'CONFIRMED'];
for (let attempt = 0; attempt < 15; attempt++) {
  await new Promise(r => setTimeout(r, 2000));
  try {
    // Check ARC first (faster)
    const arcResp = await fetch(`${ARC_URL}/v1/tx/${testResult.txid}`);
    if (arcResp.ok) {
      const arcData: any = await arcResp.json();
      if (goodStatuses.includes(arcData.txStatus)) {
        console.log(`  ✓ ARC confirms: ${arcData.txStatus} — this is REAL, not ghost`);
        verified = true;
        break;
      }
    }
    // Fallback: check WoC
    const wocResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${testResult.txid}`);
    if (wocResp.ok) {
      const wocData: any = await wocResp.json();
      if (wocData.txid === testResult.txid) {
        console.log(`  ✓ WoC confirms on-chain after ${(attempt + 1) * 2}s`);
        verified = true;
        break;
      }
    }
  } catch {}
  console.log(`  Waiting... (attempt ${attempt + 1}/15)`);
}

if (!verified) {
  console.error('  ✗ FAILED: Test tx not found on ARC or WoC after 30s');
  console.error('  This would produce ghost txids. Aborting.');
  await engine.flush();
  process.exit(1);
}

// Restore original fire-and-forget setting for the slam
(engine as any).config.fireAndForget = origFF;

// ── SLAM: Broadcast CellTokens until dry ──

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  SLAMMING — verified on-chain, proceeding at full speed');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const startTime = Date.now();
let txCount = 1; // already did 1 test tx
let errors = 0;
let lastVerifyCount = 0;
let lastStatusTime = startTime;
const STATUS_INTERVAL_MS = 10_000; // status line every 10s

// Handle graceful shutdown
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\n  SIGINT received — flushing and shutting down...');
});
process.on('SIGTERM', () => {
  stopping = true;
  console.log('\n  SIGTERM received — flushing and shutting down...');
});

// Track which vouts we've used
const usedVouts = new Set<number>([usableVouts[0].vout]);
let nextVoutCursor = 1; // next index into usableVouts to try

// Main loop
while (!stopping) {
  if (MAX_TX > 0 && txCount >= MAX_TX) {
    console.log(`  Reached MAX_TX=${MAX_TX} — stopping`);
    break;
  }

  try {
    const streamId = txCount % STREAMS;
    const handNumber = Math.floor(txCount / 4);
    const phase = ['preflop', 'flop', 'turn', 'river'][txCount % 4];

    const cell = await engine.buildPokerCell(
      `slam-${streamId}`,
      handNumber,
      phase,
      {
        tx: txCount,
        ts: Date.now(),
        stream: streamId,
      },
      (handNumber * 4) + (txCount % 4) + 1,
    );

    await engine.createCellToken(
      streamId,
      cell.cellBytes,
      cell.semanticPath,
      cell.contentHash,
    );

    txCount++;

    // Periodic on-chain verification
    if (VERIFY_INTERVAL > 0 && txCount - lastVerifyCount >= VERIFY_INTERVAL) {
      lastVerifyCount = txCount;
      // Verify the most recent tx
      const stats = engine.getStats();
      const recentTxid = stats.errors.length === 0 ? 'ok' : `${stats.errors.length} errors`;
      console.log(`  [verify@${txCount}] totalBroadcast=${stats.totalBroadcast} errors=${recentTxid} pools=${stats.utxoPoolSizes.join(',')}`);
    }

    // Periodic status
    const now = Date.now();
    if (now - lastStatusTime > STATUS_INTERVAL_MS) {
      const elapsed = (now - startTime) / 1000;
      const txPerSec = txCount / elapsed;
      const balance = engine.getRemainingBalance();
      const estRemaining = balance.totalSats / 136; // est sats per tx
      const estTimeRemaining = estRemaining / txPerSec;
      console.log(`  [${txCount.toLocaleString()} tx | ${txPerSec.toFixed(1)} tx/s | ${elapsed.toFixed(0)}s | ${balance.utxoCount} UTXOs | ${balance.totalSats.toLocaleString()} sats remaining | ETA: ${Math.round(estTimeRemaining)}s]`);
      lastStatusTime = now;
    }
  } catch (err: any) {
    errors++;
    if (err.message.includes('no more funding UTXOs')) {
      // Try to ingest next fan-out vout
      if (nextVoutCursor < usableVouts.length) {
        const nextVout = usableVouts[nextVoutCursor];
        nextVoutCursor++;
        usedVouts.add(nextVout.vout);
        console.log(`  Stream exhausted — ingesting vout ${nextVout.vout} (${nextVout.sats.toLocaleString()} sats)...`);
        try {
          const funding = await engine.ingestFunding(fanoutHex, nextVout.vout);
          await engine.preSplit(funding);
          console.log(`  ✓ Ingested + pre-split vout ${nextVout.vout}`);
          continue;
        } catch (splitErr: any) {
          console.error(`  Pre-split vout ${nextVout.vout} failed: ${splitErr.message}`);
        }
      } else {
        console.log('  All fan-out vouts exhausted — stopping');
        break;
      }
    } else {
      console.error(`  Error #${errors}: ${err.message.slice(0, 200)}`);
      if (errors > 50) {
        console.error('  Too many errors — stopping');
        break;
      }
    }
  }
}

// ── Shutdown ──

console.log('');
console.log('  Flushing engine...');
const flushResult = await engine.flush();
const elapsed = (Date.now() - startTime) / 1000;

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  BEEF SLAM RESULTS');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Total txs:    ${txCount.toLocaleString()}`);
console.log(`  Errors:       ${errors}`);
console.log(`  Elapsed:      ${elapsed.toFixed(1)}s`);
console.log(`  Rate:         ${(txCount / elapsed).toFixed(2)} tx/s`);
console.log(`  Flush:        ${flushResult.settled} settled, ${flushResult.errors} flush errors`);
const balance = engine.getRemainingBalance();
console.log(`  Remaining:    ${balance.totalSats.toLocaleString()} sats across ${balance.utxoCount} UTXOs`);

const store = engine.getBeefStore();
if (store) {
  const stats = store.getStats();
  console.log(`  BEEF store:   ${stats.txCount} txs, ${stats.fileSize.toLocaleString()} bytes, valid=${stats.valid}`);
}

console.log('');
console.log(`  Audit CSV:    data/beef-slam-txids.csv`);
console.log(`  BEEF file:    data/beef-slam.beef`);
console.log('');
