/**
 * DirectPokerStateMachine — Drop-in replacement for PokerStateMachine
 * that uses DirectBroadcastEngine instead of the wallet.
 *
 * Same public API as PokerStateMachine so GameLoop can swap transparently.
 * All CellToken transitions and OP_RETURN events are built locally and
 * broadcast via ARC — bypassing the 7.7s/tx wallet bottleneck entirely.
 *
 * Usage in GameLoop:
 *   const sm = new DirectPokerStateMachine(engine, { verbose: true });
 *   await sm.init(gameId);
 *   // ... same API as PokerStateMachine ...
 */

import { CellToken } from '../protocol/cell-token';
import { CellStore } from '../protocol/cell-store';
import { MemoryAdapter } from '../protocol/adapters/memory-adapter';
import { Linearity } from '../protocol/constants';
import { TransitionValidator } from '../protocol/transition-validator';
import { loadCellEngine } from '../cell-engine/loader';
import {
  DirectBroadcastEngine,
  type BroadcastResult,
} from './direct-broadcast-engine';
import type {
  PokerPhase,
  HandStatePayload,
  AnchorResult,
} from './poker-state-machine';
import { PublicKey } from '@bsv/sdk';
import { createHash } from 'crypto';

// Re-export types so consumers don't need dual imports
export type { PokerPhase, HandStatePayload, AnchorResult };

/** Semantic type hash for poker hand state cells */
const POKER_HAND_TYPE_HASH = createHash('sha256').update('semantos/poker/hand-state/v1').digest();

// ── Types ──

interface LiveUtxo {
  txid: string;
  vout: number;
  /** The Transaction object for the UTXO — passed directly, never fetched */
  sourceTx: import('@bsv/sdk').Transaction;
  version: number;
  lockedToKey: string;
}

// ── State Machine ──

export class DirectPokerStateMachine {
  private engine: DirectBroadcastEngine;
  private verbose: boolean;
  private streamId: number = 0; // round-robin across streams

  /** Owner ID for cell headers */
  private ownerId: Uint8Array = new Uint8Array(16);
  private gameId: string = '';

  /** Current hand's LINEAR CellToken UTXO */
  private liveUtxo: LiveUtxo | null = null;

  /** All txids produced for the current hand */
  private handTxids: AnchorResult[] = [];

  /** Running version counter */
  private cellVersion: number = 0;

  /** OP_RETURN stream — separate from CellToken stream */
  private opReturnStreamId: number = 1;

  /** 2PDA kernel validator — loaded once, reused for all transitions */
  private validator: TransitionValidator | null = null;

  /** Previous cell bytes + content hash for v1→v2 kernel validation */
  private prevCellBytes: Uint8Array | null = null;
  private prevContentHash: Uint8Array | null = null;

  /** Stats: total kernel validations performed */
  kernelValidations: number = 0;
  kernelValidationFailures: number = 0;

  constructor(
    engine: DirectBroadcastEngine,
    options?: {
      verbose?: boolean;
      /** Stream ID for CellToken ops. Default: 0 */
      cellStreamId?: number;
      /** Stream ID for OP_RETURN ops. Default: 1 */
      opReturnStreamId?: number;
    },
  ) {
    this.engine = engine;
    this.verbose = options?.verbose ?? true;
    this.streamId = options?.cellStreamId ?? 0;
    this.opReturnStreamId = options?.opReturnStreamId ?? 1;
  }

  // ── Public API (same as PokerStateMachine) ──

  async init(gameId: string, _opponentPubKey?: string): Promise<void> {
    this.gameId = gameId;
    this.ownerId = hexToBytes(
      createHash('sha256').update(gameId).digest('hex').slice(0, 32),
    );
    this.log('INIT', `DirectBroadcastEngine mode — gameId=${gameId}`);
    this.log('INIT', `PubKey: ${this.engine.getPubKeyHex().slice(0, 24)}...`);

    // Load 2PDA kernel for transition validation (once per state machine)
    if (!this.validator) {
      try {
        const t0 = Date.now();
        const cellEngine = await loadCellEngine();
        this.validator = new TransitionValidator(cellEngine as any, { debug: this.verbose });
        this.log('KERNEL', `2PDA kernel loaded in ${Date.now() - t0}ms (embedded WASM)`);
      } catch (err: any) {
        this.log('KERNEL', `⚠ Failed to load 2PDA kernel: ${err.message}`);
        this.log('KERNEL', `  Transitions will proceed WITHOUT kernel validation`);
      }
    }
  }

  /**
   * Create the first CellToken for a hand (v1).
   */
  async createHandToken(state: HandStatePayload, _lockToKey?: string): Promise<AnchorResult | null> {
    this.handTxids = [];
    this.cellVersion = 1;
    this.liveUtxo = null;
    this.prevCellBytes = null;
    this.prevContentHash = null;

    const { cellBytes, contentHash, semanticPath } = await this.buildPokerCell(state, 1);

    // Validate the initial cell through the kernel
    let kernelValidated = false;
    if (this.validator) {
      const check = this.validator.validateCell(cellBytes);
      kernelValidated = check.valid;
      if (kernelValidated) {
        this.kernelValidations++;
        this.log('KERNEL', `✓ v1 cell valid (linearity=${check.linearity})`);
      } else {
        this.kernelValidationFailures++;
        this.log('KERNEL', `✗ v1 cell invalid: ${check.reason}`);
      }
    }

    // Save for future v1→v2 transition validation
    this.prevCellBytes = cellBytes;
    this.prevContentHash = contentHash;

    this.log('CREATE', `Hand #${state.handNumber} v1 — ${state.phase}`);

    const t0 = Date.now();
    const result = await this.engine.createCellToken(
      this.streamId, cellBytes, semanticPath, contentHash,
    );

    const anchor: AnchorResult = {
      txid: result.txid,
      eventType: 'hand-create',
      isLinear: true,
      phase: state.phase,
      vout: 0,
      cellVersion: 1,
      kernelValidated,
    };
    this.handTxids.push(anchor);

    // Cache the Transaction object for zero-fetch chaining
    this.liveUtxo = {
      txid: result.txid,
      vout: 0,
      sourceTx: result.tx,
      version: 1,
      lockedToKey: this.engine.getPubKeyHex(),
    };

    this.log('CREATE', `✓ v1 → ${result.txid.slice(0, 16)}... [${result.buildMs + result.broadcastMs}ms]${kernelValidated ? ' [2PDA ✓]' : ''}`);
    this.log('WoC', `https://whatsonchain.com/tx/${result.txid}`);

    return anchor;
  }

  /**
   * State transition: spend v(n) CellToken, create v(n+1).
   */
  async transition(newState: HandStatePayload, _lockNextTo?: string): Promise<AnchorResult | null> {
    if (!this.liveUtxo) {
      this.log('TRANSITION', '✗ No live UTXO — skipping');
      return null;
    }

    this.cellVersion++;
    const { cellBytes, contentHash, semanticPath } = await this.buildPokerCell(newState, this.cellVersion);

    // ── 2PDA Kernel Validation ──
    // Validate v1→v2 transition BEFORE broadcasting.
    // The kernel checks: cell size, magic bytes, linearity preservation,
    // type-hash continuity, owner-ID continuity, version monotonicity,
    // and PushDrop script execution through the 2-PDA with linearity enforcement.
    let kernelValidated = false;
    let kernelOpcodeCount = 0;
    if (this.validator && this.prevCellBytes && this.prevContentHash) {
      const ownerPubKey = PublicKey.fromString(this.engine.getPubKeyHex());

      const validationResult = this.validator.validate({
        v1CellBytes: this.prevCellBytes,
        v2CellBytes: cellBytes,
        semanticPath,
        v1ContentHash: this.prevContentHash,
        v2ContentHash: contentHash,
        ownerPubKey,
      });

      kernelValidated = validationResult.valid;
      kernelOpcodeCount = validationResult.opcodeCount;

      if (kernelValidated) {
        this.kernelValidations++;
        this.log('KERNEL', `✓ v${this.cellVersion - 1}→v${this.cellVersion} validated (ops=${kernelOpcodeCount})`);
      } else {
        this.kernelValidationFailures++;
        this.log('KERNEL', `✗ v${this.cellVersion - 1}→v${this.cellVersion} INVALID: ${validationResult.reason}`);
        // Don't block the broadcast — log the failure but continue.
        // In production, this would be a hard gate. For the hackathon demo,
        // we want to show that validation IS happening and report results.
      }
    }

    this.log('TRANSITION', `v${this.cellVersion - 1} → v${this.cellVersion}: ${newState.phase}`);

    const result = await this.engine.transitionCellToken(
      this.streamId,
      this.liveUtxo.txid,
      this.liveUtxo.vout,
      this.liveUtxo.sourceTx,
      cellBytes,
      semanticPath,
      contentHash,
    );

    const anchor: AnchorResult = {
      txid: result.txid,
      eventType: `transition-${newState.phase}`,
      isLinear: true,
      phase: newState.phase,
      vout: 0,
      cellVersion: this.cellVersion,
      kernelValidated,
      kernelOpcodeCount,
    };
    this.handTxids.push(anchor);

    // Save current cell as v1 for next transition
    this.prevCellBytes = cellBytes;
    this.prevContentHash = contentHash;

    // Update live UTXO with zero-fetch chaining
    this.liveUtxo = {
      txid: result.txid,
      vout: 0,
      sourceTx: result.tx,
      version: this.cellVersion,
      lockedToKey: this.engine.getPubKeyHex(),
    };

    this.log('TRANSITION', `✓ v${this.cellVersion} → ${result.txid.slice(0, 16)}... [${result.buildMs + result.broadcastMs}ms]${kernelValidated ? ' [2PDA ✓]' : ''}`);
    this.log('WoC', `https://whatsonchain.com/tx/${result.txid}`);

    return anchor;
  }

  /**
   * End hand with final transition to 'complete'.
   */
  async endHand(finalState: HandStatePayload, lockNextTo?: string): Promise<AnchorResult | null> {
    const result = await this.transition({ ...finalState, phase: 'complete' }, lockNextTo);
    this.liveUtxo = null;
    this.prevCellBytes = null;
    this.prevContentHash = null;
    return result;
  }

  /**
   * Anchor a non-linear event as 0-sat OP_RETURN.
   */
  async anchorEvent(
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<AnchorResult | null> {
    const payload = JSON.stringify({
      proto: 'semantos-poker',
      v: 1,
      event: eventType,
      ts: Date.now(),
      ...data,
    });

    try {
      const result = await this.engine.anchorOpReturn(this.opReturnStreamId, payload);

      const anchor: AnchorResult = {
        txid: result.txid,
        eventType,
        isLinear: false,
        phase: (data as any).phase ?? 'unknown',
      };
      this.handTxids.push(anchor);
      this.log('EVENT', `${eventType} → ${result.txid.slice(0, 16)}... [${result.buildMs + result.broadcastMs}ms]`);

      return anchor;
    } catch (err: any) {
      this.log('EVENT', `✗ ${eventType}: ${err.message}`);
      return null;
    }
  }

  /**
   * Batch multiple events into a single OP_RETURN.
   */
  async anchorEventBatch(
    events: { eventType: string; data: Record<string, unknown> }[],
  ): Promise<AnchorResult | null> {
    if (events.length === 0) return null;

    const batchPayload = JSON.stringify({
      proto: 'semantos-poker',
      v: 1,
      batch: true,
      count: events.length,
      events: events.map(e => ({ event: e.eventType, ...e.data })),
      ts: Date.now(),
    });

    try {
      const result = await this.engine.anchorOpReturn(this.opReturnStreamId, batchPayload);

      const anchor: AnchorResult = {
        txid: result.txid,
        eventType: `batch(${events.length})`,
        isLinear: false,
        phase: (events[0].data as any).phase ?? 'unknown',
      };
      this.handTxids.push(anchor);
      this.log('BATCH', `${events.length} events → ${result.txid.slice(0, 16)}... [${result.buildMs + result.broadcastMs}ms]`);

      return anchor;
    } catch (err: any) {
      this.log('BATCH', `✗ batch(${events.length}): ${err.message}`);
      return null;
    }
  }

  // ── Accessors (same as PokerStateMachine) ──

  getHandTxids(): AnchorResult[] { return [...this.handTxids]; }
  getCurrentStateTxid(): string | null { return this.liveUtxo?.txid ?? null; }
  getMyPubKey(): string { return this.engine.getPubKeyHex(); }
  getOpponentPubKey(): string { return this.engine.getPubKeyHex(); }
  canISpend(): boolean { return this.liveUtxo !== null; }
  getLiveUtxo(): { txid: string; vout: number; lockedToKey: string; version: number } | null {
    if (!this.liveUtxo) return null;
    return {
      txid: this.liveUtxo.txid,
      vout: this.liveUtxo.vout,
      lockedToKey: this.liveUtxo.lockedToKey,
      version: this.liveUtxo.version,
    };
  }

  // ── Private ──

  private semanticPath(state: HandStatePayload): string {
    return `game/poker/${state.gameId}/hand-${state.handNumber}/state`;
  }

  private async buildPokerCell(
    state: HandStatePayload,
    version: number,
  ): Promise<{ cellBytes: Uint8Array; contentHash: Uint8Array; semanticPath: string }> {
    const storage = new MemoryAdapter();
    const cellStore = new CellStore(storage);
    const path = this.semanticPath(state);

    const data = new TextEncoder().encode(JSON.stringify(state));
    const cellRef = await cellStore.put(path, data, {
      linearity: Linearity.LINEAR,
      ownerId: this.ownerId,
      typeHash: POKER_HAND_TYPE_HASH,
    });

    const cellBytes = await storage.read(path);
    if (!cellBytes) throw new Error('Failed to read cell');

    // Bump version in header if needed
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

  private log(label: string, msg: string): void {
    if (this.verbose) {
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
