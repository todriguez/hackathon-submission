/**
 * PokerMessageTransport — P2P transport for two-player poker via @bsv/message-box-client.
 *
 * Each player runs their own instance. The transport handles:
 *   - Sending moves (BEEF + game state) to the opponent
 *   - Receiving moves via WebSocket push (real-time)
 *   - Turn sequencing (move numbers prevent replays)
 *   - Mutual authentication via BRC-103 (wallet identity keys)
 *
 * Architecture:
 *   Player A                  MessageBox                  Player B
 *   (Shark)                  (babbage.systems)            (Turtle)
 *     │                           │                          │
 *     │── sendMove(beef,state) ──▶│                          │
 *     │                           │── WebSocket push ──────▶│
 *     │                           │                          │
 *     │                           │◀── sendMove(beef,state) ─│
 *     │◀── WebSocket push ────────│                          │
 *
 * The BEEF contains the full SPV proof of the CellToken transition.
 * The recipient validates the 2PDA locally before accepting.
 *
 * Message boxes:
 *   poker_moves    — CellToken transitions + game state
 *   poker_control  — Handshake, sync, game setup/teardown
 *
 * Cross-references:
 *   @bsv/message-box-client   — BRC-103 authenticated P2P messaging
 *   poker-state-machine.ts    — CellToken state transitions
 *   wallet-client.ts          — BRC-100 wallet for identity
 */

import type { WalletClient } from '../protocol/wallet-client';

// ── Types ──

/** Wire format for a poker move sent between players */
export interface PokerMoveMessage {
  type: 'move';
  /** Monotonic move number (prevents replays) */
  moveNum: number;
  /** Game identifier both players agreed on */
  gameId: string;
  /** Hand number within the game */
  handNumber: number;
  /** Current phase after this move */
  phase: string;
  /** The player's action */
  action: string;
  /** Bet/raise amount if applicable */
  amount?: number;
  /** BEEF of the CellToken transition (number[] for JSON safety) */
  beef: number[];
  /** Txid of the new CellToken UTXO */
  txid: string;
  /** Vout of the new CellToken */
  vout: number;
  /** Locking script hex of the new CellToken */
  lockingScript: string;
  /** Cell version number */
  cellVersion: number;
  /** Timestamp */
  ts: number;
}

/** Wire format for control messages (handshake, sync) */
export interface PokerControlMessage {
  type: 'handshake' | 'handshake-ack' | 'new-hand' | 'fold' | 'showdown' | 'game-over';
  gameId: string;
  /** Sender's identity public key */
  senderKey: string;
  /** Payload depends on type */
  payload: Record<string, unknown>;
  ts: number;
}

export type PokerMessage = PokerMoveMessage | PokerControlMessage;

export interface TransportConfig {
  /** Opponent's identity public key (hex, 33 bytes compressed) */
  opponentIdentityKey: string;
  /** Game identifier (must match between players) */
  gameId: string;
  /** MessageBox host. Default: https://messagebox.babbage.systems */
  host?: string;
  /** Enable debug logging */
  verbose?: boolean;
}

/** Callback when a move arrives from the opponent */
export type OnMoveCallback = (move: PokerMoveMessage) => void | Promise<void>;
/** Callback when a control message arrives */
export type OnControlCallback = (msg: PokerControlMessage) => void | Promise<void>;

// ── Transport ──

export class PokerMessageTransport {
  private wallet: WalletClient;
  private config: TransportConfig;
  private msgBoxClient: any = null; // MessageBoxClient — lazily loaded
  private myIdentityKey: string = '';
  private moveCounter: number = 0;
  private lastReceivedMove: number = -1;
  private onMove: OnMoveCallback | null = null;
  private onControl: OnControlCallback | null = null;
  private listening: boolean = false;
  private verbose: boolean;

  /** Message box names */
  private static readonly MOVES_BOX = 'poker_moves';
  private static readonly CONTROL_BOX = 'poker_control';

  constructor(wallet: WalletClient, config: TransportConfig) {
    this.wallet = wallet;
    this.config = config;
    this.verbose = config.verbose ?? false;
  }

  // ── Lifecycle ──

  /**
   * Initialize the transport: create MessageBoxClient, get identity key.
   * Must be called before send/listen.
   */
  async init(): Promise<void> {
    // Get our identity key from the wallet
    this.myIdentityKey = await this.wallet.getPublicKey({
      identityKey: true,
    });
    this.log('INIT', `My identity: ${this.myIdentityKey.slice(0, 20)}...`);
    this.log('INIT', `Opponent:    ${this.config.opponentIdentityKey.slice(0, 20)}...`);

    // Lazy-load and construct MessageBoxClient
    const { MessageBoxClient } = await import('@bsv/message-box-client');
    this.msgBoxClient = new MessageBoxClient({
      walletClient: this.wallet as any,
      host: this.config.host ?? 'https://messagebox.babbage.systems',
      enableLogging: this.verbose,
    });

    // Initialize (registers identity with the MessageBox server)
    await this.msgBoxClient.init();
    this.log('INIT', 'MessageBox client initialized');
  }

  /**
   * Start listening for incoming messages on both boxes.
   * Call after init(). Non-blocking — uses WebSocket push.
   */
  async startListening(onMove: OnMoveCallback, onControl: OnControlCallback): Promise<void> {
    this.onMove = onMove;
    this.onControl = onControl;
    this.listening = true;

    // Listen on poker_moves
    await this.msgBoxClient.listenForLiveMessages({
      messageBox: PokerMessageTransport.MOVES_BOX,
      onMessage: async (raw: any) => {
        try {
          const msg = typeof raw.body === 'string' ? JSON.parse(raw.body) : raw.body;
          await this.handleIncoming(msg, raw.messageId);
        } catch (err: any) {
          this.log('ERROR', `Failed to parse move: ${err.message}`);
        }
      },
    });

    // Listen on poker_control
    await this.msgBoxClient.listenForLiveMessages({
      messageBox: PokerMessageTransport.CONTROL_BOX,
      onMessage: async (raw: any) => {
        try {
          const msg = typeof raw.body === 'string' ? JSON.parse(raw.body) : raw.body;
          if (this.onControl) await this.onControl(msg);
          // Acknowledge control messages
          await this.msgBoxClient.acknowledgeMessage({ messageIds: [raw.messageId] });
        } catch (err: any) {
          this.log('ERROR', `Failed to parse control: ${err.message}`);
        }
      },
    });

    this.log('LISTEN', 'WebSocket listeners active on poker_moves + poker_control');

    // Also drain any queued messages from before we started listening
    await this.drainPending();
  }

  /**
   * Stop listening. Idempotent.
   */
  async stopListening(): Promise<void> {
    this.listening = false;
    // MessageBoxClient doesn't expose a disconnect method —
    // the WebSocket will close when the process exits.
    this.log('LISTEN', 'Stopped');
  }

  // ── Sending ──

  /**
   * Send a move to the opponent.
   * Includes the BEEF so they can validate the CellToken transition locally.
   */
  async sendMove(params: {
    handNumber: number;
    phase: string;
    action: string;
    amount?: number;
    beef: number[];
    txid: string;
    vout: number;
    lockingScript: string;
    cellVersion: number;
  }): Promise<void> {
    this.moveCounter++;

    const msg: PokerMoveMessage = {
      type: 'move',
      moveNum: this.moveCounter,
      gameId: this.config.gameId,
      handNumber: params.handNumber,
      phase: params.phase,
      action: params.action,
      amount: params.amount,
      beef: params.beef,
      txid: params.txid,
      vout: params.vout,
      lockingScript: params.lockingScript,
      cellVersion: params.cellVersion,
      ts: Date.now(),
    };

    await this.msgBoxClient.sendMessage({
      recipient: this.config.opponentIdentityKey,
      messageBox: PokerMessageTransport.MOVES_BOX,
      body: JSON.stringify(msg),
    });

    this.log('SEND', `Move #${msg.moveNum}: ${params.action}${params.amount ? ' ' + params.amount : ''} → ${params.txid.slice(0, 12)}...`);
  }

  /**
   * Send a control message (handshake, new-hand, game-over, etc.)
   */
  async sendControl(
    type: PokerControlMessage['type'],
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const msg: PokerControlMessage = {
      type,
      gameId: this.config.gameId,
      senderKey: this.myIdentityKey,
      payload,
      ts: Date.now(),
    };

    await this.msgBoxClient.sendMessage({
      recipient: this.config.opponentIdentityKey,
      messageBox: PokerMessageTransport.CONTROL_BOX,
      body: JSON.stringify(msg),
    });

    this.log('SEND', `Control: ${type}`);
  }

  // ── Receiving (pull-based fallback) ──

  /**
   * Poll for pending messages. Used as fallback if WebSocket isn't working,
   * and to drain any messages queued before we started listening.
   */
  async drainPending(): Promise<void> {
    // Drain move messages
    try {
      const moves = await this.msgBoxClient.listMessages({
        messageBox: PokerMessageTransport.MOVES_BOX,
      });
      if (moves?.length > 0) {
        this.log('DRAIN', `${moves.length} queued move(s)`);
        for (const raw of moves) {
          const msg = typeof raw.body === 'string' ? JSON.parse(raw.body) : raw.body;
          await this.handleIncoming(msg, raw.messageId);
        }
      }
    } catch (err: any) {
      this.log('DRAIN', `Move drain: ${err.message}`);
    }

    // Drain control messages
    try {
      const controls = await this.msgBoxClient.listMessages({
        messageBox: PokerMessageTransport.CONTROL_BOX,
      });
      if (controls?.length > 0) {
        this.log('DRAIN', `${controls.length} queued control message(s)`);
        for (const raw of controls) {
          const msg = typeof raw.body === 'string' ? JSON.parse(raw.body) : raw.body;
          if (this.onControl) await this.onControl(msg);
          await this.msgBoxClient.acknowledgeMessage({ messageIds: [raw.messageId] });
        }
      }
    } catch (err: any) {
      this.log('DRAIN', `Control drain: ${err.message}`);
    }
  }

  /**
   * Blocking wait for the next move from the opponent.
   * Uses a Promise that resolves when the WebSocket listener fires,
   * with a timeout fallback that polls.
   */
  async waitForMove(timeoutMs: number = 120_000): Promise<PokerMoveMessage> {
    return new Promise<PokerMoveMessage>((resolve, reject) => {
      const prevHandler = this.onMove;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.onMove = prevHandler;
          reject(new Error(`Timed out waiting for opponent move (${timeoutMs}ms)`));
        }
      }, timeoutMs);

      // Poll interval as fallback (in case WebSocket misses it)
      const pollInterval = setInterval(async () => {
        if (settled) { clearInterval(pollInterval); return; }
        try {
          await this.drainPending();
        } catch {}
      }, 5_000);

      this.onMove = async (move: PokerMoveMessage) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          clearInterval(pollInterval);
          this.onMove = prevHandler;
          resolve(move);
        }
      };
    });
  }

  // ── Accessors ──

  getMyIdentityKey(): string { return this.myIdentityKey; }
  getMoveCounter(): number { return this.moveCounter; }
  getLastReceivedMove(): number { return this.lastReceivedMove; }

  // ── Internals ──

  private async handleIncoming(msg: PokerMessage, messageId: string): Promise<void> {
    if (msg.type !== 'move') return;

    const move = msg as PokerMoveMessage;

    // Validate game ID
    if (move.gameId !== this.config.gameId) {
      this.log('REJECT', `Wrong gameId: ${move.gameId} (expected ${this.config.gameId})`);
      await this.msgBoxClient.acknowledgeMessage({ messageIds: [messageId] });
      return;
    }

    // Replay protection: must be strictly increasing
    if (move.moveNum <= this.lastReceivedMove) {
      this.log('REJECT', `Replayed move #${move.moveNum} (last: ${this.lastReceivedMove})`);
      await this.msgBoxClient.acknowledgeMessage({ messageIds: [messageId] });
      return;
    }

    this.lastReceivedMove = move.moveNum;
    this.log('RECV', `Move #${move.moveNum}: ${move.action}${move.amount ? ' ' + move.amount : ''} (hand ${move.handNumber}, ${move.phase}) txid=${move.txid.slice(0, 12)}...`);

    // Deliver to handler
    if (this.onMove) {
      await this.onMove(move);
    }

    // Acknowledge (removes from server)
    await this.msgBoxClient.acknowledgeMessage({ messageIds: [messageId] });
  }

  private log(label: string, msg: string): void {
    if (this.verbose) {
      console.log(`\x1b[34m[P2P:${label}]\x1b[0m ${msg}`);
    }
  }
}
