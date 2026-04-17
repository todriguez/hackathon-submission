#!/usr/bin/env bun
/**
 * pool-crank.ts — Continuous BRC-42 Pool Slam with change recycling.
 *
 * Send BSV to the master address, then run this script. It will:
 *   1. Derive 8 child keys via BRC-42
 *   2. Fan-out master funds to children
 *   3. Pre-split each child into micro-UTXOs
 *   4. Slam CellTokens via MAPI at ~200-300 tx/s
 *   5. Collect change outputs → re-split → slam again
 *   6. Repeat until all sats are burned as fees
 *
 * 1.5 BSV ≈ 1.36M CellTokens over ~4-6 hours.
 *
 * Usage:
 *   set -a && . ./.env.live && set +a
 *   bun scripts/pool-crank.ts
 */

import { PrivateKey, KeyDeriver, Transaction, P2PKH, LockingScript } from '@bsv/sdk';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

// ── Config ──

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const NUM_CHILDREN = Number(process.env.NUM_CHILDREN ?? '8');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '50');
const FEE_RATE = Number(process.env.FEE_RATE ?? '0.5');
const MICRO_SATS = Number(process.env.MICRO_SATS ?? '1000');
const MAX_SPLIT_OUTPUTS = Number(process.env.MAX_SPLIT_OUTPUTS ?? '600');
const MAPI_URL = 'https://mapi.gorillapool.io/mapi/tx';
const MIN_SATS = 500; // minimum UTXO to spend

const masterKey = PrivateKey.fromWif(WIF);
const deriver = new KeyDeriver(masterKey);
const p2pkh = new P2PKH();
const masterAddress = masterKey.toPublicKey().toAddress();
const masterLock = p2pkh.lock(masterAddress);

mkdirSync('data', { recursive: true });

const AUDIT_FILE = 'data/pool-crank-txids.csv';
if (!existsSync(AUDIT_FILE)) {
  writeFileSync(AUDIT_FILE, 'txid,type,child,input_sats,fee,size,round,timestamp\n');
}

// Resume count
const existingCount = existsSync(AUDIT_FILE)
  ? (await Bun.file(AUDIT_FILE).text()).split('\n').filter(l => l.includes(',celltoken,')).length
  : 0;

// ── Child Keys ──

interface ChildInfo {
  index: number;
  privKey: PrivateKey;
  address: string;
  lockScript: LockingScript;
}

interface Utxo { txid: string; vout: number; sats: number; }

const children: ChildInfo[] = Array.from({ length: NUM_CHILDREN }, (_, i) => {
  const privKey = deriver.derivePrivateKey([2, 'pool manager funding'], `container-${i}`, 'self');
  const address = privKey.toPublicKey().toAddress();
  return { index: i, privKey, address, lockScript: p2pkh.lock(address) };
});

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  POOL CRANK — Continuous BRC-42 CellToken slam');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Master:       ${masterAddress}`);
console.log(`  Children:     ${NUM_CHILDREN}`);
console.log(`  Concurrency:  ${CONCURRENCY} per child (${NUM_CHILDREN * CONCURRENCY} total)`);
console.log(`  Fee rate:     ${FEE_RATE} sat/byte`);
console.log(`  Micro UTXO:   ${MICRO_SATS} sats`);
if (existingCount > 0) console.log(`  Resuming:     ${existingCount.toLocaleString()} existing CellTokens`);
console.log('');

for (const c of children) {
  console.log(`  Child ${c.index}: ${c.address}`);
}
console.log('');

// ── Broadcast ──

async function broadcastMAPI(txHex: string): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(MAPI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawtx: txHex }),
      });
      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      const raw = await resp.text();
      try {
        const outer = JSON.parse(raw);
        const inner = JSON.parse(outer.payload);
        const ok = inner.returnResult === 'success' || (inner.resultDescription || '').includes('already known');
        return { ok, error: ok ? undefined : inner.resultDescription };
      } catch {
        return { ok: resp.ok, error: raw.slice(0, 200) };
      }
    } catch (err: any) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 200)); continue; }
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: '429 after retries' };
}

// ── UTXO Discovery ──

async function discoverUtxos(address: string): Promise<Utxo[]> {
  const all: Utxo[] = [];
  const seen = new Set<string>();

  // WoC (fast, up to 1000, confirmed only)
  try {
    const resp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`);
    if (resp.ok) {
      const utxos: any[] = await resp.json();
      for (const u of utxos) {
        if ((u.value ?? 0) >= MIN_SATS) {
          const key = `${u.tx_hash}:${u.tx_pos}`;
          if (!seen.has(key)) {
            seen.add(key);
            all.push({ txid: u.tx_hash, vout: u.tx_pos, sats: u.value });
          }
        }
      }
    }
  } catch {}

  // Bitails (paginated, includes unconfirmed)
  let from = 0;
  const LIMIT = 10000;
  while (true) {
    try {
      const resp = await fetch(`https://api.bitails.io/address/${address}/unspent?limit=${LIMIT}&from=${from}`);
      if (!resp.ok) break;
      const data: any = await resp.json();
      const utxos = data.unspent ?? data;
      if (!Array.isArray(utxos) || utxos.length === 0) break;
      for (const u of utxos) {
        const sats = u.value ?? u.satoshis ?? 0;
        if (sats >= MIN_SATS) {
          const txid = u.tx_hash ?? u.txid;
          const vout = u.tx_pos ?? u.vout;
          const key = `${txid}:${vout}`;
          if (!seen.has(key)) {
            seen.add(key);
            all.push({ txid, vout, sats });
          }
        }
      }
      if (utxos.length < LIMIT) break;
      from += LIMIT;
    } catch { break; }
  }

  return all;
}

// ── Fan-out: master → children ──

async function fanOutToChildren(masterUtxos: Utxo[], satsPerChild: number): Promise<Map<number, Utxo[]>> {
  const result = new Map<number, Utxo[]>();

  const tx = new Transaction();
  let inputTotal = 0;

  for (const u of masterUtxos) {
    tx.addInput({
      sourceTXID: u.txid, sourceOutputIndex: u.vout,
      unlockingScriptTemplate: p2pkh.unlock(masterKey, 'all', false, u.sats, masterLock),
    });
    inputTotal += u.sats;
    if (inputTotal >= satsPerChild * NUM_CHILDREN + 50000) break;
  }

  let outputTotal = 0;
  for (let i = 0; i < NUM_CHILDREN; i++) {
    tx.addOutput({ lockingScript: children[i].lockScript, satoshis: satsPerChild });
    outputTotal += satsPerChild;
  }

  const estSize = 180 * masterUtxos.length + 34 * (NUM_CHILDREN + 1) + 10;
  const fee = Math.max(Math.ceil(estSize * FEE_RATE * 1.5), 500);
  const change = inputTotal - outputTotal - fee;
  if (change >= 546) {
    tx.addOutput({ lockingScript: masterLock, satoshis: change });
  }

  await tx.sign();
  const txHex = tx.toHex();
  const txid = tx.id('hex') as string;

  const broadcast = await broadcastMAPI(txHex);
  if (!broadcast.ok) {
    // WoC fallback
    const woc = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: txHex }),
    });
    if (!woc.ok) {
      const body = await woc.text();
      throw new Error(`Fan-out rejected: MAPI=${broadcast.error} WoC=${body.slice(0, 150)}`);
    }
  }

  for (let i = 0; i < NUM_CHILDREN; i++) {
    result.set(i, [{ txid, vout: i, sats: satsPerChild }]);
  }

  appendFileSync(AUDIT_FILE, `${txid},fanout,master,${inputTotal},${fee},${txHex.length / 2},0,${Date.now()}\n`);
  console.log(`  Fan-out: ${txid.slice(0, 16)}... → ${NUM_CHILDREN} × ${satsPerChild.toLocaleString()} sats (fee: ${fee})`);

  return result;
}

// ── Pre-split: big UTXO → many micro-UTXOs ──

async function preSplit(child: ChildInfo, utxo: Utxo, round: number): Promise<Utxo[]> {
  const numOutputs = Math.min(
    Math.floor((utxo.sats - 500) / (MICRO_SATS + 20)),
    MAX_SPLIT_OUTPUTS,
  );
  if (numOutputs <= 1) return [utxo]; // too small to split

  const tx = new Transaction();
  tx.addInput({
    sourceTXID: utxo.txid, sourceOutputIndex: utxo.vout,
    unlockingScriptTemplate: p2pkh.unlock(child.privKey, 'all', false, utxo.sats, child.lockScript),
  });

  let outputTotal = 0;
  for (let j = 0; j < numOutputs; j++) {
    tx.addOutput({ lockingScript: child.lockScript, satoshis: MICRO_SATS });
    outputTotal += MICRO_SATS;
  }

  const fee = Math.max(Math.ceil((180 + numOutputs * 34 + 10) * FEE_RATE), 200);
  const change = utxo.sats - outputTotal - fee;
  if (change >= 546) {
    tx.addOutput({ lockingScript: child.lockScript, satoshis: change });
  }

  await tx.sign();
  const txHex = tx.toHex();
  const txid = tx.id('hex') as string;

  const result = await broadcastMAPI(txHex);
  if (!result.ok) {
    console.error(`    Child ${child.index} split failed: ${result.error?.slice(0, 100)}`);
    return [utxo];
  }

  const outputs: Utxo[] = [];
  for (let j = 0; j < numOutputs; j++) {
    outputs.push({ txid, vout: j, sats: MICRO_SATS });
  }
  if (change >= MIN_SATS) {
    outputs.push({ txid, vout: numOutputs, sats: change });
  }

  appendFileSync(AUDIT_FILE, `${txid},presplit,${child.index},${utxo.sats},${fee},${txHex.length / 2},${round},${Date.now()}\n`);
  return outputs;
}

// ── Slam CellTokens from a child's UTXOs ──
// Returns change UTXOs for recycling

async function slamChild(
  child: ChildInfo,
  utxos: Utxo[],
  round: number,
  stats: Stats,
): Promise<Utxo[]> {
  const changeUtxos: Utxo[] = [];

  // Shuffle for even distribution
  for (let i = utxos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [utxos[i], utxos[j]] = [utxos[j], utxos[i]];
  }

  for (let cursor = 0; cursor < utxos.length && !stats.stopping; cursor += CONCURRENCY) {
    const batch = utxos.slice(cursor, cursor + CONCURRENCY);

    // Build
    const built: Array<{ txid: string; txHex: string; fee: number; utxo: Utxo; change: number }> = [];
    for (const u of batch) {
      try {
        const tx = new Transaction();
        tx.addInput({
          sourceTXID: u.txid, sourceOutputIndex: u.vout,
          unlockingScriptTemplate: p2pkh.unlock(child.privKey, 'all', false, u.sats, child.lockScript),
        });
        const payload = Array.from(new TextEncoder().encode(JSON.stringify({
          t: 'cell', c: child.index, n: stats.txCount, r: round, ts: Date.now(),
        })));
        tx.addOutput({
          lockingScript: new LockingScript([
            { op: 0 }, { op: 0x6a },
            payload.length <= 75 ? { op: payload.length, data: payload } : { op: 0x4c, data: payload },
          ]),
          satoshis: 0,
        });
        const fee = Math.max(Math.ceil(220 * FEE_RATE), 110);
        const change = u.sats - fee;
        if (change >= 546) tx.addOutput({ lockingScript: child.lockScript, satoshis: change });
        await tx.sign();
        built.push({ txid: tx.id('hex') as string, txHex: tx.toHex(), fee, utxo: u, change: change >= 546 ? change : 0 });
      } catch {}
    }

    // Broadcast
    const results = await Promise.all(built.map(async (b) => {
      const r = await broadcastMAPI(b.txHex);
      return { ...b, result: r };
    }));

    for (const r of results) {
      if (r.result.ok) {
        stats.ok++;
        stats.txCount++;
        appendFileSync(AUDIT_FILE, `${r.txid},celltoken,${child.index},${r.utxo.sats},${r.fee},${r.txHex.length / 2},${round},${Date.now()}\n`);
        // Collect change for recycling
        if (r.change >= MIN_SATS) {
          changeUtxos.push({ txid: r.txid, vout: 1, sats: r.change });
        }
      } else {
        stats.fail++;
        if (stats.fail <= 5 || stats.fail % 500 === 0) {
          console.error(`    Child ${child.index} fail #${stats.fail}: ${r.result.error?.slice(0, 100)}`);
        }
      }
    }
  }

  return changeUtxos;
}

// ── Main Loop ──

interface Stats {
  txCount: number;
  ok: number;
  fail: number;
  stopping: boolean;
}

const stats: Stats = {
  txCount: existingCount,
  ok: existingCount,
  fail: 0,
  stopping: false,
};

process.on('SIGINT', () => {
  if (stats.stopping) process.exit(1);
  stats.stopping = true;
  console.log('\n  SIGINT — finishing current batch, then stopping...');
});

const globalStart = Date.now();

// Step 1: Discover what we have
console.log('  Discovering UTXOs...');

let masterUtxos = await discoverUtxos(masterAddress);
const masterTotal = masterUtxos.reduce((s, u) => s + u.sats, 0);
console.log(`  Master: ${masterUtxos.length} UTXOs (${masterTotal.toLocaleString()} sats / ${(masterTotal / 1e8).toFixed(4)} BSV)`);

// Check children too
const childUtxoMap = new Map<number, Utxo[]>();
let readyChildren = 0;
for (const child of children) {
  const utxos = await discoverUtxos(child.address);
  childUtxoMap.set(child.index, utxos);
  if (utxos.length > 0) {
    const total = utxos.reduce((s, u) => s + u.sats, 0);
    console.log(`  Child ${child.index}: ${utxos.length} UTXOs (${total.toLocaleString()} sats)`);
    readyChildren++;
  }
}
console.log('');

// Step 2: Fan-out if needed
if (readyChildren === 0 && masterTotal > 0) {
  console.log('  No children funded. Creating fan-out...');
  masterUtxos.sort((a, b) => b.sats - a.sats);
  // Use at most 200 biggest UTXOs for the fan-out (keeps tx size reasonable)
  const fanInputs = masterUtxos.slice(0, 200);
  const usableTotal = fanInputs.reduce((s, u) => s + u.sats, 0);
  console.log(`  Using top ${fanInputs.length} UTXOs (${usableTotal.toLocaleString()} sats / ${(usableTotal / 1e8).toFixed(4)} BSV)`);
  const perChild = Math.floor((usableTotal - 50000) / NUM_CHILDREN);

  if (perChild < MICRO_SATS * 10) {
    console.error(`  Not enough funds. Have ${usableTotal.toLocaleString()} sats, need ${(MICRO_SATS * 10 * NUM_CHILDREN).toLocaleString()}`);
    console.log(`  Send BSV to: ${masterAddress}`);
    process.exit(1);
  }

  try {
    const fanOut = await fanOutToChildren(fanInputs, perChild);
    for (const [idx, utxos] of fanOut) {
      childUtxoMap.set(idx, utxos);
    }
    console.log('  Waiting 3s for propagation...');
    await new Promise(r => setTimeout(r, 3000));
  } catch (err: any) {
    console.error(`  Fan-out failed: ${err.message}`);
    process.exit(1);
  }
  console.log('');
}

if (masterTotal === 0 && readyChildren === 0) {
  console.log(`  No funds anywhere. Send BSV to: ${masterAddress}`);
  process.exit(1);
}

// Step 3: CRANK — rounds of (split → slam → collect change → repeat)

let round = 0;
const statusInterval = setInterval(() => {
  if (stats.stopping) return;
  const elapsed = (Date.now() - globalStart) / 1000;
  const produced = stats.txCount - existingCount;
  const rate = produced / Math.max(elapsed, 0.1);
  const feeBurned = produced * 110;
  console.log(`  ══ Round ${round} | ${stats.txCount.toLocaleString()} tx | ${rate.toFixed(0)} tx/s | ${stats.fail} fail | ${(feeBurned / 1e8).toFixed(4)} BSV burned | ${(elapsed / 60).toFixed(1)}m ══`);
}, 10_000);

while (!stats.stopping) {
  round++;
  console.log(`\n  ── Round ${round} ──`);

  // Pre-split all children
  for (const child of children) {
    if (stats.stopping) break;
    const utxos = childUtxoMap.get(child.index) ?? [];
    if (utxos.length === 0) continue;

    // Split big UTXOs into micro-UTXOs
    const allMicro: Utxo[] = [];
    for (const u of utxos) {
      if (stats.stopping) break;
      if (u.sats >= MICRO_SATS * 5) {
        const split = await preSplit(child, u, round);
        allMicro.push(...split);
        console.log(`    Child ${child.index}: ${u.sats.toLocaleString()} → ${split.length} UTXOs`);
      } else if (u.sats >= MIN_SATS) {
        allMicro.push(u);
      }
    }
    childUtxoMap.set(child.index, allMicro);
  }

  // Count total UTXOs available
  let totalUtxos = 0;
  for (const [, utxos] of childUtxoMap) totalUtxos += utxos.length;
  if (totalUtxos === 0) {
    console.log('  No UTXOs left. All sats burned as fees. Done!');
    break;
  }
  console.log(`  Total: ${totalUtxos.toLocaleString()} UTXOs across ${NUM_CHILDREN} children`);

  // Slam all children in parallel, collect change
  const changePromises = children.map(async (child) => {
    const utxos = childUtxoMap.get(child.index) ?? [];
    if (utxos.length === 0) return [];
    const spendable = utxos.filter(u => u.sats >= MIN_SATS);
    return slamChild(child, spendable, round, stats);
  });

  const changeResults = await Promise.all(changePromises);

  // Collect change outputs for next round
  let totalChange = 0;
  for (let i = 0; i < children.length; i++) {
    const change = changeResults[i];
    childUtxoMap.set(i, change);
    totalChange += change.reduce((s, u) => s + u.sats, 0);
  }

  const elapsed = (Date.now() - globalStart) / 1000;
  const produced = stats.txCount - existingCount;
  console.log(`  Round ${round} done. Change: ${totalChange.toLocaleString()} sats → next round`);
  console.log(`  Cumulative: ${produced.toLocaleString()} CellTokens in ${(elapsed / 60).toFixed(1)}m (${(produced / elapsed).toFixed(0)} tx/s avg)`);

  if (totalChange < MIN_SATS * NUM_CHILDREN) {
    console.log('  Insufficient change for another round. Checking master for more funds...');
    masterUtxos = await discoverUtxos(masterAddress);
    if (masterUtxos.length > 0) {
      const mt = masterUtxos.reduce((s, u) => s + u.sats, 0);
      console.log(`  Master has ${mt.toLocaleString()} sats — re-funding children...`);
      try {
        masterUtxos.sort((a, b) => b.sats - a.sats);
        const perChild = Math.floor((mt - 50000) / NUM_CHILDREN);
        if (perChild >= MICRO_SATS * 10) {
          const fanOut = await fanOutToChildren(masterUtxos, perChild);
          for (const [idx, utxos] of fanOut) {
            const existing = childUtxoMap.get(idx) ?? [];
            childUtxoMap.set(idx, [...existing, ...utxos]);
          }
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch {}
    } else {
      console.log('  No more funds. Done!');
      break;
    }
  }

  // Periodic WoC verification
  if (round % 3 === 0 && produced > 0) {
    const lines = (await Bun.file(AUDIT_FILE).text()).split('\n').filter(l => l.includes(',celltoken,'));
    const sample = lines[Math.floor(Math.random() * lines.length)];
    const txid = sample?.split(',')[0];
    if (txid?.length === 64) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${txid}`);
        console.log(`  [verify] ${txid.slice(0, 16)}... ${check.ok ? '✓ ON-CHAIN' : '✗ NOT FOUND'}`);
      } catch {}
    }
  }
}

clearInterval(statusInterval);

// ── Final Results ──

const totalElapsed = (Date.now() - globalStart) / 1000;
const totalProduced = stats.txCount - existingCount;
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  POOL CRANK FINAL RESULTS');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  CellTokens:    ${totalProduced.toLocaleString()}`);
console.log(`  Total (resume): ${stats.txCount.toLocaleString()}`);
console.log(`  Accepted:      ${stats.ok.toLocaleString()}`);
console.log(`  Failed:        ${stats.fail}`);
console.log(`  Rounds:        ${round}`);
console.log(`  Elapsed:       ${(totalElapsed / 60).toFixed(1)} minutes`);
console.log(`  Avg rate:      ${(totalProduced / totalElapsed).toFixed(0)} tx/s`);
console.log(`  Fees burned:   ${(totalProduced * 110 / 1e8).toFixed(4)} BSV`);
console.log(`  Audit:         ${AUDIT_FILE}`);
console.log('');

// Final spot check
if (totalProduced > 0) {
  console.log('  Spot-checking 5 random txids...');
  const lines = (await Bun.file(AUDIT_FILE).text()).split('\n').filter(l => l.includes(',celltoken,'));
  for (let i = 0; i < 5 && lines.length > 0; i++) {
    const line = lines[Math.floor(Math.random() * lines.length)];
    const txid = line.split(',')[0];
    if (txid.length !== 64) continue;
    try {
      const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${txid}`);
      console.log(`    ${txid.slice(0, 16)}... ${check.ok ? '✓ ON-CHAIN' : '✗ NOT FOUND'}`);
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
}
console.log('');
