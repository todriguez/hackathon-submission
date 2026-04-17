#!/usr/bin/env bun
/**
 * test-broadcast.ts — Diagnostic: build ONE CellToken and broadcast it via
 * WoC directly (bypassing ARC) at 1 sat/byte. Then verify on WoC.
 * This tells us if the ghost problem is fee-rate or tx-construction.
 */

import { PrivateKey, Transaction, P2PKH } from '@bsv/sdk';
import { readFileSync } from 'fs';

const WIF = process.env.PRIVATE_KEY_WIF ?? '';
if (!WIF) { console.error('ERROR: PRIVATE_KEY_WIF not set'); process.exit(1); }

const privKey = PrivateKey.fromWif(WIF);
const pubKey = privKey.toPublicKey();
const address = pubKey.toAddress();
const p2pkh = new P2PKH();
const lockingScript = p2pkh.lock(address);

console.log(`Address: ${address}`);

// Use the fan-out tx as source
const fanoutHex = readFileSync('data/funding-tx.hex', 'utf-8').trim();
const fanoutTx = Transaction.fromHex(fanoutHex);
const fanoutTxid = fanoutTx.id('hex') as string;
console.log(`Fan-out: ${fanoutTxid}`);

// Pick vout 1 (should be unspent, vout 0 may have been attempted)
const VOUT = 1;
const inputSats = Number(fanoutTx.outputs[VOUT].satoshis);
console.log(`Using vout ${VOUT}: ${inputSats} sats`);

// Build a simple OP_RETURN CellToken tx
const tx = new Transaction();
tx.addInput({
  sourceTXID: fanoutTxid,
  sourceOutputIndex: VOUT,
  sourceTransaction: fanoutTx,
  unlockingScriptTemplate: p2pkh.unlock(privKey),
});

// OP_RETURN output (CellToken payload)
const payload = Buffer.from(JSON.stringify({
  type: 'celltoken',
  test: 'broadcast-diagnostic',
  ts: Date.now(),
}));
const opReturnScript = new (await import('@bsv/sdk')).Script();
opReturnScript.writeOpCode(0x6a); // OP_RETURN
opReturnScript.writeBin(payload);
tx.addOutput({ lockingScript: opReturnScript, satoshis: 0 });

// Change output — pay 1 sat/byte fee
// Estimate size: ~250 bytes for 1-in-2-out P2PKH + OP_RETURN
const estSize = 250;
const fee = Math.max(estSize, 250); // 1 sat/byte minimum 250 sats
const changeSats = inputSats - fee;
tx.addOutput({ lockingScript, satoshis: changeSats });

await tx.sign();

const txHex = tx.toHex();
const txid = tx.id('hex') as string;
const actualFeeRate = (fee / (txHex.length / 2)).toFixed(2);

console.log(`Txid:     ${txid}`);
console.log(`Size:     ${txHex.length / 2} bytes`);
console.log(`Fee:      ${fee} sats (${actualFeeRate} sat/byte)`);
console.log(`Change:   ${changeSats} sats`);
console.log('');

// Method 1: Broadcast via WoC directly (no ARC)
console.log('=== Broadcasting via WoC ===');
try {
  const wocResp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: txHex }),
  });
  const wocBody = await wocResp.text();
  console.log(`WoC response: HTTP ${wocResp.status} — ${wocBody.slice(0, 300)}`);
} catch (err: any) {
  console.log(`WoC error: ${err.message}`);
}

// Method 2: Broadcast via ARC
console.log('');
console.log('=== Broadcasting via ARC ===');
try {
  const arcResp = await fetch('https://arc.gorillapool.io/v1/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawTx: txHex }),
  });
  const arcBody = await arcResp.text();
  console.log(`ARC response: HTTP ${arcResp.status} — ${arcBody.slice(0, 300)}`);
} catch (err: any) {
  console.log(`ARC error: ${err.message}`);
}

// Method 3: Try EF format to ARC (includes source tx)
console.log('');
console.log('=== Broadcasting via ARC (EF format) ===');
try {
  const efHex = tx.toHexEF();
  const arcResp = await fetch('https://arc.gorillapool.io/v1/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawTx: efHex }),
  });
  const arcBody = await arcResp.text();
  console.log(`ARC EF response: HTTP ${arcResp.status} — ${arcBody.slice(0, 300)}`);
} catch (err: any) {
  console.log(`ARC EF error: ${err.message}`);
}

// Method 4: Try BEEF format to ARC
console.log('');
console.log('=== Broadcasting via ARC (BEEF format) ===');
try {
  const { Beef } = await import('@bsv/sdk');
  const beef = new Beef();
  beef.mergeTransaction(fanoutTx); // ancestor
  beef.mergeTransaction(tx);        // the tx itself
  const beefBinary = beef.toBinary();

  const arcResp = await fetch('https://arc.gorillapool.io/v1/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(beefBinary),
  });
  const arcBody = await arcResp.text();
  console.log(`ARC BEEF response: HTTP ${arcResp.status} — ${arcBody.slice(0, 300)}`);
} catch (err: any) {
  console.log(`ARC BEEF error: ${err.message}`);
}

// Wait and verify
console.log('');
console.log('=== Verification (waiting 10s) ===');
await new Promise(r => setTimeout(r, 10_000));

// Check WoC
try {
  const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${txid}`);
  if (check.ok) {
    console.log(`✓ WoC: FOUND (HTTP ${check.status})`);
  } else {
    console.log(`✗ WoC: NOT FOUND (HTTP ${check.status})`);
  }
} catch (err: any) {
  console.log(`WoC check error: ${err.message}`);
}

// Check ARC
try {
  const check = await fetch(`https://arc.gorillapool.io/v1/tx/${txid}`);
  const data = await check.json();
  console.log(`ARC status: ${(data as any).txStatus}`);
} catch (err: any) {
  console.log(`ARC check error: ${err.message}`);
}
