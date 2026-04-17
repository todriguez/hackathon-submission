/**
 * BEEF-gated broadcast tests — TDD for the BEEF rearchitecture.
 *
 * The core problem: current DirectBroadcastEngine trusts ARC's 200 response
 * as proof that a UTXO exists. When ARC silently drops a tx (or returns
 * "SEEN_ON_NETWORK" for something it hasn't actually propagated), every child
 * tx built on that phantom parent produces a phantom txid that never hits chain.
 *
 * The fix: wrap every broadcast result in a BEEF envelope. Before spending a
 * UTXO, verify the BEEF structurally (isValid). For confirmed txs, verify the
 * merkle path against block headers (verify + ChainTracker). Ghost outputs
 * literally can't enter the system — no BEEF, no bind, no spend.
 *
 * These tests use @bsv/sdk's built-in Beef class, MerklePath, and Transaction
 * BEEF serialization (toBEEF/fromBEEF) — the same primitives used in
 * semantos-core's cell engine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrivateKey, Transaction, P2PKH, Beef, MerklePath } from '@bsv/sdk';
import type ChainTracker from '@bsv/sdk/primitives/chaintracker';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build a simple P2PKH tx with N outputs. Not broadcast — just for
 * in-memory BEEF envelope testing.
 */
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

/**
 * Build a child tx that spends vout from parentTx.
 * Returns signed tx ready for BEEF wrapping.
 */
async function buildChildTx(
  privKey: PrivateKey,
  parentTx: Transaction,
  vout: number,
): Promise<Transaction> {
  const p2pkh = new P2PKH();
  const tx = new Transaction();
  const parentTxid = parentTx.id('hex') as string;

  tx.addInput({
    sourceTXID: parentTxid,
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

/**
 * GullibleChainTracker — accepts any merkle root. For structure-only tests.
 */
const gullibleTracker: ChainTracker = {
  isValidRootForHeight: async () => true,
  currentHeight: async () => 999999,
};

// ── Tests ────────────────────────────────────────────────────────────

describe('BEEF envelope creation and structural verification', () => {
  const privKey = PrivateKey.fromRandom();

  it('wraps a parent + child tx chain into a valid BEEF', async () => {
    const parent = buildFundingTx(privKey, [{ satoshis: 10_000 }]);
    const child = await buildChildTx(privKey, parent, 0);

    const beef = new Beef();
    beef.mergeTransaction(parent);
    beef.mergeTransaction(child);

    // Structural validity (no merkle proofs needed for unconfirmed chain)
    // isValid with allowTxidOnly=true accepts unconfirmed ancestors
    const valid = beef.isValid(true);
    expect(valid).toBe(true);
  });

  it('BEEF serialization round-trips correctly', async () => {
    const parent = buildFundingTx(privKey, [{ satoshis: 5_000 }, { satoshis: 5_000 }]);
    const child = await buildChildTx(privKey, parent, 0);

    const beef = new Beef();
    beef.mergeTransaction(parent);
    beef.mergeTransaction(child);

    // Serialize
    const binary = beef.toBinary();
    expect(binary.length).toBeGreaterThan(0);

    // Deserialize
    const restored = Beef.fromBinary(binary);
    const childTxid = child.id('hex') as string;
    const parentTxid = parent.id('hex') as string;

    expect(restored.findTxid(childTxid)).toBeDefined();
    expect(restored.findTxid(parentTxid)).toBeDefined();
  });

  it('BEEF hex round-trip preserves transaction data', async () => {
    const parent = buildFundingTx(privKey, [{ satoshis: 8_000 }]);
    const child = await buildChildTx(privKey, parent, 0);

    const beef = new Beef();
    beef.mergeTransaction(parent);
    beef.mergeTransaction(child);

    const hex = beef.toHex();
    const restored = Beef.fromString(hex, 'hex');

    const childTxid = child.id('hex') as string;
    const foundTx = restored.findTransactionForSigning(childTxid);
    expect(foundTx).toBeDefined();
  });

  it('findTransactionForSigning returns a tx with sourceTransactions populated', async () => {
    const parent = buildFundingTx(privKey, [{ satoshis: 6_000 }]);
    const child = await buildChildTx(privKey, parent, 0);

    const beef = new Beef();
    beef.mergeTransaction(parent);
    beef.mergeTransaction(child);

    const childTxid = child.id('hex') as string;
    const tx = beef.findTransactionForSigning(childTxid);
    expect(tx).toBeDefined();
    // The input's sourceTransaction should be populated from the BEEF
    expect(tx!.inputs[0].sourceTransaction).toBeDefined();
  });
});

describe('BEEF persistence to disk', () => {
  let tmpDir: string;
  const privKey = PrivateKey.fromRandom();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'beef-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists BEEF binary to disk and restores it', async () => {
    const parent = buildFundingTx(privKey, [{ satoshis: 10_000 }]);
    const child = await buildChildTx(privKey, parent, 0);

    const beef = new Beef();
    beef.mergeTransaction(parent);
    beef.mergeTransaction(child);

    // Write BEEF binary to disk
    const beefPath = join(tmpDir, 'chain.beef');
    const binary = Buffer.from(beef.toBinary());
    writeFileSync(beefPath, binary);

    expect(existsSync(beefPath)).toBe(true);

    // Restore
    const raw = readFileSync(beefPath);
    const restored = Beef.fromBinary(new Uint8Array(raw));

    const childTxid = child.id('hex') as string;
    expect(restored.findTxid(childTxid)).toBeDefined();
    expect(restored.isValid(true)).toBe(true);
  });

  it('BEEF file is much smaller than raw hex persistence', async () => {
    // Build a chain: parent → 200 children (simulating pre-split outputs)
    const parent = buildFundingTx(privKey,
      Array.from({ length: 200 }, () => ({ satoshis: 500 }))
    );

    const beef = new Beef();
    beef.mergeTransaction(parent);

    // Build 200 child txs
    for (let i = 0; i < 200; i++) {
      const child = await buildChildTx(privKey, parent, i);
      beef.mergeTransaction(child);
    }

    const beefBinary = Buffer.from(beef.toBinary());

    // Compare: v1 chaintip would store parent hex per-UTXO
    const parentHex = parent.toHex();
    const v1Size = parentHex.length * 200; // parent hex repeated 200 times

    // BEEF stores parent ONCE plus child txs
    expect(beefBinary.length).toBeLessThan(v1Size);
  });
});

describe('BEEF-gated UTXO extraction', () => {
  const privKey = PrivateKey.fromRandom();

  it('extracts spendable UTXOs from a BEEF envelope', async () => {
    const parent = buildFundingTx(privKey, [
      { satoshis: 3_000 },
      { satoshis: 4_000 },
      { satoshis: 5_000 },
    ]);

    const beef = new Beef();
    beef.mergeTransaction(parent);

    const parentTxid = parent.id('hex') as string;

    // Extract UTXOs by walking the BEEF's transaction outputs
    const beefTx = beef.findTxid(parentTxid);
    expect(beefTx).toBeDefined();

    const tx = beef.findTransactionForSigning(parentTxid);
    expect(tx).toBeDefined();
    expect(tx!.outputs.length).toBe(3);
    expect(Number(tx!.outputs[0].satoshis)).toBe(3_000);
    expect(Number(tx!.outputs[1].satoshis)).toBe(4_000);
    expect(Number(tx!.outputs[2].satoshis)).toBe(5_000);
  });

  it('child tx can be built from BEEF-extracted sourceTransaction', async () => {
    const parent = buildFundingTx(privKey, [{ satoshis: 10_000 }]);

    // Serialize parent into BEEF, then restore
    const beef = new Beef();
    beef.mergeTransaction(parent);
    const binary = beef.toBinary();

    // Simulate: different process loads the BEEF
    const restored = Beef.fromBinary(binary);
    const parentTxid = parent.id('hex') as string;
    const sourceTx = restored.findTransactionForSigning(parentTxid);
    expect(sourceTx).toBeDefined();

    // Build a child using the BEEF-restored source tx
    const child = await buildChildTx(privKey, sourceTx!, 0);
    const childTxid = child.id('hex') as string;
    expect(childTxid).toHaveLength(64);
    expect(Number(child.outputs[0].satoshis)).toBe(10_000 - 50);
  });
});

describe('BEEF chain growth (change recycling)', () => {
  const privKey = PrivateKey.fromRandom();

  it('accumulates a chain of 5 txs in a single BEEF, all structurally valid', async () => {
    const beef = new Beef();

    // Genesis funding
    let current = buildFundingTx(privKey, [{ satoshis: 50_000 }]);
    beef.mergeTransaction(current);
    let currentTxid = current.id('hex') as string;
    let currentSats = 50_000;

    // Chain 5 spends
    for (let i = 0; i < 5; i++) {
      const child = await buildChildTx(privKey, current, 0);
      beef.mergeTransaction(child);

      current = child;
      currentTxid = child.id('hex') as string;
      currentSats = Number(child.outputs[0].satoshis);
    }

    // Final sats: 50_000 - (5 × 50 fee) = 49_750
    expect(currentSats).toBe(49_750);

    // BEEF contains all 6 txs (1 genesis + 5 children)
    expect(beef.txs.length).toBe(6);

    // Structurally valid
    expect(beef.isValid(true)).toBe(true);

    // Can round-trip
    const binary = beef.toBinary();
    const restored = Beef.fromBinary(binary);
    expect(restored.txs.length).toBe(6);
    expect(restored.isValid(true)).toBe(true);
  });

  it('can extract the tip tx from a long chain BEEF for spending', async () => {
    const beef = new Beef();
    let current = buildFundingTx(privKey, [{ satoshis: 20_000 }]);
    beef.mergeTransaction(current);

    for (let i = 0; i < 3; i++) {
      const child = await buildChildTx(privKey, current, 0);
      beef.mergeTransaction(child);
      current = child;
    }

    const tipTxid = current.id('hex') as string;
    const tipTx = beef.findTransactionForSigning(tipTxid);
    expect(tipTx).toBeDefined();

    // Build one more child from the tip
    const nextChild = await buildChildTx(privKey, tipTx!, 0);
    expect(nextChild.id('hex')).toHaveLength(64);
  });
});

describe('AtomicBEEF for per-worker envelopes', () => {
  const privKey = PrivateKey.fromRandom();

  it('produces an AtomicBEEF focused on a single txid', async () => {
    const parent = buildFundingTx(privKey, [{ satoshis: 10_000 }, { satoshis: 10_000 }]);
    const child1 = await buildChildTx(privKey, parent, 0);
    const child2 = await buildChildTx(privKey, parent, 1);

    const beef = new Beef();
    beef.mergeTransaction(parent);
    beef.mergeTransaction(child1);
    beef.mergeTransaction(child2);

    // AtomicBEEF for child1 — should include parent + child1 but not child2
    const child1Txid = child1.id('hex') as string;
    const atomicBytes = beef.toBinaryAtomic(child1Txid);
    expect(atomicBytes.length).toBeGreaterThan(0);

    // The atomic prefix is 0x01010101
    const prefix = (atomicBytes[0] | (atomicBytes[1] << 8) | (atomicBytes[2] << 16) | (atomicBytes[3] << 24)) >>> 0;
    expect(prefix).toBe(0x01010101);
  });
});
