#!/usr/bin/env bun
import { PrivateKey, Transaction, P2PKH, LockingScript } from '@bsv/sdk';

const privKey = PrivateKey.fromWif(process.env.PRIVATE_KEY_WIF!);
const p2pkh = new P2PKH();
const address = privKey.toPublicKey().toAddress();
const lockScript = p2pkh.lock(address);

// Get a fresh unspent UTXO
const utxoResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`);
const utxos: any[] = await utxoResp.json();
const utxo = utxos.find((u: any) => u.value >= 1000 && u.value < 3000);
if (!utxo) { console.log('No suitable UTXO'); process.exit(1); }

console.log(`UTXO: ${utxo.tx_hash.slice(0,16)}...vout ${utxo.tx_pos} = ${utxo.value} sats`);

const tx = new Transaction();
tx.addInput({
  sourceTXID: utxo.tx_hash,
  sourceOutputIndex: utxo.tx_pos,
  unlockingScriptTemplate: p2pkh.unlock(privKey, 'all', false, utxo.value, lockScript),
});

const payload = Array.from(new TextEncoder().encode(JSON.stringify({ t: 'cell', test: 'waitfor', ts: Date.now() })));
tx.addOutput({ lockingScript: new LockingScript([{ op: 0 }, { op: 0x6a }, { op: payload.length, data: payload }]), satoshis: 0 });
const change = utxo.value - 250;
if (change >= 546) tx.addOutput({ lockingScript: lockScript, satoshis: change });
await tx.sign();

const txHex = tx.toHex();
const txid = tx.id('hex');
console.log(`Txid: ${txid}`);
console.log(`Size: ${txHex.length / 2} bytes`);

// Test 1: ARC with X-WaitFor: SEEN_ON_NETWORK
console.log('\n=== ARC + X-WaitFor: SEEN_ON_NETWORK ===');
const t0 = Date.now();
try {
  const arcResp = await fetch('https://arc.gorillapool.io/v1/tx', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-WaitFor': 'SEEN_ON_NETWORK',
    },
    body: JSON.stringify({ rawTx: txHex }),
    signal: AbortSignal.timeout(30000),
  });
  const elapsed = Date.now() - t0;
  const arcBody = await arcResp.text();
  console.log(`Response (${elapsed}ms): HTTP ${arcResp.status}`);
  console.log(`Body: ${arcBody.slice(0, 300)}`);
} catch (err: any) {
  const elapsed = Date.now() - t0;
  console.log(`Error after ${elapsed}ms: ${err.message}`);
}

// Verify on WoC
console.log('\n=== WoC verify (8s) ===');
await new Promise(r => setTimeout(r, 8000));
const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${txid}`);
console.log(`WoC: ${check.ok ? 'FOUND!' : `NOT FOUND (${check.status})`}`);
