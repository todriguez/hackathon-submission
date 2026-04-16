#!/usr/bin/env bun
/**
 * Pre-Fund — Split wallet balance into per-container chunks via createAction.
 *
 * Uses the MetaNet Desktop wallet (port 3321) for UTXO management.
 * The wallet handles input selection, signing, and broadcasting.
 * Returns Atomic BEEF (BRC-95) — self-contained SPV proof chain
 * that downstream containers can use without fetching from explorers.
 *
 * Flow:
 *   1. Ensure MetaNet Desktop is running on :3321
 *   2. Run this script → wallet creates fan-out tx, writes BEEF + .env.live
 *   3. Launch Docker with --env-file .env.live
 *
 * Usage:
 *   bun run scripts/pre-fund.ts
 *   WALLET_URL=http://localhost:3321 bun run scripts/pre-fund.ts
 *
 * Legacy mode (raw key, no wallet):
 *   PRIVATE_KEY_WIF=L364... bun run scripts/pre-fund.ts
 */

import { WalletClient } from '../src/protocol/wallet-client';
import { PrivateKey, P2PKH, Transaction, ARC } from '@bsv/sdk';
import { writeFileSync, mkdirSync } from 'fs';

const WALLET_URL = process.env.WALLET_URL ?? 'http://localhost:3321';
const WIF = process.env.PRIVATE_KEY_WIF ?? '';
const CHANGE_ADDRESS = process.env.CHANGE_ADDRESS ?? '';

const FLOOR_NODES = 8;
const APEX_AGENTS = 5;
const TOTAL_CONTAINERS = FLOOR_NODES + APEX_AGENTS; // 13

const FLOOR_SHARE = 0.90;
const APEX_SHARE = 0.10;

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  PRE-FUND — Splitting balance into per-container chunks');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// ── Detect mode: wallet (preferred) or legacy raw key ──

const wallet = new WalletClient({
  baseUrl: WALLET_URL,
  timeout: 120_000,
  originator: 'semantos-casino',
  origin: 'http://localhost',
});

let useWallet = false;
try {
  useWallet = await wallet.isAuthenticated();
} catch {}

if (useWallet) {
  console.log(`  Mode: WALLET (MetaNet Desktop on ${WALLET_URL})`);
  await walletPreFund();
} else if (WIF) {
  console.log(`  Mode: LEGACY (raw PRIVATE_KEY_WIF)`);
  await legacyPreFund();
} else {
  console.error('  ERROR: No wallet on :3321 and no PRIVATE_KEY_WIF set');
  console.error('  Start MetaNet Desktop or set PRIVATE_KEY_WIF env var');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// Wallet-based pre-fund (preferred)
// ═══════════════════════════════════════════════════════════════

async function walletPreFund() {
  // Get the wallet's identity key for the locking script
  const pubKeyHex = await wallet.getPublicKey({ identityKey: true });
  console.log(`  Wallet pubkey: ${pubKeyHex.slice(0, 16)}...`);

  // Build P2PKH locking script from pubkey
  const { PublicKey, Hash } = await import('@bsv/sdk');
  const pubKey = PublicKey.fromString(pubKeyHex);
  const address = pubKey.toAddress();
  const p2pkh = new P2PKH();
  const lockingScript = p2pkh.lock(address);
  const lockingScriptHex = lockingScript.toHex();

  // Check wallet balance via a test listOutputs
  console.log(`  Address: ${address}`);
  console.log('  Querying wallet balance...');

  // Estimate available sats — wallet handles UTXO selection internally
  // We need to specify how much each container gets
  // For now, use a target total and let the wallet figure out the inputs
  const balanceResp = await fetch(
    `https://api.whatsonchain.com/v1/bsv/main/address/${address}/balance`,
  );
  const balance = await balanceResp.json();
  const totalSats = (balance.confirmed ?? 0) + (balance.unconfirmed ?? 0);

  if (totalSats < 100_000) {
    console.error(`  ERROR: Insufficient balance: ${totalSats.toLocaleString()} sats`);
    process.exit(1);
  }

  console.log(`  Balance: ${totalSats.toLocaleString()} sats (${(totalSats / 1e8).toFixed(4)} BSV)`);

  // Generous fee estimate for the fan-out (wallet adds change automatically)
  const estFee = 5_000; // wallet calculates actual fee
  const availSats = totalSats - estFee;
  const floorPerNode = Math.floor((availSats * FLOOR_SHARE) / FLOOR_NODES);
  const apexPerAgent = Math.floor((availSats * APEX_SHARE) / APEX_AGENTS);

  console.log(`  Per floor node: ${floorPerNode.toLocaleString()} sats (${(floorPerNode / 1e8).toFixed(4)} BSV)`);
  console.log(`  Per apex agent: ${apexPerAgent.toLocaleString()} sats (${(apexPerAgent / 1e8).toFixed(4)} BSV)`);
  console.log('');

  // Build outputs array
  const outputs = [];
  const assignments: Array<{ label: string; sats: number; vout: number }> = [];

  // vout 0..7 = floor nodes
  for (let i = 0; i < FLOOR_NODES; i++) {
    outputs.push({
      lockingScript: lockingScriptHex,
      satoshis: floorPerNode,
      outputDescription: `floor-${i}`,
      basket: 'casino-floor',
      tags: [`floor-${i}`],
    });
    assignments.push({ label: `floor-${i}`, sats: floorPerNode, vout: i });
  }

  // vout 8..12 = apex agents
  for (let i = 0; i < APEX_AGENTS; i++) {
    outputs.push({
      lockingScript: lockingScriptHex,
      satoshis: apexPerAgent,
      outputDescription: `apex-${i}`,
      basket: 'apex-agents',
      tags: [`apex-${i}`],
    });
    assignments.push({ label: `apex-${i}`, sats: apexPerAgent, vout: FLOOR_NODES + i });
  }

  console.log('  Creating fan-out via wallet createAction...');
  const result = await wallet.createAction({
    description: 'Casino floor fan-out funding',
    labels: ['pre-fund', 'casino-floor'],
    outputs,
  });

  const txid = result.txid;
  console.log(`  ✓ Fan-out tx: ${txid}`);
  console.log(`  https://whatsonchain.com/tx/${txid}`);
  console.log('');

  // Save BEEF to file for downstream containers
  mkdirSync('data', { recursive: true });
  let beefHex: string;

  if (result.tx) {
    // Wallet returns BEEF in `tx` field (number[] or hex string)
    if (Array.isArray(result.tx)) {
      beefHex = Buffer.from(result.tx as number[]).toString('hex');
    } else {
      beefHex = result.tx as string;
    }
  } else if (result.rawTx) {
    beefHex = result.rawTx;
  } else {
    console.error('  ERROR: Wallet returned neither tx (BEEF) nor rawTx');
    process.exit(1);
  }

  writeFileSync('data/funding-tx.hex', beefHex);
  console.log(`  Wrote data/funding-tx.hex (${(beefHex.length / 2).toLocaleString()} bytes BEEF)`);

  // Internalize the outputs so wallet tracks them
  try {
    await wallet.internalizeAction({
      tx: result.tx as number[],
      description: 'Casino floor pre-fund outputs',
      labels: ['pre-fund'],
      outputs: [
        ...Array.from({ length: FLOOR_NODES }, (_, i) => ({
          outputIndex: i,
          protocol: 'basket insertion' as const,
          insertionRemittance: { basket: 'casino-floor', tags: [`floor-${i}`] },
        })),
        ...Array.from({ length: APEX_AGENTS }, (_, i) => ({
          outputIndex: FLOOR_NODES + i,
          protocol: 'basket insertion' as const,
          insertionRemittance: { basket: 'apex-agents', tags: [`apex-${i}`] },
        })),
      ],
    });
    console.log('  ✓ Outputs internalized in wallet baskets');
  } catch (err: any) {
    console.log(`  ⚠ Internalize failed (non-fatal): ${err.message}`);
  }

  // Print assignments
  console.log('');
  console.log('  Container assignments:');
  for (const a of assignments) {
    console.log(`    ${a.label}: vout=${a.vout} → ${a.sats.toLocaleString()} sats`);
  }

  // Write .env.live
  writeEnvLive(txid, beefHex, WIF, CHANGE_ADDRESS || address);
}

// ═══════════════════════════════════════════════════════════════
// Legacy pre-fund (raw key, no wallet)
// ═══════════════════════════════════════════════════════════════

async function legacyPreFund() {
  const privKey = PrivateKey.fromWif(WIF);
  const pubKey = privKey.toPublicKey();
  const address = pubKey.toAddress();
  const changeAddr = CHANGE_ADDRESS || address;

  console.log(`  Address: ${address}`);
  console.log(`  Change:  ${changeAddr}`);
  console.log('');
  console.log('  Polling WhatsOnChain for UTXOs...');

  const resp = await fetch(
    `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
  );
  if (!resp.ok) {
    console.error(`  ERROR: WoC returned ${resp.status}`);
    process.exit(1);
  }

  let utxos: any[] = await resp.json();
  if (utxos.length === 0) {
    console.error('  ERROR: No UTXOs found. Fund the address first!');
    process.exit(1);
  }

  // Filter to confirmed-only UTXOs when CONFIRMED_ONLY=1 (avoids mempool contamination)
  if (process.env.CONFIRMED_ONLY === '1') {
    const before = utxos.length;
    utxos = utxos.filter((u: any) => u.height > 0);
    console.log(`  CONFIRMED_ONLY: ${utxos.length}/${before} UTXOs have confirmations`);
    if (utxos.length === 0) {
      console.error('  ERROR: No confirmed UTXOs found!');
      process.exit(1);
    }
  }

  // FUNDING_BUDGET caps the total sats to consume (e.g. 5000000 for 0.05 BSV).
  // Sort largest-first so we minimise the number of inputs (fewer source-tx fetches).
  const fundingBudget = Number(process.env.FUNDING_BUDGET ?? '0');
  if (fundingBudget > 0) {
    utxos.sort((a: any, b: any) => b.value - a.value);
    let cumSats = 0;
    const selected: any[] = [];
    for (const u of utxos) {
      selected.push(u);
      cumSats += u.value;
      if (cumSats >= fundingBudget) break;
    }
    console.log(`  FUNDING_BUDGET=${fundingBudget.toLocaleString()} sats — using ${selected.length}/${utxos.length} UTXOs (${cumSats.toLocaleString()} sats)`);
    utxos = selected;
  }

  const totalSats = utxos.reduce((s: number, u: any) => s + u.value, 0);
  console.log(`  Using ${utxos.length} UTXOs totaling ${totalSats.toLocaleString()} sats (${(totalSats / 1e8).toFixed(4)} BSV)`);

  // Fetch full tx hex for each UTXO
  const fundingInputs: Array<{ txid: string; vout: number; sats: number; sourceTx: Transaction }> = [];
  for (const u of utxos) {
    const txResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${u.tx_hash}/hex`);
    const txHex = await txResp.text();
    fundingInputs.push({
      txid: u.tx_hash,
      vout: u.tx_pos,
      sats: u.value,
      sourceTx: Transaction.fromHex(txHex),
    });
  }

  // Build fan-out tx
  const p2pkh = new P2PKH();
  const lockingScript = p2pkh.lock(address);
  const tx = new Transaction();

  for (const inp of fundingInputs) {
    tx.addInput({
      sourceTXID: inp.txid,
      sourceOutputIndex: inp.vout,
      sourceTransaction: inp.sourceTx,
      unlockingScriptTemplate: p2pkh.unlock(privKey),
    });
  }

  const estInputBytes = fundingInputs.length * 148;
  const estOutputBytes = (TOTAL_CONTAINERS + 1) * 34;
  const estFee = Math.max(50, Math.ceil((10 + estInputBytes + estOutputBytes) * 0.5));

  const availSats = totalSats - estFee;
  const floorPerNode = Math.floor((availSats * FLOOR_SHARE) / FLOOR_NODES);
  const apexPerAgent = Math.floor((availSats * APEX_SHARE) / APEX_AGENTS);

  console.log('');
  console.log(`  Fee estimate: ${estFee} sats`);
  console.log(`  Per floor node: ${floorPerNode.toLocaleString()} sats (${(floorPerNode / 1e8).toFixed(4)} BSV)`);
  console.log(`  Per apex agent: ${apexPerAgent.toLocaleString()} sats (${(apexPerAgent / 1e8).toFixed(4)} BSV)`);
  console.log('');

  const assignments: Array<{ label: string; sats: number; vout: number }> = [];

  for (let i = 0; i < FLOOR_NODES; i++) {
    tx.addOutput({ lockingScript, satoshis: floorPerNode });
    assignments.push({ label: `floor-${i}`, sats: floorPerNode, vout: i });
  }

  for (let i = 0; i < APEX_AGENTS; i++) {
    tx.addOutput({ lockingScript, satoshis: apexPerAgent });
    assignments.push({ label: `apex-${i}`, sats: apexPerAgent, vout: FLOOR_NODES + i });
  }

  const allocated = floorPerNode * FLOOR_NODES + apexPerAgent * APEX_AGENTS;
  const change = availSats - allocated;
  if (change > 546) {
    tx.addOutput({ lockingScript, satoshis: change });
    console.log(`  Change output (vout ${TOTAL_CONTAINERS}): ${change} sats`);
  }

  await tx.sign();
  const txHex = tx.toHex();
  const txid = tx.id('hex') as string;

  console.log(`  Tx size: ${txHex.length / 2} bytes`);
  console.log('  Broadcasting via ARC + WoC (dual broadcast)...');

  const arc = new ARC('https://arc.gorillapool.io');
  const result = await tx.broadcast(arc);

  if ('status' in result && (result as any).status === 'error') {
    console.error(`  ERROR: ARC rejected: ${JSON.stringify(result)}`);
    process.exit(1);
  }

  const wocResp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: txHex }),
  });
  if (wocResp.ok) {
    console.log('  ✓ WoC backup broadcast confirmed');
  } else {
    const body = await wocResp.text().catch(() => '');
    if (body.includes('already-known') || body.includes('already in the mempool')) {
      console.log('  ✓ Tx already on network');
    } else {
      console.log(`  ⚠ WoC backup: ${wocResp.status} ${body.slice(0, 100)}`);
    }
  }

  console.log(`  ✓ Fan-out tx: ${txid}`);
  console.log(`  https://whatsonchain.com/tx/${txid}`);

  // Wait for ARC to fully ingest the fan-out — critical for avoiding orphan
  // mempool contamination on downstream pre-split children.
  console.log('  Waiting for ARC to index fan-out (prevents orphan-mempool on children)...');
  const arcUrl = process.env.ARC_URL ?? 'https://arc.gorillapool.io';
  const arcKey = process.env.ARC_API_KEY ?? '';
  const arcHeaders: Record<string, string> = arcKey ? { Authorization: `Bearer ${arcKey}` } : {};
  const waitStart = Date.now();
  const waitCap = 90_000;
  let arcSaw = false;
  while (Date.now() - waitStart < waitCap) {
    try {
      const r = await fetch(`${arcUrl}/v1/tx/${txid}`, { headers: arcHeaders });
      if (r.ok) {
        const body: any = await r.json().catch(() => ({}));
        const status: string = body?.txStatus ?? '';
        if (['SEEN_ON_NETWORK', 'MINED', 'ACCEPTED_BY_NETWORK', 'ANNOUNCED_TO_NETWORK', 'STORED', 'CONFIRMED'].includes(status)) {
          console.log(`  ✓ ARC indexed fan-out (${status}) after ${Date.now() - waitStart}ms`);
          arcSaw = true;
          break;
        } else if (status) {
          console.log(`  ARC status: ${status} — waiting...`);
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!arcSaw) {
    console.log(`  ⚠ ARC did not index fan-out within ${waitCap}ms — children may orphan. Proceeding anyway.`);
  }

  // Save tx hex to file
  mkdirSync('data', { recursive: true });
  writeFileSync('data/funding-tx.hex', txHex);
  console.log(`  Wrote data/funding-tx.hex (${(txHex.length / 2).toLocaleString()} bytes)`);

  console.log('');
  console.log('  Container assignments:');
  for (const a of assignments) {
    console.log(`    ${a.label}: vout=${a.vout} → ${a.sats.toLocaleString()} sats`);
  }

  writeEnvLive(txid, '', WIF, changeAddr);
}

// ═══════════════════════════════════════════════════════════════
// Shared: write .env.live
// ═══════════════════════════════════════════════════════════════

function writeEnvLive(txid: string, beefHex: string, wif: string, changeAddr: string) {
  const envLines = [
    `# Generated by pre-fund.ts at ${new Date().toISOString()}`,
    `# Fan-out txid: ${txid}`,
    wif ? `PRIVATE_KEY_WIF=${wif}` : '# PRIVATE_KEY_WIF not set (wallet mode)',
    `CHANGE_ADDRESS=${changeAddr}`,
    `ANCHOR_MODE=live`,
    `FUNDING_TX_HEX_FILE=/funding/funding-tx.hex`,
    // Apex LLM config
    `LLM_PROVIDER=${process.env.LLM_PROVIDER ?? 'anthropic'}`,
    `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ''}`,
    `# GorillaPool ARC — honest broadcaster`,
    `ARC_URL=${process.env.ARC_URL ?? 'https://arc.gorillapool.io'}`,
    `ARC_API_KEY=${process.env.ARC_API_KEY ?? ''}`,
  ];

  writeFileSync('.env.live', envLines.join('\n') + '\n');
  console.log('');
  console.log('  Wrote .env.live');
  console.log('');
  console.log('  To launch:');
  console.log('');
  console.log('  docker compose --env-file .env.live up -d');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}
