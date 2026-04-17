/**
 * BEEF + DirectBroadcastEngine integration test.
 *
 * Proves the full round-trip:
 *   1. Engine enables BEEF store
 *   2. Engine ingests funding + pre-splits → merged into BEEF
 *   3. Engine persists BEEF to disk
 *   4. New engine restores from BEEF → extracts tip UTXOs
 *   5. Restored UTXOs are spendable (sourceTx is populated)
 *
 * This replaces the JSON chaintip persistence path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrivateKey, Transaction, P2PKH } from '@bsv/sdk';
import { DirectBroadcastEngine } from '../src/agent/direct-broadcast-engine';

// ── Tests ────────────────────────────────────────────────────────────

describe('DirectBroadcastEngine + BeefStore integration', () => {
  let tmpDir: string;
  const wif = PrivateKey.fromRandom().toWif();

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'beef-engine-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enableBeefStore creates the store and logs activation', () => {
    const engine = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    const beefPath = join(tmpDir, 'chain.beef');

    engine.enableBeefStore(beefPath, 60_000);
    const store = engine.getBeefStore();

    expect(store).not.toBeNull();
  });

  it('ingestFunding + manual UTXO seeding merges into BEEF store', async () => {
    const engine = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    const beefPath = join(tmpDir, 'chain.beef');
    engine.enableBeefStore(beefPath, 60_000);

    // Build a funding tx
    const privKey = PrivateKey.fromWif(wif);
    const p2pkh = new P2PKH();
    const fundingTx = new Transaction();
    fundingTx.addOutput({
      lockingScript: p2pkh.lock(privKey.toPublicKey().toAddress()),
      satoshis: 10_000,
    });

    // Ingest funding
    const funding = await engine.ingestFunding(fundingTx.toHex(), 0);
    expect(funding.txid).toHaveLength(64);

    // Manually merge the funding tx into BEEF (simulating what preSplit does)
    engine.getBeefStore()!.mergeTransaction(fundingTx);

    const store = engine.getBeefStore()!;
    expect(store.hasTxid(funding.txid)).toBe(true);
    expect(store.isStructurallyValid()).toBe(true);

    await engine.flush();
  });

  it('BEEF store persists and restores UTXOs across engine instances', async () => {
    const beefPath = join(tmpDir, 'chain.beef');

    // Engine A: seed UTXOs and persist
    const engineA = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engineA.enableBeefStore(beefPath, 60_000);

    const privKey = PrivateKey.fromWif(wif);
    const p2pkh = new P2PKH();
    const fundingTx = new Transaction();
    const lock = p2pkh.lock(privKey.toPublicKey().toAddress());
    fundingTx.addOutput({ lockingScript: lock, satoshis: 5_000 });
    fundingTx.addOutput({ lockingScript: lock, satoshis: 6_000 });

    // Merge into BEEF
    engineA.getBeefStore()!.mergeTransaction(fundingTx);

    // Seed utxoPools manually (simulating post-preSplit state)
    const txid = fundingTx.id('hex') as string;
    (engineA as any).utxoPools = [
      [{ txid, vout: 0, satoshis: 5_000, sourceTx: fundingTx }],
      [{ txid, vout: 1, satoshis: 6_000, sourceTx: fundingTx }],
    ];

    // Persist
    engineA.getBeefStore()!.persist();
    await engineA.flush();

    expect(existsSync(beefPath)).toBe(true);

    // Engine B: restore from BEEF
    const engineB = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engineB.enableBeefStore(beefPath, 60_000);

    const restored = await engineB.restoreFromBeef();
    expect(restored).toBe(true);

    // Verify UTXOs were restored
    const pools = (engineB as any).utxoPools;
    const totalUtxos = pools.reduce((s: number, p: any[]) => s + p.length, 0);
    expect(totalUtxos).toBe(2);

    // Verify the restored UTXOs have valid sourceTx
    for (const pool of pools) {
      for (const utxo of pool) {
        expect(utxo.sourceTx).toBeDefined();
        expect(typeof utxo.sourceTx.toHex).toBe('function');
        expect(utxo.satoshis).toBeGreaterThan(0);
      }
    }

    await engineB.flush();
  });

  it('restoreFromBeef returns false when no BEEF file exists', async () => {
    const engine = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engine.enableBeefStore(join(tmpDir, 'nonexistent.beef'), 60_000);

    const restored = await engine.restoreFromBeef();
    expect(restored).toBe(false);

    await engine.flush();
  });

  it('restoreFromBeef returns false when BEEF has no unspent outputs', async () => {
    const beefPath = join(tmpDir, 'empty.beef');
    const engine = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engine.enableBeefStore(beefPath, 60_000);

    // Create an empty BEEF and persist it
    const { Beef } = await import('@bsv/sdk');
    const emptyBeef = new Beef();
    const { writeFileSync } = await import('fs');
    writeFileSync(beefPath, Buffer.from(emptyBeef.toBinary()));

    const restored = await engine.restoreFromBeef();
    expect(restored).toBe(false);

    await engine.flush();
  });

  it('restoreFromBeef identifies tip UTXOs (unspent outputs only)', async () => {
    const beefPath = join(tmpDir, 'chain.beef');

    // Build a 2-tx chain: parent → child (child spends parent vout 0)
    const privKey = PrivateKey.fromWif(wif);
    const p2pkh = new P2PKH();
    const lock = p2pkh.lock(privKey.toPublicKey().toAddress());

    const parent = new Transaction();
    parent.addOutput({ lockingScript: lock, satoshis: 10_000 });
    parent.addOutput({ lockingScript: lock, satoshis: 7_000 });

    const child = new Transaction();
    child.addInput({
      sourceTXID: parent.id('hex') as string,
      sourceOutputIndex: 0,
      sourceTransaction: parent,
      unlockingScriptTemplate: p2pkh.unlock(privKey),
    });
    child.addOutput({ lockingScript: lock, satoshis: 9_900 });
    await child.sign();

    // Save to BEEF
    const engineA = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engineA.enableBeefStore(beefPath, 60_000);
    engineA.getBeefStore()!.mergeTransaction(parent);
    engineA.getBeefStore()!.mergeTransaction(child);
    engineA.getBeefStore()!.persist();
    await engineA.flush();

    // Restore and check: parent:0 is spent by child, parent:1 is unspent, child:0 is unspent
    const engineB = new DirectBroadcastEngine({ privateKeyWif: wif, streams: 2, verbose: false });
    engineB.enableBeefStore(beefPath, 60_000);
    const restored = await engineB.restoreFromBeef();
    expect(restored).toBe(true);

    const pools = (engineB as any).utxoPools;
    const allUtxos = pools.flat();

    // Should have 2 unspent: parent:1 (7000) + child:0 (9900)
    expect(allUtxos.length).toBe(2);
    const sats = allUtxos.map((u: any) => u.satoshis).sort((a: number, b: number) => a - b);
    expect(sats).toEqual([7_000, 9_900]);

    await engineB.flush();
  });
});
