/**
 * PaymentChannelManager — 2-of-2 multisig payment channels for poker.
 *
 * Each poker match operates inside a payment channel:
 *   1. NEGOTIATE: Both agents' public keys are known (from discovery)
 *   2. FUND: Build a 2-of-2 multisig output from the engine's UTXO pool
 *   3. ACTIVE: Each bet is a "tick" — an HMAC-authenticated state update
 *   4. SETTLE: At game end, spend the multisig to pay winner/loser
 *
 * The channel state (balances per player) is tracked alongside the
 * CellToken game state. Each CellToken transition carries the channel
 * state in its payload, creating a dual-proof: the 2PDA kernel validates
 * the game state, and the HMAC tick proofs validate the payments.
 *
 * Every bet increment emits a CellToken transition (v_n → v_{n+1}) on-chain,
 * making the internal channel mechanism fully auditable.
 *
 * Inlined from semantos-core/packages/poker-agent/src/payment-channel.ts
 * with imports rewritten for the standalone hackathon repo.
 */

import {
  PrivateKey,
  PublicKey,
  Transaction,
  P2PKH,
  ARC,
  Hash,
  TransactionSignature,
  LockingScript,
} from '@bsv/sdk';
import {
  createChannel,
  fund,
  activate,
  tick as channelTick,
  requestClose,
  confirmClose,
  settle as channelSettle,
  type MeteringChannel,
  ChannelState,
} from '../stubs/channel-fsm';
import {
  computeTickProof,
  createSettlementBatch,
  type TickProof,
  type SettlementBatch,
} from '../stubs/settlement';
import type { DirectBroadcastEngine, FundingUtxo } from './direct-broadcast-engine';
import { CellToken } from '../protocol/cell-token';
import { CellStore } from '../protocol/cell-store';
import { MemoryAdapter } from '../protocol/adapters/memory-adapter';
import { Linearity, TaxonomyDimension, CommercePhase } from '../protocol/constants';
import { TransitionValidator, type CellEngineHandle } from '../protocol/transition-validator';
import { createHash } from 'crypto';

// ── Types ──

export interface ChannelConfig {
  /** Agent A's identity */
  agentA: { id: string; name: string; pubKey: PublicKey; privKey: PrivateKey };
  /** Agent B's identity */
  agentB: { id: string; name: string; pubKey: PublicKey; privKey: PrivateKey };
  /** ECDH shared secret (for HMAC tick proofs) */
  sharedSecret: Uint8Array;
  /** Total sats to lock in the channel */
  fundingSats: number;
  /** On-chain txid of the discovery match confirmation (for traceability) */
  matchTxid?: string;
  /** On-chain txids of agent discovery announcements */
  announceTxidA?: string;
  announceTxidB?: string;
  /** Stream ID for channel funding/settlement txs + OP_RETURNs */
  streamId: number;
  /** Stream ID for channel state CellTokens */
  cellStreamId?: number;
}

export interface ChannelInstance {
  /** Channel ID from the metering FSM */
  channelId: string;
  /** The metering FSM channel state */
  channel: MeteringChannel;
  /** Config for this channel */
  config: ChannelConfig;
  /** Funding transaction */
  fundingTxid: string;
  fundingVout: number;
  fundingTx: Transaction;
  /** Current balances (in sats) */
  balanceA: number;
  balanceB: number;
  /** All tick proofs accumulated during the game */
  tickProofs: TickProof[];
  /** Settlement transaction (set when channel is settled) */
  settlementTxid?: string;

  // ── CellToken state chain (kernel-validated) ──
  /** Live CellToken UTXO tracking channel state */
  cellTxid?: string;
  cellVout?: number;
  cellSourceTx?: Transaction;
  cellVersion: number;
  /** Previous cell bytes for kernel v1→v2 validation */
  prevCellBytes?: Uint8Array;
  prevContentHash?: Uint8Array;
  /** All CellToken transition txids (the verifiable state chain) */
  cellTransitions: { txid: string; version: number; prevStateHash: string; kernelValidated: boolean }[];
}

export interface ChannelEvent {
  type: 'channel-open' | 'channel-tick' | 'channel-settle' | 'channel-violation' | 'watchlist-hit';
  channelId: string;
  matchId?: number;
  txid?: string;
  data: Record<string, unknown>;
  ts: number;
}

/**
 * Per-offender watchlist state (stage-3).
 */
export interface WatchlistInstance {
  offenderIdHex: string;
  offenderPubKey: string;
  offenderName: string;
  hitCount: number;
  firstSeenTs: number;
  lastSeenTs: number;
  violationTxids: string[];
  lastKernelReason: string;

  // ── CellToken state chain (kernel-validated) ──
  cellTxid: string;
  cellVout: number;
  cellSourceTx: Transaction;
  cellVersion: number;
  prevCellBytes: Uint8Array;
  prevContentHash: Uint8Array;
  cellTransitions: { txid: string; version: number; hitCount: number; kernelValidated: boolean }[];
}

/**
 * Adversarial tamper modes for stage-1 violation demos.
 */
export type TamperMode =
  | 'flip-linearity'
  | 'zero-owner'
  | 'break-prev-hash'
  | 'bump-version-double'
  | 'corrupt-magic';

/**
 * Thrown by recordBet() when a candidate state transition fails kernel validation.
 */
export class ChannelViolationError extends Error {
  readonly name = 'ChannelViolationError';
  constructor(
    public readonly kernelReason: string,
    public readonly tamperMode: TamperMode | undefined,
    public readonly channelId: string,
    public readonly violationTxid?: string,
  ) {
    super(
      `Channel ${channelId} violation${tamperMode ? ` (tamper=${tamperMode})` : ''}: ${kernelReason}`,
    );
  }
}

// ── Manager ──

/** Semantic type hash for channel state cells */
const CHANNEL_STATE_TYPE_HASH = createHash('sha256').update('semantos/poker/channel-state/v1').digest();

/** Semantic type hash for channel violation cells (stage-2). */
const CHANNEL_VIOLATION_TYPE_HASH = createHash('sha256').update('semantos/poker/violation/v1').digest();

/** Semantic type hash for per-offender watchlist cells (stage-3). */
const CHANNEL_WATCHLIST_TYPE_HASH = createHash('sha256').update('semantos/poker/watchlist/v1').digest();

export class PaymentChannelManager {
  private engine: DirectBroadcastEngine;
  private arc: ARC;
  private channels: Map<string, ChannelInstance> = new Map();
  private verbose: boolean;

  /** 2PDA kernel validator for channel state CellTokens */
  private validator: TransitionValidator | null = null;
  private kernelLoaded = false;

  /** Per-offender watchlists — keyed by SHA256(offenderPubKey)[:16] hex. */
  private watchlists: Map<string, WatchlistInstance> = new Map();

  /** Optional observer for ChannelEvents */
  private onChannelEvent?: (event: ChannelEvent) => void;

  /** Stats */
  totalChannelsOpened = 0;
  totalChannelsSettled = 0;
  totalSatsTransferred = 0;
  totalTicks = 0;
  totalKernelValidations = 0;
  totalKernelFailures = 0;
  totalViolationsCaught = 0;
  totalViolationsAnchored = 0;
  totalWatchlistValidations = 0;
  totalWatchlistFailures = 0;
  totalWatchlistHits = 0;

  /** Scheduled tamper injections for red-team demos. */
  private tamperSchedule: Map<string, { tick: number; mode: TamperMode; fired: boolean }[]> = new Map();

  constructor(
    engine: DirectBroadcastEngine,
    arcUrl: string = 'https://arc.gorillapool.io',
    verbose = true,
    onChannelEvent?: (event: ChannelEvent) => void,
  ) {
    this.engine = engine;
    this.arc = new ARC(arcUrl);
    this.verbose = verbose;
    this.onChannelEvent = onChannelEvent;
  }

  setChannelEventHandler(handler: (event: ChannelEvent) => void): void {
    this.onChannelEvent = handler;
  }

  private emit(
    type: ChannelEvent['type'],
    channelId: string,
    data: Record<string, unknown>,
    opts: { matchId?: number; txid?: string } = {},
  ): void {
    if (!this.onChannelEvent) return;
    try {
      this.onChannelEvent({
        type,
        channelId,
        matchId: opts.matchId,
        txid: opts.txid,
        data,
        ts: Date.now(),
      });
    } catch (err: any) {
      if (this.verbose) {
        this.log('EVENT', `⚠ onChannelEvent observer threw: ${err.message}`);
      }
    }
  }

  scheduleTamper(channelId: string, tick: number, mode: TamperMode): void {
    const arr = this.tamperSchedule.get(channelId) ?? [];
    arr.push({ tick, mode, fired: false });
    this.tamperSchedule.set(channelId, arr);
    this.log('TAMPER', `⚡ Scheduled: channel=${channelId} tick=${tick} mode=${mode}`);
  }

  private popScheduledTamper(channelId: string, atTick: number): TamperMode | undefined {
    const arr = this.tamperSchedule.get(channelId);
    if (!arr) return undefined;
    for (const entry of arr) {
      if (!entry.fired && entry.tick === atTick) {
        entry.fired = true;
        return entry.mode;
      }
    }
    return undefined;
  }

  /** Load the 2PDA kernel for channel state validation */
  async loadKernel(): Promise<void> {
    if (this.kernelLoaded) return;
    try {
      const { loadCellEngine } = await import('../cell-engine/loader');
      const cellEngine = await loadCellEngine();
      this.validator = new TransitionValidator(cellEngine as unknown as CellEngineHandle, { debug: false });
      this.kernelLoaded = true;
      this.log('KERNEL', '2PDA kernel loaded for channel state validation');
    } catch (err: any) {
      this.log('KERNEL', `⚠ Failed to load kernel: ${err.message} (channel state CellTokens will not be kernel-validated)`);
    }
  }

  /**
   * Open a payment channel: create 2-of-2 multisig funding tx.
   */
  async openChannel(config: ChannelConfig): Promise<ChannelInstance> {
    const { agentA, agentB, fundingSats, streamId, sharedSecret } = config;

    // 1. Create metering FSM channel
    let channel = createChannel(agentA.id, agentB.id);

    // 2. Build 2-of-2 multisig locking script
    const multisigScript = this.build2of2Script(agentA.pubKey, agentB.pubKey);

    // 3. Build and broadcast the funding transaction
    const fundingResult = await this.buildFundingTx(
      streamId, multisigScript, fundingSats, config,
    );

    // 4. Advance FSM: NEGOTIATING → FUNDED → ACTIVE
    const fundResult = fund(channel, `${fundingResult.txid}.${fundingResult.vout}`);
    if (!fundResult.ok) throw new Error((fundResult as any).error);
    channel = fundResult.value;

    const activateResult = activate(channel);
    if (!activateResult.ok) throw new Error((activateResult as any).error);
    channel = activateResult.value;

    const instance: ChannelInstance = {
      channelId: channel.channelId,
      channel,
      config,
      fundingTxid: fundingResult.txid,
      fundingVout: fundingResult.vout,
      fundingTx: fundingResult.tx,
      balanceA: Math.floor(fundingSats / 2),
      balanceB: Math.floor(fundingSats / 2),
      tickProofs: [],
      cellVersion: 0,
      cellTransitions: [],
    };

    this.channels.set(channel.channelId, instance);
    this.totalChannelsOpened++;

    this.log('CHANNEL', `Opened: ${channel.channelId}`);
    this.log('CHANNEL', `  2-of-2 multisig: ${fundingResult.txid.slice(0, 16)}... (${fundingSats} sats)`);
    this.log('CHANNEL', `  ${agentA.name}: ${instance.balanceA} sats | ${agentB.name}: ${instance.balanceB} sats`);
    this.log('CHANNEL', `  https://whatsonchain.com/tx/${fundingResult.txid}`);

    this.emit('channel-open', channel.channelId, {
      agentA: agentA.name,
      agentB: agentB.name,
      agentAPubKey: agentA.pubKey.toString(),
      agentBPubKey: agentB.pubKey.toString(),
      fundingSats,
      balanceA: instance.balanceA,
      balanceB: instance.balanceB,
      matchTxid: config.matchTxid,
    }, { txid: fundingResult.txid });

    // Create the initial channel state CellToken (v1)
    await this.createChannelStateCellToken(instance);

    return instance;
  }

  /**
   * Record a bet (tick) in the payment channel.
   *
   * Staged validate-then-commit flow:
   *   1. STAGE — compute candidate balances, FSM tick, tick proof
   *   2. BUILD — construct candidate cell bytes; optionally tamper
   *   3. VALIDATE — run through 2PDA kernel
   *   4a. VIOLATION — anchor violation cell, throw
   *   4b. COMMIT — apply state, broadcast transition
   */
  async recordBet(
    channelId: string,
    fromAgent: 'A' | 'B',
    satoshis: number,
    tamperMode?: TamperMode,
  ): Promise<TickProof> {
    const instance = this.channels.get(channelId);
    if (!instance) throw new Error(`Channel ${channelId} not found`);

    // ── STAGE 1: Compute candidate state (no mutation yet) ──
    let candidateBalanceA = instance.balanceA;
    let candidateBalanceB = instance.balanceB;
    if (fromAgent === 'A') {
      candidateBalanceA -= satoshis;
      candidateBalanceB += satoshis;
    } else {
      candidateBalanceB -= satoshis;
      candidateBalanceA += satoshis;
    }
    candidateBalanceA = Math.max(0, candidateBalanceA);
    candidateBalanceB = Math.max(0, candidateBalanceB);

    const tickResult = channelTick(instance.channel, satoshis);
    if (!tickResult.ok) throw new Error((tickResult as any).error);
    const candidateChannel = tickResult.value;

    const proof = await computeTickProof(
      channelId,
      candidateChannel.currentTick,
      candidateChannel.cumulativeSatoshis,
      instance.config.sharedSecret,
    );

    // ── STAGE 2: Build candidate cell bytes ──
    const newVersion = instance.cellVersion + 1;
    const prevContentHex = instance.prevContentHash
      ? Buffer.from(instance.prevContentHash).toString('hex')
      : '0'.repeat(64);

    const statePayload = {
      proto: 'semantos:poker:channel-state',
      v: newVersion,
      channelId: instance.channelId,
      tick: candidateChannel.currentTick,
      balanceA: candidateBalanceA,
      balanceB: candidateBalanceB,
      lastAction: { from: fromAgent, sats: satoshis },
      hmacProof: proof.hmac.slice(0, 16),
      cumulativeSats: candidateChannel.cumulativeSatoshis,
      prevStateHash: prevContentHex,
      ts: Date.now(),
    };

    const prevCellHashBytes = instance.prevCellBytes
      ? new Uint8Array(createHash('sha256').update(Buffer.from(instance.prevCellBytes)).digest())
      : undefined;

    let cellBuild = await this.buildChannelCell(
      instance.channelId, statePayload, newVersion, false, prevCellHashBytes,
    );
    let cellBytes = cellBuild.cellBytes;
    const contentHash = cellBuild.contentHash;
    const semanticPath = cellBuild.semanticPath;

    // Check for scheduled tamper
    let effectiveTamperMode = tamperMode;
    if (!effectiveTamperMode) {
      effectiveTamperMode = this.popScheduledTamper(channelId, candidateChannel.currentTick);
      if (effectiveTamperMode) {
        this.log(
          'TAMPER',
          `⚡ Firing scheduled tamper on channel=${channelId} tick=${candidateChannel.currentTick} mode=${effectiveTamperMode}`,
        );
      }
    }

    if (effectiveTamperMode) {
      cellBytes = applyTamper(cellBytes, effectiveTamperMode);
    }

    // ── STAGE 3: Kernel validation ──
    let kernelChecked = false;
    let kernelValidated = true;
    let kernelReason = '';
    if (this.validator && instance.prevCellBytes && instance.prevContentHash && instance.cellTxid) {
      kernelChecked = true;
      const ownerPubKey = PublicKey.fromString(this.engine.getPubKeyHex());
      const result = this.validator.validate({
        v1CellBytes: instance.prevCellBytes,
        v2CellBytes: cellBytes,
        semanticPath,
        v1ContentHash: instance.prevContentHash,
        v2ContentHash: contentHash,
        ownerPubKey,
      });
      kernelValidated = result.valid;
      kernelReason = result.reason ?? '';
    }

    // ── STAGE 4A: VIOLATION path ──
    if (kernelChecked && !kernelValidated) {
      this.totalKernelFailures++;
      this.totalViolationsCaught++;
      const offender = fromAgent === 'A' ? instance.config.agentA : instance.config.agentB;
      this.log(
        'KERNEL',
        `✗ VIOLATION caught: channel=${instance.channelId} v${instance.cellVersion}→v${newVersion} by ${offender.name}${effectiveTamperMode ? ` tamper=${effectiveTamperMode}` : ''}: ${kernelReason}`,
      );

      const offenderPubKeyHex = offender.pubKey.toString();
      const violationPayload = {
        proto: 'semantos:poker:violation',
        v: 1,
        stage: 2,
        channelId: instance.channelId,
        fromVersion: instance.cellVersion,
        attemptedVersion: newVersion,
        kernelReason: kernelReason.slice(0, 200),
        tamperMode: effectiveTamperMode ?? null,
        offender: offender.name,
        offenderPubKey: offenderPubKeyHex,
        offenderPubKeyShort: offenderPubKeyHex.slice(0, 16),
        attemptedCellSha256: sha256Hex(cellBytes),
        attemptedContentHash: Buffer.from(contentHash).toString('hex'),
        prevCellSha256: instance.prevCellBytes ? sha256Hex(instance.prevCellBytes) : null,
        prevCellTxid: instance.cellTxid ?? null,
        ts: Date.now(),
      };

      let violationTxid: string | undefined;
      let anchorKind: 'violation-cell' | 'op-return' | 'none' = 'none';

      try {
        const violationCell = await this.buildViolationCell(offenderPubKeyHex, violationPayload);

        if (this.validator) {
          const selfCheck = this.validator.validateCell(violationCell.cellBytes);
          if (!selfCheck.valid) {
            throw new Error(`violation cell self-check failed: ${selfCheck.reason}`);
          }
        }

        const cellStream = instance.config.cellStreamId ?? instance.config.streamId;
        const r = await this.engine.createCellToken(
          cellStream,
          violationCell.cellBytes,
          violationCell.semanticPath,
          violationCell.contentHash,
        );
        violationTxid = r.txid;
        anchorKind = 'violation-cell';
        this.totalViolationsAnchored++;
        this.log(
          'VIOLATION',
          `📝 AFFINE cell anchored: ${r.txid.slice(0, 16)}... path=${violationCell.semanticPath} https://whatsonchain.com/tx/${r.txid}`,
        );

        await this.recordWatchlistHit(
          offenderPubKeyHex,
          offender.name,
          r.txid,
          kernelReason,
          instance.channelId,
        );
      } catch (cellErr: any) {
        this.log('VIOLATION', `⚠ Violation cell broadcast failed (${cellErr.message}), falling back to OP_RETURN marker`);
        try {
          const r = await this.engine.anchorOpReturn(
            instance.config.streamId,
            JSON.stringify(violationPayload),
          );
          violationTxid = r.txid;
          anchorKind = 'op-return';
          this.totalViolationsAnchored++;
          this.log(
            'VIOLATION',
            `📝 OP_RETURN fallback anchored: ${r.txid.slice(0, 16)}... https://whatsonchain.com/tx/${r.txid}`,
          );
        } catch (fallbackErr: any) {
          this.log('VIOLATION', `⚠ Fallback OP_RETURN also failed: ${fallbackErr.message}`);
        }
      }

      const offenderOwnerHash = createHash('sha256').update(offenderPubKeyHex).digest();
      const offenderIdHex = offenderOwnerHash.subarray(0, 16).toString('hex');
      const watchlistAfter = this.watchlists.get(offenderIdHex);
      this.emit('channel-violation', instance.channelId, {
        offenderName: offender.name,
        offenderPubKey: offenderPubKeyHex,
        offenderIdHex,
        fromVersion: instance.cellVersion,
        attemptedVersion: newVersion,
        kernelReason,
        tamperMode: effectiveTamperMode ?? null,
        kTheorem: tamperModeToKTheorem(effectiveTamperMode),
        anchorKind,
        hitCountAfter: watchlistAfter?.hitCount ?? 0,
        watchlistVersionAfter: watchlistAfter?.cellVersion ?? 0,
        watchlistTxidAfter: watchlistAfter?.cellTxid,
      }, { txid: violationTxid });

      throw new ChannelViolationError(
        `${kernelReason} [anchor=${anchorKind}]`,
        effectiveTamperMode,
        instance.channelId,
        violationTxid,
      );
    }

    // ── STAGE 4B: COMMIT candidate state ──
    instance.balanceA = candidateBalanceA;
    instance.balanceB = candidateBalanceB;
    instance.channel = candidateChannel;
    instance.tickProofs.push(proof);
    this.totalTicks++;
    this.totalSatsTransferred += satoshis;
    if (kernelChecked) this.totalKernelValidations++;

    // ── STAGE 5: Broadcast transition ──
    if (instance.cellTxid && instance.cellSourceTx) {
      const txCellStream = instance.config.cellStreamId ?? instance.config.streamId;
      try {
        const result = await this.engine.transitionCellToken(
          txCellStream,
          instance.cellTxid,
          instance.cellVout!,
          instance.cellSourceTx,
          cellBytes,
          semanticPath,
          contentHash,
          instance.cellVersion,
        );

        instance.cellTxid = result.txid;
        instance.cellVout = 0;
        instance.cellSourceTx = result.tx;
        instance.cellVersion = newVersion;
        instance.prevCellBytes = cellBytes;
        instance.prevContentHash = contentHash;
        instance.cellTransitions.push({
          txid: result.txid,
          version: newVersion,
          prevStateHash: prevContentHex,
          kernelValidated: true,
        });

        this.log(
          'CELL',
          `Channel v${newVersion}: ${fromAgent} ${satoshis}sat → A:${instance.balanceA} B:${instance.balanceB} | ${result.txid.slice(0, 12)}... [2PDA ✓]`,
        );

        this.emit('channel-tick', instance.channelId, {
          version: newVersion,
          fromAgent,
          sats: satoshis,
          balanceA: instance.balanceA,
          balanceB: instance.balanceB,
          agentAName: instance.config.agentA.name,
          agentBName: instance.config.agentB.name,
          kernelValidated: kernelChecked,
          prevStateHash: prevContentHex,
        }, { txid: result.txid });
      } catch (err: any) {
        this.log('CELL', `⚠ Channel state transition broadcast failed: ${err.message}`);
      }
    }

    return proof;
  }

  /**
   * Award the pot to the winner at hand end.
   */
  async awardPot(
    channelId: string,
    winnerIsA: boolean,
    potSats: number,
  ): Promise<TickProof> {
    return this.recordBet(channelId, winnerIsA ? 'B' : 'A', potSats);
  }

  /**
   * Settle the channel: close the 2-of-2 multisig and pay out final balances.
   */
  async settleChannel(channelId: string): Promise<{ txid: string; batch: SettlementBatch }> {
    const instance = this.channels.get(channelId);
    if (!instance) throw new Error(`Channel ${channelId} not found`);

    const { config, fundingTx, fundingTxid, fundingVout, balanceA, balanceB, tickProofs, channel } = instance;

    // Advance FSM: ACTIVE → CLOSING_REQUESTED → CLOSING_CONFIRMED → SETTLED
    let ch = channel;
    const closeReq = requestClose(ch);
    if (!closeReq.ok) throw new Error((closeReq as any).error);
    ch = closeReq.value;

    const closeConf = confirmClose(ch);
    if (!closeConf.ok) throw new Error((closeConf as any).error);
    ch = closeConf.value;

    // Build settlement transaction
    const fee = 150;
    const totalIn = balanceA + balanceB;
    const totalOut = totalIn - fee;

    const ratioA = totalIn > 0 ? balanceA / totalIn : 0.5;
    const outA = Math.floor(totalOut * ratioA);
    const outB = totalOut - outA;

    const p2pkh = new P2PKH();
    const tx = new Transaction();

    const signatureScope = TransactionSignature.SIGHASH_FORKID | TransactionSignature.SIGHASH_ALL;

    // nSequence encodes the FINAL kernel-validated state version
    const finalStateSequence = Math.min(instance.cellVersion, 0xFFFFFFFE);

    tx.addInput({
      sourceTXID: fundingTxid,
      sourceOutputIndex: fundingVout,
      sourceTransaction: fundingTx,
      sequence: finalStateSequence,
      unlockingScriptTemplate: {
        sign: async (tx: Transaction, inputIndex: number): Promise<any> => {
          const preimage = (tx as any).preimage(inputIndex, signatureScope);
          const preimageHash = Hash.sha256(preimage);

          const sigA = config.agentA.privKey.sign(preimageHash as any);
          const txSigA = new TransactionSignature(sigA.r, sigA.s, signatureScope);
          const sigBytesA = txSigA.toChecksigFormat();

          const sigB = config.agentB.privKey.sign(preimageHash as any);
          const txSigB = new TransactionSignature(sigB.r, sigB.s, signatureScope);
          const sigBytesB = txSigB.toChecksigFormat();

          // OP_0 <sigA> <sigB> (OP_0 is the dummy for CHECKMULTISIG bug)
          const { UnlockingScript: US } = await import('@bsv/sdk');
          return new US([
            { op: 0x00 },
            sigBytesA.length <= 75
              ? { op: sigBytesA.length, data: Array.from(sigBytesA as any) }
              : { op: 0x4c, data: Array.from(sigBytesA as any) },
            sigBytesB.length <= 75
              ? { op: sigBytesB.length, data: Array.from(sigBytesB as any) }
              : { op: 0x4c, data: Array.from(sigBytesB as any) },
          ]);
        },
        estimateLength: async (): Promise<number> => 1 + 73 + 73,
      },
    });

    if (outA > 0) {
      tx.addOutput({
        lockingScript: p2pkh.lock(config.agentA.pubKey.toAddress()),
        satoshis: outA,
      });
    }

    if (outB > 0) {
      tx.addOutput({
        lockingScript: p2pkh.lock(config.agentB.pubKey.toAddress()),
        satoshis: outB,
      });
    }

    await tx.sign();
    const txid = tx.id('hex') as string;

    const result = await tx.broadcast(this.arc);
    if ('status' in result && result.status === 'error') {
      const fail = result as any;
      this.log('SETTLE', `⚠ Settlement broadcast failed: ${fail.description}`);
    }

    const settleResult = channelSettle(ch, txid);
    if (settleResult.ok) {
      instance.channel = settleResult.value;
    }
    instance.settlementTxid = txid;

    const batch = createSettlementBatch(channelId, tickProofs);
    batch.settlementTxId = txid;

    this.totalChannelsSettled++;

    this.log('SETTLE', `Channel ${channelId} settled: ${txid.slice(0, 16)}...`);
    this.log('SETTLE', `  ${config.agentA.name}: ${outA} sats | ${config.agentB.name}: ${outB} sats`);
    this.log('SETTLE', `  ${tickProofs.length} ticks, ${instance.channel.cumulativeSatoshis} sats transferred`);
    this.log('SETTLE', `  final state v${instance.cellVersion} (nSequence=${finalStateSequence})`);
    this.log('SETTLE', `  https://whatsonchain.com/tx/${txid}`);

    this.emit('channel-settle', channelId, {
      agentA: config.agentA.name,
      agentB: config.agentB.name,
      outA,
      outB,
      finalBalanceA: balanceA,
      finalBalanceB: balanceB,
      tickCount: tickProofs.length,
      satsTransferred: instance.channel.cumulativeSatoshis,
      finalCellVersion: instance.cellVersion,
      nSequence: finalStateSequence,
    }, { txid });

    return { txid, batch };
  }

  /** Get a channel instance by ID */
  getChannel(channelId: string): ChannelInstance | undefined {
    return this.channels.get(channelId);
  }

  /** Get all channel instances */
  getAllChannels(): ChannelInstance[] {
    return [...this.channels.values()];
  }

  // ── Channel State CellToken (kernel-validated state chain) ──

  private async createChannelStateCellToken(instance: ChannelInstance): Promise<void> {
    const { channelId, config, fundingTxid, balanceA, balanceB } = instance;

    const statePayload = {
      proto: 'semantos:poker:channel-state',
      v: 1,
      channelId,
      tick: 0,
      balanceA,
      balanceB,
      fundingTxid,
      matchTxid: config.matchTxid ?? null,
      announceTxA: config.announceTxidA ?? null,
      announceTxB: config.announceTxidB ?? null,
      agentA: config.agentA.name,
      agentB: config.agentB.name,
      prevStateHash: '0'.repeat(64),
      ts: Date.now(),
    };

    const { cellBytes, contentHash, semanticPath } = await this.buildChannelCell(
      channelId, statePayload, 1,
    );

    let kernelValidated = false;
    if (this.validator) {
      const check = this.validator.validateCell(cellBytes);
      kernelValidated = check.valid;
      if (kernelValidated) {
        this.totalKernelValidations++;
        this.log('KERNEL', `✓ Channel ${channelId} v1 cell valid (linearity=${check.linearity})`);
      } else {
        this.totalKernelFailures++;
        this.log('KERNEL', `✗ Channel ${channelId} v1 invalid: ${check.reason}`);
      }
    }

    const cellStream = instance.config.cellStreamId ?? instance.config.streamId;
    try {
      const result = await this.engine.createCellToken(
        cellStream,
        cellBytes,
        semanticPath,
        contentHash,
      );

      instance.cellTxid = result.txid;
      instance.cellVout = 0;
      instance.cellSourceTx = result.tx;
      instance.cellVersion = 1;
      instance.prevCellBytes = cellBytes;
      instance.prevContentHash = contentHash;
      instance.cellTransitions = [{
        txid: result.txid,
        version: 1,
        prevStateHash: '0'.repeat(64),
        kernelValidated,
      }];

      this.log('CELL', `Channel ${channelId} state v1 → ${result.txid.slice(0, 16)}...${kernelValidated ? ' [2PDA ✓]' : ''}`);
    } catch (err: any) {
      this.log('CELL', `⚠ Channel state CellToken create failed: ${err.message}`);
      instance.cellVersion = 0;
      instance.cellTransitions = [];
    }
  }

  private async buildChannelCell(
    channelId: string,
    statePayload: Record<string, unknown>,
    version: number,
    isFinal: boolean = false,
    prevCellHash?: Uint8Array,
  ): Promise<{ cellBytes: Uint8Array; contentHash: Uint8Array; semanticPath: string }> {
    const storage = new MemoryAdapter();
    const cellStore = new CellStore(storage);
    const path = `channels/state/${channelId}`;

    const data = new TextEncoder().encode(JSON.stringify(statePayload));
    const ownerId = hexToBytes(
      createHash('sha256').update(channelId).digest('hex').slice(0, 32),
    );

    const cellRef = await cellStore.put(path, data, {
      linearity: Linearity.LINEAR,
      ownerId,
      typeHash: CHANNEL_STATE_TYPE_HASH,
      dimension: TaxonomyDimension.HOW,
      phase: isFinal ? CommercePhase.OUTCOME : CommercePhase.ACTION,
      prevStateHash: prevCellHash,
    });

    const cellBytes = await storage.read(path);
    if (!cellBytes) throw new Error('Failed to read channel cell');

    if (version > 1) {
      const dv = new DataView(cellBytes.buffer, cellBytes.byteOffset, cellBytes.byteLength);
      dv.setUint32(20, version, true);
    }

    return {
      cellBytes,
      contentHash: hexToBytes(cellRef.contentHash),
      semanticPath: path,
    };
  }

  private async buildViolationCell(
    offenderPubKeyHex: string,
    violationPayload: Record<string, unknown>,
  ): Promise<{ cellBytes: Uint8Array; contentHash: Uint8Array; semanticPath: string }> {
    const storage = new MemoryAdapter();
    const cellStore = new CellStore(storage);

    const ownerHash = createHash('sha256').update(offenderPubKeyHex).digest();
    const ownerId = new Uint8Array(ownerHash.subarray(0, 16));

    const ownerIdHex = Buffer.from(ownerId).toString('hex');
    const path = `channels/violations/${ownerIdHex}`;

    const data = new TextEncoder().encode(JSON.stringify(violationPayload));

    const cellRef = await cellStore.put(path, data, {
      linearity: Linearity.AFFINE,
      ownerId,
      typeHash: CHANNEL_VIOLATION_TYPE_HASH,
      dimension: TaxonomyDimension.HOW,
      phase: CommercePhase.OUTCOME,
    });

    const cellBytes = await storage.read(path);
    if (!cellBytes) throw new Error('Failed to read violation cell');

    return {
      cellBytes,
      contentHash: hexToBytes(cellRef.contentHash),
      semanticPath: path,
    };
  }

  private async buildWatchlistCell(
    offenderIdHex: string,
    statePayload: Record<string, unknown>,
    version: number,
    prevCellHash?: Uint8Array,
  ): Promise<{ cellBytes: Uint8Array; contentHash: Uint8Array; semanticPath: string }> {
    const storage = new MemoryAdapter();
    const cellStore = new CellStore(storage);
    const path = `watchlist/offenders/${offenderIdHex}`;

    const data = new TextEncoder().encode(JSON.stringify(statePayload));
    const ownerId = hexToBytes(offenderIdHex);

    const cellRef = await cellStore.put(path, data, {
      linearity: Linearity.LINEAR,
      ownerId,
      typeHash: CHANNEL_WATCHLIST_TYPE_HASH,
      dimension: TaxonomyDimension.INSTRUMENT,
      phase: CommercePhase.ACTION,
      prevStateHash: prevCellHash,
    });

    const cellBytes = await storage.read(path);
    if (!cellBytes) throw new Error('Failed to read watchlist cell');

    if (version > 1) {
      const dv = new DataView(cellBytes.buffer, cellBytes.byteOffset, cellBytes.byteLength);
      dv.setUint32(20, version, true);
    }

    return {
      cellBytes,
      contentHash: hexToBytes(cellRef.contentHash),
      semanticPath: path,
    };
  }

  private async recordWatchlistHit(
    offenderPubKeyHex: string,
    offenderName: string,
    violationTxid: string,
    kernelReason: string,
    channelId: string,
  ): Promise<string | undefined> {
    const ownerHash = createHash('sha256').update(offenderPubKeyHex).digest();
    const offenderIdHex = ownerHash.subarray(0, 16).toString('hex');
    const now = Date.now();

    let watchlist = this.watchlists.get(offenderIdHex);
    const isFirstHit = !watchlist;

    try {
      if (isFirstHit) {
        const state = {
          proto: 'semantos:poker:watchlist/v1',
          v: 1,
          offenderPubKey: offenderPubKeyHex,
          offenderId: offenderIdHex,
          offenderName,
          hitCount: 1,
          firstSeen: now,
          lastSeen: now,
          violationTxids: [violationTxid],
          lastKernelReason: kernelReason.slice(0, 200),
          lastChannelId: channelId,
          prevStateHash: '0'.repeat(64),
        };

        const built = await this.buildWatchlistCell(offenderIdHex, state, 1);

        if (this.validator) {
          const check = this.validator.validateCell(built.cellBytes);
          if (check.valid) {
            this.totalWatchlistValidations++;
          } else {
            this.totalWatchlistFailures++;
            throw new Error(`watchlist v1 self-check failed: ${check.reason}`);
          }
        }

        const cellStream = 0;
        const result = await this.engine.createCellToken(
          cellStream,
          built.cellBytes,
          built.semanticPath,
          built.contentHash,
        );

        watchlist = {
          offenderIdHex,
          offenderPubKey: offenderPubKeyHex,
          offenderName,
          hitCount: 1,
          firstSeenTs: now,
          lastSeenTs: now,
          violationTxids: [violationTxid],
          lastKernelReason: kernelReason.slice(0, 200),
          cellTxid: result.txid,
          cellVout: 0,
          cellSourceTx: result.tx,
          cellVersion: 1,
          prevCellBytes: built.cellBytes,
          prevContentHash: built.contentHash,
          cellTransitions: [{ txid: result.txid, version: 1, hitCount: 1, kernelValidated: this.validator !== null }],
        };
        this.watchlists.set(offenderIdHex, watchlist);
        this.totalWatchlistHits++;

        this.log(
          'WATCHLIST',
          `🆕 ${offenderName} (${offenderIdHex.slice(0, 8)}...): v1 opened, hitCount=1 → ${result.txid.slice(0, 16)}...${this.validator ? ' [2PDA ✓]' : ''}`,
        );

        this.emit('watchlist-hit', channelId, {
          offenderName,
          offenderPubKey: offenderPubKeyHex,
          offenderIdHex,
          hitCount: 1,
          cellVersion: 1,
          isFirstHit: true,
          kernelReason: kernelReason.slice(0, 200),
          kernelValidated: this.validator !== null,
          violationTxid,
        }, { txid: result.txid });

        return result.txid;
      } else {
        const newVersion = watchlist!.cellVersion + 1;
        const newHitCount = watchlist!.hitCount + 1;
        const prevContentHex = Buffer.from(watchlist!.prevContentHash).toString('hex');

        const rollingTxids = [...watchlist!.violationTxids, violationTxid].slice(-10);

        const state = {
          proto: 'semantos:poker:watchlist/v1',
          v: newVersion,
          offenderPubKey: offenderPubKeyHex,
          offenderId: offenderIdHex,
          offenderName,
          hitCount: newHitCount,
          firstSeen: watchlist!.firstSeenTs,
          lastSeen: now,
          violationTxids: rollingTxids,
          lastKernelReason: kernelReason.slice(0, 200),
          lastChannelId: channelId,
          prevStateHash: prevContentHex,
        };

        const prevWatchlistHash = new Uint8Array(
          createHash('sha256').update(Buffer.from(watchlist!.prevCellBytes)).digest(),
        );
        const built = await this.buildWatchlistCell(
          offenderIdHex, state, newVersion, prevWatchlistHash,
        );

        if (this.validator) {
          const ownerPubKey = PublicKey.fromString(this.engine.getPubKeyHex());
          const result = this.validator.validate({
            v1CellBytes: watchlist!.prevCellBytes,
            v2CellBytes: built.cellBytes,
            semanticPath: built.semanticPath,
            v1ContentHash: watchlist!.prevContentHash,
            v2ContentHash: built.contentHash,
            ownerPubKey,
          });
          if (result.valid) {
            this.totalWatchlistValidations++;
          } else {
            this.totalWatchlistFailures++;
            throw new Error(`watchlist v${watchlist!.cellVersion}→v${newVersion} kernel check failed: ${result.reason}`);
          }
        }

        const cellStream = 0;
        const result = await this.engine.transitionCellToken(
          cellStream,
          watchlist!.cellTxid,
          watchlist!.cellVout,
          watchlist!.cellSourceTx,
          built.cellBytes,
          built.semanticPath,
          built.contentHash,
          watchlist!.cellVersion,
        );

        watchlist!.cellTxid = result.txid;
        watchlist!.cellVout = 0;
        watchlist!.cellSourceTx = result.tx;
        watchlist!.cellVersion = newVersion;
        watchlist!.prevCellBytes = built.cellBytes;
        watchlist!.prevContentHash = built.contentHash;
        watchlist!.hitCount = newHitCount;
        watchlist!.lastSeenTs = now;
        watchlist!.violationTxids = rollingTxids;
        watchlist!.lastKernelReason = kernelReason.slice(0, 200);
        watchlist!.cellTransitions.push({
          txid: result.txid,
          version: newVersion,
          hitCount: newHitCount,
          kernelValidated: this.validator !== null,
        });
        this.totalWatchlistHits++;

        this.log(
          'WATCHLIST',
          `🔁 ${offenderName} (${offenderIdHex.slice(0, 8)}...): REPEAT OFFENDER v${newVersion}, hitCount=${newHitCount} → ${result.txid.slice(0, 16)}...${this.validator ? ' [2PDA ✓]' : ''}`,
        );

        this.emit('watchlist-hit', channelId, {
          offenderName,
          offenderPubKey: offenderPubKeyHex,
          offenderIdHex,
          hitCount: newHitCount,
          cellVersion: newVersion,
          isFirstHit: false,
          kernelReason: kernelReason.slice(0, 200),
          kernelValidated: this.validator !== null,
          violationTxid,
        }, { txid: result.txid });

        return result.txid;
      }
    } catch (err: any) {
      this.log('WATCHLIST', `⚠ Watchlist update failed for ${offenderName}: ${err.message}`);
      return undefined;
    }
  }

  getWatchlist(offenderPubKeyHex: string): WatchlistInstance | undefined {
    const ownerHash = createHash('sha256').update(offenderPubKeyHex).digest();
    const offenderIdHex = ownerHash.subarray(0, 16).toString('hex');
    return this.watchlists.get(offenderIdHex);
  }

  getAllWatchlists(): WatchlistInstance[] {
    return [...this.watchlists.values()];
  }

  // ── Private ──

  private build2of2Script(pubA: PublicKey, pubB: PublicKey): LockingScript {
    const pubABytes = pubA.encode(true) as number[];
    const pubBBytes = pubB.encode(true) as number[];

    return new LockingScript([
      { op: 0x52 },  // OP_2
      { op: pubABytes.length, data: pubABytes },
      { op: pubBBytes.length, data: pubBBytes },
      { op: 0x52 },  // OP_2
      { op: 0xae },  // OP_CHECKMULTISIG
    ]);
  }

  private async buildFundingTx(
    streamId: number,
    multisigScript: LockingScript,
    fundingSats: number,
    config: ChannelConfig,
  ): Promise<{ txid: string; vout: number; tx: Transaction }> {
    const fee = 250;
    const needed = fundingSats + fee;

    let consumed: FundingUtxo[] = [];
    let totalIn = 0;
    const maxUtxos = 10;

    for (let i = 0; i < maxUtxos; i++) {
      try {
        const [utxo] = this.engine.consumeUtxos(streamId, 1);
        consumed.push(utxo);
        totalIn += utxo.satoshis;
        if (totalIn >= needed) break;
      } catch {
        if (consumed.length > 0) this.engine.returnUtxos(streamId, consumed);
        throw new Error(`Stream ${streamId}: insufficient UTXOs for channel funding (need ${needed} sats)`);
      }
    }

    if (totalIn < needed) {
      this.engine.returnUtxos(streamId, consumed);
      throw new Error(`Stream ${streamId}: consumed ${consumed.length} UTXOs (${totalIn} sats) but need ${needed}`);
    }

    const engineKey = this.getEnginePrivKey();
    const engineAddress = this.engine.getFundingAddress();
    const p2pkh = new P2PKH();
    const changeLock = p2pkh.lock(engineAddress);

    const tx = new Transaction();

    for (const utxo of consumed) {
      tx.addInput({
        sourceTXID: utxo.txid,
        sourceOutputIndex: utxo.vout,
        sourceTransaction: utxo.sourceTx,
        unlockingScriptTemplate: p2pkh.unlock(engineKey),
      });
    }

    // Output 0: OP_RETURN channel-fund announcement
    const payload = JSON.stringify({
      proto: 'semantos:poker:channel-fund',
      v: 1,
      type: '2-of-2-multisig',
      sats: fundingSats,
      agentA: { name: config.agentA.name, pubKey: config.agentA.pubKey.toString().slice(0, 16) },
      agentB: { name: config.agentB.name, pubKey: config.agentB.pubKey.toString().slice(0, 16) },
      matchTxid: config.matchTxid ?? null,
      announceTxA: config.announceTxidA ?? null,
      announceTxB: config.announceTxidB ?? null,
      ts: Date.now(),
    });
    const opReturnScript = new LockingScript([
      { op: 0x00 }, // OP_FALSE
      { op: 0x6a }, // OP_RETURN
      { op: payload.length <= 75 ? payload.length : 0x4c, data: Array.from(Buffer.from(payload, 'utf-8')) },
    ]);
    tx.addOutput({ lockingScript: opReturnScript, satoshis: 0 });

    // Output 1: 2-of-2 multisig
    tx.addOutput({
      lockingScript: multisigScript,
      satoshis: fundingSats,
    });

    // Output 2: change
    const remainingChange = totalIn - fundingSats - fee;
    if (remainingChange > 0) {
      tx.addOutput({
        lockingScript: changeLock,
        satoshis: remainingChange,
      });
    }

    await tx.sign();
    const txid = tx.id('hex') as string;

    const broadcastResult = await tx.broadcast(this.arc);
    if ('status' in broadcastResult && broadcastResult.status === 'error') {
      const fail = broadcastResult as any;
      this.engine.returnUtxos(streamId, consumed);
      throw new Error(`Channel funding broadcast failed: ${fail.description}`);
    }

    this.log('CHANNEL', `Funding tx: ${consumed.length} UTXOs (${totalIn} sats) → ${fundingSats} sats locked, ${remainingChange} change, ${fee} fee`);

    return { txid, vout: 1, tx };
  }

  private getEnginePrivKey(): PrivateKey {
    return PrivateKey.fromWif(this.engine.getPrivateKeyWIF());
  }

  private log(label: string, msg: string): void {
    if (this.verbose) {
      console.log(`\x1b[36m[${label}]\x1b[0m ${msg}`);
    }
  }
}

// ── Helpers ──

function hexToBytes(hex: string): Uint8Array {
  const h = hex.length % 2 !== 0 ? '0' + hex : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function tamperModeToKTheorem(mode: TamperMode | undefined): string {
  switch (mode) {
    case 'flip-linearity':      return 'K1 Linearity';
    case 'zero-owner':          return 'K3 Domain Isolation';
    case 'break-prev-hash':     return 'K6 State Continuity';
    case 'bump-version-double': return 'K6 Monotonicity';
    case 'corrupt-magic':       return 'K7 Cell Immutability';
    default:                    return 'kernel invariant';
  }
}

function applyTamper(cellBytes: Uint8Array, mode: TamperMode): Uint8Array {
  const tampered = new Uint8Array(cellBytes);
  const dv = new DataView(tampered.buffer, tampered.byteOffset, tampered.byteLength);
  switch (mode) {
    case 'flip-linearity':
      dv.setUint32(16, 2, true);
      break;
    case 'zero-owner':
      for (let i = 0; i < 16; i++) tampered[62 + i] = 0x00;
      break;
    case 'break-prev-hash':
      for (let i = 0; i < 32; i++) tampered[128 + i] = 0xAA;
      break;
    case 'bump-version-double':
      dv.setUint32(20, dv.getUint32(20, true) + 1, true);
      break;
    case 'corrupt-magic':
      dv.setUint32(0, 0xBAADF00D, true);
      break;
  }
  return tampered;
}
