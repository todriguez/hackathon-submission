/**
 * pool-manager.ts — BRC-42 Key Derivation Pool Manager
 *
 * Derives per-container child keys from a master key using BRC-42 (BKDS).
 * Each container gets a deterministic private key via:
 *   childPrivKey = KeyDeriver.derivePrivateKey([2, 'pool manager funding'], `container-${i}`, 'self')
 *
 * The pool manager can:
 *   1. Derive N child keys from a master WIF
 *   2. Create a fan-out funding tx from master → N children
 *   3. Pre-split child funding into micro-UTXOs for high-throughput slamming
 *   4. Build CellToken txs from any child key
 *
 * When Metanet Client on :3321 is healthy, it can also:
 *   5. Use createAction for wallet-managed fan-out with BEEF ancestry
 *   6. Use internalizeAction so children track UTXOs via the wallet
 *
 * Cross-references:
 *   BRC-42  — https://bsv.brc.dev/key-derivation/0042
 *   BRC-100 — https://bsv.brc.dev/wallet/0100
 *   BRC-95  — AtomicBEEF format
 */

import { PrivateKey, KeyDeriver, Transaction, P2PKH, LockingScript } from '@bsv/sdk';

// ── Types ──

export interface ChildKey {
  /** Container index (0-based) */
  index: number;
  /** Derived private key */
  privKey: PrivateKey;
  /** P2PKH address */
  address: string;
  /** P2PKH locking script */
  lockScript: LockingScript;
}

export interface Utxo {
  txid: string;
  vout: number;
  sats: number;
}

export interface PoolManagerConfig {
  /** Master WIF (required) */
  masterWif: string;
  /** Number of children to derive (default: 8) */
  numChildren?: number;
  /** BRC-42 protocol ID (default: [2, 'pool manager funding']) */
  protocolID?: [0 | 1 | 2, string];
  /** Fee rate in sat/byte (default: 0.5) */
  feeRate?: number;
  /** Satoshis per micro-UTXO for slamming (default: 1000) */
  microSats?: number;
  /** MAPI endpoint (default: GorillaPool) */
  mapiUrl?: string;
}

export interface BroadcastResult {
  ok: boolean;
  txid?: string;
  error?: string;
}

// ── Pool Manager ──

export class PoolManager {
  readonly masterKey: PrivateKey;
  readonly masterAddress: string;
  readonly masterLock: LockingScript;
  readonly deriver: KeyDeriver;
  readonly children: ChildKey[];
  readonly p2pkh: P2PKH;
  readonly feeRate: number;
  readonly microSats: number;
  readonly mapiUrl: string;
  readonly protocolID: [0 | 1 | 2, string];

  constructor(config: PoolManagerConfig) {
    this.masterKey = PrivateKey.fromWif(config.masterWif);
    this.deriver = new KeyDeriver(this.masterKey);
    this.p2pkh = new P2PKH();
    this.masterAddress = this.masterKey.toPublicKey().toAddress();
    this.masterLock = this.p2pkh.lock(this.masterAddress);
    this.feeRate = config.feeRate ?? 0.5;
    this.microSats = config.microSats ?? 1000;
    this.mapiUrl = config.mapiUrl ?? 'https://mapi.gorillapool.io/mapi/tx';
    this.protocolID = config.protocolID ?? [2, 'pool manager funding'];

    const n = config.numChildren ?? 8;
    this.children = Array.from({ length: n }, (_, i) => this.deriveChild(i));
  }

  /**
   * Derive a child key at index i.
   * Deterministic: same master + index always produces same key.
   */
  deriveChild(index: number): ChildKey {
    const privKey = this.deriver.derivePrivateKey(
      this.protocolID,
      `container-${index}`,
      'self',
    );
    const address = privKey.toPublicKey().toAddress();
    return {
      index,
      privKey,
      address,
      lockScript: this.p2pkh.lock(address),
    };
  }

  /**
   * Build a fan-out transaction from master UTXOs to N child addresses.
   * Returns the signed tx hex and the per-child UTXO info.
   */
  async buildFanOut(
    masterUtxos: Utxo[],
    satsPerChild: number,
    childIndices?: number[],
  ): Promise<{
    txHex: string;
    txid: string;
    childUtxos: Map<number, Utxo>;
    fee: number;
  }> {
    const targets = childIndices ?? this.children.map(c => c.index);
    const totalNeeded = satsPerChild * targets.length;

    const tx = new Transaction();
    let inputTotal = 0;

    // Add inputs until we have enough
    for (const u of masterUtxos) {
      tx.addInput({
        sourceTXID: u.txid,
        sourceOutputIndex: u.vout,
        unlockingScriptTemplate: this.p2pkh.unlock(
          this.masterKey, 'all', false, u.sats, this.masterLock,
        ),
      });
      inputTotal += u.sats;
      if (inputTotal >= totalNeeded + 10000) break; // rough fee buffer
    }

    // Add outputs for each target child
    const childUtxos = new Map<number, Utxo>();
    let outputTotal = 0;
    let vout = 0;

    for (const idx of targets) {
      const child = this.children[idx];
      tx.addOutput({ lockingScript: child.lockScript, satoshis: satsPerChild });
      outputTotal += satsPerChild;
      // txid will be set after signing
      childUtxos.set(idx, { txid: '', vout, sats: satsPerChild });
      vout++;
    }

    // Change back to master
    const estSize = 180 * masterUtxos.length + 34 * (targets.length + 1) + 10;
    const fee = Math.max(Math.ceil(estSize * this.feeRate), 200);
    const change = inputTotal - outputTotal - fee;
    if (change >= 546) {
      tx.addOutput({ lockingScript: this.masterLock, satoshis: change });
    }

    await tx.sign();
    const txHex = tx.toHex();
    const txid = tx.id('hex') as string;

    // Fix up txids in child UTXOs
    for (const [idx, utxo] of childUtxos) {
      utxo.txid = txid;
    }

    return { txHex, txid, childUtxos, fee };
  }

  /**
   * Build a pre-split transaction for a child: one big UTXO → many micro-UTXOs.
   */
  async buildPreSplit(
    child: ChildKey,
    utxo: Utxo,
    numOutputs: number,
  ): Promise<{
    txHex: string;
    txid: string;
    microUtxos: Utxo[];
    fee: number;
  }> {
    const tx = new Transaction();
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: this.p2pkh.unlock(
        child.privKey, 'all', false, utxo.sats, child.lockScript,
      ),
    });

    const microUtxos: Utxo[] = [];
    let outputTotal = 0;

    for (let j = 0; j < numOutputs; j++) {
      tx.addOutput({ lockingScript: child.lockScript, satoshis: this.microSats });
      outputTotal += this.microSats;
      microUtxos.push({ txid: '', vout: j, sats: this.microSats });
    }

    const estSize = 180 + numOutputs * 34 + 10;
    const fee = Math.max(Math.ceil(estSize * this.feeRate), 200);
    const change = utxo.sats - outputTotal - fee;
    if (change >= 546) {
      tx.addOutput({ lockingScript: child.lockScript, satoshis: change });
      microUtxos.push({ txid: '', vout: numOutputs, sats: change });
    }

    await tx.sign();
    const txHex = tx.toHex();
    const txid = tx.id('hex') as string;

    for (const mu of microUtxos) mu.txid = txid;

    return { txHex, txid, microUtxos, fee };
  }

  /**
   * Build a CellToken transaction from a child's UTXO.
   * Returns signed tx ready for MAPI broadcast.
   */
  async buildCellToken(
    child: ChildKey,
    utxo: Utxo,
    seqNum: number,
    extraData?: Record<string, unknown>,
  ): Promise<{
    txHex: string;
    txid: string;
    fee: number;
    change: number;
  }> {
    const tx = new Transaction();
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: this.p2pkh.unlock(
        child.privKey, 'all', false, utxo.sats, child.lockScript,
      ),
    });

    const payload = Array.from(new TextEncoder().encode(JSON.stringify({
      t: 'cell',
      c: child.index,
      n: seqNum,
      ts: Date.now(),
      ...extraData,
    })));

    tx.addOutput({
      lockingScript: new LockingScript([
        { op: 0 }, { op: 0x6a },
        payload.length <= 75
          ? { op: payload.length, data: payload }
          : { op: 0x4c, data: payload },
      ]),
      satoshis: 0,
    });

    const fee = Math.max(Math.ceil(220 * this.feeRate), 110);
    const change = utxo.sats - fee;
    if (change >= 546) {
      tx.addOutput({ lockingScript: child.lockScript, satoshis: change });
    }

    await tx.sign();
    return {
      txHex: tx.toHex(),
      txid: tx.id('hex') as string,
      fee,
      change: change >= 546 ? change : 0,
    };
  }

  /**
   * Broadcast a raw tx hex via MAPI with retry.
   */
  async broadcastMAPI(txHex: string): Promise<BroadcastResult> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(this.mapiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawtx: txHex }),
        });
        if (resp.status === 429) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        const raw = await resp.text();
        try {
          const outer = JSON.parse(raw);
          const inner = JSON.parse(outer.payload);
          const ok = inner.returnResult === 'success'
            || (inner.resultDescription || '').includes('already known');
          return { ok, txid: inner.txid, error: ok ? undefined : inner.resultDescription };
        } catch {
          return { ok: resp.ok, error: raw.slice(0, 200) };
        }
      } catch (err: any) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 200)); continue; }
        return { ok: false, error: err.message };
      }
    }
    return { ok: false, error: '429 after 3 retries' };
  }

  /**
   * Discover unspent UTXOs for an address via Bitails (paginated).
   */
  async discoverUtxos(address: string, minSats: number = 500): Promise<Utxo[]> {
    const all: Utxo[] = [];
    let from = 0;
    const LIMIT = 10000;
    while (true) {
      const resp = await fetch(
        `https://api.bitails.io/address/${address}/unspent?limit=${LIMIT}&from=${from}`,
      );
      if (!resp.ok) throw new Error(`Bitails HTTP ${resp.status}`);
      const data: any = await resp.json();
      const utxos = data.unspent ?? data;
      if (!Array.isArray(utxos) || utxos.length === 0) break;
      for (const u of utxos) {
        const sats = u.value ?? u.satoshis;
        if (sats >= minSats) {
          all.push({ txid: u.tx_hash ?? u.txid, vout: u.tx_pos ?? u.vout, sats });
        }
      }
      if (utxos.length < LIMIT) break;
      from += LIMIT;
    }
    return all;
  }
}
