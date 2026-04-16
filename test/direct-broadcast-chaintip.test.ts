/**
 * Restart-safety test for DirectBroadcastEngine chain-tip persistence.
 *
 * Regression: before this patch, every container restart re-ingested the
 * fan-out funding vout, which had already been spent by the pre-restart
 * chain, causing every subsequent broadcast to be rejected as "Missing inputs".
 *
 * Fix: engine persists utxoPools snapshot to disk on a timer and on flush();
 * restoreChainTip() reads the snapshot on next boot and skips preSplit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DirectBroadcastEngine } from '../src/agent/direct-broadcast-engine';
import { PrivateKey, Transaction, P2PKH } from '@bsv/sdk';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build a self-signed funding tx with N outputs to the engine's address.
 * This mimics what pre-fund.ts produces on chain — but we don't broadcast
 * it, we just use the hex + the derived txid for in-memory engine setup.
 */
function buildLocalFundingTx(
  privKey: PrivateKey,
  outputs: { satoshis: number }[],
): Transaction {
  // Use a dummy parent UTXO — tests never broadcast this tx, they just need
  // a valid parsed Transaction to seed the engine's utxoPools.
  const tx = new Transaction();
  const p2pkh = new P2PKH();
  const lock = p2pkh.lock(privKey.toPublicKey().toAddress());
  for (const o of outputs) {
    tx.addOutput({ lockingScript: lock, satoshis: o.satoshis });
  }
  // No inputs — that's fine for persistence tests; we never sign or broadcast.
  return tx;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('DirectBroadcastEngine chain-tip persistence', () => {
  let tmpDir: string;
  let chaintipPath: string;
  const wif = PrivateKey.fromRandom().toWif();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'chaintip-test-'));
    chaintipPath = join(tmpDir, 'chaintip.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persistChainTip writes a valid JSON snapshot', async () => {
    const engine = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engine.enableChainTipPersistence(chaintipPath, 10_000); // long interval — we call flush explicitly

    // Seed utxoPools by hand to simulate a running chain
    const fundingTx = buildLocalFundingTx(PrivateKey.fromWif(wif), [{ satoshis: 10_000 }, { satoshis: 10_000 }]);
    // Reach into the private field deliberately — this is a white-box test
    (engine as any).utxoPools = [
      [{ txid: 'a'.repeat(64), vout: 0, satoshis: 10_000, sourceTx: fundingTx }],
      [{ txid: 'b'.repeat(64), vout: 1, satoshis: 10_000, sourceTx: fundingTx }],
    ];
    (engine as any).chainTipDirty = true;

    // Trigger persist via flush() which calls finalizeChainTipPersistence()
    await engine.flush();

    expect(existsSync(chaintipPath)).toBe(true);
    const data = JSON.parse(readFileSync(chaintipPath, 'utf-8'));
    expect(data.streams).toHaveLength(2);
    expect(data.streams[0].utxos).toHaveLength(1);
    expect(data.streams[0].utxos[0].txid).toBe('a'.repeat(64));
    expect(data.streams[0].utxos[0].satoshis).toBe(10_000);
    expect(typeof data.streams[0].utxos[0].sourceTxHex).toBe('string');
    expect(data.streams[0].utxos[0].sourceTxHex.length).toBeGreaterThan(20);
    expect(typeof data.savedAt).toBe('number');
  });

  it('restoreChainTip rehydrates utxoPools from a snapshot', async () => {
    // Producer: build + persist
    const engineA = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engineA.enableChainTipPersistence(chaintipPath, 10_000);
    const fundingTx = buildLocalFundingTx(PrivateKey.fromWif(wif), [{ satoshis: 7_777 }, { satoshis: 8_888 }]);
    (engineA as any).utxoPools = [
      [{ txid: 'c'.repeat(64), vout: 0, satoshis: 7_777, sourceTx: fundingTx }],
      [{ txid: 'd'.repeat(64), vout: 1, satoshis: 8_888, sourceTx: fundingTx }],
    ];
    (engineA as any).chainTipDirty = true;
    await engineA.flush();

    // Consumer: new engine, same WIF, restore
    const engineB = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engineB.enableChainTipPersistence(chaintipPath, 10_000);
    const restored = await engineB.restoreChainTip();
    expect(restored).toBe(true);

    const pools = (engineB as any).utxoPools;
    expect(pools).toHaveLength(2);
    expect(pools[0][0].txid).toBe('c'.repeat(64));
    expect(pools[0][0].satoshis).toBe(7_777);
    expect(pools[1][0].txid).toBe('d'.repeat(64));
    expect(pools[1][0].satoshis).toBe(8_888);
    // sourceTx must be reconstituted as a real Transaction
    expect(typeof pools[0][0].sourceTx.toHex).toBe('function');
    expect(pools[0][0].sourceTx.toHex()).toBe(fundingTx.toHex());

    await engineB.flush(); // clean up timer
  });

  it('restoreChainTip returns false when no snapshot exists', async () => {
    const engine = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engine.enableChainTipPersistence(chaintipPath, 10_000);
    const restored = await engine.restoreChainTip();
    expect(restored).toBe(false);
    await engine.flush();
  });

  it('restoreChainTip returns false when snapshot has no UTXOs', async () => {
    const engine = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engine.enableChainTipPersistence(chaintipPath, 10_000);
    (engine as any).utxoPools = [[], []];
    (engine as any).chainTipDirty = true;
    await engine.flush();

    const engineB = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engineB.enableChainTipPersistence(chaintipPath, 10_000);
    expect(await engineB.restoreChainTip()).toBe(false);
    await engineB.flush();
  });

  it('restoreChainTip survives a corrupt snapshot without crashing', async () => {
    const { writeFileSync } = await import('fs');
    writeFileSync(chaintipPath, '{ not valid json');

    const engine = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engine.enableChainTipPersistence(chaintipPath, 10_000);
    expect(await engine.restoreChainTip()).toBe(false);
    await engine.flush();
  });

  it('flush() without enableChainTipPersistence() is a no-op', async () => {
    const engine = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    const result = await engine.flush();
    expect(result.settled).toBe(0);
    expect(result.errors).toBe(0);
    expect(existsSync(chaintipPath)).toBe(false);
  });
});
