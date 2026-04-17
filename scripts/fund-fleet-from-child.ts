#!/usr/bin/env bun
/**
 * fund-fleet-from-child.ts — Use pool-crank child 0's funds to fund Docker fleet.
 * Child 0 has ~86M sats. Consolidate → fan-out to 13 fleet containers.
 */

import { PrivateKey, KeyDeriver, Transaction, P2PKH } from '@bsv/sdk';
import { writeFileSync } from 'fs';

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const SATS_PER_CONTAINER = Number(process.env.SATS_PER_CONTAINER ?? '5000000'); // 5M = 0.05 BSV each
const NUM_FLEET = 13;
const MAPI_URL = 'https://mapi.gorillapool.io/mapi/tx';

const masterKey = PrivateKey.fromWif(WIF);
const p2pkh = new P2PKH();

// ALL pool-crank children (same derivation as pool-crank.ts)
const poolDeriver = new KeyDeriver(masterKey);
const poolChildren = Array.from({ length: 8 }, (_, i) => {
  const key = poolDeriver.derivePrivateKey([2, 'pool manager funding'], `container-${i}`, 'self');
  const addr = key.toPublicKey().toAddress();
  return { key, address: addr, lock: p2pkh.lock(addr) };
});

// Fleet container keys (different protocol ID to avoid collision)
const fleetDeriver = new KeyDeriver(masterKey);
const fleetContainers = Array.from({ length: NUM_FLEET }, (_, i) => {
  const name = i < 8 ? `floor-${i}` : `apex-${i - 8}`;
  const key = fleetDeriver.derivePrivateKey([2, 'fleet container funding'], name, 'self');
  const addr = key.toPublicKey().toAddress();
  return { name, index: i, privKey: key, wif: key.toWif(), address: addr, lock: p2pkh.lock(addr) };
});

console.log('═══════════════════════════════════════════════════════════');
console.log('  FLEET FUNDING — sweep ALL pool-crank children');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Sources: 8 pool-crank children`);
console.log(`  Per fleet container: ${(SATS_PER_CONTAINER / 1e8).toFixed(4)} BSV`);
console.log('');

async function broadcastMAPI(txHex: string): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(MAPI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawtx: txHex }),
      });
      if (resp.status === 429) { await new Promise(r => setTimeout(r, 500 * (attempt + 1))); continue; }
      const raw = await resp.text();
      try {
        const outer = JSON.parse(raw);
        const inner = JSON.parse(outer.payload);
        const ok = inner.returnResult === 'success' || (inner.resultDescription || '').includes('already known');
        return { ok, error: ok ? undefined : inner.resultDescription };
      } catch { return { ok: resp.ok, error: raw.slice(0, 200) }; }
    } catch (err: any) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 200)); continue; }
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: 'retries exhausted' };
}

// Step 1: Sweep all 8 children — consolidate each into a single UTXO on child 0
console.log('  Sweeping all 8 pool-crank children...');

const childKey = poolChildren[0].key;
const childAddress = poolChildren[0].address;
const childLock = poolChildren[0].lock;

for (let ci = 0; ci < 8; ci++) {
  const child = poolChildren[ci];
  console.log(`  Discovering child ${ci} (${child.address})...`);

  const childUtxos: Array<{ txid: string; vout: number; sats: number }> = [];
  let from = 0;
  while (true) {
    const resp = await fetch(`https://api.bitails.io/address/${child.address}/unspent?limit=10000&from=${from}`);
    if (!resp.ok) break;
    const data: any = await resp.json();
    const list = data.unspent ?? data;
    if (!Array.isArray(list) || list.length === 0) break;
    for (const u of list) {
      const sats = u.value ?? u.satoshis ?? 0;
      if (sats >= 500) childUtxos.push({ txid: u.tx_hash ?? u.txid, vout: u.tx_pos ?? u.vout, sats });
    }
    if (list.length < 10000) break;
    from += 10000;
  }

  const childTotal = childUtxos.reduce((s, u) => s + u.sats, 0);
  console.log(`    ${childUtxos.length} UTXOs (${childTotal.toLocaleString()} sats)`);

  if (childUtxos.length === 0) continue;

  // Consolidate in batches of 200 → send to child 0
  childUtxos.sort((a, b) => b.sats - a.sats);
  let remaining = [...childUtxos];

  while (remaining.length > 0) {
    const batch = remaining.splice(0, 200);
    const batchTotal = batch.reduce((s, u) => s + u.sats, 0);

    const tx = new Transaction();
    for (const u of batch) {
      tx.addInput({
        sourceTXID: u.txid, sourceOutputIndex: u.vout,
        unlockingScriptTemplate: p2pkh.unlock(child.key, 'all', false, u.sats, child.lock),
      });
    }
    const fee = Math.ceil((batch.length * 150 + 34 + 10) * 1.0);
    const out = batchTotal - fee;
    if (out < 546) continue;

    // Send to child 0 (consolidation target)
    tx.addOutput({ lockingScript: childLock, satoshis: out });
    await tx.sign();
    const txHex = tx.toHex();
    const txid = tx.id('hex') as string;

    const result = await broadcastMAPI(txHex);
    if (result.ok) {
      console.log(`    Swept ${batch.length} UTXOs → child 0 (${out.toLocaleString()} sats)`);
    } else {
      console.error(`    Sweep failed: ${result.error?.slice(0, 100)}`);
    }
  }
}

// Now discover child 0's consolidated UTXOs
console.log('');
console.log('  Waiting 3s for sweep propagation...');
await new Promise(r => setTimeout(r, 3000));

console.log('  Discovering child 0 consolidated UTXOs...');
const utxos: Array<{ txid: string; vout: number; sats: number }> = [];
let scanFrom = 0;
while (true) {
  const resp = await fetch(`https://api.bitails.io/address/${childAddress}/unspent?limit=10000&from=${scanFrom}`);
  if (!resp.ok) break;
  const data: any = await resp.json();
  const list = data.unspent ?? data;
  if (!Array.isArray(list) || list.length === 0) break;
  for (const u of list) {
    const sats = u.value ?? u.satoshis ?? 0;
    if (sats >= 500) utxos.push({ txid: u.tx_hash ?? u.txid, vout: u.tx_pos ?? u.vout, sats });
  }
  if (list.length < 10000) break;
  scanFrom += 10000;
}
utxos.sort((a, b) => b.sats - a.sats);
const total = utxos.reduce((s, u) => s + u.sats, 0);
console.log(`  ${utxos.length} UTXOs (${total.toLocaleString()} sats / ${(total / 1e8).toFixed(4)} BSV)`);

// Step 2: Consolidate child 0's UTXOs into a single big UTXO for the fan-out
const needed = SATS_PER_CONTAINER * NUM_FLEET + 100000;
console.log(`  Need ${needed.toLocaleString()} sats for fleet. Have ${total.toLocaleString()}.`);

let consolidatedUtxo: { txid: string; vout: number; sats: number } | null = null;
const bigEnough = utxos.find(u => u.sats >= needed);

if (bigEnough) {
  console.log(`  Big enough UTXO found: ${bigEnough.sats.toLocaleString()} sats`);
  consolidatedUtxo = bigEnough;
} else {
  console.log('  Consolidating child 0 UTXOs...');
  let remaining = [...utxos];
  while (remaining.length > 1) {
    const batch = remaining.splice(0, 200);
    const batchTotal = batch.reduce((s, u) => s + u.sats, 0);
    const tx = new Transaction();
    for (const u of batch) {
      tx.addInput({
        sourceTXID: u.txid, sourceOutputIndex: u.vout,
        unlockingScriptTemplate: p2pkh.unlock(childKey, 'all', false, u.sats, childLock),
      });
    }
    const fee = Math.ceil((batch.length * 150 + 34 + 10) * 1.0);
    const out = batchTotal - fee;
    if (out < 546) continue;
    tx.addOutput({ lockingScript: childLock, satoshis: out });
    await tx.sign();
    const result = await broadcastMAPI(tx.toHex());
    const txid = tx.id('hex') as string;
    if (result.ok) {
      console.log(`    ${batch.length} → 1 (${out.toLocaleString()} sats)`);
      remaining.unshift({ txid, vout: 0, sats: out });
    } else {
      console.error(`    Failed: ${result.error?.slice(0, 100)}`);
      remaining.push(...batch);
      break;
    }
  }
  consolidatedUtxo = remaining[0] ?? null;
}

if (!consolidatedUtxo || consolidatedUtxo.sats < needed) {
  console.error(`  Not enough: ${consolidatedUtxo?.sats ?? 0} sats, need ${needed}`);
  process.exit(1);
}
console.log(`  Ready: ${consolidatedUtxo.sats.toLocaleString()} sats`);
console.log('');

// Step 3: Fan-out to 13 fleet containers
console.log('  Step 2: Fan-out to fleet containers...');
const fanTx = new Transaction();
fanTx.addInput({
  sourceTXID: consolidatedUtxo.txid, sourceOutputIndex: consolidatedUtxo.vout,
  unlockingScriptTemplate: p2pkh.unlock(childKey, 'all', false, consolidatedUtxo.sats, childLock),
});

for (const c of fleetContainers) {
  fanTx.addOutput({ lockingScript: c.lock, satoshis: SATS_PER_CONTAINER });
}
const fanFee = Math.ceil((150 + NUM_FLEET * 34 + 34 + 10) * 1.0);
const fanChange = consolidatedUtxo.sats - (SATS_PER_CONTAINER * NUM_FLEET) - fanFee;
if (fanChange >= 546) {
  fanTx.addOutput({ lockingScript: childLock, satoshis: fanChange });
}

await fanTx.sign();
const fanHex = fanTx.toHex();
const fanTxid = fanTx.id('hex') as string;

console.log(`  Fan-out txid: ${fanTxid}`);
console.log(`  Size: ${fanHex.length / 2} bytes`);

const fanResult = await broadcastMAPI(fanHex);
if (!fanResult.ok) {
  console.error(`  Fan-out MAPI rejected: ${fanResult.error}`);
  // WoC fallback
  const woc = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: fanHex }),
  });
  if (!woc.ok) {
    console.error(`  WoC also rejected: ${(await woc.text()).slice(0, 200)}`);
    process.exit(1);
  }
  console.log('  ✓ WoC accepted');
} else {
  console.log('  ✓ MAPI accepted');
}

// Write docker-compose.override.yml
let yaml = `# Auto-generated by fund-fleet-from-child.ts — ${new Date().toISOString()}\n`;
yaml += `# Fan-out txid: ${fanTxid}\n`;
yaml += `# BRC-42 derived keys (protocol: 'fleet container funding')\n\n`;
yaml += `services:\n`;

for (const c of fleetContainers) {
  yaml += `  ${c.name}:\n`;
  yaml += `    environment:\n`;
  yaml += `      PRIVATE_KEY_WIF: "${c.wif}"\n`;
  yaml += `      CHANGE_ADDRESS: "${c.address}"\n`;
  yaml += `      FUNDING_VOUT: "${c.index}"\n`;
  yaml += `      FUNDING_TX_HEX_FILE: "/funding/fleet-funding-tx.hex"\n`;
  yaml += `      BROADCAST_VIA: "mapi"\n`;
  yaml += `      ANCHOR_MODE: "live"\n`;
  yaml += `      FEE_RATE: "0.5"\n`;
  yaml += `      MIN_FEE: "110"\n`;
  yaml += `\n`;
}

writeFileSync('docker-compose.override.yml', yaml);
writeFileSync('data/fleet-funding-tx.hex', fanHex);

const envContent = [
  `# Generated by fund-fleet-from-child.ts at ${new Date().toISOString()}`,
  `ANCHOR_MODE=live`,
  `BROADCAST_VIA=mapi`,
  `FEE_RATE=0.5`,
  `MIN_FEE=110`,
  `SPLIT_SATS=1000`,
  `PRIVATE_KEY_WIF=${WIF}`,
  `CHANGE_ADDRESS=${childAddress}`,
].join('\n') + '\n';
writeFileSync('.env.fleet', envContent);

console.log('');
console.log('  ✓ docker-compose.override.yml written');
console.log('  ✓ data/fleet-funding-tx.hex written');
console.log('  ✓ .env.fleet written');
console.log('');
console.log('  Fleet containers:');
for (const c of fleetContainers) {
  console.log(`    ${c.name}: ${c.address} (${SATS_PER_CONTAINER.toLocaleString()} sats)`);
}
console.log('');
console.log('  Next: docker compose build && docker compose --env-file .env.fleet up -d');
