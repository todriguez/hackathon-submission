/**
 * DirectBroadcastEngine — Bypass the wallet for raw BSV throughput.
 *
 * The metanet-desktop wallet's createAction endpoint averages ~7.7 seconds per call,
 * capping throughput at ~0.13 tx/sec. For the hackathon target of 1.5M txs/24h (17 tx/sec),
 * we need to construct and broadcast transactions entirely in-process.
 *
 * Architecture:
 *   1. Generate a fresh BSV keypair locally
 *   2. User sends a single funding tx to the generated address
 *   3. Pre-split that UTXO into hundreds of small funding UTXOs (fan-out tx)
 *   4. Each parallel stream consumes its own pre-split UTXO pool
 *   5. CellToken txs built with @bsv/sdk, signed with local PrivateKey
 *   6. Broadcast via ARC (GorillaPool — no API key, ~3000 tx/sec capacity)
 *
 * Result: ~5 tx/sec per stream × 4 streams = 20 tx/sec = 1.73M txs/day
 *
 * Cross-references:
 *   scripts/anchor-demo.ts           — canonical BEEF/CellToken pattern
 *   protocol-types/src/cell-token.ts — BRC-48 PushDrop scripts
 *   @bsv/sdk ARC broadcaster        — direct transaction broadcast
 */

import {
  PrivateKey,
  PublicKey,
  Transaction,
  P2PKH,
  ARC,
  Hash,
  Signature,
  TransactionSignature,
  LockingScript,
} from '@bsv/sdk';
import { CellToken } from '../protocol/cell-token';
import { CellStore } from '../protocol/cell-store';
import { MemoryAdapter } from '../protocol/adapters/memory-adapter';
import { Linearity } from '../protocol/constants';
import { createHash } from 'crypto';
import { appendFileSync, writeFileSync, existsSync } from 'fs';

// ── Types ──

export interface FundingUtxo {
  txid: string;
  vout: number;
  satoshis: number;
  /** The source transaction (needed for signing) */
  sourceTx: Transaction;
}

export interface DirectBroadcastConfig {
  /** ARC endpoint. Default: GorillaPool (no API key). */
  arcUrl?: string;
  /** ARC API key (optional — GorillaPool doesn't need one) */
  arcApiKey?: string;
  /** Number of parallel streams to run */
  streams?: number;
  /** Satoshis per CellToken output. Default: 1 */
  cellSatoshis?: number;
  /** Satoshis per funding UTXO split. Default: 500 (enough for several CellToken txs with fee recycling) */
  splitSatoshis?: number;
  /** Log verbosity */
  verbose?: boolean;
  /**
   * Fire-and-forget mode: don't await ARC broadcast confirmation.
   * The tx is built, signed, and the broadcast is kicked off in the background.
   * The return value uses the locally-computed txid (no round-trip).
   * This overlaps broadcast latency with agent thinking time.
   * Default: false (await broadcast for reliability).
   */
  fireAndForget?: boolean;
  /**
   * Fee rate in sats/byte. TAAL policy: 0.1 (100 sats/KB).
   * GorillaPool: ~0.05 sats/byte (50 sats/KB).
   * Default: 0.1
   */
  feeRate?: number;
  /**
   * Minimum fee floor in sats. ARC typically accepts >= 1 sat fees
   * for small txs but some miners require higher.
   * Default: 25
   */
  minFee?: number;
}

export interface BroadcastResult {
  txid: string;
  /** ms elapsed for broadcast */
  broadcastMs: number;
  /** ms elapsed for tx construction */
  buildMs: number;
  /** The signed transaction object (for chaining into next transition without re-fetching) */
  tx: import('@bsv/sdk').Transaction;
}

export interface StreamStats {
  streamId: number;
  txCount: number;
  totalMs: number;
  avgMs: number;
  txPerSec: number;
}

// ── Constants ──

// NOTE: @bsv/sdk ARC class appends /v1/tx to this URL, so do NOT include /v1 here
const DEFAULT_ARC_URL = 'https://arc.gorillapool.io';
const POKER_HAND_TYPE_HASH = createHash('sha256').update('semantos/poker/hand-state/v1').digest();
// Fee constants — now configurable via DirectBroadcastConfig.feeRate / minFee.
// Defaults: TAAL policy is 100 sats/KB = 0.1 sats/byte.
const DEFAULT_FEE_RATE = 0.1; // sats per byte (TAAL: 100 sats/KB)
const DEFAULT_MIN_FEE = 135;  // absolute floor in sats (CellToken txs are ~1,345 bytes at 0.1 sat/byte)

// ── Engine ──

export class DirectBroadcastEngine {
  /** The engine's local private key — all CellTokens are signed with this */
  private privateKey: PrivateKey;
  private publicKey: PublicKey;
  private arc: ARC;
  private config: Required<DirectBroadcastConfig>;

  /** Pool of pre-split funding UTXOs, partitioned by stream */
  private utxoPools: FundingUtxo[][] = [];

  /** Stats */
  private totalBroadcast: number = 0;
  private totalBuildMs: number = 0;
  private totalBroadcastMs: number = 0;
  private errors: string[] = [];
  /** Background broadcast promises (fire-and-forget mode) */
  private pendingBroadcasts: Promise<void>[] = [];
  /** Append-only CSV audit log path (null = no logging) */
  private auditLogPath: string | null = null;
  /** Batch queue for burst broadcasting */
  private batchQueue: Transaction[] = [];
  private batchFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_SIZE = 20;       // txs per batch POST
  private readonly BATCH_FLUSH_MS = 100;  // max wait before flushing partial batch

  constructor(config?: DirectBroadcastConfig & {
    /** Optional: derive keypair from seed instead of random. All engines with same seed share the same address. */
    keySeed?: string;
    /** Optional: provide an explicit private key (WIF or hex) */
    privateKeyWif?: string;
  }) {
    this.config = {
      arcUrl: config?.arcUrl ?? DEFAULT_ARC_URL,
      arcApiKey: config?.arcApiKey ?? '',
      streams: config?.streams ?? 4,
      cellSatoshis: config?.cellSatoshis ?? 1,
      splitSatoshis: config?.splitSatoshis ?? 500,
      verbose: config?.verbose ?? true,
      fireAndForget: config?.fireAndForget ?? false,
      feeRate: config?.feeRate ?? DEFAULT_FEE_RATE,
      minFee: config?.minFee ?? DEFAULT_MIN_FEE,
    };

    // Key derivation: seed > WIF > random
    if (config?.keySeed) {
      const seedHash = createHash('sha256').update(config.keySeed).digest('hex');
      this.privateKey = PrivateKey.fromString(seedHash.slice(0, 64), 'hex');
    } else if (config?.privateKeyWif) {
      this.privateKey = PrivateKey.fromWif(config.privateKeyWif);
    } else {
      this.privateKey = PrivateKey.fromRandom();
    }
    this.publicKey = this.privateKey.toPublicKey();

    // Set up ARC broadcaster
    this.arc = this.config.arcApiKey
      ? new ARC(this.config.arcUrl, this.config.arcApiKey)
      : new ARC(this.config.arcUrl);
  }

  // ── Audit Log ──

  /**
   * Enable CSV audit logging of every txid. Creates/appends to a CSV file.
   * Format: txid,type,satoshis,fee,bytes,timestamp
   * Call once after construction.
   */
  enableAuditLog(filePath: string): void {
    this.auditLogPath = filePath;
    if (!existsSync(filePath)) {
      writeFileSync(filePath, 'txid,type,sats_in,fee_sats,est_bytes,timestamp\n');
    }
  }

  /** Append a row to the audit CSV */
  private logTxid(txid: string, type: string, satsIn: number, fee: number, estBytes: number): void {
    if (!this.auditLogPath) return;
    const row = `${txid},${type},${satsIn},${fee},${estBytes},${Date.now()}\n`;
    try { appendFileSync(this.auditLogPath, row); } catch {}
  }

  // ── Public API ──

  /** Get the funding address (P2PKH) for the engine's keypair */
  getFundingAddress(): string {
    return this.publicKey.toAddress();
  }

  /** Get the public key hex */
  getPubKeyHex(): string {
    return this.publicKey.toString();
  }

  /** Get the private key WIF (for debugging) */
  getPrivateKeyWIF(): string {
    return this.privateKey.toWif();
  }

  /**
   * Consume N UTXOs from a stream's pool for custom tx building (e.g. channel funding).
   * Returns the UTXOs removed from the pool. Caller is responsible for spending them.
   */
  consumeUtxos(streamId: number, count: number): FundingUtxo[] {
    const pool = this.utxoPools[streamId];
    if (!pool || pool.length < count) {
      throw new Error(`Stream ${streamId}: need ${count} UTXOs, only ${pool?.length ?? 0} available`);
    }
    return pool.splice(0, count);
  }

  /**
   * Return unspent UTXOs back to a stream's pool (e.g. if channel funding fails).
   */
  returnUtxos(streamId: number, utxos: FundingUtxo[]): void {
    const pool = this.utxoPools[streamId];
    if (pool) {
      pool.push(...utxos);
    }
  }

  /**
   * Wait for the funding tx and ingest it.
   * Polls WhatsOnChain for UTXOs at the funding address.
   */
  async waitForFunding(timeoutMs: number = 300_000): Promise<FundingUtxo> {
    const address = this.getFundingAddress();
    this.log('FUND', `Waiting for funding at: ${address}`);
    this.log('FUND', `Send BSV to this address, then press enter or wait...`);

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(
          `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
        );
        if (resp.ok) {
          const utxos: any[] = await resp.json();
          if (utxos.length > 0) {
            // Get the largest UTXO
            const best = utxos.sort((a, b) => b.value - a.value)[0];
            this.log('FUND', `Found UTXO: ${best.tx_hash}:${best.tx_pos} (${best.value} sats)`);

            // Fetch the full tx for signing
            const txResp = await fetch(
              `https://api.whatsonchain.com/v1/bsv/main/tx/${best.tx_hash}/hex`,
            );
            const txHex = await txResp.text();
            const sourceTx = Transaction.fromHex(txHex);

            return {
              txid: best.tx_hash,
              vout: best.tx_pos,
              satoshis: best.value,
              sourceTx,
            };
          }
        }
      } catch (err: any) {
        this.log('FUND', `Poll error: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error('Funding timeout — no UTXO received');
  }

  /**
   * Ingest a funding UTXO directly (if you already have it).
   * Provide the raw tx hex and the vout index.
   */
  async ingestFunding(txHex: string, vout: number): Promise<FundingUtxo> {
    const sourceTx = Transaction.fromHex(txHex);
    const txid = sourceTx.id('hex') as string;
    const satoshis = Number(sourceTx.outputs[vout].satoshis);

    this.log('FUND', `Ingested: ${txid}:${vout} (${satoshis} sats)`);
    return { txid, vout, satoshis, sourceTx };
  }

  /**
   * Pre-split a single large UTXO into many small UTXOs for parallel streams.
   * Creates one fan-out transaction with N outputs, each with `splitSatoshis` sats.
   *
   * @param funding The funding UTXO to split
   * @param count   Number of splits (default: auto-calculate from funding amount)
   * @returns       The split txid and number of outputs created
   */
  async preSplit(funding: FundingUtxo, count?: number): Promise<{ txid: string; splits: number }> {
    const INPUT_SIZE = 148;
    const OUTPUT_SIZE = 34;
    const OVERHEAD = 10;
    const feeRate = this.config.feeRate;

    const estimateFee = (numOutputs: number) =>
      Math.max(this.config.minFee, Math.ceil((OVERHEAD + INPUT_SIZE + OUTPUT_SIZE * (numOutputs + 1)) * feeRate));

    const maxSplitsByFee = Math.floor(
      (funding.satoshis - estimateFee(1)) / (this.config.splitSatoshis + Math.ceil(OUTPUT_SIZE * feeRate)),
    );
    const splits = count
      ? Math.min(count, maxSplitsByFee)
      : Math.min(maxSplitsByFee, this.config.streams * 200);

    if (splits < this.config.streams) {
      const minSats = this.config.streams * this.config.splitSatoshis + estimateFee(this.config.streams);
      throw new Error(`Not enough funding for ${this.config.streams} streams. Need at least ${minSats} sats, got ${funding.satoshis}.`);
    }

    const fee = estimateFee(splits);
    this.log('SPLIT', `Splitting ${funding.txid.slice(0, 16)}... into ${splits} × ${this.config.splitSatoshis} sats (est fee: ${fee} sats)`);

    const p2pkh = new P2PKH();
    const lockingScript = p2pkh.lock(this.publicKey.toAddress());

    const tx = new Transaction();

    // Input: the funding UTXO
    tx.addInput({
      sourceTXID: funding.txid,
      sourceOutputIndex: funding.vout,
      sourceTransaction: funding.sourceTx,
      unlockingScriptTemplate: p2pkh.unlock(this.privateKey),
    });

    // Outputs: N × splitSatoshis
    for (let i = 0; i < splits; i++) {
      tx.addOutput({
        lockingScript,
        satoshis: this.config.splitSatoshis,
      });
    }

    // Change output (anything leftover after splits + fee)
    const totalOut = splits * this.config.splitSatoshis;
    const change = funding.satoshis - totalOut - fee;
    if (change > 546) {
      tx.addOutput({
        lockingScript,
        satoshis: change,
      });
    }

    // Sign and broadcast
    await tx.sign();

    const txHex = tx.toHex();
    this.log('SPLIT', `Tx size: ${txHex.length / 2} bytes, actual fee: ${funding.satoshis - totalOut - (change > 546 ? change : 0)} sats`);

    let arcOk = false;
    try {
      const result = await tx.broadcast(this.arc);
      if ('status' in result && result.status === 'error') {
        const fail = result as any;
        this.log('SPLIT', `ARC error (will retry via WoC): code=${fail.code} desc=${fail.description}`);
      } else {
        arcOk = true;
      }
    } catch (arcErr: any) {
      this.log('SPLIT', `ARC broadcast exception (will retry via WoC): ${arcErr.message}`);
    }

    const txid = tx.id('hex') as string;

    // Always try WoC as backup/primary
    const wocOk = await this.wocBroadcast(txHex);
    this.log('SPLIT', `WoC broadcast: ${wocOk ? 'OK' : 'FAILED'}`);

    if (!arcOk && !wocOk) {
      // Last resort: check if tx is already on-chain (from a previous run)
      try {
        const checkResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}`);
        if (checkResp.ok) {
          this.log('SPLIT', `Tx ${txid.slice(0, 16)}... already on-chain — proceeding`);
        } else {
          throw new Error(`Split broadcast failed on both ARC and WoC. txid=${txid}`);
        }
      } catch (checkErr: any) {
        if (checkErr.message.includes('Split broadcast failed')) throw checkErr;
        throw new Error(`Split broadcast failed on both ARC and WoC. txid=${txid}`);
      }
    }

    // Verify tx is visible (wait up to 10s)
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const check = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`);
        if (check.ok && (await check.text()).length > 100) {
          this.log('SPLIT', `✓ Confirmed visible on-chain: ${txid}`);
          break;
        }
      } catch {}
      this.log('SPLIT', `Waiting for tx propagation... (attempt ${attempt + 1}/5)`);
      await new Promise(r => setTimeout(r, 2000));
    }

    this.logTxid(txid, 'split', funding.satoshis, fee, txHex.length / 2);
    this.log('SPLIT', `✓ Fan-out tx: ${txid} (${splits} outputs)`);
    this.log('SPLIT', `  https://whatsonchain.com/tx/${txid}`);

    // Partition UTXOs across streams
    this.utxoPools = Array.from({ length: this.config.streams }, () => []);
    for (let i = 0; i < splits; i++) {
      const streamIdx = i % this.config.streams;
      this.utxoPools[streamIdx].push({
        txid,
        vout: i,
        satoshis: this.config.splitSatoshis,
        sourceTx: tx,
      });
    }

    this.log('SPLIT', `Partitioned: ${this.utxoPools.map((p, i) => `stream${i}=${p.length}`).join(', ')}`);

    return { txid, splits };
  }

  /**
   * Discover existing UTXOs from WoC and distribute them directly to stream pools.
   * Use this when the address already has many small UTXOs (e.g. from a previous run).
   * Skips pre-split entirely — just fetches and partitions what's already on-chain.
   */
  async discoverUtxos(partitionIndex?: number, totalPartitions?: number): Promise<{ count: number; totalSats: number }> {
    const address = this.getFundingAddress();
    this.log('DISCOVER', `Fetching UTXOs for ${address}...`);

    const resp = await fetch(
      `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`,
    );
    if (!resp.ok) throw new Error(`WoC returned ${resp.status}`);

    const utxos: any[] = await resp.json();
    if (utxos.length === 0) throw new Error('No UTXOs found on-chain');

    // Filter out dust that can't cover a CellToken fee
    const MIN_USEFUL = this.config.minFee + 2;
    let usable = utxos.filter(u => u.value >= MIN_USEFUL);

    // If partitioned, take only our slice (deterministic split by index)
    if (partitionIndex !== undefined && totalPartitions !== undefined && totalPartitions > 1) {
      usable = usable.filter((_, i) => i % totalPartitions === partitionIndex);
      this.log('DISCOVER', `Partition ${partitionIndex}/${totalPartitions}: taking ${usable.length} of ${utxos.length} UTXOs`);
    }
    const totalSats = usable.reduce((s, u) => s + u.value, 0);

    this.log('DISCOVER', `Found ${usable.length} usable UTXOs (${totalSats.toLocaleString()} sats), discarded ${utxos.length - usable.length} dust`);

    // Fetch unique source txs (many UTXOs share the same parent tx)
    const uniqueTxids = [...new Set(usable.map(u => u.tx_hash))];
    this.log('DISCOVER', `Need ${uniqueTxids.length} unique source txs for ${usable.length} UTXOs`);

    const txCache = new Map<string, Transaction>();
    const BATCH = 3;
    for (let i = 0; i < uniqueTxids.length; i += BATCH) {
      const chunk = uniqueTxids.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        chunk.map(async (txid) => {
          const txResp = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`);
          if (!txResp.ok) throw new Error(`WoC ${txResp.status} for ${txid}`);
          const hex = await txResp.text();
          return { txid, tx: Transaction.fromHex(hex) };
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') txCache.set(r.value.txid, r.value.tx);
      }
      if (i + BATCH < uniqueTxids.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    this.log('DISCOVER', `Fetched ${txCache.size}/${uniqueTxids.length} source txs`);

    // Build funding UTXOs from cache
    const fundingUtxos: FundingUtxo[] = [];
    for (const u of usable) {
      const sourceTx = txCache.get(u.tx_hash);
      if (sourceTx) {
        fundingUtxos.push({
          txid: u.tx_hash as string,
          vout: u.tx_pos as number,
          satoshis: u.value as number,
          sourceTx,
        });
      }
    }

    // Partition across streams
    this.utxoPools = Array.from({ length: this.config.streams }, () => []);
    for (let i = 0; i < fundingUtxos.length; i++) {
      this.utxoPools[i % this.config.streams].push(fundingUtxos[i]);
    }

    this.log('DISCOVER', `Partitioned ${fundingUtxos.length} UTXOs: ${this.utxoPools.map((p, i) => `stream${i}=${p.length}`).join(', ')}`);
    return { count: fundingUtxos.length, totalSats };
  }

  /**
   * Build and broadcast a CellToken creation tx using a local UTXO.
   * No wallet involved — everything is local + ARC.
   *
   * @param streamId  Which stream's UTXO pool to use
   * @param cellBytes The 1024-byte cell
   * @param semanticPath  The semantic path
   * @param contentHash   32-byte content hash
   * @returns BroadcastResult with txid and timing
   */
  async createCellToken(
    streamId: number,
    cellBytes: Uint8Array,
    semanticPath: string,
    contentHash: Uint8Array,
  ): Promise<BroadcastResult> {
    const pool = this.utxoPools[streamId];
    const funding = this.pickFundingUtxo(pool, streamId, 'create');
    const t0 = Date.now();

    // Build CellToken locking script (BRC-48 PushDrop)
    const cellLockingScript = CellToken.createOutputScript(
      cellBytes, semanticPath, contentHash, this.publicKey,
    );

    const p2pkh = new P2PKH();
    const tx = new Transaction();

    // Input: funding UTXO
    tx.addInput({
      sourceTXID: funding.txid,
      sourceOutputIndex: funding.vout,
      sourceTransaction: funding.sourceTx,
      unlockingScriptTemplate: p2pkh.unlock(this.privateKey),
    });

    // Output 0: CellToken (1 sat)
    tx.addOutput({
      lockingScript: cellLockingScript,
      satoshis: this.config.cellSatoshis,
    });

    // Output 1: Change back to pool (recycle the UTXO)
    // CellToken locking script ≈ 1,142 bytes (256 header + 768 payload + ~40 path + 32 hash + 34 pubkey + opcodes)
    // CellToken output = 8 (value) + 3 (varint) + 1,142 (script) ≈ 1,153 bytes
    // Total: 10 (overhead) + 148 (P2PKH input) + 1,153 (CellToken output) + 34 (P2PKH change) ≈ 1,345 bytes
    const changeLock = p2pkh.lock(this.publicKey.toAddress());
    const estTxBytes = 10 + 148 + 1153 + 34; // overhead + P2PKH input + CellToken output + P2PKH change
    const fee = Math.max(this.config.minFee, Math.ceil(estTxBytes * this.config.feeRate));
    const change = funding.satoshis - this.config.cellSatoshis - fee;
    if (change > 0) {
      tx.addOutput({
        lockingScript: changeLock,
        satoshis: change,
      });
    }

    await tx.sign();
    const buildMs = Date.now() - t0;

    const txid = tx.id('hex') as string;
    this.logTxid(txid, 'celltoken', funding.satoshis, fee, estTxBytes);
    const { broadcastMs } = await this.broadcastTx(tx, 'CellToken');

    // Recycle change output back into the pool
    if (change > 0) {
      pool.push({
        txid,
        vout: 1, // change is always vout 1
        satoshis: change,
        sourceTx: tx,
      });
    }

    this.totalBuildMs += buildMs;

    return { txid, buildMs, broadcastMs, tx };
  }

  /**
   * Build and broadcast a CellToken state transition tx.
   * Spends the previous CellToken and creates a new one.
   *
   * @param streamId      Which stream's UTXO pool to use for fee funding
   * @param prevCellTxid  Previous CellToken txid
   * @param prevCellVout  Previous CellToken vout
   * @param prevCellTx    Previous CellToken source transaction
   * @param newCellBytes  New 1024-byte cell
   * @param semanticPath  Semantic path
   * @param contentHash   32-byte content hash
   * @returns BroadcastResult
   */
  async transitionCellToken(
    streamId: number,
    prevCellTxid: string,
    prevCellVout: number,
    prevCellTx: Transaction,
    newCellBytes: Uint8Array,
    semanticPath: string,
    contentHash: Uint8Array,
    /**
     * Optional nSequence for input 0 (the PushDrop-locked previous CellToken).
     * Caller can pass the previous cell's state version so the Bitcoin tx is
     * self-describing at the input level ("this tx replaces state vN-1").
     * Must be < 0xFFFFFFFF (0xFFFFFFFF is the "final / nLockTime ignored" marker).
     * Omit or pass undefined to get SDK default (0xFFFFFFFF).
     */
    prevStateSequence?: number,
  ): Promise<BroadcastResult> {
    // Need a funding UTXO to pay the miner fee (CellToken is only 1 sat)
    const pool = this.utxoPools[streamId];
    const funding = this.pickFundingUtxo(pool, streamId, 'transition');

    const t0 = Date.now();

    // Build new CellToken locking script
    const newLockingScript = CellToken.createOutputScript(
      newCellBytes, semanticPath, contentHash, this.publicKey,
    );

    // For PushDrop inputs, we need custom signing
    const signatureScope = TransactionSignature.SIGHASH_FORKID | TransactionSignature.SIGHASH_ALL;

    const p2pkh = new P2PKH();
    const tx = new Transaction();

    // Input 0: spend previous CellToken (PushDrop unlock)
    // Optional nSequence encodes the previous state version being replaced.
    const clampedPrevSeq =
      typeof prevStateSequence === 'number'
        ? Math.max(0, Math.min(prevStateSequence, 0xFFFFFFFE))
        : undefined;
    tx.addInput({
      sourceTXID: prevCellTxid,
      sourceOutputIndex: prevCellVout,
      sourceTransaction: prevCellTx,
      ...(clampedPrevSeq !== undefined ? { sequence: clampedPrevSeq } : {}),
      unlockingScriptTemplate: {
        sign: async (tx: Transaction, inputIndex: number): Promise<any> => {
          // Compute sighash
          const preimage = tx.preimage(inputIndex, signatureScope);
          const preimageHash = Hash.sha256(preimage);

          // Sign with local key
          const sig = this.privateKey.sign(preimageHash);
          const txSig = new TransactionSignature(sig.r, sig.s, signatureScope);
          const sigForScript = txSig.toChecksigFormat();

          // Build minimal unlocking script: PUSH <sig>
          const chunks = [
            sigForScript.length <= 75
              ? { op: sigForScript.length, data: Array.from(sigForScript) }
              : { op: 0x4c, data: Array.from(sigForScript) },
          ];
          const { UnlockingScript: US } = await import('@bsv/sdk');
          return new US(chunks);
        },
        estimateLength: async (): Promise<number> => 73,
      },
    });

    // Input 1: funding UTXO to pay miner fee
    tx.addInput({
      sourceTXID: funding.txid,
      sourceOutputIndex: funding.vout,
      sourceTransaction: funding.sourceTx,
      unlockingScriptTemplate: p2pkh.unlock(this.privateKey),
    });

    // Output 0: new CellToken (1 sat)
    tx.addOutput({
      lockingScript: newLockingScript,
      satoshis: this.config.cellSatoshis,
    });

    // Output 1: change from funding UTXO back to pool
    // Transition: 10 (overhead) + 114 (CellToken input, ~73b sig) + 148 (P2PKH input)
    //           + 1,153 (CellToken output) + 34 (P2PKH change) ≈ 1,459 bytes
    const estTransitionBytes = 10 + 114 + 148 + 1153 + 34;
    const fee = Math.max(this.config.minFee, Math.ceil(estTransitionBytes * this.config.feeRate));
    const totalIn = Number(prevCellTx.outputs[prevCellVout].satoshis) + funding.satoshis;
    const change = totalIn - this.config.cellSatoshis - fee;
    if (change > 0) {
      tx.addOutput({
        lockingScript: p2pkh.lock(this.publicKey.toAddress()),
        satoshis: change,
      });
    }

    await tx.sign();
    const buildMs = Date.now() - t0;

    const txid = tx.id('hex') as string;
    this.logTxid(txid, 'transition', totalIn, fee, estTransitionBytes);
    const { broadcastMs } = await this.broadcastTx(tx, 'Transition');

    // Recycle change output back into the pool
    if (change > 0) {
      pool.push({
        txid,
        vout: 1, // change is output index 1 (after CellToken at index 0)
        satoshis: change,
        sourceTx: tx,
      });
    }

    this.totalBuildMs += buildMs;

    return { txid, buildMs, broadcastMs, tx };
  }

  /**
   * Build and broadcast a standalone OP_RETURN tx.
   *
   * @param streamId Which stream's UTXO pool to use
   * @param payload  String payload for the OP_RETURN
   * @returns BroadcastResult
   */
  async anchorOpReturn(streamId: number, payload: string): Promise<BroadcastResult> {
    const pool = this.utxoPools[streamId];
    const funding = this.pickFundingUtxo(pool, streamId, 'opreturn');
    const t0 = Date.now();

    // Build OP_RETURN script
    const payloadBytes = Array.from(new TextEncoder().encode(payload));
    const opReturnScript = new LockingScript([
      { op: 0 },       // OP_FALSE
      { op: 0x6a },    // OP_RETURN
      payloadBytes.length <= 75
        ? { op: payloadBytes.length, data: payloadBytes }
        : payloadBytes.length <= 255
          ? { op: 0x4c, data: payloadBytes }
          : { op: 0x4d, data: payloadBytes },
    ]);

    const p2pkh = new P2PKH();
    const tx = new Transaction();

    // Input
    tx.addInput({
      sourceTXID: funding.txid,
      sourceOutputIndex: funding.vout,
      sourceTransaction: funding.sourceTx,
      unlockingScriptTemplate: p2pkh.unlock(this.privateKey),
    });

    // Output 0: OP_RETURN (0 sats)
    tx.addOutput({
      lockingScript: opReturnScript,
      satoshis: 0,
    });

    // Output 1: Change
    const changeLock = p2pkh.lock(this.publicKey.toAddress());
    const estTxSize = 10 + 148 + (payloadBytes.length + 3 + 9) + (25 + 9); // overhead + input + opreturn out + change out
    const fee = Math.max(this.config.minFee, Math.ceil(estTxSize * this.config.feeRate));
    const change = funding.satoshis - fee;
    if (change > 0) {
      tx.addOutput({
        lockingScript: changeLock,
        satoshis: change,
      });
    }

    await tx.sign();
    const buildMs = Date.now() - t0;

    const txid = tx.id('hex') as string;
    const { broadcastMs } = await this.broadcastTx(tx, 'OP_RETURN');

    // Recycle change
    if (change > 0) {
      pool.push({
        txid,
        vout: 1,
        satoshis: change,
        sourceTx: tx,
      });
    }

    this.totalBuildMs += buildMs;

    return { txid, buildMs, broadcastMs, tx };
  }

  // ── Cell Builder Helper ──

  /**
   * Build a 1024-byte cell for poker hand state.
   * Uses the same CellStore + MemoryAdapter pattern as poker-state-machine.ts.
   */
  async buildPokerCell(
    gameId: string,
    handNumber: number,
    phase: string,
    data: Record<string, unknown>,
    version?: number,
  ): Promise<{ cellBytes: Uint8Array; contentHash: Uint8Array; semanticPath: string }> {
    const storage = new MemoryAdapter();
    const cellStore = new CellStore(storage);
    const semanticPath = `game/poker/${gameId}/hand-${handNumber}/state`;
    const ownerId = hexToBytes(
      createHash('sha256').update(gameId).digest('hex').slice(0, 32),
    );

    const payload = { gameId, handNumber, phase, ...data };
    const cellData = new TextEncoder().encode(JSON.stringify(payload));
    const cellRef = await cellStore.put(semanticPath, cellData, {
      linearity: Linearity.LINEAR,
      ownerId,
      typeHash: POKER_HAND_TYPE_HASH,
    });

    const cellBytes = await storage.read(semanticPath);
    if (!cellBytes) throw new Error('Failed to read cell');

    // Bump version in header if specified
    if (version && version > 1) {
      const dv = new DataView(cellBytes.buffer, cellBytes.byteOffset, cellBytes.byteLength);
      dv.setUint32(20, version, true);
    }

    return {
      cellBytes,
      contentHash: hexToBytes(cellRef.contentHash),
      semanticPath,
    };
  }

  // ── Stats ──

  getStats(): {
    totalBroadcast: number;
    avgBuildMs: number;
    avgBroadcastMs: number;
    txPerSec: number;
    errors: string[];
    utxoPoolSizes: number[];
  } {
    const avgBuild = this.totalBroadcast > 0 ? this.totalBuildMs / this.totalBroadcast : 0;
    const avgBroadcast = this.totalBroadcast > 0 ? this.totalBroadcastMs / this.totalBroadcast : 0;
    const totalMs = this.totalBuildMs + this.totalBroadcastMs;
    const txPerSec = totalMs > 0 ? (this.totalBroadcast / totalMs) * 1000 : 0;

    return {
      totalBroadcast: this.totalBroadcast,
      avgBuildMs: Math.round(avgBuild),
      avgBroadcastMs: Math.round(avgBroadcast),
      txPerSec: parseFloat(txPerSec.toFixed(2)),
      errors: [...this.errors],
      utxoPoolSizes: this.utxoPools.map(p => p.length),
    };
  }

  /**
   * Sweep all remaining UTXOs to an external address.
   * Call at end of run to return change to the user.
   * Batches UTXOs into txs of up to 200 inputs each (to stay under tx size limits).
   *
   * @param toAddress  BSV address to send change to
   * @returns Total sats swept and txids
   */
  async sweepAll(toAddress: string): Promise<{ totalSats: number; txids: string[]; utxosSwept: number }> {
    // Collect all remaining UTXOs across all streams
    const allUtxos: FundingUtxo[] = [];
    for (const pool of this.utxoPools) {
      while (pool.length > 0) {
        allUtxos.push(pool.shift()!);
      }
    }

    if (allUtxos.length === 0) {
      this.log('SWEEP', 'No UTXOs to sweep');
      return { totalSats: 0, txids: [], utxosSwept: 0 };
    }

    this.log('SWEEP', `Sweeping ${allUtxos.length} UTXOs to ${toAddress}`);

    const txids: string[] = [];
    let totalSats = 0;
    const BATCH_SIZE = 200; // max inputs per sweep tx

    for (let i = 0; i < allUtxos.length; i += BATCH_SIZE) {
      const batch = allUtxos.slice(i, i + BATCH_SIZE);
      const inputSats = batch.reduce((s, u) => s + u.satoshis, 0);

      const p2pkh = new P2PKH();
      const tx = new Transaction();

      for (const utxo of batch) {
        tx.addInput({
          sourceTXID: utxo.txid,
          sourceOutputIndex: utxo.vout,
          sourceTransaction: utxo.sourceTx,
          unlockingScriptTemplate: p2pkh.unlock(this.privateKey),
        });
      }

      // Estimate fee: ~148 bytes per input + 34 output + 10 overhead
      const estBytes = 10 + batch.length * 148 + 34;
      const fee = Math.max(this.config.minFee, Math.ceil(estBytes * this.config.feeRate));
      const outputSats = inputSats - fee;

      if (outputSats <= 546) {
        this.log('SWEEP', `Batch ${i / BATCH_SIZE}: ${batch.length} UTXOs too small to sweep (${inputSats} sats, fee ${fee})`);
        continue;
      }

      tx.addOutput({
        lockingScript: p2pkh.lock(toAddress),
        satoshis: outputSats,
      });

      await tx.sign();
      const txid = tx.id('hex') as string;
      this.logTxid(txid, 'sweep', inputSats, fee, estBytes);
      await this.broadcastTx(tx, 'SWEEP');

      txids.push(txid);
      totalSats += outputSats;
      this.log('SWEEP', `Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} UTXOs → ${outputSats} sats → ${txid.slice(0, 16)}...`);
    }

    this.log('SWEEP', `Done: ${totalSats} sats swept in ${txids.length} txs to ${toAddress}`);
    return { totalSats, txids, utxosSwept: allUtxos.length };
  }

  /**
   * Get total sats remaining across all UTXO pools.
   */
  getRemainingBalance(): { totalSats: number; utxoCount: number } {
    let totalSats = 0;
    let utxoCount = 0;
    for (const pool of this.utxoPools) {
      for (const u of pool) {
        totalSats += u.satoshis;
        utxoCount++;
      }
    }
    return { totalSats, utxoCount };
  }

  // ── Private ──

  /**
   * Wait for all pending fire-and-forget broadcasts to complete.
   * Call this at the end of a run to ensure all txs have been submitted.
   */
  async flush(): Promise<{ settled: number; errors: number }> {
    // Drain any remaining batch queue first
    while (this.batchQueue.length > 0) {
      this.flushBatch();
    }
    const results = await Promise.allSettled(this.pendingBroadcasts);
    const errors = results.filter(r => r.status === 'rejected').length;
    const settled = results.length;
    this.pendingBroadcasts = [];
    return { settled, errors };
  }

  /**
   * Broadcast a signed tx, either awaiting the result or firing in the background.
   * In fire-and-forget mode with batching: accumulates txs and flushes in batches
   * of BATCH_SIZE via ARC's /v1/txs bulk endpoint (one HTTP round-trip per batch).
   */
  private async broadcastTx(tx: Transaction, label: string): Promise<{ broadcastMs: number }> {
    if (this.config.fireAndForget) {
      // Batch mode — accumulate and flush in bursts
      this.batchQueue.push(tx);
      this.totalBroadcast++;

      if (this.batchQueue.length >= this.BATCH_SIZE) {
        // Batch full — flush immediately
        this.flushBatch();
      } else if (!this.batchFlushTimer) {
        // Start a timer to flush partial batches
        this.batchFlushTimer = setTimeout(() => this.flushBatch(), this.BATCH_FLUSH_MS);
      }

      return { broadcastMs: 0 };
    } else {
      // Synchronous — wait for ARC confirmation
      const t1 = Date.now();
      const result = await tx.broadcast(this.arc);
      const broadcastMs = Date.now() - t1;

      if ('status' in result && result.status === 'error') {
        const fail = result as any;
        const err = `${label} broadcast failed: code=${fail.code} desc=${fail.description} more=${JSON.stringify(fail.more)}`;
        this.errors.push(err);
        throw new Error(err);
      }

      this.totalBroadcast++;
      this.totalBroadcastMs += broadcastMs;
      return { broadcastMs };
    }
  }

  /**
   * Flush the current batch queue to ARC using direct fetch (bypasses @bsv/sdk).
   * The SDK's broadcastMany uses Node's https module which silently fails under Bun.
   * Direct fetch is reliable and gives us proper error reporting.
   */
  private flushBatch(): void {
    if (this.batchFlushTimer) {
      clearTimeout(this.batchFlushTimer);
      this.batchFlushTimer = null;
    }
    if (this.batchQueue.length === 0) return;

    const batch = this.batchQueue.splice(0, this.BATCH_SIZE);
    const batchNum = Math.floor(this.totalBroadcast / this.BATCH_SIZE);

    const p = (async () => {
      const t0 = Date.now();
      try {
        // Serialize txs to EF hex (includes source transactions for SPV)
        const rawTxs = batch.map(tx => {
          try { return { rawTx: tx.toHexEF() }; }
          catch { return { rawTx: tx.toHex() }; }
        });

        // Direct fetch to ARC batch endpoint (bypasses broken SDK httpClient)
        const arcUrl = this.config.arcUrl;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.config.arcApiKey) headers['Authorization'] = `Bearer ${this.config.arcApiKey}`;

        const resp = await fetch(`${arcUrl}/v1/txs`, {
          method: 'POST',
          headers,
          body: JSON.stringify(rawTxs),
        });

        const elapsed = Date.now() - t0;
        this.totalBroadcastMs += elapsed;

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '');
          throw new Error(`ARC batch HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
        }

        const results: any[] = await resp.json();
        if (!Array.isArray(results)) {
          throw new Error(`ARC batch returned non-array: ${JSON.stringify(results).slice(0, 200)}`);
        }

        let ok = 0;
        let fail = 0;
        for (const r of results) {
          const isError = r?.status === 'error' || r?.txStatus === 'REJECTED'
            || (typeof r?.status === 'number' && r.status >= 400);
          if (isError) {
            fail++;
            this.errors.push(`Batch tx failed: ${r?.title || r?.detail || r?.description || JSON.stringify(r).slice(0, 150)}`);
          } else {
            ok++;
          }
        }
        // Log first few batches + any failures
        if (batchNum <= 2 || fail > 0) {
          this.log('BATCH', `Batch #${batchNum}: ${ok} ok, ${fail} failed in ${elapsed}ms — sample: ${JSON.stringify(results[0]).slice(0, 200)}`);
        }

        // Dual-broadcast: push to WoC for reliable propagation (rate-limited to avoid 429)
        // Send 1 per batch to verify propagation without hammering WoC
        if (batch.length > 0) {
          this.wocBroadcast(batch[0].toHex()).catch(() => {});
        }
      } catch (err: any) {
        this.errors.push(`Batch broadcast error: ${err.message}`);
        this.log('BATCH', `Batch #${batchNum} error: ${err.message} — falling back to WoC`);
        // Fallback: broadcast first tx via WoC as probe
        if (batch.length > 0) {
          this.wocBroadcast(batch[0].toHex()).catch(() => {});
        }
      }
    })();

    this.pendingBroadcasts.push(p);
  }

  /**
   * Pick a funding UTXO from the pool that has enough sats to cover the fee.
   * Skips dust UTXOs that can't cover minFee + 1-sat CellToken output.
   * Discarded dust UTXOs are dropped (they can't be used for anything).
   */
  private pickFundingUtxo(pool: FundingUtxo[] | undefined, streamId: number, op: string): FundingUtxo {
    if (!pool) {
      throw new Error(`Stream ${streamId} has no UTXO pool (${op})`);
    }
    // Min sats needed: minFee + CellToken output (1)
    const MIN_USEFUL_SATS = this.config.minFee + this.config.cellSatoshis;
    while (pool.length > 0) {
      const utxo = pool.shift()!;
      if (utxo.satoshis >= MIN_USEFUL_SATS) {
        return utxo;
      }
      // Dust UTXO — discard silently
    }
    throw new Error(`Stream ${streamId} has no more funding UTXOs for ${op}`);
  }

  /**
   * Broadcast raw tx hex via WhatsOnChain's node endpoint as a backup.
   * ARC's ANNOUNCED_TO_NETWORK doesn't guarantee propagation — WoC goes direct to nodes.
   */
  private async wocBroadcast(txHex: string): Promise<boolean> {
    try {
      const resp = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: txHex }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        // "txn-already-known" or "already in the mempool" means the tx IS on the network
        if (body.includes('already-known') || body.includes('already in the mempool')) {
          this.log('WOC', `Tx already on network (treating as success)`);
          return true;
        }
        this.log('WOC', `Backup broadcast returned ${resp.status}: ${body.slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (err: any) {
      // Non-fatal — ARC is primary, WoC is belt-and-suspenders
      this.log('WOC', `Backup broadcast failed: ${err.message}`);
      return false;
    }
  }

  private log(label: string, msg: string): void {
    if (this.config.verbose) {
      console.log(`\x1b[33m[DIRECT:${label}]\x1b[0m ${msg}`);
    }
  }
}

// ── Helpers ──

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
