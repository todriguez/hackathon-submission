#!/usr/bin/env bun
/**
 * turbo-slam.ts — Maximum throughput CellToken broadcaster.
 *
 * Uses TWO broadcast endpoints in round-robin to ~2x throughput:
 *   1. WoC /tx/raw — proven 100% reliable, ~3/sec limit
 *   2. GorillaPool MAPI — proven reliable, independent rate limit
 *
 * Each tx is built without source tx fetch (P2PKH.unlock with sats+script).
 * Periodic WoC verification ensures pipeline stays real.
 *
 * Usage:
 *   set -a && . ./.env.live && set +a
 *   bun scripts/turbo-slam.ts
 */

import { PrivateKey, Transaction, P2PKH, LockingScript } from '@bsv/sdk';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

// ── Config ──

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const MAX_TX = Number(process.env.MAX_TX ?? '0');
const FEE_RATE = Number(process.env.FEE_RATE ?? '0.5');
const MIN_UTXO_SATS = Number(process.env.MIN_UTXO_SATS ?? '500');
const VERIFY_INTERVAL = Number(process.env.VERIFY_INTERVAL ?? '200');
// Two concurrent streams: one to WoC, one to MAPI
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '2');
// Gap between broadcasts (per endpoint)
const GAP_MS = Number(process.env.GAP_MS ?? '350');

const privKey = PrivateKey.fromWif(WIF);
const pubKey = privKey.toPublicKey();
const address = pubKey.toAddress();
const p2pkh = new P2PKH();
const lockScript = p2pkh.lock(address);

mkdirSync('data', { recursive: true });

const AUDIT_FILE = 'data/turbo-slam-txids.csv';
// Append to existing (resume-safe)
if (!existsSync(AUDIT_FILE)) {
  writeFileSync(AUDIT_FILE, 'txid,type,input_sats,fee,size,endpoint,timestamp\n');
}

// Count existing txids to resume
const existingLines = existsSync(AUDIT_FILE) ? (await Bun.file(AUDIT_FILE).text()).split('\n').filter(l => l.length > 64).length : 0;

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  TURBO SLAM — Dual-endpoint CellToken broadcaster');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Address:     ${address}`);
console.log(`  Concurrency: ${CONCURRENCY}`);
console.log(`  Fee rate:    ${FEE_RATE} sat/byte`);
console.log(`  Gap:         ${GAP_MS}ms per endpoint`);
if (existingLines > 0) console.log(`  Resuming:    ${existingLines} existing txids`);
console.log('');

// ── Discover UTXOs ──

console.log('  Discovering unspent UTXOs via Bitails...');

interface UtxoInfo { txid: string; vout: number; sats: number; }

async function discoverUtxos(): Promise<UtxoInfo[]> {
  const all: UtxoInfo[] = [];
  let from = 0;
  const LIMIT = 10000;
  while (true) {
    const resp = await fetch(`https://api.bitails.io/address/${address}/unspent?limit=${LIMIT}&from=${from}`);
    if (!resp.ok) throw new Error(`Bitails HTTP ${resp.status}`);
    const data: any = await resp.json();
    const utxos = data.unspent ?? data;
    if (!Array.isArray(utxos) || utxos.length === 0) break;
    for (const u of utxos) {
      const sats = u.value ?? u.satoshis;
      if (sats >= MIN_UTXO_SATS) {
        all.push({ txid: u.tx_hash ?? u.txid, vout: u.tx_pos ?? u.vout, sats });
      }
    }
    console.log(`    Page ${Math.floor(from / LIMIT) + 1}: ${utxos.length} (${all.length} usable)`);
    if (utxos.length < LIMIT) break;
    from += LIMIT;
  }
  return all;
}

const utxos = await discoverUtxos();
const totalSats = utxos.reduce((s, u) => s + u.sats, 0);
console.log(`  ${utxos.length.toLocaleString()} UTXOs (${(totalSats / 1e8).toFixed(4)} BSV)`);

// Shuffle
for (let i = utxos.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [utxos[i], utxos[j]] = [utxos[j], utxos[i]];
}
console.log('');

// ── Build function ──

async function buildCellToken(utxo: UtxoInfo, seq: number): Promise<{ txid: string; txHex: string; fee: number }> {
  const tx = new Transaction();
  tx.addInput({
    sourceTXID: utxo.txid,
    sourceOutputIndex: utxo.vout,
    unlockingScriptTemplate: p2pkh.unlock(privKey, 'all', false, utxo.sats, lockScript),
  });

  const payload = Array.from(new TextEncoder().encode(JSON.stringify({ t: 'cell', n: seq, ts: Date.now() })));
  tx.addOutput({
    lockingScript: new LockingScript([
      { op: 0 }, { op: 0x6a },
      payload.length <= 75 ? { op: payload.length, data: payload } : { op: 0x4c, data: payload },
    ]),
    satoshis: 0,
  });

  const fee = Math.max(Math.ceil(220 * FEE_RATE), 110);
  const change = utxo.sats - fee;
  if (change >= 546) tx.addOutput({ lockingScript: lockScript, satoshis: change });

  await tx.sign();
  return { txid: tx.id('hex') as string, txHex: tx.toHex(), fee };
}

// ── Broadcast functions ──

async function broadcastWoC(txHex: string): Promise<{ ok: boolean; body: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: txHex }),
      });
      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      const body = await resp.text();
      return { ok: resp.ok || body.includes('txn-already-known'), body: body.slice(0, 200) };
    } catch (err: any) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 500)); continue; }
      return { ok: false, body: err.message };
    }
  }
  return { ok: false, body: '429 after 3 retries' };
}

async function broadcastMAPI(txHex: string): Promise<{ ok: boolean; body: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch('https://mapi.gorillapool.io/mapi/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawtx: txHex }),
      });
      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      const raw = await resp.text();
      try {
        const outer = JSON.parse(raw);
        const inner = JSON.parse(outer.payload);
        const ok = inner.returnResult === 'success' || (inner.resultDescription || '').includes('already known');
        return { ok, body: `${inner.returnResult}: ${inner.resultDescription || ''}`.slice(0, 200) };
      } catch {
        return { ok: resp.ok, body: raw.slice(0, 200) };
      }
    } catch (err: any) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 500)); continue; }
      return { ok: false, body: err.message };
    }
  }
  return { ok: false, body: '429 after 3 retries' };
}

// ── Pipeline verification ──

console.log('  Pipeline verification...');
const testUtxo = utxos.shift()!;
const testTx = await buildCellToken(testUtxo, 0);

const wocTest = await broadcastWoC(testTx.txHex);
if (!wocTest.ok) { console.error(`  ✗ WoC rejected: ${wocTest.body}`); process.exit(1); }
console.log(`  ✓ WoC: ${testTx.txid.slice(0, 24)}...`);
appendFileSync(AUDIT_FILE, `${testTx.txid},celltoken,${testUtxo.sats},${testTx.fee},${testTx.txHex.length / 2},woc,${Date.now()}\n`);

await new Promise(r => setTimeout(r, 8000));
const verify = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${testTx.txid}`);
console.log(`  ${verify.ok ? '✓ On-chain verified!' : '⚠ WoC indexing delay'}`);
console.log('');

// ── SLAM ──

console.log('═══════════════════════════════════════════════════════════');
console.log('  TURBO SLAMMING — WoC + MAPI dual-endpoint');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const startTime = Date.now();
let txCount = 1 + existingLines;
let ok = 1;
let fail = 0;
let verifyOk = 0;
let verifyFail = 0;
let lastStatusTime = startTime;
let stopping = false;
let cursor = 0;

process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\n  Stopping...');
});

// Dual-endpoint round-robin
const broadcasters = [
  { name: 'woc', fn: broadcastWoC },
  { name: 'mapi', fn: broadcastMAPI },
];

while (cursor < utxos.length && !stopping) {
  if (MAX_TX > 0 && txCount >= MAX_TX + existingLines) break;

  // Take CONCURRENCY UTXOs
  const batchEnd = Math.min(cursor + CONCURRENCY, utxos.length);
  const batch = utxos.slice(cursor, batchEnd);
  cursor = batchEnd;

  // Build and broadcast in parallel (each to different endpoint)
  const results = await Promise.all(batch.map(async (utxo, i) => {
    const bc = broadcasters[i % broadcasters.length];
    try {
      const { txid, txHex, fee } = await buildCellToken(utxo, txCount + i);
      const result = await bc.fn(txHex);
      return { txid, txHex, fee, utxo, result, endpoint: bc.name };
    } catch (err: any) {
      return { txid: '', txHex: '', fee: 0, utxo, result: { ok: false, body: err.message }, endpoint: bc.name };
    }
  }));

  for (const r of results) {
    if (r.result.ok) {
      ok++;
      txCount++;
      appendFileSync(AUDIT_FILE, `${r.txid},celltoken,${r.utxo.sats},${r.fee},${r.txHex.length / 2},${r.endpoint},${Date.now()}\n`);
    } else {
      fail++;
      if (fail <= 10 || fail % 100 === 0) {
        console.error(`  ${r.endpoint} reject #${fail}: ${r.result.body.slice(0, 120)}`);
      }
      if (fail > 500) { console.error('  Too many failures'); stopping = true; }
    }
  }

  // Rate limit per endpoint
  await new Promise(r => setTimeout(r, GAP_MS));

  // Status
  const now = Date.now();
  if (now - lastStatusTime > 10_000) {
    const elapsed = (now - startTime) / 1000;
    const rate = (txCount - existingLines) / elapsed;
    const remaining = utxos.length - cursor;
    const eta = remaining / Math.max(rate, 0.1);
    console.log(`  [${txCount.toLocaleString()} tx | ${rate.toFixed(1)} tx/s | ${fail} fail | ${remaining.toLocaleString()} left | ETA: ${(eta / 3600).toFixed(1)}h]`);
    lastStatusTime = now;
  }

  // Periodic verify
  if (VERIFY_INTERVAL > 0 && (txCount - existingLines) % VERIFY_INTERVAL === 0) {
    const sample = results.filter(r => r.result.ok).pop();
    if (sample) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${sample.txid}`);
        if (check.ok) {
          verifyOk++;
          console.log(`  [verify] ✓ ${sample.txid.slice(0, 16)}... ON-CHAIN via ${sample.endpoint} (${verifyOk}/${verifyOk + verifyFail})`);
        } else {
          verifyFail++;
          console.log(`  [verify] ✗ ${sample.txid.slice(0, 16)}... NOT FOUND via ${sample.endpoint}`);
          if (verifyFail > 5) { console.error('  Ghost pipeline detected — stopping'); stopping = true; }
        }
      } catch {}
    }
  }
}

// ── Results ──

const elapsed = (Date.now() - startTime) / 1000;
const produced = txCount - existingLines;
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  TURBO SLAM RESULTS');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  New CellTokens:  ${produced.toLocaleString()}`);
console.log(`  Total (w/resume): ${txCount.toLocaleString()}`);
console.log(`  Accepted:        ${ok.toLocaleString()}`);
console.log(`  Rejected:        ${fail}`);
console.log(`  Verified:        ${verifyOk}/${verifyOk + verifyFail}`);
console.log(`  Elapsed:         ${elapsed.toFixed(1)}s`);
console.log(`  Rate:            ${(produced / elapsed).toFixed(1)} tx/s`);
console.log(`  Remaining:       ${(utxos.length - cursor).toLocaleString()} UTXOs`);
console.log(`  Audit:           ${AUDIT_FILE}`);
console.log('');
