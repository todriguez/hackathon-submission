#!/usr/bin/env bun
/**
 * mapi-slam.ts — 100+ tx/s CellToken broadcaster via GorillaPool MAPI.
 *
 * MAPI goes DIRECT to GorillaPool's mining node. Unlike ARC (which just
 * announces to peers and hopes), MAPI puts txs in the miner's mempool.
 *
 * Pipeline:
 *   1. Discover all unspent UTXOs via Bitails (paginated)
 *   2. Pre-build all CellToken txs (no source tx fetch — offline signing)
 *   3. Blast via MAPI at concurrency 100 (~125 tx/s proven)
 *   4. Periodic WoC verification to confirm on-chain
 *
 * Usage:
 *   set -a && . ./.env.live && set +a
 *   bun scripts/mapi-slam.ts
 */

import { PrivateKey, Transaction, P2PKH, LockingScript } from '@bsv/sdk';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

// ── Config ──

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const MAX_TX = Number(process.env.MAX_TX ?? '0');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '100');
const FEE_RATE = Number(process.env.FEE_RATE ?? '0.5');
const MIN_UTXO_SATS = Number(process.env.MIN_UTXO_SATS ?? '500');
const VERIFY_INTERVAL = Number(process.env.VERIFY_INTERVAL ?? '1000');
const MAPI_URL = 'https://mapi.gorillapool.io/mapi/tx';

const privKey = PrivateKey.fromWif(WIF);
const p2pkh = new P2PKH();
const address = privKey.toPublicKey().toAddress();
const lockScript = p2pkh.lock(address);

mkdirSync('data', { recursive: true });

const AUDIT_FILE = 'data/mapi-slam-txids.csv';
if (!existsSync(AUDIT_FILE)) {
  writeFileSync(AUDIT_FILE, 'txid,type,input_sats,fee,size,timestamp\n');
}

// Count existing for resume
const existingCount = existsSync(AUDIT_FILE)
  ? (await Bun.file(AUDIT_FILE).text()).split('\n').filter(l => l.length > 64).length
  : 0;

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  MAPI SLAM — 100+ tx/s via GorillaPool mining node');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Address:     ${address}`);
console.log(`  Concurrency: ${CONCURRENCY}`);
console.log(`  Fee rate:    ${FEE_RATE} sat/byte`);
if (existingCount > 0) console.log(`  Resuming:    ${existingCount} existing`);
console.log('');

// ── Discover UTXOs ──

console.log('  Discovering UTXOs via Bitails...');

interface Utxo { txid: string; vout: number; sats: number; }

async function discoverUtxos(): Promise<Utxo[]> {
  const all: Utxo[] = [];
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

// Shuffle to spread load
for (let i = utxos.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [utxos[i], utxos[j]] = [utxos[j], utxos[i]];
}
console.log('');

// ── Pipeline verification ──

console.log('  Verifying pipeline (WoC broadcast + MAPI)...');
{
  const u = utxos.shift()!;
  const tx = new Transaction();
  tx.addInput({
    sourceTXID: u.txid, sourceOutputIndex: u.vout,
    unlockingScriptTemplate: p2pkh.unlock(privKey, 'all', false, u.sats, lockScript),
  });
  const payload = Array.from(new TextEncoder().encode(JSON.stringify({ t: 'cell', v: 1, ts: Date.now() })));
  tx.addOutput({ lockingScript: new LockingScript([{ op: 0 }, { op: 0x6a }, { op: payload.length, data: payload }]), satoshis: 0 });
  const change = u.sats - Math.max(Math.ceil(220 * FEE_RATE), 110);
  if (change >= 546) tx.addOutput({ lockingScript: lockScript, satoshis: change });
  await tx.sign();

  const txHex = tx.toHex();
  const txid = tx.id('hex') as string;

  // WoC first (proven reliable)
  const wocResp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: txHex }),
  });
  if (!wocResp.ok) {
    const body = await wocResp.text();
    console.error(`  ✗ WoC rejected: ${body.slice(0, 200)}`);
    process.exit(1);
  }
  appendFileSync(AUDIT_FILE, `${txid},celltoken,${u.sats},110,${txHex.length / 2},${Date.now()}\n`);

  // Also send to MAPI
  await fetch(MAPI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawtx: txHex }),
  }).catch(() => {});

  await new Promise(r => setTimeout(r, 5000));
  const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${txid}`);
  console.log(`  ${check.ok ? '✓ On-chain verified!' : '⚠ Indexing delay'} — ${txid.slice(0, 24)}...`);
}
console.log('');

// ── SLAM ──

console.log('═══════════════════════════════════════════════════════════');
console.log('  SLAMMING — MAPI direct to miner @ concurrency ' + CONCURRENCY);
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const startTime = Date.now();
let txCount = 1 + existingCount;
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
  console.log('\n  Stopping after current batch...');
});

// Pre-build in chunks to avoid memory explosion
const BUILD_CHUNK = 5000;

while (cursor < utxos.length && !stopping) {
  if (MAX_TX > 0 && txCount >= MAX_TX + existingCount) break;

  // Build a chunk of txs
  const chunkEnd = Math.min(cursor + BUILD_CHUNK, utxos.length);
  const chunk = utxos.slice(cursor, chunkEnd);

  console.log(`  Building chunk ${cursor}-${chunkEnd}...`);
  const built: Array<{ txid: string; txHex: string; fee: number; utxo: Utxo }> = [];
  for (let i = 0; i < chunk.length; i++) {
    if (MAX_TX > 0 && txCount + built.length >= MAX_TX + existingCount) break;
    const u = chunk[i];
    try {
      const tx = new Transaction();
      tx.addInput({
        sourceTXID: u.txid, sourceOutputIndex: u.vout,
        unlockingScriptTemplate: p2pkh.unlock(privKey, 'all', false, u.sats, lockScript),
      });
      const payload = Array.from(new TextEncoder().encode(JSON.stringify({ t: 'c', n: txCount + built.length })));
      tx.addOutput({
        lockingScript: new LockingScript([
          { op: 0 }, { op: 0x6a },
          payload.length <= 75 ? { op: payload.length, data: payload } : { op: 0x4c, data: payload },
        ]),
        satoshis: 0,
      });
      const fee = Math.max(Math.ceil(220 * FEE_RATE), 110);
      const change = u.sats - fee;
      if (change >= 546) tx.addOutput({ lockingScript: lockScript, satoshis: change });
      await tx.sign();
      built.push({ txid: tx.id('hex') as string, txHex: tx.toHex(), fee, utxo: u });
    } catch {}
  }
  console.log(`  Built ${built.length} txs, broadcasting...`);

  // Broadcast via MAPI at CONCURRENCY
  for (let i = 0; i < built.length && !stopping; i += CONCURRENCY) {
    const batch = built.slice(i, i + CONCURRENCY);

    const results = await Promise.all(batch.map(async (b) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const resp = await fetch(MAPI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawtx: b.txHex }),
          });
          if (resp.status === 429) {
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            continue;
          }
          const raw = await resp.text();
          try {
            const outer = JSON.parse(raw);
            const inner = JSON.parse(outer.payload);
            return inner.returnResult === 'success' || (inner.resultDescription || '').includes('already known');
          } catch { return resp.ok; }
        } catch {
          if (attempt < 2) await new Promise(r => setTimeout(r, 200));
        }
      }
      return false;
    }));

    let batchOk = 0;
    for (let j = 0; j < results.length; j++) {
      if (results[j]) {
        batchOk++;
        ok++;
        txCount++;
        appendFileSync(AUDIT_FILE, `${batch[j].txid},celltoken,${batch[j].utxo.sats},${batch[j].fee},${batch[j].txHex.length / 2},${Date.now()}\n`);
      } else {
        fail++;
      }
    }

    // Status
    const now = Date.now();
    if (now - lastStatusTime > 5_000) {
      const elapsed = (now - startTime) / 1000;
      const produced = txCount - existingCount;
      const rate = produced / elapsed;
      const remaining = utxos.length - cursor - (i + CONCURRENCY);
      const eta = Math.max(0, remaining) / Math.max(rate, 0.1);
      console.log(`  [${txCount.toLocaleString()} tx | ${rate.toFixed(0)} tx/s | ${fail} fail | ${Math.max(0, remaining).toLocaleString()} left | ETA: ${(eta / 60).toFixed(1)}m]`);
      lastStatusTime = now;
    }

    // Periodic verify
    if (VERIFY_INTERVAL > 0 && (txCount - existingCount) % VERIFY_INTERVAL < CONCURRENCY) {
      const sample = batch[0];
      await new Promise(r => setTimeout(r, 10000));
      try {
        const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${sample.txid}`);
        if (check.ok) {
          verifyOk++;
          console.log(`  [verify] ✓ ${sample.txid.slice(0, 16)}... ON-CHAIN (${verifyOk}/${verifyOk + verifyFail})`);
        } else {
          verifyFail++;
          console.log(`  [verify] ✗ ${sample.txid.slice(0, 16)}... NOT FOUND`);
          if (verifyFail > 3) { console.error('  Ghost pipeline — stopping'); stopping = true; }
        }
      } catch {}
    }
  }

  cursor = chunkEnd;
}

// ── Results ──

const elapsed = (Date.now() - startTime) / 1000;
const produced = txCount - existingCount;
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  MAPI SLAM RESULTS');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  New CellTokens:   ${produced.toLocaleString()}`);
console.log(`  Total (w/resume): ${txCount.toLocaleString()}`);
console.log(`  Accepted:         ${ok.toLocaleString()}`);
console.log(`  Failed:           ${fail}`);
console.log(`  Verified:         ${verifyOk}/${verifyOk + verifyFail}`);
console.log(`  Elapsed:          ${elapsed.toFixed(1)}s`);
console.log(`  Rate:             ${(produced / elapsed).toFixed(1)} tx/s`);
console.log(`  Remaining:        ${(utxos.length - cursor).toLocaleString()} UTXOs`);
console.log(`  Audit:            ${AUDIT_FILE}`);
console.log('');
