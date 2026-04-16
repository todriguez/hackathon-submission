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
const DRY_RUN = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';
if (DRY_RUN) console.log('  *** DRY RUN — will build + sign txs but NOT broadcast ***');
const p2pkh = new P2PKH();

console.log('');
console.log('════════════════════════════════════════════');
console.log('  UTXO SWEEP');
console.log('════════════════════════════════════════════');
console.log(`  From:    ${address}`);
console.log(`  To:      ${sweepTo}`);
console.log('');

// ── Discover UTXOs ──
//
// Primary: Bitails (reports full confirmed balance, paginated 10k/page).
// WoC and GorillaPool are supplements — WoC caps at 1000, GorillaPool only
// indexes ordinal-tagged outputs (misses ~97% of plain P2PKH UTXOs).
//
// Sanity-check against Bitails balance endpoint — if discovered total doesn't
// match confirmed balance, we're missing UTXOs and should abort.

interface Utxo { txid: string; vout: number; sats: number; }

const utxoMap = new Map<string, Utxo>(); // dedupe by outpoint

// Bitails balance (source of truth for "how much should we see?")
let expectedBalance = 0;
try {
  const resp = await fetch(`https://api.bitails.io/address/${address}/balance`);
  if (resp.ok) {
    const b: any = await resp.json();
    expectedBalance = b.confirmed ?? 0;
    console.log(`  Bitails balance: ${expectedBalance.toLocaleString()} sats confirmed (${b.count ?? '?'} UTXOs)`);
  }
} catch (e: any) { console.log(`  Bitails balance failed: ${e.message}`); }

// Bitails paginated UTXO enumeration
console.log('  Enumerating via Bitails...');
const BITAILS_PAGE = 10000;
for (let page = 0; page < 20; page++) {
  const from = page * BITAILS_PAGE;
  try {
    const resp = await fetch(`https://api.bitails.io/address/${address}/unspent?limit=${BITAILS_PAGE}&from=${from}`);
    if (!resp.ok) { console.log(`  Bitails page ${page + 1}: HTTP ${resp.status}`); break; }
    const data: any = await resp.json();
    const arr: any[] = Array.isArray(data) ? data : (data.unspent ?? []);
    if (arr.length === 0) break;
    for (const u of arr) {
      const txid = u.txid ?? u.tx_hash;
      const vout = u.vout ?? u.tx_pos;
      const sats = u.satoshis ?? u.value;
      if (txid != null && vout != null && sats != null) {
        utxoMap.set(`${txid}:${vout}`, { txid, vout, sats });
      }
    }
    console.log(`  Bitails page ${page + 1}: +${arr.length} (total so far: ${utxoMap.size})`);
    if (arr.length < BITAILS_PAGE) break;
  } catch (e: any) { console.log(`  Bitails page ${page + 1} failed: ${e.message}`); break; }
}

// WoC supplement (may catch a few Bitails missed, capped at 1000)
try {
  const resp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`);
  if (resp.ok) {
    const woc: any[] = await resp.json();
    let added = 0;
    for (const u of woc) {
      const key = `${u.tx_hash}:${u.tx_pos}`;
      if (!utxoMap.has(key)) {
        utxoMap.set(key, { txid: u.tx_hash, vout: u.tx_pos, sats: u.value });
        added++;
      }
    }
    console.log(`  WoC: ${woc.length} UTXOs (${added} new)`);
  }
} catch (e: any) { console.log(`  WoC failed: ${e.message}`); }

// GorillaPool ordinals supplement
try {
  const resp = await fetch(`https://ordinals.gorillapool.io/api/txos/address/${address}/unspent?limit=100000`);
  if (resp.ok) {
    const gp: any[] = await resp.json();
    let added = 0;
    for (const u of gp) {
      if (u.spend) continue;
      const key = `${u.txid}:${u.vout}`;
      if (!utxoMap.has(key)) {
        utxoMap.set(key, { txid: u.txid, vout: u.vout, sats: u.satoshis });
        added++;
      }
    }
    console.log(`  GorillaPool: ${gp.length} UTXOs (${added} new)`);
  }
} catch (e: any) { console.log(`  GorillaPool failed: ${e.message}`); }

const utxos = Array.from(utxoMap.values());
const totalSats = utxos.reduce((s, u) => s + u.sats, 0);

console.log('');
console.log(`  Total unique UTXOs: ${utxos.length.toLocaleString()}`);
console.log(`  Total sats: ${totalSats.toLocaleString()} (${(totalSats / 1e8).toFixed(4)} BSV)`);
if (expectedBalance > 0) {
  const delta = expectedBalance - totalSats;
  const pct = ((totalSats / expectedBalance) * 100).toFixed(2);
  console.log(`  Expected: ${expectedBalance.toLocaleString()} sats — coverage ${pct}% (missing ${delta.toLocaleString()})`);
}

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

console.log(`  Unique parent txs: ${byTxid.size.toLocaleString()}`);
console.log('');
console.log('  Skipping source-tx fetch — signing with explicit sats + locking script.');

// P2PKH.unlock() accepts sourceSatoshis + lockingScript directly (SDK v1.x).
// Every UTXO on this address uses the same P2PKH locking script, so we compute
// it once and pass (sats, script) per input — no parent tx hex required.
const knownLockingScript = p2pkh.lock(address);

// All discovered UTXOs are sweepable (we sign via known script+sats).
const sweepable = utxos;
const sweepableSats = totalSats;
console.log(`  Sweepable: ${sweepable.length.toLocaleString()} UTXOs (${sweepableSats.toLocaleString()} sats)`);

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
      // No sourceTransaction — sign via explicit sats + locking script
      unlockingScriptTemplate: p2pkh.unlock(privKey, 'all', false, u.sats, knownLockingScript),
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

  if (DRY_RUN) {
    console.log(`  [DRY] Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} UTXOs, ${inputSats} in - ${fee} fee = ${output} out  txid=${txid.slice(0, 16)}...`);
    txids.push(txid);
    totalSwept += output;
    continue;
  }

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
