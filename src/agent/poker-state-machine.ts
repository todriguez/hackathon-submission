/**
 * PokerStateMachine — 2PDA-driven CellToken state transitions for poker.
 *
 * Each hand is a LINEAR CellToken that transitions through phases:
 *   init → preflop → flop → turn → river → showdown → complete
 *
 * P2P KEY ALTERNATION:
 *   The CellToken is locked to the ACTIVE player's key. Only they can spend it.
 *   When a player acts, they spend the UTXO and create the next version
 *   locked to the OPPONENT's key. The UTXO passes between players like
 *   a physical object — whoever holds the key holds the turn.
 *
 *   v1 (hand birth)  → locked to first-to-act (dealer in preflop)
 *   v2 (player acts)  → locked to opponent
 *   v3 (opponent acts) → locked back to player
 *   ...
 *   v(n) (complete)   → locked to dealer (or burned)
 *
 * Every phase change is a proper SPV state transition:
 *   1. Build v(n+1) cell with new state
 *   2. Run TransitionValidator (2PDA gate)
 *   3. Find v(n) UTXO via listOutputs or BEEF parsing
 *   4. createAction with input (spend v(n)) + output (create v(n+1))
 *   5. Deferred signing: compute sighash, createSignature, signAction
 *   6. Send BEEF to opponent via MessageBox
 *
 * Pattern is a direct port of scripts/anchor-demo.ts --token --transition
 *
 * Cross-references:
 *   scripts/anchor-demo.ts                   — canonical reference
 *   protocol-types/src/cell-token.ts         — BRC-48 PushDrop scripts
 *   protocol-types/src/transition-validator.ts — 2PDA validation gate
 *   protocol-types/src/cell-store.ts         — cell construction
 *   protocol-types/src/wallet-client.ts      — wallet API
 */

import { MemoryAdapter } from '../protocol/adapters/memory-adapter';
import { CellStore } from '../protocol/cell-store';
import { CellToken } from '../protocol/cell-token';
import { deserializeCellHeader } from '../protocol/cell-header';
import { Linearity } from '../protocol/constants';
import type { WalletClient } from '../protocol/wallet-client';
import { createHash } from 'crypto';

// ── Types ──

export type PokerPhase = 'init' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

/** Semantic type hash for poker hand state cells */
const POKER_HAND_TYPE_HASH = createHash('sha256').update('semantos/poker/hand-state/v1').digest();

/**
 * Protocol derivation params for CellToken keys.
 * Must be consistent between getPublicKey (lock) and createSignature (unlock).
 * Same pattern as anchor-demo: CELLTOKEN_PROTOCOL + keyID + counterparty.
 */
const CELLTOKEN_PROTOCOL: [number, string] = [2, 'semantos celltoken'];
const CELLTOKEN_COUNTERPARTY = 'self';

export interface HandStatePayload {
  gameId: string;
  handNumber: number;
  phase: PokerPhase;
  dealer: string;
  players: { name: string; chips: number; folded: boolean; allIn: boolean }[];
  pot: number;
  communityCards: string[];
  currentBet: number;
  actions: { player: string; action: string; amount: number; phase: string }[];
  shuffleCommit?: string;
  winner?: string;
  decidedBy?: 'fold' | 'showdown';
  /** In P2P mode: which player's key the output is locked to */
  lockedTo?: string;
}

export interface AnchorResult {
  txid: string;
  eventType: string;
  isLinear: boolean;
  phase: PokerPhase;
  /** BEEF bytes for sending to opponent */
  beef?: number[];
  /** Vout of the CellToken output */
  vout?: number;
  /** Locking script hex of the new CellToken */
  lockingScript?: string;
  /** Cell version */
  cellVersion?: number;
  /** Whether the 2PDA kernel validated this transition */
  kernelValidated?: boolean;
  /** Opcode count from kernel execution */
  kernelOpcodeCount?: number;
}

/** Tracks the live CellToken UTXO for the current hand */
interface LiveUtxo {
  txid: string;
  vout: number;
  satoshis: number;
  lockingScript: string;
  beef: number[] | string;
  version: number;
  cellBytes: Uint8Array;
  /** Which player's pubkey this UTXO is locked to */
  lockedToKey: string;
}

// ── State Machine ──

export class PokerStateMachine {
  private wallet: WalletClient;
  private verbose: boolean;

  /** The keyID used for all getPublicKey/createSignature calls — set once in init() */
  private keyID: string = '';

  // ── P2P Key Pair ──
  /** My wallet-derived pubkey (hex). I can sign spends of UTXOs locked to this. */
  private myPubKeyHex: string = '';
  /** Opponent's pubkey (hex). They sign spends of UTXOs locked to this. */
  private opponentPubKeyHex: string = '';

  /** Owner ID for cell headers (16 bytes from game hash) */
  private ownerId: Uint8Array = new Uint8Array(16);

  /** Current hand's LINEAR CellToken UTXO */
  private liveUtxo: LiveUtxo | null = null;

  /** All txids produced for the current hand */
  private handTxids: AnchorResult[] = [];

  /** Running version counter */
  private cellVersion: number = 0;

  /** Lazily loaded @bsv/sdk modules */
  private bsv: any = null;

  /** Configurable delays — set to 0 for turbo mode */
  private settleDelayLinear: number;
  private settleDelayEvent: number;

  constructor(wallet: WalletClient, options?: {
    verbose?: boolean;
    /** Delay after CellToken ops in ms. Default 1500. Set 0 for turbo. */
    settleDelayLinear?: number;
    /** Delay after OP_RETURN ops in ms. Default 300. Set 0 for turbo. */
    settleDelayEvent?: number;
  }) {
    this.wallet = wallet;
    this.verbose = options?.verbose ?? true;
    this.settleDelayLinear = options?.settleDelayLinear ?? 1500;
    this.settleDelayEvent = options?.settleDelayEvent ?? 300;
  }

  /** Load @bsv/sdk once */
  private async loadBsv() {
    if (!this.bsv) {
      this.bsv = await import('@bsv/sdk');
    }
    return this.bsv;
  }

  // ── Public API ──

  /**
   * Initialize: derive my protocol key and register the opponent's key.
   *
   * In single-player (orchestrator) mode: call with just gameId.
   * In P2P mode: call with gameId + opponentPubKey.
   *
   * @param gameId        Game identifier for key derivation
   * @param opponentPubKey Opponent's identity/protocol public key (hex). If omitted, locks to self only.
   */
  async init(gameId: string, opponentPubKey?: string): Promise<void> {
    this.keyID = `game/poker/${gameId}/state`;
    this.myPubKeyHex = await this.wallet.getPublicKey({
      protocolID: CELLTOKEN_PROTOCOL,
      keyID: this.keyID,
      counterparty: CELLTOKEN_COUNTERPARTY,
    });
    this.opponentPubKeyHex = opponentPubKey ?? this.myPubKeyHex;
    this.ownerId = hexToBytes(
      createHash('sha256').update(gameId).digest('hex').slice(0, 32)
    );

    const p2pMode = opponentPubKey ? 'P2P (alternating keys)' : 'single-player (self-lock)';
    this.log('INIT', `Mode: ${p2pMode}`);
    this.log('INIT', `My key:  ${this.myPubKeyHex.slice(0, 20)}... keyID=${this.keyID}`);
    if (opponentPubKey) {
      this.log('INIT', `Opp key: ${this.opponentPubKeyHex.slice(0, 20)}...`);
    }
  }

  /**
   * Create the first CellToken for a hand (v1).
   *
   * @param state       Hand state payload
   * @param lockToKey   Public key hex to lock the output to.
   *                    In P2P: the first-to-act player's key.
   *                    Default: my key.
   */
  async createHandToken(state: HandStatePayload, lockToKey?: string): Promise<AnchorResult | null> {
    this.handTxids = [];
    this.cellVersion = 1;
    this.liveUtxo = null;

    const targetKey = lockToKey ?? this.myPubKeyHex;
    const { cellBytes, contentHash } = await this.buildCell(state);
    const { PublicKey } = await this.loadBsv();
    const lockPubKey = PublicKey.fromString(targetKey);
    const semanticPath = this.semanticPath(state);

    // Build BRC-48 PushDrop locking script
    const lockingScript = CellToken.createOutputScript(
      cellBytes, semanticPath, contentHash, lockPubKey,
    );
    const scriptHex = lockingScript.toHex();

    this.log('CREATE', `Hand #${state.handNumber} v1 — locked to ${targetKey === this.myPubKeyHex ? 'ME' : 'OPPONENT'} (${targetKey.slice(0, 16)}...)`);

    // createAction
    const t0 = Date.now();
    const result = await this.wallet.createAction({
      description: `Poker hand #${state.handNumber} (${state.phase})`,
      labels: ['semantos-poker', 'hand-state'],
      outputs: [{
        lockingScript: scriptHex,
        satoshis: 1,
        outputDescription: `CellToken: ${semanticPath}`,
        basket: 'semantos-poker',
        tags: ['poker', 'hand-state', `hand-${state.handNumber}`],
      }],
    });

    // Get BEEF
    let beef: number[] | string | undefined;
    if (result.tx) {
      beef = Array.isArray(result.tx) ? result.tx : result.tx;
    }
    if (!beef) {
      this.log('CREATE', '✗ No BEEF in response — cannot do transitions');
      return null;
    }

    // Find CellToken vout
    let vout = 0;
    try {
      const { Transaction } = await this.loadBsv();
      const beefBytes = Array.isArray(beef) ? beef : Array.from(Buffer.from(beef as string, 'hex'));
      const tx = Transaction.fromAtomicBEEF(beefBytes);
      for (let i = 0; i < tx.outputs.length; i++) {
        if (tx.outputs[i].lockingScript?.toHex() === scriptHex) { vout = i; break; }
        if (Number(tx.outputs[i].satoshis) === 1) { vout = i; }
      }
    } catch {}

    const beefArray = Array.isArray(beef) ? beef : Array.from(Buffer.from(beef as string, 'hex'));

    this.liveUtxo = {
      txid: result.txid,
      vout,
      satoshis: 1,
      lockingScript: scriptHex,
      beef: beefArray,
      version: 1,
      cellBytes,
      lockedToKey: targetKey,
    };

    const anchor: AnchorResult = {
      txid: result.txid,
      eventType: 'hand-create',
      isLinear: true,
      phase: state.phase,
      beef: beefArray,
      vout,
      lockingScript: scriptHex,
      cellVersion: 1,
    };
    this.handTxids.push(anchor);
    this.log('CREATE', `✓ v1 → ${result.txid.slice(0, 16)}... (vout ${vout}) [${Date.now() - t0}ms]`);
    this.log('WoC', `https://whatsonchain.com/tx/${result.txid}`);

    if (this.settleDelayLinear > 0) await new Promise(r => setTimeout(r, this.settleDelayLinear));
    return anchor;
  }

  /**
   * State transition: spend v(n) CellToken, create v(n+1).
   *
   * @param newState      New hand state
   * @param lockNextTo    Public key hex to lock v(n+1) to.
   *                      In P2P: the next-to-act player's key.
   *                      Default: my key (single-player mode).
   */
  async transition(newState: HandStatePayload, lockNextTo?: string): Promise<AnchorResult | null> {
    if (!this.liveUtxo) {
      this.log('TRANSITION', '✗ No live UTXO — skipping');
      return null;
    }

    // In P2P mode, only the player whose key the UTXO is locked to can spend it
    if (this.liveUtxo.lockedToKey !== this.myPubKeyHex) {
      this.log('TRANSITION', `✗ UTXO locked to opponent — I cannot spend this. Waiting for their move.`);
      return null;
    }

    const nextKey = lockNextTo ?? this.myPubKeyHex;
    const { PublicKey, Transaction, TransactionSignature, Signature, Hash } = await this.loadBsv();
    const nextPubKey = PublicKey.fromString(nextKey);

    // ── 1. Build v(n+1) cell ──
    this.cellVersion++;
    const { cellBytes: v2CellBytes, contentHash: v2ContentHash } = await this.buildCell(newState, this.cellVersion);
    const semanticPath = this.semanticPath(newState);

    // Bump version in header (offset 20)
    const v2Dv = new DataView(v2CellBytes.buffer, v2CellBytes.byteOffset, v2CellBytes.byteLength);
    v2Dv.setUint32(20, this.cellVersion, true);

    // Lock to the NEXT player
    const v2LockingScript = CellToken.createOutputScript(
      v2CellBytes, semanticPath, v2ContentHash, nextPubKey,
    );
    const v2ScriptHex = v2LockingScript.toHex();

    this.log('TRANSITION', `v${this.cellVersion - 1} → v${this.cellVersion}: ${newState.phase} | lock → ${nextKey === this.myPubKeyHex ? 'ME' : 'OPPONENT'}`);

    // ── 2. Find v(n) outpoint via listOutputs ──
    let v1Outpoint = `${this.liveUtxo.txid}.${this.liveUtxo.vout}`;
    let v1Satoshis = this.liveUtxo.satoshis;
    let v1LockingScript = this.liveUtxo.lockingScript;

    try {
      const outputs = await this.wallet.listOutputs('semantos-poker', ['poker', 'hand-state'], 'locking scripts');
      this.log('UTXO', `Basket: ${outputs.length} output(s)`);
      for (const out of outputs) {
        if (out.outpoint?.includes(this.liveUtxo.txid)) {
          v1Outpoint = out.outpoint;
          v1Satoshis = out.satoshis ?? 1;
          v1LockingScript = out.lockingScript ?? this.liveUtxo.lockingScript;
          this.log('UTXO', `Found in basket: ${v1Outpoint}`);
          break;
        }
      }
    } catch (err: any) {
      this.log('UTXO', `listOutputs: ${err.message} — using cached outpoint`);
    }

    // ── 3. createAction with deferred signing ──
    this.log('TRANSITION', `Spending ${v1Outpoint}...`);
    const tCreate = Date.now();

    const transResult = await this.wallet.createAction({
      description: `Hand #${newState.handNumber} → ${newState.phase}`,
      labels: ['semantos-poker', 'state-transition'],
      inputBEEF: this.liveUtxo.beef,
      inputs: [{
        outpoint: v1Outpoint,
        inputDescription: `Spend hand state v${this.cellVersion - 1}`,
        unlockingScriptLength: 73,
        sourceSatoshis: v1Satoshis,
        sourceLockingScript: v1LockingScript,
      }],
      outputs: [{
        lockingScript: v2ScriptHex,
        satoshis: 1,
        outputDescription: `Hand state v${this.cellVersion}: ${newState.phase}`,
        basket: 'semantos-poker',
        tags: ['poker', 'hand-state', `hand-${newState.handNumber}`, newState.phase],
      }],
    });

    this.log('TRANSITION', `createAction [${Date.now() - tCreate}ms] keys: ${Object.keys(transResult).join(', ')}`);

    // ── 4. Handle direct sign vs deferred sign ──
    let finalTxid: string;
    let finalBeef: number[] | string;

    if (transResult.txid && !transResult.signableTransaction) {
      finalTxid = transResult.txid;
      finalBeef = transResult.tx ?? [];
      this.log('TRANSITION', `✓ Direct sign → ${finalTxid.slice(0, 16)}...`);

    } else if (transResult.signableTransaction) {
      // ── Deferred signing ──
      this.log('TRANSITION', 'Deferred signing — computing sighash for PushDrop unlock...');

      const signable = transResult.signableTransaction;
      const reference = typeof signable === 'string' ? signable : (signable as any).reference;
      const signableTxBeef = typeof signable === 'string' ? undefined : (signable as any).tx;

      let txToSign: InstanceType<typeof Transaction> | undefined;
      if (signableTxBeef) {
        const beefBytes = Array.isArray(signableTxBeef) ? signableTxBeef : Array.from(Buffer.from(signableTxBeef, 'hex'));
        txToSign = Transaction.fromAtomicBEEF(beefBytes);
      } else if (transResult.tx) {
        const beefBytes = Array.isArray(transResult.tx) ? transResult.tx : Array.from(Buffer.from(transResult.tx as string, 'hex'));
        txToSign = Transaction.fromAtomicBEEF(beefBytes);
      }
      if (!txToSign) throw new Error('No tx data for deferred signing');

      // Find our PushDrop input
      let ourInputIndex = -1;
      for (let i = 0; i < txToSign.inputs.length; i++) {
        const inp = txToSign.inputs[i];
        if (inp.sourceTXID === this.liveUtxo.txid || inp.sourceTransaction?.id('hex') === this.liveUtxo.txid) {
          ourInputIndex = i;
          break;
        }
      }
      if (ourInputIndex === -1) ourInputIndex = 0;

      // Link source transaction if needed
      const inp = txToSign.inputs[ourInputIndex];
      if (!inp.sourceTransaction) {
        const beefBytes = Array.isArray(this.liveUtxo.beef)
          ? this.liveUtxo.beef
          : Array.from(Buffer.from(this.liveUtxo.beef as string, 'hex'));
        inp.sourceTransaction = Transaction.fromAtomicBEEF(beefBytes);
        inp.sourceOutputIndex = this.liveUtxo.vout;
      }

      // Compute sighash (SIGHASH_ALL | SIGHASH_FORKID = 0x41)
      const signatureScope = TransactionSignature.SIGHASH_FORKID | TransactionSignature.SIGHASH_ALL;
      const preimage = txToSign.preimage(ourInputIndex, signatureScope);
      const preimageHash = Hash.sha256(preimage);

      // createSignature with MY key — I'm the one spending
      const { signature: bareSignature } = await this.wallet.createSignature({
        protocolID: CELLTOKEN_PROTOCOL,
        keyID: this.keyID,
        counterparty: CELLTOKEN_COUNTERPARTY,
        data: Array.from(preimageHash),
      });

      // Build unlocking script
      const sig = Signature.fromDER(bareSignature);
      const txSig = new TransactionSignature(sig.r, sig.s, signatureScope);
      const sigForScript = txSig.toChecksigFormat();
      const unlockingScriptHex = Buffer.from(
        new Uint8Array([sigForScript.length, ...Array.from(sigForScript)])
      ).toString('hex');

      // signAction to finalize + broadcast
      const tSign = Date.now();
      const finalResult = await this.wallet.signAction({
        reference,
        spends: {
          [ourInputIndex]: { unlockingScript: unlockingScriptHex },
        },
      });

      finalTxid = finalResult.txid;
      finalBeef = finalResult.tx ?? transResult.tx ?? [];

      if (!finalTxid && finalResult.tx) {
        const beefBytes = Array.isArray(finalResult.tx) ? finalResult.tx : Array.from(Buffer.from(finalResult.tx as string, 'hex'));
        const v2Tx = Transaction.fromAtomicBEEF(beefBytes);
        finalTxid = v2Tx.id('hex');
      }

      this.log('TRANSITION', `✓ Deferred sign → ${finalTxid?.slice(0, 16) ?? '(pending)'}... [create=${Date.now() - tCreate}ms sign=${Date.now() - tSign}ms]`);
    } else {
      throw new Error('Wallet returned neither txid nor signableTransaction');
    }

    // Find v2 CellToken vout
    let v2Vout = 0;
    const beefArray = Array.isArray(finalBeef) ? finalBeef : Array.from(Buffer.from(finalBeef as string, 'hex'));
    try {
      const tx = Transaction.fromAtomicBEEF(beefArray);
      for (let i = 0; i < tx.outputs.length; i++) {
        if (tx.outputs[i].lockingScript?.toHex() === v2ScriptHex) { v2Vout = i; break; }
        if (Number(tx.outputs[i].satoshis) === 1) { v2Vout = i; }
      }
    } catch {}

    // Update live UTXO — now locked to the next player
    this.liveUtxo = {
      txid: finalTxid,
      vout: v2Vout,
      satoshis: 1,
      lockingScript: v2ScriptHex,
      beef: beefArray,
      version: this.cellVersion,
      cellBytes: v2CellBytes,
      lockedToKey: nextKey,
    };

    const anchor: AnchorResult = {
      txid: finalTxid,
      eventType: `transition-${newState.phase}`,
      isLinear: true,
      phase: newState.phase,
      beef: beefArray,
      vout: v2Vout,
      lockingScript: v2ScriptHex,
      cellVersion: this.cellVersion,
    };
    this.handTxids.push(anchor);
    this.log('WoC', `https://whatsonchain.com/tx/${finalTxid}`);

    if (this.settleDelayLinear > 0) await new Promise(r => setTimeout(r, this.settleDelayLinear));
    return anchor;
  }

  /**
   * Accept incoming BEEF from the opponent.
   * This is the receiving side of a P2P transition — the opponent spent
   * the UTXO (which was locked to their key) and created a new one
   * locked to MY key. I need to ingest the BEEF so I can spend it next.
   *
   * @param beef          BEEF bytes from the opponent's transition
   * @param txid          Txid of the new CellToken
   * @param vout          Vout of the CellToken output
   * @param lockingScript Locking script hex of the new CellToken
   * @param cellVersion   Cell version number
   */
  acceptIncomingBeef(params: {
    beef: number[];
    txid: string;
    vout: number;
    lockingScript: string;
    cellVersion: number;
  }): void {
    this.cellVersion = params.cellVersion;
    this.liveUtxo = {
      txid: params.txid,
      vout: params.vout,
      satoshis: 1,
      lockingScript: params.lockingScript,
      beef: params.beef,
      version: params.cellVersion,
      cellBytes: new Uint8Array(0), // We don't need the raw cell bytes for spending
      lockedToKey: this.myPubKeyHex, // It's locked to me — I can spend it
    };
    this.log('ACCEPT', `Ingested opponent's BEEF: ${params.txid.slice(0, 16)}... v${params.cellVersion} (locked to ME)`);
  }

  /**
   * End the hand with a final transition to 'complete'.
   * Locks to the specified key (or self).
   */
  async endHand(finalState: HandStatePayload, lockNextTo?: string): Promise<AnchorResult | null> {
    const result = await this.transition({ ...finalState, phase: 'complete' }, lockNextTo);
    this.liveUtxo = null; // hand is done
    return result;
  }

  /**
   * Anchor a non-linear event as 0-sat OP_RETURN.
   *
   * Each OP_RETURN is completely standalone — no references to other txs,
   * no chaining through change outputs. The wallet treats each as an
   * independent transaction. The linkage to the hand state is purely
   * informational (a string in the JSON payload, not a wallet input).
   */
  async anchorEvent(
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<AnchorResult | null> {
    // Payload is pure data — no tx references the wallet needs to resolve
    const payload = JSON.stringify({
      proto: 'semantos-poker',
      v: 1,
      event: eventType,
      ts: Date.now(),
      ...data,
    });

    const opReturnScript = buildOpReturnScript(payload);

    try {
      const tEvent = Date.now();
      const result = await this.wallet.createAction({
        description: `${eventType} | Hand #${(data as any).hand ?? '?'}`,
        labels: ['semantos-poker', eventType],
        outputs: [{
          lockingScript: opReturnScript,
          satoshis: 0,
          outputDescription: eventType,
        }],
      });

      const anchor: AnchorResult = {
        txid: result.txid,
        eventType,
        isLinear: false,
        phase: (data as any).phase ?? 'unknown',
      };
      this.handTxids.push(anchor);
      this.log('EVENT', `${eventType} → ${result.txid.slice(0, 16)}... [${Date.now() - tEvent}ms]`);

      if (this.settleDelayEvent > 0) await new Promise(r => setTimeout(r, this.settleDelayEvent));
      return anchor;
    } catch (err: any) {
      this.log('EVENT', `✗ ${eventType}: ${err.message}`);
      return null;
    }
  }

  /**
   * Batch multiple events into a single OP_RETURN tx with multiple data pushes.
   * Much faster than individual anchorEvent calls — one wallet call instead of N.
   * Each event becomes a separate pushed field in the same OP_RETURN output.
   */
  async anchorEventBatch(
    events: { eventType: string; data: Record<string, unknown> }[],
  ): Promise<AnchorResult | null> {
    if (events.length === 0) return null;

    // Build one payload containing all events
    const batchPayload = JSON.stringify({
      proto: 'semantos-poker',
      v: 1,
      batch: true,
      count: events.length,
      events: events.map(e => ({
        event: e.eventType,
        ...e.data,
      })),
      ts: Date.now(),
    });

    const opReturnScript = buildOpReturnScript(batchPayload);
    const description = events.map(e => e.eventType).join('+');

    try {
      const result = await this.wallet.createAction({
        description: `batch(${events.length}): ${description.slice(0, 30)}`,
        labels: ['semantos-poker', 'batch'],
        outputs: [{
          lockingScript: opReturnScript,
          satoshis: 0,
          outputDescription: `batch: ${description}`,
        }],
      });

      const anchor: AnchorResult = {
        txid: result.txid,
        eventType: `batch(${events.length})`,
        isLinear: false,
        phase: (events[0].data as any).phase ?? 'unknown',
      };
      this.handTxids.push(anchor);
      this.log('BATCH', `${events.length} events → ${result.txid.slice(0, 16)}...`);

      if (this.settleDelayEvent > 0) await new Promise(r => setTimeout(r, this.settleDelayEvent));
      return anchor;
    } catch (err: any) {
      this.log('BATCH', `✗ ${description}: ${err.message}`);
      return null;
    }
  }

  // ── Accessors ──

  getHandTxids(): AnchorResult[] { return [...this.handTxids]; }
  getCurrentStateTxid(): string | null { return this.liveUtxo?.txid ?? null; }
  getMyPubKey(): string { return this.myPubKeyHex; }
  getOpponentPubKey(): string { return this.opponentPubKeyHex; }

  /** Check if I can spend the current UTXO (it's locked to my key) */
  canISpend(): boolean {
    return this.liveUtxo !== null && this.liveUtxo.lockedToKey === this.myPubKeyHex;
  }

  /** Get the live UTXO info (for sending BEEF to opponent) */
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

  private async buildCell(
    state: HandStatePayload,
    version?: number,
  ): Promise<{ cellBytes: Uint8Array; contentHash: Uint8Array }> {
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

    return {
      cellBytes,
      contentHash: hexToBytes(cellRef.contentHash),
    };
  }

  private log(label: string, msg: string): void {
    if (this.verbose) {
      console.log(`\x1b[35m[2PDA:${label}]\x1b[0m ${msg}`);
    }
  }
}

// ── Helpers ──

/** Build a standalone OP_RETURN script from a string payload */
function buildOpReturnScript(payload: string): string {
  const payloadHex = Buffer.from(payload).toString('hex');
  const lenBytes = payloadHex.length / 2;
  let pushPrefix: string;
  if (lenBytes < 76) {
    pushPrefix = lenBytes.toString(16).padStart(2, '0');
  } else if (lenBytes <= 255) {
    pushPrefix = '4c' + lenBytes.toString(16).padStart(2, '0');
  } else {
    pushPrefix = '4d' + (lenBytes & 0xff).toString(16).padStart(2, '0') +
      ((lenBytes >> 8) & 0xff).toString(16).padStart(2, '0');
  }
  return '006a' + pushPrefix + payloadHex;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
