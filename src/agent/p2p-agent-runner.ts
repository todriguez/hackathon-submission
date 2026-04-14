/**
 * P2PAgentRunner — Standalone process for one player in a P2P poker match.
 *
 * Each player runs this on their own machine. The two processes
 * coordinate entirely via:
 *   1. MessageBox (BRC-103 authenticated P2P messaging)
 *   2. BSV mainnet (LINEAR CellToken state transitions)
 *
 * There is NO central server. The blockchain is the truth.
 * MessageBox is the envelope — BEEF passes through it so each
 * player validates the 2PDA locally.
 *
 * Architecture:
 *   This process                    Opponent's process
 *   ┌──────────────┐               ┌──────────────┐
 *   │ WalletClient │               │ WalletClient │
 *   │ AgentRuntime │               │ AgentRuntime │
 *   │ StateMachine │               │ StateMachine │
 *   │ Transport    │◄── msgbox ───►│ Transport    │
 *   └──────────────┘               └──────────────┘
 *          │                              │
 *          └──────── BSV mainnet ─────────┘
 *             (LINEAR CellToken UTXO chain)
 *
 * Turn protocol:
 *   1. Dealer (this process or opponent) creates hand CellToken v1
 *   2. CellToken locked to ACTIVE player's key
 *   3. Active player makes decision (Claude API)
 *   4. Active player spends CellToken, creates v(n+1) locked to opponent
 *   5. Active player sends BEEF via MessageBox
 *   6. Opponent receives, validates 2PDA, makes their decision
 *   7. Repeat until hand completes
 *
 * The CellToken alternates locks between players — whoever holds
 * the UTXO locked to their key has the move. You literally cannot
 * play out of turn because you can't sign the spend.
 *
 * Cross-references:
 *   poker-message-transport.ts — P2P transport wrapper
 *   poker-state-machine.ts    — CellToken state transitions
 *   agent-runtime.ts          — Claude API decision-making
 *   game-state-db.ts          — Local state tracking
 */

import { GameStateDB } from './game-state-db';
import type { AgentRuntime } from './agent-runtime';
import type { WalletClient } from '../protocol/wallet-client';
import { PokerStateMachine } from './poker-state-machine';
import type { HandStatePayload, PokerPhase, AnchorResult } from './poker-state-machine';
import { PokerMessageTransport } from './poker-message-transport';
import type { PokerMoveMessage, PokerControlMessage } from './poker-message-transport';
import { createHash } from 'crypto';

// ── Types ──

export interface P2PAgentConfig {
  /** Unique game identifier. Must match between both players. */
  gameId: string;
  /** Which seat this player occupies: 0 = Shark (dealer first hand), 1 = Turtle */
  seat: 0 | 1;
  /** Opponent's wallet identity public key (hex, 33 bytes compressed) */
  opponentIdentityKey: string;
  /** Blinds */
  smallBlind: number;
  bigBlind: number;
  startingChips: number;
  maxHands: number;
  verbose: boolean;
}

interface PlayerState {
  name: string;
  chips: number;
  currentBet: number;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  holeCards: { suit: string; rank: number; label: string }[];
}

interface TableState {
  phase: PokerPhase;
  pot: number;
  currentBet: number;
  minRaise: number;
  communityCards: { suit: string; rank: number; label: string }[];
  dealerSeat: number;
  handNumber: number;
}

export interface P2PHandResult {
  handNumber: number;
  winner: string;
  potSize: number;
  txids: string[];
  stateChain: string[];
}

// ── Card Utilities ──

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANK_LABELS = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
  const deck: { suit: string; rank: number; label: string }[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ suit, rank, label: `${RANK_LABELS[rank]}${suit[0]}` });
    }
  }
  return deck;
}

function shuffleDeck(deck: ReturnType<typeof createDeck>, seed: string) {
  // Deterministic shuffle from shared seed so both players get same deck
  const d = [...deck];
  let hash = createHash('sha256').update(seed).digest();
  for (let i = d.length - 1; i > 0; i--) {
    // Use 4 bytes of hash for each swap
    if (i % 8 === 0) {
      hash = createHash('sha256').update(hash).digest();
    }
    const offset = (i % 8) * 4;
    const j = (hash.readUInt32BE(offset) % (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ── P2P Agent Runner ──

export class P2PAgentRunner {
  private config: P2PAgentConfig;
  private db: GameStateDB;
  private agent: AgentRuntime;
  private wallet: WalletClient;
  private stateMachine: PokerStateMachine;
  private transport: PokerMessageTransport;

  private me: PlayerState;
  private opponent: PlayerState;
  private table: TableState;
  private handResults: P2PHandResult[] = [];
  private allTxids: { txid: string; type: string; hand: number; detail: string }[] = [];

  constructor(
    config: P2PAgentConfig,
    db: GameStateDB,
    agent: AgentRuntime,
    wallet: WalletClient,
  ) {
    this.config = config;
    this.db = db;
    this.agent = agent;
    this.wallet = wallet;

    this.stateMachine = new PokerStateMachine(wallet, { verbose: config.verbose });
    this.transport = new PokerMessageTransport(wallet, {
      opponentIdentityKey: config.opponentIdentityKey,
      gameId: config.gameId,
      verbose: config.verbose,
    });

    const myName = agent.personality.name;
    const opponentName = config.seat === 0 ? 'Turtle' : 'Shark';

    this.me = {
      name: myName,
      chips: config.startingChips,
      currentBet: 0, folded: false, allIn: false, hasActed: false, holeCards: [],
    };
    this.opponent = {
      name: opponentName,
      chips: config.startingChips,
      currentBet: 0, folded: false, allIn: false, hasActed: false, holeCards: [],
    };
    this.table = {
      phase: 'complete' as PokerPhase,
      pot: 0, currentBet: 0, minRaise: config.bigBlind,
      communityCards: [], dealerSeat: 0, handNumber: 0,
    };
  }

  // ── Main Loop ──

  async run(): Promise<{ results: P2PHandResult[]; allTxids: typeof this.allTxids }> {
    // Initialize all subsystems
    // P2P mode: pass opponent's key so CellTokens alternate locks
    await this.stateMachine.init(this.config.gameId, this.config.opponentIdentityKey);
    await this.transport.init();

    this.log('READY', `${this.me.name} (seat ${this.config.seat}) — waiting for opponent...`);

    // Handshake: both players announce themselves
    await this.transport.sendControl('handshake', {
      seat: this.config.seat,
      name: this.me.name,
      chips: this.config.startingChips,
    });

    // Wait for opponent's handshake
    const opHandshake = await this.waitForControl('handshake', 60_000);
    this.log('MATCHED', `Opponent: ${opHandshake.payload.name} (seat ${opHandshake.payload.seat})`);

    // Acknowledge
    await this.transport.sendControl('handshake-ack', { ready: true });

    // Start listening for moves
    const moveQueue: PokerMoveMessage[] = [];
    let moveResolver: ((m: PokerMoveMessage) => void) | null = null;

    await this.transport.startListening(
      // On move: resolve any pending wait, or queue it
      async (move) => {
        if (moveResolver) {
          const resolve = moveResolver;
          moveResolver = null;
          resolve(move);
        } else {
          moveQueue.push(move);
        }
      },
      // On control: handle game-over, new-hand signals
      async (ctrl) => {
        this.log('CTRL', `${ctrl.type}: ${JSON.stringify(ctrl.payload)}`);
      },
    );

    /** Block until a move arrives from the opponent */
    const waitForMove = (): Promise<PokerMoveMessage> => {
      if (moveQueue.length > 0) return Promise.resolve(moveQueue.shift()!);
      return new Promise(resolve => { moveResolver = resolve; });
    };

    // ── Game Loop ──
    while (
      this.table.handNumber < this.config.maxHands &&
      this.me.chips > 0 && this.opponent.chips > 0
    ) {
      await this.playHand(waitForMove);
    }

    // Game over
    await this.transport.sendControl('game-over', {
      winner: this.me.chips > this.opponent.chips ? this.me.name : this.opponent.name,
      myChips: this.me.chips,
    });

    this.log('GAME OVER', `${this.me.name}: ${this.me.chips} chips`);
    await this.transport.stopListening();

    return { results: this.handResults, allTxids: this.allTxids };
  }

  // ── Single Hand (P2P turn-based) ──

  private async playHand(waitForMove: () => Promise<PokerMoveMessage>): Promise<void> {
    this.table.handNumber++;
    this.table.pot = 0;
    this.table.currentBet = 0;
    this.table.minRaise = this.config.bigBlind;
    this.table.communityCards = [];
    this.table.phase = 'preflop';

    // Rotate dealer
    if (this.table.handNumber > 1) {
      this.table.dealerSeat = 1 - this.table.dealerSeat;
    }

    // Reset
    this.me.currentBet = 0; this.me.folded = false; this.me.allIn = false; this.me.hasActed = false; this.me.holeCards = [];
    this.opponent.currentBet = 0; this.opponent.folded = false; this.opponent.allIn = false; this.opponent.hasActed = false; this.opponent.holeCards = [];

    const handTxids: string[] = [];
    const stateChain: string[] = [];

    // Deterministic shuffle from game + hand number
    const shuffleSeed = `${this.config.gameId}:hand:${this.table.handNumber}`;
    const deck = shuffleDeck(createDeck(), shuffleSeed);
    let deckIdx = 0;
    const draw = () => deck[deckIdx++];

    // Deal (both players compute the same deck from the shared seed)
    const seat0Cards = [draw(), draw()];
    const seat1Cards = [draw(), draw()];
    this.me.holeCards = this.config.seat === 0 ? seat0Cards : seat1Cards;
    this.opponent.holeCards = this.config.seat === 0 ? seat1Cards : seat0Cards;

    // Post blinds (in heads-up, dealer = SB, non-dealer = BB)
    const iAmDealer = this.table.dealerSeat === this.config.seat;
    const sbPlayer = iAmDealer ? this.me : this.opponent;
    const bbPlayer = iAmDealer ? this.opponent : this.me;

    this.placeBet(sbPlayer, this.config.smallBlind);
    this.placeBet(bbPlayer, this.config.bigBlind);
    this.table.currentBet = this.config.bigBlind;

    this.log('HAND', `#${this.table.handNumber} — ${iAmDealer ? 'I am dealer (SB)' : 'Opponent is dealer'}`);
    this.log('CARDS', `My hand: ${this.me.holeCards.map(c => c.label).join(' ')}`);

    // ── Who acts first? In heads-up preflop, dealer (SB) acts first ──
    let myTurn = iAmDealer;

    // Key alternation: first-to-act (dealer preflop) gets the UTXO locked to them
    const myKey = this.stateMachine.getMyPubKey();
    const oppKey = this.stateMachine.getOpponentPubKey();
    const firstToActKey = iAmDealer ? myKey : oppKey;

    // ── Create hand CellToken if I'm dealer ──
    if (iAmDealer) {
      const initState = this.buildStatePayload('preflop');
      // Lock v1 to ME (dealer acts first in preflop)
      const anchor = await this.stateMachine.createHandToken(initState, myKey);
      if (anchor) {
        stateChain.push(anchor.txid);
        handTxids.push(anchor.txid);
        this.recordTx(anchor.txid, 'CellToken', `hand birth (v1) locked→ME`);

        // Send BEEF to opponent so they can track the state
        await this.transport.sendControl('new-hand', {
          handNumber: this.table.handNumber,
          txid: anchor.txid,
          beef: anchor.beef,
          vout: anchor.vout,
          lockingScript: anchor.lockingScript,
          cellVersion: anchor.cellVersion,
          lockedToKey: myKey,
          shuffleSeed,
        });
      }
    } else {
      // Wait for dealer to send new-hand signal with initial CellToken
      const newHandCtrl = await this.waitForControl('new-hand', 60_000);
      const initTxid = newHandCtrl.payload.txid as string;
      stateChain.push(initTxid);
      handTxids.push(initTxid);
      this.log('RECV', `Hand CellToken v1: ${initTxid.slice(0, 16)}... locked to opponent (dealer acts first)`);

      // Don't ingest BEEF yet — it's locked to opponent's key, not mine
      // I'll get the BEEF when the opponent sends their move and the UTXO flips to me
    }

    // ── Phase loop ──
    const phases: PokerPhase[] = ['preflop', 'flop', 'turn', 'river'];
    let handOver = false;

    for (const phase of phases) {
      if (handOver) break;

      if (phase !== 'preflop') {
        this.table.phase = phase;
        deckIdx++; // burn

        if (phase === 'flop') {
          this.table.communityCards.push(draw(), draw(), draw());
        } else {
          this.table.communityCards.push(draw());
        }

        // Reset betting
        this.me.currentBet = 0; this.me.hasActed = false;
        this.opponent.currentBet = 0; this.opponent.hasActed = false;
        this.table.currentBet = 0;
        this.table.minRaise = this.config.bigBlind;

        // Post-flop: non-dealer acts first
        myTurn = !iAmDealer;

        this.log(phase.toUpperCase(), `Board: ${this.table.communityCards.map(c => c.label).join(' ')}`);

        // Phase transition CellToken — whoever's turn it is creates it
        // Lock it to the active player (me if it's my turn)
        if (myTurn && this.stateMachine.canISpend()) {
          const phaseState = this.buildStatePayload(phase);
          // I spend the UTXO and create the next one still locked to ME
          // (because I'm about to act in this betting round)
          const anchor = await this.stateMachine.transition(phaseState, myKey);
          if (anchor) {
            stateChain.push(anchor.txid);
            handTxids.push(anchor.txid);
            this.recordTx(anchor.txid, 'CellToken', `${phase} transition (v${stateChain.length}) locked→ME`);
          }
        }
      }

      // ── Betting round ──
      let roundDone = false;
      let safety = 20;

      while (!roundDone && safety-- > 0) {
        if (myTurn) {
          // MY TURN: ask Claude, execute, send move to opponent
          const ctx = this.buildHandContext();
          const decision = await this.agent.decide(this.config.gameId, ctx);

          this.executeAction(this.me, decision);
          this.log(this.me.name, `${decision.action}${decision.amount ? ' ' + decision.amount : ''} (${decision.reasoning})`);

          // CellToken transition: spend UTXO locked to me, create next locked to OPPONENT
          // This is the P2P handoff — the UTXO passes to them
          let moveAnchor: AnchorResult | null = null;
          if (this.stateMachine.canISpend()) {
            const moveState = this.buildStatePayload(phase);
            moveState.actions = [{ player: this.me.name, action: decision.action, amount: decision.amount ?? 0, phase }];
            // Lock to OPPONENT — it's their turn next
            moveAnchor = await this.stateMachine.transition(moveState, oppKey);
            if (moveAnchor) {
              stateChain.push(moveAnchor.txid);
              handTxids.push(moveAnchor.txid);
              this.recordTx(moveAnchor.txid, 'CellToken', `${this.me.name} ${decision.action} → locked→OPPONENT`);
            }
          }

          // Also anchor as OP_RETURN for the action detail
          const eventResult = await this.stateMachine.anchorEvent('action', {
            gameId: this.config.gameId,
            hand: this.table.handNumber,
            player: this.me.name,
            action: decision.action,
            amount: decision.amount ?? 0,
            phase,
            pot: this.table.pot,
          });
          if (eventResult) {
            handTxids.push(eventResult.txid);
            this.recordTx(eventResult.txid, 'OP_RETURN', `${this.me.name} ${decision.action}`);
          }

          // Send move + BEEF to opponent via MessageBox
          await this.transport.sendMove({
            handNumber: this.table.handNumber,
            phase,
            action: decision.action,
            amount: decision.amount,
            beef: moveAnchor?.beef ?? [],
            txid: moveAnchor?.txid ?? eventResult?.txid ?? '',
            vout: moveAnchor?.vout ?? 0,
            lockingScript: moveAnchor?.lockingScript ?? '',
            cellVersion: moveAnchor?.cellVersion ?? 0,
          });

          // Check fold
          if (decision.action === 'fold') {
            this.me.folded = true;
            handOver = true;
            break;
          }
        } else {
          // OPPONENT'S TURN: wait for their move via MessageBox
          this.log('WAIT', `Waiting for ${this.opponent.name}...`);
          const move = await waitForMove();

          // Reconstruct opponent's action locally
          this.executeAction(this.opponent, { action: move.action, amount: move.amount });
          this.log(this.opponent.name, `${move.action}${move.amount ? ' ' + move.amount : ''}`);

          if (move.txid) {
            handTxids.push(move.txid);
            stateChain.push(move.txid);
            this.recordTx(move.txid, 'CellToken', `${this.opponent.name} ${move.action} (received) → locked→ME`);
          }

          // Ingest opponent's BEEF — the UTXO is now locked to MY key
          if (move.beef && move.beef.length > 0 && move.lockingScript) {
            this.stateMachine.acceptIncomingBeef({
              beef: move.beef,
              txid: move.txid,
              vout: move.vout,
              lockingScript: move.lockingScript,
              cellVersion: move.cellVersion,
            });
          }

          // Check fold
          if (move.action === 'fold') {
            this.opponent.folded = true;
            handOver = true;
            break;
          }
        }

        // Check round done
        const meCanAct = !this.me.folded && !this.me.allIn && !this.me.hasActed;
        const opCanAct = !this.opponent.folded && !this.opponent.allIn && !this.opponent.hasActed;
        if (!meCanAct && !opCanAct) {
          roundDone = true;
        } else {
          myTurn = !myTurn;
        }
      }
    }

    // ── Resolve hand ──
    let winnerName: string;
    if (handOver) {
      // Someone folded
      winnerName = this.me.folded ? this.opponent.name : this.me.name;
    } else {
      // Showdown (simplified)
      const myScore = this.me.holeCards.reduce((s, c) => s + c.rank, 0)
        + this.table.communityCards.reduce((s, c) => s + c.rank, 0);
      const opScore = this.opponent.holeCards.reduce((s, c) => s + c.rank, 0)
        + this.table.communityCards.reduce((s, c) => s + c.rank, 0);
      winnerName = myScore >= opScore ? this.me.name : this.opponent.name;
    }

    const winner = winnerName === this.me.name ? this.me : this.opponent;
    winner.chips += this.table.pot;
    this.log('WIN', `${winnerName} wins ${this.table.pot} (${handOver ? 'fold' : 'showdown'})`);

    // Final CellToken transition
    const finalState = this.buildStatePayload('complete');
    (finalState as any).winner = winnerName;
    (finalState as any).decidedBy = handOver ? 'fold' : 'showdown';
    const endAnchor = await this.stateMachine.endHand(finalState);
    if (endAnchor) {
      stateChain.push(endAnchor.txid);
      handTxids.push(endAnchor.txid);
      this.recordTx(endAnchor.txid, 'CellToken', `complete (v${stateChain.length})`);
    }

    this.log('CHAIN', `Hand #${this.table.handNumber}: ${handTxids.length} txs (${stateChain.length} LINEAR + ${handTxids.length - stateChain.length} OP_RETURN)`);
    if (stateChain.length > 0) {
      this.log('CHAIN', `State: ${stateChain.map(t => t.slice(0, 10)).join(' → ')}`);
    }
    this.log('CHIPS', `${this.me.name}: ${this.me.chips} | ${this.opponent.name}: ${this.opponent.chips}`);

    this.handResults.push({
      handNumber: this.table.handNumber,
      winner: winnerName,
      potSize: this.table.pot,
      txids: handTxids,
      stateChain,
    });
  }

  // ── Helpers ──

  private buildStatePayload(phase: PokerPhase): HandStatePayload {
    const players = this.config.seat === 0
      ? [this.me, this.opponent]
      : [this.opponent, this.me];
    return {
      gameId: this.config.gameId,
      handNumber: this.table.handNumber,
      phase,
      dealer: this.table.dealerSeat === this.config.seat ? this.me.name : this.opponent.name,
      players: players.map(p => ({
        name: p.name,
        chips: p.chips,
        folded: p.folded,
        allIn: p.allIn,
      })),
      pot: this.table.pot,
      communityCards: this.table.communityCards.map(c => c.label),
      currentBet: this.table.currentBet,
      actions: [],
    };
  }

  private buildHandContext(): import('./game-state-db').HandContext {
    return {
      handNumber: this.table.handNumber,
      dealerSeat: this.table.dealerSeat,
      myCards: this.me.holeCards.map(c => c.label),
      communityCards: this.table.communityCards.map(c => c.label),
      phase: this.table.phase,
      pot: this.table.pot,
      myChips: this.me.chips,
      opponentChips: this.opponent.chips,
      actions: [],
      legalActions: this.getLegalActions(),
    };
  }

  private getLegalActions(): string[] {
    const actions: string[] = ['fold'];
    const toCall = this.table.currentBet - this.me.currentBet;
    if (toCall === 0) {
      actions.push('check');
      actions.push(`bet (min ${this.config.bigBlind})`);
    } else {
      actions.push(`call ${toCall}`);
      if (this.me.chips + this.me.currentBet > this.table.currentBet) {
        actions.push(`raise (min ${this.table.currentBet + this.table.minRaise})`);
      }
    }
    actions.push(`all-in ${this.me.chips}`);
    return actions;
  }

  private executeAction(player: PlayerState, decision: { action: string; amount?: number }): void {
    switch (decision.action) {
      case 'fold':
        player.folded = true;
        player.hasActed = true;
        break;
      case 'check':
        player.hasActed = true;
        break;
      case 'call': {
        const toCall = this.table.currentBet - player.currentBet;
        this.placeBet(player, toCall);
        player.hasActed = true;
        break;
      }
      case 'bet': {
        const amt = decision.amount ?? this.config.bigBlind;
        this.placeBet(player, amt);
        this.table.currentBet = player.currentBet;
        this.table.minRaise = amt;
        player.hasActed = true;
        // Opponent must re-act
        const other = player === this.me ? this.opponent : this.me;
        if (!other.folded && !other.allIn) other.hasActed = false;
        break;
      }
      case 'raise': {
        const total = decision.amount ?? this.table.currentBet + this.table.minRaise;
        const toWager = total - player.currentBet;
        this.placeBet(player, toWager);
        this.table.currentBet = player.currentBet;
        this.table.minRaise = Math.max(this.table.minRaise, total - this.table.currentBet);
        player.hasActed = true;
        const other = player === this.me ? this.opponent : this.me;
        if (!other.folded && !other.allIn) other.hasActed = false;
        break;
      }
      case 'all-in': {
        const amt = player.chips;
        this.placeBet(player, amt);
        if (player.currentBet > this.table.currentBet) {
          this.table.minRaise = Math.max(this.table.minRaise, player.currentBet - this.table.currentBet);
          this.table.currentBet = player.currentBet;
          const other = player === this.me ? this.opponent : this.me;
          if (!other.folded && !other.allIn) other.hasActed = false;
        }
        player.hasActed = true;
        break;
      }
    }
  }

  private placeBet(player: PlayerState, amount: number): void {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.currentBet += actual;
    this.table.pot += actual;
    if (player.chips === 0) player.allIn = true;
  }

  private recordTx(txid: string, type: string, detail: string): void {
    this.allTxids.push({
      txid,
      type,
      hand: this.table.handNumber,
      detail,
    });
    this.log('TX', `${type === 'CellToken' ? '\x1b[32m✓' : '\x1b[33m✓'} ${type}\x1b[0m ${txid} \x1b[90m(${detail})\x1b[0m`);
    if (type === 'CellToken') {
      this.log('TX', `  https://whatsonchain.com/tx/${txid}`);
    }
  }

  private async waitForControl(type: string, timeoutMs: number): Promise<PokerControlMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
      const poll = setInterval(async () => {
        try {
          await this.transport.drainPending();
        } catch {}
      }, 2_000);

      // Override the transport's control handler temporarily
      const origHandler = (this.transport as any).onControl;
      (this.transport as any).onControl = async (msg: PokerControlMessage) => {
        if (msg.type === type) {
          clearTimeout(timer);
          clearInterval(poll);
          (this.transport as any).onControl = origHandler;
          resolve(msg);
        }
      };
    });
  }

  private log(label: string, msg: string): void {
    if (this.config.verbose) {
      console.log(`\x1b[36m[${this.me.name}:${label}]\x1b[0m ${msg}`);
    }
  }

  // ── Print audit log ──

  printAuditLog(): void {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  ${this.me.name} — On-Chain Transaction Audit Log`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let currentHand = 0;
    let txNum = 0;

    for (const entry of this.allTxids) {
      if (entry.hand !== currentHand) {
        currentHand = entry.hand;
        const handResult = this.handResults.find(r => r.handNumber === currentHand);
        console.log(`\x1b[36m── Hand #${currentHand} ──\x1b[0m  Winner: ${handResult?.winner ?? '?'} | Pot: ${handResult?.potSize ?? '?'}`);
      }
      txNum++;
      const color = entry.type === 'CellToken' ? '\x1b[32m' : '\x1b[33m';
      console.log(`  ${color}${String(txNum).padStart(3)}. [${entry.type}]\x1b[0m ${entry.txid}`);
      if (entry.type === 'CellToken') {
        console.log(`       https://whatsonchain.com/tx/${entry.txid}`);
      }
      console.log(`       ${entry.detail}`);
    }

    console.log(`\n\x1b[36mTotal: ${txNum} transactions on BSV mainnet\x1b[0m`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}
