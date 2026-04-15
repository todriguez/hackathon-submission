#!/usr/bin/env bun
/**
 * Provider Compare -- Send 100 txs to each ARC provider and compare latency.
 *
 * Broadcasts identical OP_RETURN transactions to each configured provider
 * and reports latency stats (avg, p50, p95, p99, min, max, success rate).
 *
 * Usage:
 *   PRIVATE_KEY_WIF=L... bun run scripts/provider-compare.ts
 *   PRIVATE_KEY_WIF=L... TX_COUNT=50 bun run scripts/provider-compare.ts
 *
 * Env vars:
 *   PRIVATE_KEY_WIF   -- (required) Funded WIF private key
 *   TX_COUNT          -- Txs per provider (default: 100)
 *   FEE_RATE          -- Sats/byte (default: 0.1)
 *   MIN_FEE           -- Minimum fee floor in sats (default: 25)
 *   PROVIDERS         -- Comma-separated ARC URLs (default: GorillaPool + TAAL)
 *   SPLIT_SATS        -- Sats per UTXO (default: 500)
 */

import { PrivateKey, Transaction, P2PKH, ARC, LockingScript } from '@bsv/sdk';

// ── Config ──

const WIF = process.env.PRIVATE_KEY_WIF;
if (!WIF) {
  console.error('ERROR: Set PRIVATE_KEY_WIF env var');
  process.exit(1);
}

const TX_COUNT   = parseInt(process.env.TX_COUNT ?? '100', 10);
const FEE_RATE   = parseFloat(process.env.FEE_RATE ?? '0.1');
const MIN_FEE    = parseInt(process.env.MIN_FEE ?? '25', 10);
const SPLIT_SATS = parseInt(process.env.SPLIT_SATS ?? '500', 10);

const DEFAULT_PROVIDERS = [
  'https://arc.gorillapool.io',
  'https://arc.taal.com',
];
const PROVIDERS = process.env.PROVIDERS
  ? process.env.PROVIDERS.split(',').map(s => s.trim())
  : DEFAULT_PROVIDERS;

const privKey = PrivateKey.fromWif(WIF);
const pubKey  = privKey.toPublicKey();
const address = pubKey.toAddress();
const p2pkh   = new P2PKH();
const lockingScript = p2pkh.lock(address);

// ── Types ──

interface Utxo {
  txid: string;
  vout: number;
  satoshis: number;
  sourceTx: Transaction;
}

interface ProviderResult {
  url: string;
  latencies: number[];
  successes: number;
  failures: number;
  errors: string[];
}

// ── Helpers ──

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`  [${ts}] ${tag}: ${msg}`);
}

function buildOpReturnScript(seq: number): LockingScript {
  const tag = Buffer.from('semantos/provider-compare/v1', 'utf8');
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Date.now()));
  const seqBuf = Buffer.alloc(4);
  seqBuf.writeUInt32BE(seq);
  const pad = Buffer.alloc(200);
  for (let i = 0; i < 200; i++) pad[i] = (seq + i) & 0xff;

  const chunks: number[] = [];
  chunks.push(0x00); // OP_FALSE
  chunks.push(0x6a); // OP_RETURN

  for (const buf of [tag, timestamp, seqBuf, pad]) {
    if (buf.length < 76) {
      chunks.push(buf.length);
    } else if (buf.length <= 0xff) {
      chunks.push(0x4c);
      chunks.push(buf.length);
    } else {
      chunks.push(0x4d);
      chunks.push(buf.length & 0xff);
      chunks.push((buf.length >> 8) & 0xff);
    }
    for (const b of buf) chunks.push(b);
  }

  return LockingScript.fromHex(Buffer.from(chunks).toString('hex'));
}

function estimateFee(): number {
  return Math.max(MIN_FEE, Math.ceil(442 * FEE_RATE));
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ══════════════════════════════════════════════════════════════════
// Phase 1: Verify Funding & Pre-Split
// ══════════════════════════════════════════════════════════════════

console.log('');
console.log('================================================================');
console.log('  PROVIDER COMPARE');
console.log('================================================================');
console.log(`  Address:    ${address}`);
console.log(`  Providers:  ${PROVIDERS.join(', ')}`);
console.log(`  Txs/prov:   ${TX_COUNT}`);
console.log(`  Total txs:  ${TX_COUNT * PROVIDERS.length}`);
console.log('');

log('FUND', 'Checking UTXOs...');

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
  process.exit(1);
}

const totalBalance = rawUtxos.reduce((s: number, u: any) => s + u.value, 0);
log('FUND', `Balance: ${totalBalance.toLocaleString()} sats (${(totalBalance / 1e8).toFixed(4)} BSV)`);

const totalNeeded = TX_COUNT * PROVIDERS.length;
const neededSats = totalNeeded * (SPLIT_SATS + 10) + 5000; // rough estimate
if (totalBalance < neededSats) {
  console.error(`  ERROR: Need ~${neededSats.toLocaleString()} sats for ${totalNeeded} txs, have ${totalBalance.toLocaleString()}`);
  process.exit(1);
}

// Fetch source txs
log('SPLIT', 'Fetching source transactions...');
const fundingInputs: Array<{ txid: string; vout: number; sats: number; sourceTx: Transaction }> = [];
for (const u of rawUtxos) {
  const txResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${u.tx_hash}/hex`);
  if (!txResp.ok) continue;
  const txHex = await txResp.text();
  fundingInputs.push({
    txid: u.tx_hash,
    vout: u.tx_pos,
    sats: u.value,
    sourceTx: Transaction.fromHex(txHex),
  });
}

const gatheredSats = fundingInputs.reduce((s, u) => s + u.sats, 0);

// Build split tx
const numSplits = totalNeeded + 10; // a few extra
log('SPLIT', `Creating ${numSplits} UTXOs of ${SPLIT_SATS} sats...`);

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

const INPUT_SIZE = 148;
const OUTPUT_SIZE = 34;
const OVERHEAD = 10;
const splitFee = Math.max(
  MIN_FEE,
  Math.ceil((OVERHEAD + fundingInputs.length * INPUT_SIZE + OUTPUT_SIZE * (numSplits + 1)) * FEE_RATE),
);
const splitChange = gatheredSats - numSplits * SPLIT_SATS - splitFee;
if (splitChange > 546) {
  splitTx.addOutput({ lockingScript, satoshis: splitChange });
}

await splitTx.sign();

const arc0 = new ARC(PROVIDERS[0]); // use first provider for split
log('SPLIT', 'Broadcasting split tx...');
const splitResult = await splitTx.broadcast(arc0);
if ('status' in splitResult && (splitResult as any).status === 'error') {
  console.error(`  ERROR: Split tx rejected: ${JSON.stringify(splitResult)}`);
  process.exit(1);
}

const splitTxid = splitTx.id('hex') as string;
log('SPLIT', `Split tx: ${splitTxid}`);

// WoC backup
await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ txhex: splitTx.toHex() }),
}).catch(() => {});

// Build UTXO pools -- one pool per provider
const providerPools: Map<string, Utxo[]> = new Map();
let voutIdx = 0;
for (const url of PROVIDERS) {
  const pool: Utxo[] = [];
  for (let i = 0; i < TX_COUNT; i++) {
    pool.push({
      txid: splitTxid,
      vout: voutIdx,
      satoshis: SPLIT_SATS,
      sourceTx: splitTx,
    });
    voutIdx++;
  }
  providerPools.set(url, pool);
}

log('SPLIT', `Pools ready. Waiting 3s for propagation...`);
await new Promise(r => setTimeout(r, 3000));

// ══════════════════════════════════════════════════════════════════
// Phase 2: Test Each Provider Sequentially
// ══════════════════════════════════════════════════════════════════

const results: ProviderResult[] = [];

for (const url of PROVIDERS) {
  console.log('');
  log('TEST', `Testing: ${url}`);
  log('TEST', `Sending ${TX_COUNT} txs at ~1 tx/sec...`);

  const arc = new ARC(url);
  const pool = providerPools.get(url)!;
  const result: ProviderResult = {
    url,
    latencies: [],
    successes: 0,
    failures: 0,
    errors: [],
  };

  for (let i = 0; i < TX_COUNT; i++) {
    if (pool.length === 0) break;
    const funding = pool.shift()!;
    const fee = estimateFee();

    const tx = new Transaction();
    tx.addInput({
      sourceTXID: funding.txid,
      sourceOutputIndex: funding.vout,
      sourceTransaction: funding.sourceTx,
      unlockingScriptTemplate: p2pkh.unlock(privKey),
    });

    tx.addOutput({
      lockingScript: buildOpReturnScript(i),
      satoshis: 0,
    });

    const change = funding.satoshis - fee;
    if (change > 546) {
      tx.addOutput({ lockingScript, satoshis: change });
    }

    await tx.sign();

    const t0 = Date.now();
    try {
      const bResult = await tx.broadcast(arc);
      const latency = Date.now() - t0;

      if ('status' in bResult && (bResult as any).status === 'error') {
        result.failures++;
        result.latencies.push(latency);
        if (result.errors.length < 5) {
          result.errors.push(JSON.stringify(bResult).slice(0, 200));
        }
      } else {
        result.successes++;
        result.latencies.push(latency);
      }
    } catch (err: any) {
      const latency = Date.now() - t0;
      result.failures++;
      result.latencies.push(latency);
      if (result.errors.length < 5) {
        result.errors.push(err.message?.slice(0, 200) ?? 'unknown');
      }
    }

    // Progress every 25
    if ((i + 1) % 25 === 0) {
      const avgSoFar = Math.round(result.latencies.reduce((a, b) => a + b, 0) / result.latencies.length);
      log('TEST', `  ${i + 1}/${TX_COUNT} done (${result.successes} ok, ${result.failures} fail, avg ${avgSoFar}ms)`);
    }

    // ~1 tx/sec pacing (subtract time already spent)
    const elapsed = Date.now() - t0;
    if (elapsed < 1000) {
      await new Promise(r => setTimeout(r, 1000 - elapsed));
    }
  }

  results.push(result);
  log('TEST', `Done: ${result.successes}/${TX_COUNT} ok`);
}

// ══════════════════════════════════════════════════════════════════
// Phase 3: Report
// ══════════════════════════════════════════════════════════════════

console.log('');
console.log('================================================================');
console.log('  PROVIDER COMPARISON RESULTS');
console.log('================================================================');
console.log('');

for (const r of results) {
  const successRate = TX_COUNT > 0 ? ((r.successes / TX_COUNT) * 100).toFixed(1) : '0.0';
  const avg = r.latencies.length > 0
    ? Math.round(r.latencies.reduce((a, b) => a + b, 0) / r.latencies.length)
    : 0;
  const p50 = percentile(r.latencies, 50);
  const p95 = percentile(r.latencies, 95);
  const p99 = percentile(r.latencies, 99);
  const min = r.latencies.length > 0 ? Math.min(...r.latencies) : 0;
  const max = r.latencies.length > 0 ? Math.max(...r.latencies) : 0;

  console.log(`  ${r.url}`);
  console.log(`    Success rate:  ${r.successes}/${TX_COUNT} (${successRate}%)`);
  console.log(`    Avg latency:   ${avg}ms`);
  console.log(`    P50 latency:   ${p50}ms`);
  console.log(`    P95 latency:   ${p95}ms`);
  console.log(`    P99 latency:   ${p99}ms`);
  console.log(`    Min latency:   ${min}ms`);
  console.log(`    Max latency:   ${max}ms`);
  if (r.errors.length > 0) {
    console.log(`    Sample errors:`);
    for (const e of r.errors.slice(0, 3)) {
      console.log(`      - ${e}`);
    }
  }
  console.log('');
}

// Winner
const ranked = [...results].sort((a, b) => {
  // Primary: success rate. Secondary: avg latency.
  const aRate = a.successes / Math.max(1, TX_COUNT);
  const bRate = b.successes / Math.max(1, TX_COUNT);
  if (Math.abs(aRate - bRate) > 0.05) return bRate - aRate;
  const aAvg = a.latencies.length > 0 ? a.latencies.reduce((x, y) => x + y, 0) / a.latencies.length : Infinity;
  const bAvg = b.latencies.length > 0 ? b.latencies.reduce((x, y) => x + y, 0) / b.latencies.length : Infinity;
  return aAvg - bAvg;
});

console.log(`  Recommended provider: ${ranked[0].url}`);
console.log(`    (${ranked[0].successes}/${TX_COUNT} success, lowest latency among top-reliability providers)`);
console.log('');
console.log('================================================================');
console.log('');
