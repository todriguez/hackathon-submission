#!/usr/bin/env bun
/**
 * Consolidate — Sweep every reachable UTXO at the funding address into ONE
 * clean, MINED UTXO, so subsequent fan-outs chain from a verifiably on-chain
 * parent with zero orphan-mempool risk.
 *
 * Three-phase flow:
 *   Phase 1  Discover every spendable UTXO (WoC + Bitails, paginated).
 *   Phase 2  Broadcast N sweep txs (≤150 inputs each) via ARC; wait until
 *            ARC acknowledges every one (SEEN_ON_NETWORK or better).
 *   Phase 3  Immediately chain one final tx that spends all Phase 2 outputs
 *            into ONE mega-UTXO at the same address. Broadcast via ARC,
 *            then wait until ARC reports it MINED.
 *
 * The output is written as data/funding-tx.hex (for Docker consumption) plus
 * data/consolidated.json with txid + vout + sats. Re-run safe.
 *
 * Usage:
 *   PRIVATE_KEY_WIF=L... bun run scripts/consolidate.ts
 *
 * Env:
 *   PRIVATE_KEY_WIF      (required) WIF of the funding address
 *   ARC_URL              default https://arc.gorillapool.io
 *   ARC_API_KEY          optional bearer
 *   WAIT_FOR_MINE        default "1" — also wait for Phase 3 MINED. Set to
 *                        "0" to exit as soon as ARC acknowledges the final tx.
 *   MINE_TIMEOUT_MS      default 1800000 (30 min)
 *   TARGET_SATS          default 200000000 (2.0 BSV). UTXOs are sorted
 *                        largest-first and summed until this target is hit;
 *                        remaining dust is left behind. Keeps consolidation
 *                        from hammering WoC for 16k parent tx fetches.
 */

import { PrivateKey, P2PKH, Transaction } from '@bsv/sdk';
import { writeFileSync, mkdirSync } from 'fs';

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) {
  console.error('ERROR: PRIVATE_KEY_WIF env var required');
  process.exit(1);
}

const ARC_URL = process.env.ARC_URL ?? 'https://arc.gorillapool.io';
const ARC_API_KEY = process.env.ARC_API_KEY ?? '';
const WAIT_FOR_MINE = process.env.WAIT_FOR_MINE !== '0';
const MINE_TIMEOUT_MS = Number(process.env.MINE_TIMEOUT_MS ?? '1800000');
const TARGET_SATS = Number(process.env.TARGET_SATS ?? '200000000'); // 2.0 BSV

const FEE_RATE = 0.1; // sat/byte — matches DirectBroadcastEngine default
const MIN_FEE = 138;
const BATCH_INPUTS = 150; // safe tx size per sweep
const DUST_LIMIT = 546;
// A P2PKH input costs ~148 bytes × feeRate ≈ 15 sats. Anything at or below
// that is net-negative to include. Use 200 sats as a safe floor: UTXOs below
// this are net drains once batched-fee is amortised, so we skip them.
const MIN_INPUT_SATS = 200;

const arcHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
if (ARC_API_KEY) arcHeaders['Authorization'] = `Bearer ${ARC_API_KEY}`;

const privKey = PrivateKey.fromWif(WIF);
const pubKey = privKey.toPublicKey();
const address = pubKey.toAddress();
const p2pkh = new P2PKH();
const lockingScript = p2pkh.lock(address);

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  CONSOLIDATE — One clean mined UTXO, zero orphan chain');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Address: ${address}`);
console.log(`  ARC:     ${ARC_URL}${ARC_API_KEY ? ' (authed)' : ' (no key)'}`);
console.log(`  Wait for mine: ${WAIT_FOR_MINE}`);
console.log('');

// ═══════════════════════════════════════════════════════════════
// Phase 1 — Discover ALL UTXOs across every reachable API
// ═══════════════════════════════════════════════════════════════

interface Utxo {
  txid: string;
  vout: number;
  sats: number;
  /** true if seen in a block (height > 0), false if mempool-only */
  confirmed: boolean;
}

async function discoverAll(confirmedOnly: boolean = true): Promise<Utxo[]> {
  const seen = new Map<string, Utxo>(); // key: "txid:vout"

  // WoC returns max 1000 but uses a different ordering than Bitails, so both
  // sources overlap on the most-recent outputs but Bitails exposes a
  // pagination cursor that reaches further back in history.
  try {
    const r = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`);
    if (r.ok) {
      const list: any[] = await r.json();
      for (const u of list) {
        const k = `${u.tx_hash}:${u.tx_pos}`;
        const confirmed = (u.height ?? 0) > 0;
        if (!seen.has(k)) seen.set(k, { txid: u.tx_hash, vout: u.tx_pos, sats: u.value, confirmed });
      }
      console.log(`  WoC: ${list.length} UTXOs`);
    }
  } catch (e: any) {
    console.log(`  WoC error: ${e.message}`);
  }

  // Bitails pagination
  let cursor = 0;
  const PAGE = 1000;
  for (let page = 0; page < 20; page++) {
    try {
      const r = await fetch(`https://api.bitails.io/address/${address}/unspent?from=${cursor}&to=${cursor + PAGE}`);
      if (!r.ok) break;
      const body: any = await r.json();
      const utxos: any[] = body.unspent ?? body ?? [];
      if (utxos.length === 0) break;
      let added = 0;
      for (const u of utxos) {
        const txid = u.txid ?? u.tx_hash;
        const vout = u.vout ?? u.tx_pos;
        const sats = u.satoshis ?? u.value;
        if (!txid || vout === undefined || !sats) continue;
        const k = `${txid}:${vout}`;
        // Bitails uses lowercase `blockheight`; also has `confirmations` counter.
        // Undefined ⇒ mempool.
        const h = u.blockheight ?? u.blockHeight ?? u.height ?? 0;
        const conf = u.confirmations ?? 0;
        const confirmed = Number(h) > 0 || Number(conf) > 0;
        if (!seen.has(k)) {
          seen.set(k, { txid, vout, sats, confirmed });
          added++;
        } else if (confirmed && !seen.get(k)!.confirmed) {
          // Upgrade to confirmed if Bitails says so but WoC didn't
          seen.get(k)!.confirmed = true;
        }
      }
      console.log(`  Bitails page ${page} (cursor ${cursor}): ${utxos.length} UTXOs, ${added} new`);
      if (utxos.length < PAGE) break;
      cursor += PAGE;
    } catch (e: any) {
      console.log(`  Bitails page ${page} error: ${e.message}`);
      break;
    }
  }

  const all = Array.from(seen.values());
  const totalAll = all.reduce((s, u) => s + u.sats, 0);
  const confirmed = all.filter((u) => u.confirmed);
  const totalC = confirmed.reduce((s, u) => s + u.sats, 0);
  const economical = confirmed.filter((u) => u.sats >= MIN_INPUT_SATS);
  const totalE = economical.reduce((s, u) => s + u.sats, 0);

  console.log(`  → Total: ${all.length} UTXOs, ${totalAll.toLocaleString()} sats`);
  console.log(`  → Confirmed: ${confirmed.length} UTXOs, ${totalC.toLocaleString()} sats (${(totalC / 1e8).toFixed(6)} BSV)`);
  const mempoolSats = totalAll - totalC;
  if (all.length - confirmed.length > 0) {
    console.log(`  → Mempool-only (skipped to avoid orphan contamination): ${all.length - confirmed.length} UTXOs, ${mempoolSats.toLocaleString()} sats`);
  }
  if (confirmed.length - economical.length > 0) {
    console.log(`  → Sub-economical dust (< ${MIN_INPUT_SATS} sats, skipped — fee exceeds value): ${confirmed.length - economical.length} UTXOs, ${(totalC - totalE).toLocaleString()} sats`);
  }
  console.log(`  → Economical + confirmed: ${economical.length} UTXOs, ${totalE.toLocaleString()} sats (${(totalE / 1e8).toFixed(6)} BSV) ← will sweep`);
  return confirmedOnly ? economical : all;
}

// ═══════════════════════════════════════════════════════════════
// Fetch parent tx hexes (cached, concurrency-limited)
// ═══════════════════════════════════════════════════════════════

async function fetchParentTxs(uniqueTxids: string[]): Promise<Map<string, Transaction>> {
  const cache = new Map<string, Transaction>();
  const BATCH = 4; // parallel fetches
  const DELAY_MS = 250;

  console.log(`  Fetching ${uniqueTxids.length} parent tx hexes from WoC...`);
  for (let i = 0; i < uniqueTxids.length; i += BATCH) {
    const chunk = uniqueTxids.slice(i, i + BATCH);
    const results = await Promise.allSettled(chunk.map(async (txid) => {
      const r = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`);
      if (!r.ok) throw new Error(`WoC ${r.status}`);
      return { txid, hex: await r.text() };
    }));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        try {
          cache.set(r.value.txid, Transaction.fromHex(r.value.hex));
        } catch {}
      }
    }
    if ((i + BATCH) % (BATCH * 10) === 0) {
      process.stdout.write(`    ${Math.min(i + BATCH, uniqueTxids.length)}/${uniqueTxids.length} fetched\r`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log(`    ${cache.size}/${uniqueTxids.length} fetched`);
  return cache;
}

// ═══════════════════════════════════════════════════════════════
// Broadcast via ARC
// ═══════════════════════════════════════════════════════════════

async function broadcastArc(txHex: string, label: string): Promise<{ ok: boolean; status: string; body: any }> {
  try {
    const r = await fetch(`${ARC_URL}/v1/tx`, {
      method: 'POST',
      headers: arcHeaders,
      body: JSON.stringify({ rawTx: txHex }),
    });
    const body: any = await r.json().catch(() => ({}));
    const status = body?.txStatus ?? '';
    const isOk = r.ok && !['REJECTED', 'DOUBLE_SPEND_ATTEMPTED'].includes(status);
    // "Already Known" responses count as success — the tx IS on the network.
    const descLower = (body?.detail || body?.title || '').toLowerCase();
    const alreadyKnown = descLower.includes('already known') || descLower.includes('already mined') || descLower.includes('seen on network');
    return { ok: isOk || alreadyKnown, status: status || (alreadyKnown ? 'SEEN_ON_NETWORK' : `HTTP ${r.status}`), body };
  } catch (e: any) {
    return { ok: false, status: `EXC ${e.message}`, body: null };
  }
}

async function waitArcSeen(txid: string, label: string, timeoutMs = 90000): Promise<string> {
  const start = Date.now();
  let lastStatus = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${ARC_URL}/v1/tx/${txid}`, { headers: arcHeaders });
      if (r.ok) {
        const body: any = await r.json().catch(() => ({}));
        const status = body?.txStatus || '';
        lastStatus = status;
        if (['SEEN_ON_NETWORK', 'MINED', 'ACCEPTED_BY_NETWORK', 'ANNOUNCED_TO_NETWORK', 'STORED', 'CONFIRMED'].includes(status)) {
          return status;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${label} not seen by ARC within ${timeoutMs}ms (last: ${lastStatus || 'none'})`);
}

async function waitArcMined(txid: string, label: string, timeoutMs: number): Promise<number> {
  const start = Date.now();
  let lastStatus = '';
  let pollCount = 0;
  while (Date.now() - start < timeoutMs) {
    pollCount++;
    try {
      const r = await fetch(`${ARC_URL}/v1/tx/${txid}`, { headers: arcHeaders });
      if (r.ok) {
        const body: any = await r.json().catch(() => ({}));
        const status = body?.txStatus || '';
        const bh = body?.blockHeight ?? 0;
        lastStatus = status;
        if (status === 'MINED' && bh > 0) {
          console.log(`  ✓ ${label} mined at block ${bh} after ${Math.round((Date.now() - start) / 1000)}s (${pollCount} polls)`);
          return bh;
        }
        if (pollCount % 6 === 0) {
          console.log(`  ${label} still ${status || 'pending'} after ${Math.round((Date.now() - start) / 1000)}s...`);
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 20000)); // poll every 20s
  }
  throw new Error(`${label} not mined within ${timeoutMs}ms (last status: ${lastStatus})`);
}

// ═══════════════════════════════════════════════════════════════
// Build & sign a sweep tx
// ═══════════════════════════════════════════════════════════════

async function buildSweepTx(inputs: Array<{ utxo: Utxo; sourceTx: Transaction }>, destAddress: string = address): Promise<{ tx: Transaction; outSats: number }> {
  const tx = new Transaction();
  let inputSats = 0;
  for (const { utxo, sourceTx } of inputs) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      sourceTransaction: sourceTx,
      unlockingScriptTemplate: p2pkh.unlock(privKey),
    });
    inputSats += utxo.sats;
  }
  // Estimate fee
  const estBytes = 10 + inputs.length * 148 + 34;
  const fee = Math.max(MIN_FEE, Math.ceil(estBytes * FEE_RATE));
  const outSats = inputSats - fee;
  if (outSats < DUST_LIMIT) {
    throw new Error(`Sweep of ${inputs.length} inputs (${inputSats} sats) too small: out ${outSats} < dust ${DUST_LIMIT}`);
  }
  tx.addOutput({ lockingScript: p2pkh.lock(destAddress), satoshis: outSats });
  await tx.sign();
  return { tx, outSats };
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  // Phase 1 — discover
  console.log('┌─ Phase 1: UTXO discovery');
  const allUtxos = await discoverAll();
  if (allUtxos.length === 0) {
    console.error('  No UTXOs found. Fund the address first.');
    process.exit(1);
  }
  if (allUtxos.length === 1) {
    const only = allUtxos[0];
    console.log(`  Only 1 UTXO present — nothing to consolidate.`);
    console.log(`  Writing as-is: ${only.txid}:${only.vout} = ${only.sats.toLocaleString()} sats`);
    await finalize([only]);
    return;
  }

  // Sort largest-first and take just enough to hit TARGET_SATS. Leaves the
  // long tail of dust untouched so we don't spend 15+ min fetching tens of
  // thousands of parent tx hexes.
  allUtxos.sort((a, b) => b.sats - a.sats);
  const utxos: Utxo[] = [];
  let cum = 0;
  for (const u of allUtxos) {
    utxos.push(u);
    cum += u.sats;
    if (cum >= TARGET_SATS) break;
  }
  const leftBehind = allUtxos.length - utxos.length;
  const leftSats = allUtxos.slice(utxos.length).reduce((s, u) => s + u.sats, 0);
  console.log(`  → Target: ${TARGET_SATS.toLocaleString()} sats (${(TARGET_SATS / 1e8).toFixed(4)} BSV)`);
  console.log(`  → Selected: ${utxos.length} UTXOs, ${cum.toLocaleString()} sats (${(cum / 1e8).toFixed(6)} BSV) — largest-first`);
  if (leftBehind > 0) {
    console.log(`  → Left behind (below target cutoff): ${leftBehind} UTXOs, ${leftSats.toLocaleString()} sats`);
  }
  console.log('');

  // Fetch parent txs (need them to build sweep tx inputs)
  const uniqueTxids = [...new Set(utxos.map((u) => u.txid))];
  const parentCache = await fetchParentTxs(uniqueTxids);
  const sweepable = utxos.filter((u) => parentCache.has(u.txid));
  console.log(`  Sweepable: ${sweepable.length}/${utxos.length} (others skipped — parent tx unreachable)`);
  console.log('');

  // Phase 2 — batched sweeps
  console.log('┌─ Phase 2: Broadcast sweep txs via ARC');
  const batches: Array<Array<{ utxo: Utxo; sourceTx: Transaction }>> = [];
  for (let i = 0; i < sweepable.length; i += BATCH_INPUTS) {
    const slice = sweepable.slice(i, i + BATCH_INPUTS);
    batches.push(slice.map((u) => ({ utxo: u, sourceTx: parentCache.get(u.txid)! })));
  }
  console.log(`  ${batches.length} sweep batches (≤${BATCH_INPUTS} inputs each)`);

  const sweepResults: Array<{ txid: string; tx: Transaction; sats: number }> = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const { tx, outSats } = await buildSweepTx(batch);
      const txid = tx.id('hex') as string;
      const txHex = tx.toHex();
      const result = await broadcastArc(txHex, `sweep-${i}`);
      if (!result.ok) {
        console.log(`  ⚠ Sweep ${i} ARC rejected (${result.status}): ${JSON.stringify(result.body).slice(0, 200)} — skipping`);
        continue;
      }
      console.log(`  ✓ Sweep ${i + 1}/${batches.length}: ${batch.length} inputs → ${outSats.toLocaleString()} sats → ${txid} (${result.status})`);
      sweepResults.push({ txid, tx, sats: outSats });
    } catch (e: any) {
      console.log(`  ⚠ Sweep ${i} build/broadcast error: ${e.message} — skipping`);
    }
  }
  if (sweepResults.length === 0) {
    console.error('  ERROR: All sweep broadcasts failed.');
    process.exit(1);
  }
  console.log('');

  // Wait for ARC to have acknowledged all sweep txs before chaining Phase 3
  console.log('┌─ Phase 2.5: Wait for ARC to index all sweep txs');
  for (const s of sweepResults) {
    try {
      const status = await waitArcSeen(s.txid, `sweep ${s.txid.slice(0, 16)}`, 60000);
      console.log(`  ARC sees ${s.txid.slice(0, 16)}...: ${status}`);
    } catch (e: any) {
      console.log(`  ⚠ ${e.message}`);
    }
  }
  console.log('');

  // Phase 3 — final consolidation into ONE output
  if (sweepResults.length === 1) {
    // Only one sweep — it IS the consolidation.
    const s = sweepResults[0];
    console.log('┌─ Phase 3: Single sweep — treating as final consolidation');
    if (WAIT_FOR_MINE) {
      console.log('');
      console.log('┌─ Phase 4: Wait for sweep tx to be MINED');
      console.log(`  (timeout: ${Math.round(MINE_TIMEOUT_MS / 1000)}s; polls every 20s)`);
      await waitArcMined(s.txid, 'sweep', MINE_TIMEOUT_MS);
    } else {
      console.log('  Skipping mine-wait (WAIT_FOR_MINE=0).');
    }
    await finalizeTx(s.tx, s.sats);
    return;
  }

  console.log('┌─ Phase 3: Final merge tx (all sweeps → one UTXO)');
  const mergeInputs = sweepResults.map((s) => ({
    utxo: { txid: s.txid, vout: 0, sats: s.sats },
    sourceTx: s.tx,
  }));
  const { tx: finalTx, outSats: finalSats } = await buildSweepTx(mergeInputs);
  const finalTxid = finalTx.id('hex') as string;
  const finalHex = finalTx.toHex();
  console.log(`  Merge: ${mergeInputs.length} inputs → ${finalSats.toLocaleString()} sats → ${finalTxid}`);
  const merge = await broadcastArc(finalHex, 'merge');
  if (!merge.ok) {
    console.error(`  ARC rejected merge: ${merge.status} ${JSON.stringify(merge.body).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`  ✓ ARC accepted merge: ${merge.status}`);
  await waitArcSeen(finalTxid, 'merge', 60000);

  if (WAIT_FOR_MINE) {
    console.log('');
    console.log('┌─ Phase 4: Wait for merge tx to be MINED');
    console.log(`  (timeout: ${Math.round(MINE_TIMEOUT_MS / 1000)}s; polls every 20s)`);
    await waitArcMined(finalTxid, 'merge', MINE_TIMEOUT_MS);
  } else {
    console.log('  Skipping mine-wait (WAIT_FOR_MINE=0).');
  }

  await finalizeTx(finalTx, finalSats);
}

async function finalizeTx(tx: Transaction, sats: number) {
  const txid = tx.id('hex') as string;
  const hex = tx.toHex();
  mkdirSync('data', { recursive: true });
  writeFileSync('data/funding-tx.hex', hex);
  writeFileSync(
    'data/consolidated.json',
    JSON.stringify(
      { txid, vout: 0, sats, address, consolidatedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  CONSOLIDATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  txid: ${txid}`);
  console.log(`  vout: 0`);
  console.log(`  sats: ${sats.toLocaleString()} (${(sats / 1e8).toFixed(6)} BSV)`);
  console.log(`  hex:  data/funding-tx.hex (${(hex.length / 2).toLocaleString()} bytes)`);
  console.log(`  meta: data/consolidated.json`);
  console.log('');
  console.log(`  Verify: https://whatsonchain.com/tx/${txid}`);
  console.log('');
  console.log('  Launch:');
  console.log('    docker compose --env-file .env.live up -d');
  console.log('');
  console.log('  Each floor/apex will ingest the funding hex, use its assigned');
  console.log('  FUNDING_VOUT (0 for all — but only one container should spend');
  console.log('  the mega-UTXO, so use scripts/pre-fund.ts AFTER this to fan it');
  console.log('  out into 13 per-container outputs).');
  console.log('');
}

async function finalize(utxos: Utxo[]) {
  if (utxos.length === 1) {
    const u = utxos[0];
    // Need the parent tx hex
    const r = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${u.txid}/hex`);
    if (!r.ok) throw new Error(`Can't fetch parent tx ${u.txid}`);
    const hex = await r.text();
    const tx = Transaction.fromHex(hex);
    mkdirSync('data', { recursive: true });
    writeFileSync('data/funding-tx.hex', hex);
    writeFileSync(
      'data/consolidated.json',
      JSON.stringify({ txid: u.txid, vout: u.vout, sats: u.sats, address, consolidatedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`  ✓ Wrote data/funding-tx.hex + data/consolidated.json`);
  }
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
