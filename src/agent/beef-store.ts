/**
 * BeefStore — Durable BEEF envelope persistence for DirectBroadcastEngine.
 *
 * Replaces the v1/v2 JSON chaintip snapshots with proper BRC-62 BEEF binary.
 * Each worker maintains a single Beef instance containing:
 *   - The funding parent tx (from pre-split)
 *   - All child txs in the UTXO chain (change-recycling lineage)
 *
 * On persist: serialize Beef → binary → atomic write to disk.
 * On restore: read binary → Beef.fromBinary → extract UTXOs → verify structure.
 *
 * Why this is better than JSON chaintip:
 *   1. BEEF stores each parent tx ONCE (automatic dedupe — no v2 hack needed)
 *   2. Structural validity is verifiable: Beef.isValid() checks dependency order
 *   3. When merkle proofs arrive (mined txs), they merge into the same Beef
 *   4. SPV verification via Beef.verify(chainTracker) proves txs are on-chain
 *   5. AtomicBEEF extraction gives per-handoff envelopes
 *
 * Cross-references:
 *   @bsv/sdk Beef class          — BRC-62/96 BEEF serialization
 *   @bsv/sdk MerklePath          — BRC-10 BUMP proofs
 *   @bsv/sdk ChainTracker        — SPV root verification
 *   semantos-core beef.zig        — Native BEEF verifier (same wire format)
 */

import { Beef, Transaction, MerklePath } from '@bsv/sdk';
import type ChainTracker from '@bsv/sdk/primitives/chaintracker';
import { writeFileSync, readFileSync, existsSync, renameSync } from 'fs';

export interface BeefUtxo {
  txid: string;
  vout: number;
  satoshis: number;
  /** The source Transaction, reconstructed from BEEF with ancestry populated */
  sourceTx: Transaction;
}

export interface BeefStoreConfig {
  /** Path to persist the BEEF binary file */
  filePath: string;
  /** Flush interval in ms. Default 5000. */
  flushIntervalMs?: number;
  /** Optional ChainTracker for SPV verification of mined txs */
  chainTracker?: ChainTracker;
  /** Log function */
  log?: (tag: string, msg: string) => void;
}

export class BeefStore {
  private beef: Beef;
  private filePath: string;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private dirty: boolean = false;
  private chainTracker?: ChainTracker;
  private log: (tag: string, msg: string) => void;

  constructor(config: BeefStoreConfig) {
    this.beef = new Beef();
    this.filePath = config.filePath;
    this.chainTracker = config.chainTracker;
    this.log = config.log ?? ((tag, msg) => console.log(`[${tag}] ${msg}`));

    const interval = config.flushIntervalMs ?? 5000;
    this.flushTimer = setInterval(() => {
      if (this.dirty) {
        try { this.persist(); } catch (err: any) {
          this.log('BEEF-STORE', `Persist failed: ${err.message}`);
        }
      }
    }, interval);

    this.log('BEEF-STORE', `initialized → ${config.filePath} (flush every ${interval}ms)`);
  }

  /**
   * Merge a transaction into the BEEF store.
   * Call after building + signing a tx (before or after broadcast).
   * The tx's sourceTransactions are automatically included.
   */
  mergeTransaction(tx: Transaction): void {
    this.beef.mergeTransaction(tx);
    this.dirty = true;
  }

  /**
   * Check if a txid exists in the BEEF store.
   */
  hasTxid(txid: string): boolean {
    return this.beef.findTxid(txid) !== undefined;
  }

  /**
   * Get a Transaction suitable for signing (with sourceTransactions populated)
   * from the BEEF store.
   */
  getTransactionForSigning(txid: string): Transaction | undefined {
    return this.beef.findTransactionForSigning(txid);
  }

  /**
   * Extract UTXOs from a specific transaction in the BEEF.
   * Returns all outputs as potential UTXOs with the sourceTx populated.
   */
  extractUtxos(txid: string): BeefUtxo[] {
    const tx = this.beef.findTransactionForSigning(txid);
    if (!tx) return [];

    return tx.outputs.map((output, vout) => ({
      txid,
      vout,
      satoshis: Number(output.satoshis),
      sourceTx: tx,
    }));
  }

  /**
   * Verify the BEEF structure is valid.
   * With allowTxidOnly=true, unconfirmed ancestor chains are accepted.
   */
  isStructurallyValid(): boolean {
    return this.beef.isValid(true);
  }

  /**
   * Verify the BEEF with SPV against a ChainTracker.
   * Only succeeds if all root txs in the chain have valid merkle proofs
   * that match confirmed block headers.
   */
  async verifySPV(): Promise<boolean> {
    if (!this.chainTracker) {
      this.log('BEEF-STORE', 'No ChainTracker configured — SPV verification skipped');
      return false;
    }
    try {
      return await this.beef.verify(this.chainTracker, true);
    } catch (err: any) {
      this.log('BEEF-STORE', `SPV verification failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Add a merkle proof for a confirmed transaction.
   * Call when a tx is confirmed and you have the BUMP.
   */
  addMerkleProof(txid: string, merklePath: MerklePath): void {
    const bumpIdx = this.beef.mergeBump(merklePath);
    const beefTx = this.beef.findTxid(txid);
    if (beefTx) {
      beefTx.bumpIndex = bumpIdx;
      this.dirty = true;
    }
  }

  /**
   * Get AtomicBEEF for a specific txid — a minimal BEEF containing only
   * the ancestry chain needed to verify that one tx.
   */
  getAtomicBEEF(txid: string): Uint8Array {
    return new Uint8Array(this.beef.toBinaryAtomic(txid));
  }

  /**
   * Persist the BEEF binary to disk atomically (write tmp + rename).
   */
  persist(): void {
    const binary = Buffer.from(this.beef.toBinary());
    const tmp = this.filePath + '.tmp';
    writeFileSync(tmp, binary);
    renameSync(tmp, this.filePath);
    this.dirty = false;
  }

  /**
   * Restore the BEEF from disk.
   * Returns true if restored successfully with at least one tx.
   */
  restore(): boolean {
    if (!existsSync(this.filePath)) {
      this.log('BEEF-STORE', `No BEEF file at ${this.filePath}`);
      return false;
    }
    try {
      const raw = readFileSync(this.filePath);
      const restored = Beef.fromBinary(new Uint8Array(raw));

      if (restored.txs.length === 0) {
        this.log('BEEF-STORE', 'BEEF file is empty');
        return false;
      }

      if (!restored.isValid(true)) {
        this.log('BEEF-STORE', 'BEEF file failed structural validation');
        return false;
      }

      this.beef = restored;
      this.log('BEEF-STORE', `Restored ${restored.txs.length} txs from BEEF (${raw.length} bytes)`);
      return true;
    } catch (err: any) {
      this.log('BEEF-STORE', `Restore failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Get the raw Beef instance (for advanced operations).
   */
  getBeef(): Beef {
    return this.beef;
  }

  /**
   * Get stats about the store.
   */
  getStats(): { txCount: number; fileSize: number; valid: boolean } {
    let fileSize = 0;
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath);
        fileSize = raw.length;
      }
    } catch {}

    return {
      txCount: this.beef.txs.length,
      fileSize,
      valid: this.beef.isValid(true),
    };
  }

  /**
   * Stop the flush timer and force a final persist.
   */
  shutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirty) {
      try { this.persist(); } catch {}
    }
  }
}
