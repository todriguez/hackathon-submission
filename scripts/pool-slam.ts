#!/usr/bin/env bun
/**
 * pool-slam.ts — BRC-42 Pool Manager + Per-Child MAPI Slam
 *
 * Architecture:
 *   1. Master key derives N child keys via BRC-42 (KeyDeriver)
 *   2. Master creates a fan-out tx splitting a funded UTXO into N child outputs
 *   3. Fan-out is broadcast via MAPI (direct to GorillaPool mining node)
 *   4. Each child pre-splits its funding into micro-UTXOs
 *   5. All children slam CellTokens in parallel via MAPI at concurrency 100
 *
 * BRC-42 key derivation:
 *   protocolID = [2, 'pool manager funding']
 *   keyID      = 'container-{i}'
 *   counterparty = 'self'
 *
 * This is fully deterministic — given a master WIF, all child keys are
 * reproducible without any state. Resume-safe by design.
 *
 * Usage:
 *   set -a && . ./.env.live && set +a
 *   bun scripts/pool-slam.ts
 *
 * Env:
 *   PRIVATE_KEY_WIF   — master key (required)
 *   NUM_CHILDREN      — number of child streams (default: 8)
 *   SATS_PER_CHILD    — satoshis to fund each child (default: auto-split)
 *   UTXOS_PER_CHILD   — micro-UTXOs per child for slamming (default: 500)
 *   CONCURRENCY       — MAPI concurrency per child (default: 50)
 *   MAX_TX            — total tx limit across all children (0 = unlimited)
 *   FEE_RATE          — sat/byte (default: 0.5)
 */

import { PrivateKey, KeyDeriver, Transaction, P2PKH, LockingScript } from '@bsv/sdk';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

// ── Config ──

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const NUM_CHILDREN = Number(process.env.NUM_CHILDREN ?? '8');
const SATS_PER_CHILD = Number(process.env.SATS_PER_CHILD ?? '0'); // 0 = auto
const UTXOS_PER_CHILD = Number(process.env.UTXOS_PER_CHILD ?? '500');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '50');
const MAX_TX = Number(process.env.MAX_TX ?? '0');
const FEE_RATE = Number(process.env.FEE_RATE ?? '0.5');
const MICRO_SATS = Number(process.env.MICRO_SATS ?? '1000'); // sats per micro-UTXO
const MAPI_URL = 'https://mapi.gorillapool.io/mapi/tx';

const masterKey = PrivateKey.fromWif(WIF);
const deriver = new KeyDeriver(masterKey);
const p2pkh = new P2PKH();
const masterAddress = masterKey.toPublicKey().toAddress();
const masterLock = p2pkh.lock(masterAddress);

mkdirSync('data', { recursive: true });

const AUDIT_FILE = 'data/pool-slam-txids.csv';
if (!existsSync(AUDIT_FILE)) {
  writeFileSync(AUDIT_FILE, 'txid,type,child,input_sats,fee,size,timestamp\n');
}

// ── Derive Children ──

interface ChildInfo {
  index: number;
  privKey: PrivateKey;
  address: string;
  lockScript: LockingScript;
}

function deriveChildren(n: number): ChildInfo[] {
  return Array.from({ length: n }, (_, i) => {
    const privKey = deriver.derivePrivateKey(
      [2, 'pool manager funding'],
      `container-${i}`,
      'self',
    );
    const address = privKey.toPublicKey().toAddress();
    return { index: i, privKey, address, lockScript: p2pkh.lock(address) };
  });
}

const children = deriveChildren(NUM_CHILDREN);

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  POOL SLAM — BRC-42 Key Derivation + Per-Child MAPI');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Master:       ${masterAddress}`);
console.log(`  Children:     ${NUM_CHILDREN}`);
console.log(`  Protocol:     [2, 'pool manager funding']`);
console.log(`  Concurrency:  ${CONCURRENCY} per child`);
console.log(`  Fee rate:     ${FEE_RATE} sat/byte`);
console.log(`  Micro UTXO:   ${MICRO_SATS} sats`);
console.log('');
console.log('  Derived child addresses:');
for (const c of children) {
  console.log(`    ${c.index}: ${c.address}`);
}
console.log('');

// ── Discover UTXOs ──

interface Utxo { txid: string; vout: number; sats: number; }

async function discoverUtxos(address: string, minSats: number = 500): Promise<Utxo[]> {
  // WoC first (fast, returns up to 1000, finds big UTXOs immediately)
  try {
    const wocResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`);
    if (wocResp.ok) {
      const wocUtxos: any[] = await wocResp.json();
      const filtered = wocUtxos
        .filter((u: any) => (u.value ?? u.satoshis ?? 0) >= minSats)
        .map((u: any) => ({
          txid: u.tx_hash ?? u.txid,
          vout: u.tx_pos ?? u.vout,
          sats: u.value ?? u.satoshis,
        }));
      if (filtered.length > 0) {
        console.log(`    WoC: ${filtered.length} UTXOs ≥ ${minSats} sats`);
        return filtered;
      }
    }
  } catch {}

  // Bitails fallback (paginated, slower but complete)
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
      if (sats >= minSats) {
        all.push({ txid: u.tx_hash ?? u.txid, vout: u.tx_pos ?? u.vout, sats });
      }
    }
    if (utxos.length < LIMIT) break;
    from += LIMIT;
  }
  return all;
}

async function broadcastMAPI(txHex: string): Promise<{ ok: boolean; txid?: string; error?: string }> {
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
        return { ok, txid: inner.txid, error: ok ? undefined : inner.resultDescription };
      } catch {
        return { ok: resp.ok, error: raw.slice(0, 200) };
      }
    } catch (err: any) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 200)); continue; }
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: '429 after 3 retries' };
}

// ── Phase 1: Discover master UTXOs & fund children ──

console.log('  Phase 1: Discovering master UTXOs...');
const masterUtxos = await discoverUtxos(masterAddress, MICRO_SATS);
const masterTotal = masterUtxos.reduce((s, u) => s + u.sats, 0);
console.log(`  Master: ${masterUtxos.length} UTXOs (${masterTotal.toLocaleString()} sats / ${(masterTotal / 1e8).toFixed(4)} BSV)`);

if (masterUtxos.length === 0) {
  console.error('  No usable UTXOs on master address. Fund it first.');
  process.exit(1);
}

// Sort by size descending for fan-out
masterUtxos.sort((a, b) => b.sats - a.sats);

// Calculate per-child funding
const fanOutFee = Math.ceil((180 + NUM_CHILDREN * 34 + 10) * FEE_RATE);
const satsPerChild = SATS_PER_CHILD > 0
  ? SATS_PER_CHILD
  : Math.floor((masterTotal - fanOutFee) / NUM_CHILDREN);

console.log(`  Per-child funding: ${satsPerChild.toLocaleString()} sats`);
console.log(`  Fan-out fee est:   ${fanOutFee} sats`);

if (satsPerChild < MICRO_SATS * 10) {
  console.error(`  Not enough to fund children. Need at least ${MICRO_SATS * 10 * NUM_CHILDREN} sats.`);
  process.exit(1);
}
console.log('');

// ── Phase 1a: Check if children already have UTXOs (resume) ──

console.log('  Checking child balances (resume detection)...');
const childUtxos: Map<number, Utxo[]> = new Map();
let childrenNeedFunding = 0;

for (const child of children) {
  const utxos = await discoverUtxos(child.address, 500);
  childUtxos.set(child.index, utxos);
  const total = utxos.reduce((s, u) => s + u.sats, 0);
  if (utxos.length > 0) {
    console.log(`    Child ${child.index}: ${utxos.length} UTXOs (${total.toLocaleString()} sats) — READY`);
  } else {
    console.log(`    Child ${child.index}: empty — needs funding`);
    childrenNeedFunding++;
  }
}
console.log('');

// ── Phase 1b: Fan-out funding tx (if needed) ──

if (childrenNeedFunding > 0) {
  // Filter master UTXOs: exclude any that appear in recent audit as spent inputs
  const recentlySpent = new Set<string>();
  if (existsSync(AUDIT_FILE)) {
    const lines = (await Bun.file(AUDIT_FILE).text()).split('\n');
    for (const line of lines) {
      const txid = line.split(',')[0];
      if (txid && txid.length === 64) recentlySpent.add(txid);
    }
  }
  // Also exclude UTXOs whose txid matches a recently broadcast tx (they're change outputs from unconfirmed txs)
  const safeUtxos = masterUtxos.filter(u => !recentlySpent.has(u.txid));
  const safeTotal = safeUtxos.reduce((s, u) => s + u.sats, 0);

  if (safeUtxos.length === 0 || safeTotal < satsPerChild * childrenNeedFunding + fanOutFee) {
    console.log(`  ⚠ Not enough safe (unspent) master UTXOs for fan-out.`);
    console.log(`    Safe UTXOs: ${safeUtxos.length} (${safeTotal.toLocaleString()} sats)`);
    console.log(`    Need: ${(satsPerChild * childrenNeedFunding + fanOutFee).toLocaleString()} sats for ${childrenNeedFunding} children`);
    console.log(`    Proceeding with already-funded children only.`);
  } else {
    console.log(`  Building fan-out to fund ${childrenNeedFunding} children...`);
    console.log(`    Safe UTXOs: ${safeUtxos.length} (${safeTotal.toLocaleString()} sats)`);

    const tx = new Transaction();
    let inputTotal = 0;
    const usedUtxos: Utxo[] = [];

    // Sort by size descending — use biggest UTXOs first to minimize inputs
    safeUtxos.sort((a, b) => b.sats - a.sats);

    for (const u of safeUtxos) {
      if (inputTotal >= satsPerChild * childrenNeedFunding + fanOutFee * 2) break;
      tx.addInput({
        sourceTXID: u.txid,
        sourceOutputIndex: u.vout,
        unlockingScriptTemplate: p2pkh.unlock(masterKey, 'all', false, u.sats, masterLock),
      });
      inputTotal += u.sats;
      usedUtxos.push(u);
    }

    // Add outputs for each unfunded child
    let outputTotal = 0;
    for (const child of children) {
      const existing = childUtxos.get(child.index) ?? [];
      if (existing.length > 0) continue;
      tx.addOutput({ lockingScript: child.lockScript, satoshis: satsPerChild });
      outputTotal += satsPerChild;
    }

    // Change back to master
    const actualFee = Math.max(Math.ceil((180 * usedUtxos.length + 34 * (childrenNeedFunding + 1) + 10) * FEE_RATE), 200);
    const change = inputTotal - outputTotal - actualFee;
    if (change >= 546) {
      tx.addOutput({ lockingScript: masterLock, satoshis: change });
    }

    await tx.sign();
    const fanOutHex = tx.toHex();
    const fanOutTxid = tx.id('hex') as string;

    console.log(`  Fan-out txid: ${fanOutTxid}`);
    console.log(`  Fan-out size: ${fanOutHex.length / 2} bytes`);
    console.log(`  Fan-out fee:  ${actualFee} sats`);

    const result = await broadcastMAPI(fanOutHex);
    if (!result.ok) {
      console.error(`  ✗ Fan-out MAPI rejected: ${result.error}`);
      console.log('  Trying WoC fallback...');
      const wocResp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: fanOutHex }),
      });
      if (!wocResp.ok) {
        const body = await wocResp.text();
        console.error(`  ✗ WoC also rejected: ${body.slice(0, 200)}`);
        console.log(`  Proceeding with already-funded children only.`);
      } else {
        console.log('  ✓ WoC accepted fan-out');
      }
    } else {
      console.log('  ✓ MAPI accepted fan-out');
    }

    if (result.ok || true) {  // Update child UTXOs even on partial success
      console.log('  Waiting 5s for propagation...');
      await new Promise(r => setTimeout(r, 5000));

      const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${fanOutTxid}`);
      console.log(`  Fan-out ${check.ok ? '✓ ON-CHAIN' : '⚠ indexing delay'}`);

      let vout = 0;
      for (const child of children) {
        const existing = childUtxos.get(child.index) ?? [];
        if (existing.length > 0) continue;
        if (result.ok) {
          childUtxos.set(child.index, [{ txid: fanOutTxid, vout, sats: satsPerChild }]);
        }
        vout++;
      }

      appendFileSync(AUDIT_FILE, `${fanOutTxid},fanout,master,${inputTotal},${actualFee},${fanOutHex.length / 2},${Date.now()}\n`);
    }
  }
  console.log('');
}

// ── Phase 2: Pre-split each child's funding into micro-UTXOs ──

console.log('  Phase 2: Pre-splitting child funding into micro-UTXOs...');

async function preSplitChild(child: ChildInfo, utxos: Utxo[]): Promise<Utxo[]> {
  // If already has many small UTXOs, skip
  const smallUtxos = utxos.filter(u => u.sats >= 500 && u.sats <= MICRO_SATS * 3);
  if (smallUtxos.length >= UTXOS_PER_CHILD / 2) {
    console.log(`    Child ${child.index}: already has ${smallUtxos.length} micro-UTXOs, skipping split`);
    return utxos;
  }

  // Find UTXOs large enough to split
  const bigUtxos = utxos.filter(u => u.sats >= MICRO_SATS * 5);
  if (bigUtxos.length === 0) {
    console.log(`    Child ${child.index}: no big UTXOs to split, using ${utxos.length} as-is`);
    return utxos;
  }

  const result: Utxo[] = [...smallUtxos]; // Keep existing small ones

  for (const big of bigUtxos) {
    // How many micro-UTXOs can we make from this one?
    const splitFee = Math.ceil(200 * FEE_RATE); // rough fee per split output
    const numOutputs = Math.min(
      Math.floor((big.sats - 200) / (MICRO_SATS + splitFee)),
      600, // max outputs per tx
      UTXOS_PER_CHILD - result.length,
    );

    if (numOutputs <= 1) continue;

    const tx = new Transaction();
    tx.addInput({
      sourceTXID: big.txid,
      sourceOutputIndex: big.vout,
      unlockingScriptTemplate: p2pkh.unlock(child.privKey, 'all', false, big.sats, child.lockScript),
    });

    let outputTotal = 0;
    for (let j = 0; j < numOutputs; j++) {
      tx.addOutput({ lockingScript: child.lockScript, satoshis: MICRO_SATS });
      outputTotal += MICRO_SATS;
    }

    const fee = Math.max(Math.ceil((180 + numOutputs * 34 + 10) * FEE_RATE), 200);
    const change = big.sats - outputTotal - fee;
    if (change >= 546) {
      tx.addOutput({ lockingScript: child.lockScript, satoshis: change });
    }

    await tx.sign();
    const txHex = tx.toHex();
    const txid = tx.id('hex') as string;

    const broadcast = await broadcastMAPI(txHex);
    if (broadcast.ok) {
      for (let j = 0; j < numOutputs; j++) {
        result.push({ txid, vout: j, sats: MICRO_SATS });
      }
      if (change >= 546) {
        result.push({ txid, vout: numOutputs, sats: change });
      }
      console.log(`    Child ${child.index}: split ${big.sats.toLocaleString()} → ${numOutputs} × ${MICRO_SATS} (txid: ${txid.slice(0, 16)}...)`);
      appendFileSync(AUDIT_FILE, `${txid},presplit,${child.index},${big.sats},${fee},${txHex.length / 2},${Date.now()}\n`);
    } else {
      console.log(`    Child ${child.index}: split failed — ${broadcast.error?.slice(0, 100)}`);
      result.push(big); // keep original if split fails
    }

    if (result.length >= UTXOS_PER_CHILD) break;
  }

  return result;
}

for (const child of children) {
  const utxos = childUtxos.get(child.index) ?? [];
  if (utxos.length === 0) continue;
  const split = await preSplitChild(child, utxos);
  childUtxos.set(child.index, split);
}

console.log('');

// ── Phase 3: SLAM CellTokens from all children in parallel ──

console.log('═══════════════════════════════════════════════════════════');
console.log('  POOL SLAM — All children slamming CellTokens via MAPI');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

const startTime = Date.now();
let globalTxCount = 0;
let globalOk = 0;
let globalFail = 0;
let stopping = false;

process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\n  Stopping all children...');
});

async function slamChild(child: ChildInfo): Promise<{ ok: number; fail: number }> {
  const utxos = childUtxos.get(child.index) ?? [];
  const usable = utxos.filter(u => u.sats >= 500);

  // Shuffle
  for (let i = usable.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [usable[i], usable[j]] = [usable[j], usable[i]];
  }

  let ok = 0;
  let fail = 0;
  let cursor = 0;

  while (cursor < usable.length && !stopping) {
    if (MAX_TX > 0 && globalTxCount >= MAX_TX) break;

    const batchEnd = Math.min(cursor + CONCURRENCY, usable.length);
    const batch = usable.slice(cursor, batchEnd);

    // Build CellToken txs
    const built: Array<{ txid: string; txHex: string; fee: number; utxo: Utxo }> = [];
    for (const u of batch) {
      if (MAX_TX > 0 && globalTxCount + built.length >= MAX_TX) break;
      try {
        const tx = new Transaction();
        tx.addInput({
          sourceTXID: u.txid,
          sourceOutputIndex: u.vout,
          unlockingScriptTemplate: p2pkh.unlock(child.privKey, 'all', false, u.sats, child.lockScript),
        });
        const seq = globalTxCount + built.length;
        const payload = Array.from(new TextEncoder().encode(JSON.stringify({
          t: 'cell', c: child.index, n: seq, ts: Date.now(),
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
        built.push({ txid: tx.id('hex') as string, txHex: tx.toHex(), fee, utxo: u });
      } catch {}
    }

    // Broadcast
    const results = await Promise.all(built.map(async (b) => {
      const r = await broadcastMAPI(b.txHex);
      return { ...b, result: r };
    }));

    for (const r of results) {
      if (r.result.ok) {
        ok++;
        globalOk++;
        globalTxCount++;
        appendFileSync(AUDIT_FILE, `${r.txid},celltoken,${child.index},${r.utxo.sats},${r.fee},${r.txHex.length / 2},${Date.now()}\n`);
      } else {
        fail++;
        globalFail++;
      }
    }

    cursor = batchEnd;
  }

  return { ok, fail };
}

// Status printer
const statusInterval = setInterval(() => {
  if (stopping) return;
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = globalTxCount / Math.max(elapsed, 0.1);
  console.log(`  [${globalTxCount.toLocaleString()} tx | ${rate.toFixed(0)} tx/s | ${globalFail} fail | ${elapsed.toFixed(0)}s elapsed]`);
}, 5000);

// Launch all children in parallel
const childResults = await Promise.all(children.map(child => slamChild(child)));

clearInterval(statusInterval);

// ── Results ──

const elapsed = (Date.now() - startTime) / 1000;
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  POOL SLAM RESULTS');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Children:      ${NUM_CHILDREN}`);
console.log(`  Total tx:      ${globalTxCount.toLocaleString()}`);
console.log(`  Accepted:      ${globalOk.toLocaleString()}`);
console.log(`  Failed:        ${globalFail}`);
console.log(`  Elapsed:       ${elapsed.toFixed(1)}s`);
console.log(`  Rate:          ${(globalTxCount / elapsed).toFixed(1)} tx/s`);
console.log('');
console.log('  Per-child:');
for (let i = 0; i < childResults.length; i++) {
  console.log(`    Child ${i}: ${childResults[i].ok} ok / ${childResults[i].fail} fail`);
}
console.log(`  Audit:         ${AUDIT_FILE}`);
console.log('');

// Periodic WoC verification of random txids
if (globalOk > 0) {
  console.log('  Spot-checking 5 random txids on WoC...');
  const auditLines = (await Bun.file(AUDIT_FILE).text()).split('\n').filter(l => l.includes(',celltoken,'));
  const sample = auditLines.sort(() => Math.random() - 0.5).slice(0, 5);
  for (const line of sample) {
    const txid = line.split(',')[0];
    if (txid.length !== 64) continue;
    await new Promise(r => setTimeout(r, 1000));
    try {
      const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${txid}`);
      console.log(`    ${txid.slice(0, 16)}... ${check.ok ? '✓ ON-CHAIN' : '✗ NOT FOUND'}`);
    } catch { console.log(`    ${txid.slice(0, 16)}... ✗ fetch error`); }
  }
}
console.log('');
