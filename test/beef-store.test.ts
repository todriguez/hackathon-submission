/**
 * BeefStore integration tests — verify BEEF persistence replaces JSON chaintip.
 *
 * Tests the BeefStore class which wraps @bsv/sdk Beef for durable
 * UTXO chain persistence. This is the replacement for the v1/v2
 * JSON chaintip snapshots that caused:
 *   - v1: 345MB writes per flush (event loop starvation)
 *   - v2: 300KB writes but no SPV verification (ghost UTXO chains)
 *
 * BeefStore stores BEEF binary (~10-50KB for typical chains) with
 * structural validation on restore and optional SPV verification.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrivateKey, Transaction, P2PKH } from '@bsv/sdk';
import { BeefStore } from '../src/agent/beef-store';

// ── Helpers ──────────────────────────────────────────────────────────

function buildFundingTx(
  privKey: PrivateKey,
  outputs: { satoshis: number }[],
): Transaction {
  const tx = new Transaction();
  const p2pkh = new P2PKH();
  const lock = p2pkh.lock(privKey.toPublicKey().toAddress());
  for (const o of outputs) {
    tx.addOutput({ lockingScript: lock, satoshis: o.satoshis });
  }
  return tx;
}

async function buildChildTx(
  privKey: PrivateKey,
  parentTx: Transaction,
  vout: number,
): Promise<Transaction> {
  const p2pkh = new P2PKH();
  const tx = new Transaction();
  tx.addInput({
    sourceTXID: parentTx.id('hex') as string,
    sourceOutputIndex: vout,
    sourceTransaction: parentTx,
    unlockingScriptTemplate: p2pkh.unlock(privKey),
  });
  const satoshis = Number(parentTx.outputs[vout].satoshis);
  const fee = 50;
  if (satoshis > fee) {
    tx.addOutput({
      lockingScript: p2pkh.lock(privKey.toPublicKey().toAddress()),
      satoshis: satoshis - fee,
    });
  }
  await tx.sign();
  return tx;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('BeefStore', () => {
  let tmpDir: string;
  const privKey = PrivateKey.fromRandom();
  const nolog = () => {};

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'beefstore-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges transactions and persists to disk', async () => {
    const beefPath = join(tmpDir, 'chain.beef');
    const store = new BeefStore({
      filePath: beefPath,
      flushIntervalMs: 60_000,
      log: nolog,
    });

    const parent = buildFundingTx(privKey, [{ satoshis: 10_000 }]);
    store.mergeTransaction(parent);
    store.persist();

    expect(existsSync(beefPath)).toBe(true);
    const size = statSync(beefPath).size;
    expect(size).toBeGreaterThan(10);

    store.shutdown();
  });

  it('restores from disk and validates structure', async () => {
    const beefPath = join(tmpDir, 'chain.beef');

    // Write
    const storeA = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });
    const parent = buildFundingTx(privKey, [{ satoshis: 10_000 }]);
    const child = await buildChildTx(privKey, parent, 0);
    storeA.mergeTransaction(parent);
    storeA.mergeTransaction(child);
    storeA.persist();
    storeA.shutdown();

    // Read
    const storeB = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });
    const restored = storeB.restore();
    expect(restored).toBe(true);
    expect(storeB.isStructurallyValid()).toBe(true);

    const childTxid = child.id('hex') as string;
    expect(storeB.hasTxid(childTxid)).toBe(true);

    storeB.shutdown();
  });

  it('extractUtxos returns correct outputs', async () => {
    const beefPath = join(tmpDir, 'chain.beef');
    const store = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });

    const parent = buildFundingTx(privKey, [
      { satoshis: 3_000 },
      { satoshis: 4_000 },
      { satoshis: 5_000 },
    ]);
    store.mergeTransaction(parent);

    const parentTxid = parent.id('hex') as string;
    const utxos = store.extractUtxos(parentTxid);

    expect(utxos).toHaveLength(3);
    expect(utxos[0].satoshis).toBe(3_000);
    expect(utxos[1].satoshis).toBe(4_000);
    expect(utxos[2].satoshis).toBe(5_000);
    expect(utxos[0].txid).toBe(parentTxid);
    expect(utxos[0].vout).toBe(0);
    expect(utxos[0].sourceTx).toBeDefined();

    store.shutdown();
  });

  it('extracted UTXOs are spendable (sourceTx is populated)', async () => {
    const beefPath = join(tmpDir, 'chain.beef');
    const store = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });

    const parent = buildFundingTx(privKey, [{ satoshis: 10_000 }]);
    store.mergeTransaction(parent);
    store.persist();
    store.shutdown();

    // Restore in new store
    const store2 = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });
    store2.restore();

    const parentTxid = parent.id('hex') as string;
    const utxos = store2.extractUtxos(parentTxid);
    expect(utxos).toHaveLength(1);

    // Build a child using the extracted UTXO
    const child = await buildChildTx(privKey, utxos[0].sourceTx, 0);
    const childTxid = child.id('hex') as string;
    expect(childTxid).toHaveLength(64);

    store2.shutdown();
  });

  it('restore returns false for missing file', () => {
    const beefPath = join(tmpDir, 'nonexistent.beef');
    const store = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });
    expect(store.restore()).toBe(false);
    store.shutdown();
  });

  it('restore returns false for corrupt file', () => {
    const beefPath = join(tmpDir, 'corrupt.beef');
    const { writeFileSync } = require('fs');
    writeFileSync(beefPath, Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]));

    const store = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });
    expect(store.restore()).toBe(false);
    store.shutdown();
  });

  it('BEEF file for 200-UTXO chain is under 100KB (vs 345MB for v1 JSON)', async () => {
    const beefPath = join(tmpDir, 'big-chain.beef');
    const store = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });

    // Build parent with 200 outputs (simulating pre-split)
    const parent = buildFundingTx(privKey,
      Array.from({ length: 200 }, () => ({ satoshis: 500 }))
    );
    store.mergeTransaction(parent);

    // Build 200 child txs
    for (let i = 0; i < 200; i++) {
      const child = await buildChildTx(privKey, parent, i);
      store.mergeTransaction(child);
    }

    store.persist();

    const fileSize = statSync(beefPath).size;
    // v1 JSON would be ~345MB for 3200 UTXOs, ~17MB for 200
    // BEEF binary should be well under 100KB
    expect(fileSize).toBeLessThan(100 * 1024);

    store.shutdown();
  });

  it('getStats returns correct counts', async () => {
    const beefPath = join(tmpDir, 'stats.beef');
    const store = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });

    const parent = buildFundingTx(privKey, [{ satoshis: 5_000 }]);
    const child = await buildChildTx(privKey, parent, 0);
    store.mergeTransaction(parent);
    store.mergeTransaction(child);

    const stats = store.getStats();
    expect(stats.txCount).toBe(2);
    expect(stats.valid).toBe(true);

    store.persist();
    const statsAfter = store.getStats();
    expect(statsAfter.fileSize).toBeGreaterThan(0);

    store.shutdown();
  });

  it('getAtomicBEEF produces valid atomic envelope for a txid', async () => {
    const beefPath = join(tmpDir, 'atomic.beef');
    const store = new BeefStore({ filePath: beefPath, flushIntervalMs: 60_000, log: nolog });

    const parent = buildFundingTx(privKey, [{ satoshis: 10_000 }, { satoshis: 10_000 }]);
    const child1 = await buildChildTx(privKey, parent, 0);
    const child2 = await buildChildTx(privKey, parent, 1);

    store.mergeTransaction(parent);
    store.mergeTransaction(child1);
    store.mergeTransaction(child2);

    const child1Txid = child1.id('hex') as string;
    const atomic = store.getAtomicBEEF(child1Txid);

    // AtomicBEEF magic: 0x01010101
    const prefix = (atomic[0] | (atomic[1] << 8) | (atomic[2] << 16) | (atomic[3] << 24)) >>> 0;
    expect(prefix).toBe(0x01010101);
    expect(atomic.length).toBeGreaterThan(10);

    store.shutdown();
  });
});
