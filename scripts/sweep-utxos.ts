#!/usr/bin/env bun
/**
 * Sweep all UTXOs back to a single address.
 *
 * Use this to recover funds after a crash, failed run, or when done testing.
 * Discovers UTXOs via WoC + GorillaPool ordinals API, then consolidates
 * them into a single output (or batches of 200 inputs).
 *
 * Usage:
 *   PRIVATE_KEY_WIF=L... bun run scripts/sweep-utxos.ts
 *   PRIVATE_KEY_WIF=L... SWEEP_TO=1Address... bun run scripts/sweep-utxos.ts
 */

import { PrivateKey, Transaction, P2PKH, ARC } from '@bsv/sdk';

const WIF = process.env.PRIVATE_KEY_WIF;
if (!WIF) { console.error('ERROR: Set PRIVATE_KEY_WIF'); process.exit(1); }

const privKey = PrivateKey.fromWif(WIF);
const address = privKey.toPublicKey().toAddress();
const sweepTo = process.env.SWEEP_TO ?? address; // default: sweep to self (consolidate)
const arc = new ARC(process.env.ARC_URL ?? 'https://arc.gorillapool.io');
const FEE_RATE = parseFloat(process.env.FEE_RATE ?? '0.1');
const p2pkh = new P2PKH();

console.log('');
console.log('════════════════════════════════════════════');
console.log('  UTXO SWEEP');
console.log('════════════════════════════════════════════');
console.log(`  From:    ${address}`);
console.log(`  To:      ${sweepTo}`);
console.log('');

// ── Discover UTXOs via both APIs ──

interface Utxo { txid: string; vout: number; sats: number; }

const utxoMap = new Map<string, Utxo>(); // dedupe by outpoint

// WoC
console.log('  Checking WoC...');
try {
  const resp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`);
  if (resp.ok) {
    const woc: any[] = await resp.json();
    for (const u of woc) {
      utxoMap.set(`${u.tx_hash}:${u.tx_pos}`, { txid: u.tx_hash, vout: u.tx_pos, sats: u.value });
    }
    console.log(`  WoC: ${woc.length} UTXOs`);
  }
} catch (e: any) { console.log(`  WoC failed: ${e.message}`); }

// GorillaPool ordinals
console.log('  Checking GorillaPool ordinals...');
try {
  const resp = await fetch(`https://ordinals.gorillapool.io/api/txos/address/${address}/unspent?limit=10000`);
  if (resp.ok) {
    const gp: any[] = await resp.json();
    for (const u of gp) {
      if (!u.spend) {
        utxoMap.set(`${u.txid}:${u.vout}`, { txid: u.txid, vout: u.vout, sats: u.satoshis });
      }
    }
    console.log(`  GorillaPool: ${gp.length} UTXOs`);
  }
} catch (e: any) { console.log(`  GorillaPool failed: ${e.message}`); }

const utxos = Array.from(utxoMap.values());
const totalSats = utxos.reduce((s, u) => s + u.sats, 0);

console.log('');
console.log(`  Total unique UTXOs: ${utxos.length}`);
console.log(`  Total sats: ${totalSats.toLocaleString()} (${(totalSats / 1e8).toFixed(4)} BSV)`);

if (utxos.length === 0) {
  console.log('  Nothing to sweep!');
  process.exit(0);
}

// Group by parent txid to batch source tx fetches
const byTxid = new Map<string, Utxo[]>();
for (const u of utxos) {
  const list = byTxid.get(u.txid) ?? [];
  list.push(u);
  byTxid.set(u.txid, list);
}

console.log(`  Unique parent txs: ${byTxid.size}`);
console.log('');
console.log('  Fetching source transactions...');

const sourceTxCache = new Map<string, Transaction>();
let fetched = 0;
for (const txid of byTxid.keys()) {
  try {
    const resp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`);
    if (resp.ok) {
      sourceTxCache.set(txid, Transaction.fromHex(await resp.text()));
      fetched++;
    }
    // Rate limit WoC
    if (fetched % 3 === 0) await new Promise(r => setTimeout(r, 1000));
  } catch {}
}
console.log(`  Fetched ${fetched}/${byTxid.size} source txs`);

// Filter to UTXOs we can sign
const sweepable = utxos.filter(u => sourceTxCache.has(u.txid));
const sweepableSats = sweepable.reduce((s, u) => s + u.sats, 0);
console.log(`  Sweepable: ${sweepable.length} UTXOs (${sweepableSats.toLocaleString()} sats)`);

if (sweepable.length === 0) {
  console.log('  No sweepable UTXOs (could not fetch source txs)');
  process.exit(1);
}

// ── Sweep in batches of 200 inputs ──

const BATCH_SIZE = 200;
const txids: string[] = [];
let totalSwept = 0;

for (let i = 0; i < sweepable.length; i += BATCH_SIZE) {
  const batch = sweepable.slice(i, i + BATCH_SIZE);
  const inputSats = batch.reduce((s, u) => s + u.sats, 0);

  const tx = new Transaction();
  for (const u of batch) {
    tx.addInput({
      sourceTXID: u.txid,
      sourceOutputIndex: u.vout,
      sourceTransaction: sourceTxCache.get(u.txid)!,
      unlockingScriptTemplate: p2pkh.unlock(privKey),
    });
  }

  const estBytes = 10 + batch.length * 148 + 34;
  const fee = Math.max(25, Math.ceil(estBytes * FEE_RATE));
  const output = inputSats - fee;

  if (output <= 546) {
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} UTXOs too small (${inputSats} sats < fee ${fee})`);
    continue;
  }

  tx.addOutput({
    lockingScript: p2pkh.lock(sweepTo),
    satoshis: output,
  });

  await tx.sign();
  const txid = tx.id('hex') as string;

  try {
    const result = await tx.broadcast(arc);
    if ('status' in result && (result as any).status === 'error') {
      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ARC rejected: ${JSON.stringify(result)}`);
      // Try WoC backup
      const wocResp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: tx.toHex() }),
      });
      if (!wocResp.ok) {
        console.log(`  WoC backup also failed: ${wocResp.status}`);
        continue;
      }
    }
    txids.push(txid);
    totalSwept += output;
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} UTXOs → ${output.toLocaleString()} sats → ${txid.slice(0, 16)}...`);
    console.log(`    https://whatsonchain.com/tx/${txid}`);
  } catch (err: any) {
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: Error: ${err.message}`);
  }
}

console.log('');
console.log('  ── Done ──');
console.log(`  Swept: ${totalSwept.toLocaleString()} sats (${(totalSwept / 1e8).toFixed(4)} BSV)`);
console.log(`  Txs: ${txids.length}`);
console.log(`  To: ${sweepTo}`);
console.log('');
