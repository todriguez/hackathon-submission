/**
 * GameLoop — Orchestrates two Claude-powered agents playing poker.
 *
 * Wires together:
 *   - PokerStateMachine (2PDA-driven on-chain state transitions)
 *   - GameStateDB (local context, agent memory)
 *   - AgentRuntime × 2 (Claude API + personality)
 *   - WalletClient (BSV wallet for signing)
 *
 * On-chain architecture:
 *   - LINEAR CellTokens: Hand state (1-sat PushDrop, spend-to-transition)
 *     Each phase transition (preflop → flop → turn → river → showdown → complete)
 *     is a 2PDA-validated CellToken state transition. The hand's UTXO chain
 *     IS the authoritative state history.
 *
 *   - OP_RETURN events: Agent decisions, card reveals, chip movements (0-sat)
 *     These reference the current hand state txid, linking them to the
 *     linear state chain.
 *
 * Transactions flow in real time as the game progresses — not batched.
 * Each state transition is sequential (spend old → create new) because
 * the next state depends on the previous UTXO.
 */

import { GameStateDB } from './game-state-db';
import type { AgentRuntime } from './agent-runtime';
import type { WalletClient } from '../protocol/wallet-client';
import { PokerStateMachine } from './poker-state-machine';
import type { HandStatePayload, PokerPhase, AnchorResult } from './poker-state-machine';
import type { DirectPokerStateMachine } from './direct-poker-state-machine';
// PaymentChannelManager excluded — requires metering package
type PaymentChannelManager = any;
type ChannelInstance = any;
import { createHash } from 'crypto';
import type { GameLoopHandle } from './shadow-loop-types';

// Phase 29.5: Kernel enforcement imports
import { HostFunctionRegistry } from '../cell-engine/host-functions';
import { compilePokerPolicies, registerPokerHostFunctions, type CompiledPokerPolicies } from '../policies/poker-policies';

/** Union type: either wallet-based or direct-broadcast state machine */
type AnyStateMachine = PokerStateMachine | DirectPokerStateMachine;

// ── Types ──

/** Callback for streaming live game events to external consumers (visualizer, etc.) */
export type GameEventCallback = (event: GameEvent) => void;

export interface GameEvent {
  type: 'hand-start' | 'deal' | 'phase' | 'action' | 'tx' | 'hand-end' | 'game-over';
  matchId?: number;
  gameId: string;
  handNumber: number;
  ts: number;
  data: Record<string, unknown>;
}

export interface GameLoopConfig {
  gameId: string;
  smallBlind: number;
  bigBlind: number;
  startingChips: number;
  /** Max hands to play. 0 = until bust. */
  maxHands: number;
  /** Whether to anchor state transitions on-chain. */
  anchorOnChain: boolean;
  /** Delay between actions in ms (for UI/logging readability). */
  actionDelay: number;
  /** Log verbosity. */
  verbose: boolean;
  /** Turbo mode: zero settle delays, batch OP_RETURNs */
  turbo: boolean;
  /** Lean mode: skip per-action OP_RETURNs, only CellTokens + hand summary batch */
  lean: boolean;
  /** Claude model override. Default: claude-sonnet-4-20250514 */
  model?: string;
  /** Optional match ID for multi-match arena mode */
  matchId?: number;
  /** Event callback for live visualization */
  onEvent?: GameEventCallback;
  /** Payment channel manager (for real-sats mode) */
  channelManager?: PaymentChannelManager;
  /** Payment channel ID (set after channel is opened) */
  channelId?: string;
  /** Sats per chip (e.g., 1 chip = 1 sat). Default: 1 */
  satsPerChip?: number;
}

export const DEFAULT_GAME_CONFIG: GameLoopConfig = {
  gameId: `game-${Date.now()}`,
  smallBlind: 5,
  bigBlind: 10,
  startingChips: 1000,
  maxHands: 100,
  anchorOnChain: true,
  actionDelay: 500,
  verbose: true,
  turbo: false,
  lean: false,
};

export interface HandResult {
  handNumber: number;
  winner: string;
  potSize: number;
  actions: { player: string; action: string; amount: number; phase: string }[];
  txids: string[];
  /** The LINEAR state chain txids (CellToken transitions) */
  stateChain: string[];
}

interface CardDescriptor {
  suit: string;
  rank: number;
  label: string;
}

// ── Simplified poker for the game loop ──

type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

interface SimplePlayer {
  id: string;
  name: string;
  chips: number;
  currentBet: number;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  holeCards: CardDescriptor[];
}

interface SimpleTable {
  phase: Phase;
  pot: number;
  currentBet: number;
  minRaise: number;
  communityCards: CardDescriptor[];
  dealerIndex: number;
  activeIndex: number;
  handNumber: number;
}

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANK_LABELS = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck(): CardDescriptor[] {
  const deck: CardDescriptor[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ suit, rank, label: `${RANK_LABELS[rank]}${suit[0]}` });
    }
  }
  return deck;
}

function shuffleDeck(deck: CardDescriptor[]): CardDescriptor[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ── Game Loop ──

export class GameLoop {
  private config: GameLoopConfig;
  private db: GameStateDB;
  private agents: AgentRuntime[];
  private wallet: WalletClient | null;
  private stateMachine: AnyStateMachine | null = null;
  private players: SimplePlayer[];
  private table: SimpleTable;
  private deck: CardDescriptor[];
  private deckIndex: number;
  private currentHandId: number = 0;
  private totalTxCount: number = 0;
  private linearTxCount: number = 0;
  private eventTxCount: number = 0;
  private handResults: HandResult[] = [];
  /** Payment channel instance for this game (real-sats mode) */
  private channelInstance: ChannelInstance | null = null;
  /** Phase H4: Optional policy swapper for Apex Agent shadow loop */
  private policySwapper: GameLoopHandle | null = null;

  // Phase 29.5: Kernel enforcement for betting action validation
  private pokerRegistry: HostFunctionRegistry;
  private pokerPolicies: CompiledPokerPolicies;

  constructor(
    config: Partial<GameLoopConfig>,
    db: GameStateDB,
    agents: [AgentRuntime, AgentRuntime],
    wallet: WalletClient | null,
    /** Pre-built state machine (DirectPokerStateMachine). If provided, skips wallet-based SM creation. */
    injectedStateMachine?: AnyStateMachine,
  ) {
    this.config = { ...DEFAULT_GAME_CONFIG, ...config };
    this.db = db;
    this.agents = agents;
    this.wallet = wallet;
    if (injectedStateMachine) {
      this.stateMachine = injectedStateMachine;
    }

    // Phase 29.5: Compile poker policies and register host functions
    this.pokerRegistry = new HostFunctionRegistry();
    registerPokerHostFunctions(this.pokerRegistry);
    this.pokerPolicies = compilePokerPolicies();
    this.deck = [];
    this.deckIndex = 0;

    // Initialize players from agents
    this.players = agents.map((agent, i) => ({
      id: `player-${i}`,
      name: agent.personality.name,
      chips: this.config.startingChips,
      currentBet: 0,
      folded: false,
      allIn: false,
      hasActed: false,
      holeCards: [],
    }));

    this.table = {
      phase: 'complete',
      pot: 0,
      currentBet: 0,
      minRaise: this.config.bigBlind,
      communityCards: [],
      dealerIndex: 0,
      activeIndex: 0,
      handNumber: 0,
    };
  }

  /** Phase H4: Attach a policy swapper for Apex Agent shadow loop integration. */
  setPolicySwapper(swapper: GameLoopHandle): void {
    this.policySwapper = swapper;
  }

  /** Phase H4: Get the attached policy swapper (if any). */
  getPolicySwapper(): GameLoopHandle | null {
    return this.policySwapper;
  }

  /**
   * Run the full game loop. Returns when one player is bust or maxHands reached.
   */
  async run(): Promise<{ results: HandResult[]; totalTx: number }> {
    // Set up DB session
    this.db.createSession(this.config.gameId, {
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      startingChips: this.config.startingChips,
    });

    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i];
      this.db.addPlayer(this.config.gameId, {
        playerId: this.players[i].id,
        agentName: agent.agentName,
        certId: agent.getIdentity().keys.certId,
        walletPubKey: agent.getIdentity().keys.walletPubKey,
        seat: i,
        startingChips: this.config.startingChips,
      });
    }

    // Initialize the 2PDA state machine
    if (this.stateMachine) {
      // Injected (DirectPokerStateMachine) — already init'd or init now
      await this.stateMachine.init(this.config.gameId);
      this.log('2PDA', `DirectBroadcast state machine — LINEAR CellToken transitions via ARC${this.config.turbo ? ' (TURBO)' : ''}`);
    } else if (this.config.anchorOnChain && this.wallet) {
      this.stateMachine = new PokerStateMachine(this.wallet, {
        verbose: this.config.verbose,
        settleDelayLinear: this.config.turbo ? 0 : 1500,
        settleDelayEvent: this.config.turbo ? 0 : 300,
      });
      await this.stateMachine.init(this.config.gameId);
      this.log('2PDA', `Wallet state machine — LINEAR CellToken transitions enabled${this.config.turbo ? ' (TURBO)' : ''}`);
    }

    this.log('GAME', `Starting ${this.config.gameId} — ${this.agents[0].agentName} vs ${this.agents[1].agentName}`);
    this.log('GAME', `Blinds: ${this.config.smallBlind}/${this.config.bigBlind}, Starting: ${this.config.startingChips} chips`);

    // Main game loop
    while (
      this.table.handNumber < this.config.maxHands &&
      this.players.every(p => p.chips > 0)
    ) {
      await this.playHand();
    }

    // Game over
    const winner = this.players[0].chips > this.players[1].chips ? this.players[0] : this.players[1];
    this.log('GAME OVER', `${winner.name} wins! (${winner.chips} chips)`);
    this.log('STATS', `${this.table.handNumber} hands, ${this.totalTxCount} on-chain txns (${this.linearTxCount} LINEAR + ${this.eventTxCount} OP_RETURN)`);

    // Settle payment channel (real-sats mode)
    let settlementTxid: string | undefined;
    if (this.config.channelManager && this.config.channelId) {
      try {
        const settlement = await this.config.channelManager.settleChannel(this.config.channelId);
        settlementTxid = settlement.txid;
        this.totalTxCount++;
        this.log('SETTLE', `Channel settled: ${settlement.txid.slice(0, 16)}...`);
        this.emit('tx', {
          txid: settlement.txid,
          kind: 'settlement',
          label: 'channel-settle',
          kernelValidated: false,
          kernelOpcodeCount: 0,
        });
      } catch (err: any) {
        this.log('SETTLE', `⚠ Channel settlement failed: ${err.message}`);
      }
    }

    this.emit('game-over', {
      winner: winner.name,
      hands: this.table.handNumber,
      totalTx: this.totalTxCount,
      players: this.players.map(p => ({ name: p.name, chips: p.chips })),
      settlementTxid,
    });

    return { results: this.handResults, totalTx: this.totalTxCount };
  }

  // ── Single Hand ──

  private async playHand(): Promise<void> {
    this.table.handNumber++;
    this.table.pot = 0;
    this.table.currentBet = 0;
    this.table.minRaise = this.config.bigBlind;
    this.table.communityCards = [];
    this.table.phase = 'preflop';

    // Rotate dealer
    if (this.table.handNumber > 1) {
      this.table.dealerIndex = 1 - this.table.dealerIndex;
    }

    // Reset players
    for (const p of this.players) {
      p.currentBet = 0;
      p.folded = false;
      p.allIn = false;
      p.hasActed = false;
      p.holeCards = [];
    }

    const sbIdx = this.table.dealerIndex;
    const bbIdx = 1 - sbIdx;

    const handActions: HandResult['actions'] = [];
    const handTxids: string[] = [];
    const stateChain: string[] = [];

    // ── Shuffle + deal ──
    this.deck = shuffleDeck(createDeck());
    this.deckIndex = 0;
    const shuffleHash = createHash('sha256')
      .update(this.deck.map(c => c.label).join(','))
      .digest('hex').slice(0, 16);

    // Deal hole cards (before any anchoring, so the state is complete)
    for (const p of this.players) {
      p.holeCards = [this.drawCard(), this.drawCard()];
    }

    // Post blinds (and record in payment channel)
    this.placeBet(this.players[sbIdx], this.config.smallBlind);
    this.placeBet(this.players[bbIdx], this.config.bigBlind);
    this.table.currentBet = this.config.bigBlind;

    // Record blinds in payment channel
    if (this.config.channelManager && this.config.channelId) {
      const spc = this.config.satsPerChip ?? 1;
      const sbAgent = sbIdx === 0 ? 'A' as const : 'B' as const;
      const bbAgent = sbIdx === 0 ? 'B' as const : 'A' as const;
      try {
        await this.config.channelManager.recordBet(this.config.channelId, sbAgent, this.config.smallBlind * spc);
        await this.config.channelManager.recordBet(this.config.channelId, bbAgent, this.config.bigBlind * spc);
      } catch (err: any) {
        this.log('CHANNEL', `⚠ Blind tick failed: ${err.message}`);
      }
    }

    // Preflop: dealer (SB) acts first in heads-up
    this.table.activeIndex = sbIdx;

    // Record in DB
    this.currentHandId = this.db.startHand(this.config.gameId, this.table.handNumber, this.table.dealerIndex);
    this.db.recordSnapshot(this.currentHandId, {
      phase: 'preflop',
      pot: this.table.pot,
      communityCards: [],
      activePlayers: 2,
      currentBet: this.table.currentBet,
    });

    this.log('HAND', `#${this.table.handNumber} — Dealer: ${this.players[sbIdx].name}`);

    this.emit('hand-start', {
      dealer: this.players[sbIdx].name,
      players: this.players.map(p => ({ name: p.name, chips: p.chips })),
    });
    this.emit('deal', {
      players: this.players.map(p => ({ name: p.name, cards: p.holeCards.map(c => c.label) })),
    });

    // ══════════════════════════════════════════════════════════════
    // LINEAR STATE: Create initial CellToken (hand birth)
    // This is the v1 of the hand's on-chain state.
    // ══════════════════════════════════════════════════════════════
    if (this.stateMachine) {
      const initState = this.buildStatePayload('preflop', handActions);
      initState.shuffleCommit = shuffleHash;
      const anchor = await this.stateMachine.createHandToken(initState);
      if (anchor) {
        stateChain.push(anchor.txid);
        handTxids.push(anchor.txid);
        this.linearTxCount++;
        this.totalTxCount++;
        this.log('TX', `\x1b[32m✓ CellToken v1\x1b[0m ${anchor.txid} \x1b[90m(hand birth)\x1b[0m`);
        this.log('TX', `  https://whatsonchain.com/tx/${anchor.txid}`);
        this.emit('tx', { txid: anchor.txid, kind: 'celltoken', label: 'hand birth', version: 1, kernelValidated: anchor.kernelValidated ?? false, kernelOpcodeCount: anchor.kernelOpcodeCount ?? 0 });
      }

      // OP_RETURN: Blind posts + hole card commitments
      // In turbo mode, batch all into a single tx
      if (this.config.turbo && this.stateMachine) {
        const batchEvents: { eventType: string; data: Record<string, unknown> }[] = [];
        batchEvents.push({
          eventType: 'blind-post',
          data: {
            gameId: this.config.gameId, hand: this.table.handNumber,
            sb: { player: this.players[sbIdx].name, amount: this.config.smallBlind },
            bb: { player: this.players[bbIdx].name, amount: this.config.bigBlind },
            pot: this.table.pot,
          },
        });
        for (const p of this.players) {
          const cardHash = createHash('sha256')
            .update(p.holeCards.map(c => c.label).join(','))
            .digest('hex').slice(0, 16);
          batchEvents.push({
            eventType: 'deal-hole',
            data: { gameId: this.config.gameId, hand: this.table.handNumber, player: p.name, cardHash },
          });
        }
        const batchResult = await this.stateMachine.anchorEventBatch(batchEvents);
        if (batchResult) {
          handTxids.push(batchResult.txid);
          this.eventTxCount++;
          this.totalTxCount++;
          this.log('TX', `\x1b[33m✓ OP_RETURN\x1b[0m ${batchResult.txid} \x1b[90m(batch: blinds+deals)\x1b[0m`);
          this.emit('tx', { txid: batchResult.txid, kind: 'opreturn', label: 'blinds+deals' });
        }
      } else {
        const blindTx = await this.anchorEvent('blind-post', {
          sb: { player: this.players[sbIdx].name, amount: this.config.smallBlind },
          bb: { player: this.players[bbIdx].name, amount: this.config.bigBlind },
          pot: this.table.pot,
        }, handTxids);
        if (blindTx) this.log('TX', `\x1b[33m✓ OP_RETURN\x1b[0m ${blindTx} \x1b[90m(blinds)\x1b[0m`);

        for (const p of this.players) {
          const cardHash = createHash('sha256')
            .update(p.holeCards.map(c => c.label).join(','))
            .digest('hex').slice(0, 16);
          const dealTx = await this.anchorEvent('deal-hole', {
            player: p.name, cardHash,
          }, handTxids);
          if (dealTx) this.log('TX', `\x1b[33m✓ OP_RETURN\x1b[0m ${dealTx} \x1b[90m(deal ${p.name})\x1b[0m`);
        }
      }
    }

    // Play through all phases
    let handOver = false;
    const phases: Phase[] = ['preflop', 'flop', 'turn', 'river'];

    for (const phase of phases) {
      if (handOver) break;

      if (phase !== 'preflop') {
        this.table.phase = phase;
        this.drawCard(); // burn

        if (phase === 'flop') {
          this.table.communityCards.push(this.drawCard(), this.drawCard(), this.drawCard());
        } else {
          this.table.communityCards.push(this.drawCard());
        }

        // Reset for new betting round
        for (const p of this.players) {
          p.currentBet = 0;
          p.hasActed = false;
        }
        this.table.currentBet = 0;
        this.table.minRaise = this.config.bigBlind;
        this.table.activeIndex = 1 - this.table.dealerIndex;

        this.db.recordSnapshot(this.currentHandId, {
          phase,
          pot: this.table.pot,
          communityCards: this.table.communityCards.map(c => c.label),
          activePlayers: this.players.filter(p => !p.folded).length,
          currentBet: 0,
        });

        this.log(phase.toUpperCase(), `Board: ${this.table.communityCards.map(c => c.label).join(' ')}`);
        this.emit('phase', {
          phase,
          communityCards: this.table.communityCards.map(c => c.label),
          pot: this.table.pot,
        });

        // ══════════════════════════════════════════════════════════
        // LINEAR STATE TRANSITION: preflop → flop → turn → river
        // Spend v(n) CellToken, create v(n+1) with new board state.
        // This is where the 2PDA validates the transition.
        // ══════════════════════════════════════════════════════════
        if (this.stateMachine) {
          const phaseState = this.buildStatePayload(phase as PokerPhase, handActions);
          const anchor = await this.stateMachine.transition(phaseState);
          if (anchor) {
            stateChain.push(anchor.txid);
            handTxids.push(anchor.txid);
            this.linearTxCount++;
            this.totalTxCount++;
            this.log('TX', `\x1b[32m✓ CellToken v${stateChain.length}\x1b[0m ${anchor.txid} \x1b[90m(${phase})\x1b[0m`);
            this.log('TX', `  https://whatsonchain.com/tx/${anchor.txid}`);
            this.emit('tx', { txid: anchor.txid, kind: 'celltoken', label: phase, version: stateChain.length, kernelValidated: anchor.kernelValidated ?? false, kernelOpcodeCount: anchor.kernelOpcodeCount ?? 0 });
          }

          // OP_RETURN: Community card reveal (skip in lean mode — state is in CellToken)
          if (!this.config.lean) {
            const newCards = phase === 'flop'
              ? this.table.communityCards.slice(-3)
              : this.table.communityCards.slice(-1);
            const cardsTx = await this.anchorEvent('community-cards', {
              phase,
              cards: newCards.map(c => c.label),
              board: this.table.communityCards.map(c => c.label),
            }, handTxids);
            if (cardsTx) this.log('TX', `\x1b[33m✓ OP_RETURN\x1b[0m ${cardsTx} \x1b[90m(${phase} cards)\x1b[0m`);
          }
        }
      }

      // Betting round
      let roundDone = false;
      let safety = 20;

      while (!roundDone && safety-- > 0) {
        const active = this.players[this.table.activeIndex];
        if (active.folded || active.allIn) {
          this.table.activeIndex = 1 - this.table.activeIndex;
          continue;
        }

        // Get decision from agent
        const agent = this.agents[this.table.activeIndex];
        const ctx = this.buildHandContext(this.table.activeIndex);
        const decision = await agent.decide(this.config.gameId, ctx);

        // Phase 29.5: Kernel policy validation — reject illegal actions
        if (!this.validateActionPolicy(active, decision)) {
          this.log('POLICY', `\x1b[31m✗ ${active.name} ${decision.action} rejected by kernel policy — downgrading to fold\x1b[0m`);
          decision.action = 'fold';
          decision.amount = undefined;
        }

        // Execute action — track chip delta for payment channel
        const chipsBefore = active.chips;
        this.executeAction(active, decision);
        const chipsWagered = chipsBefore - active.chips; // always >= 0 for bets/calls/raises
        handActions.push({
          player: active.name,
          action: decision.action,
          amount: decision.amount ?? chipsWagered,
          phase,
        });

        // Record in DB
        const seq = this.db.recordAction(this.currentHandId, {
          playerId: active.id,
          actionType: decision.action,
          amount: decision.amount ?? 0,
          phase,
          chipsAfter: active.chips,
          potAfter: this.table.pot,
        });
        agent.advanceSeq(seq);

        this.log(`${active.name}`, `${decision.action}${decision.amount ? ' ' + decision.amount : ''} (${decision.reasoning})`);

        // Record action in payment channel (real-sats mode)
        // chipsWagered is the actual chip delta from executeAction (covers call, bet, raise, all-in)
        if (this.config.channelManager && this.config.channelId && chipsWagered > 0) {
          const satsPerChip = this.config.satsPerChip ?? 1;
          const satsBet = chipsWagered * satsPerChip;
          const fromAgent = this.table.activeIndex === 0 ? 'A' as const : 'B' as const;
          try {
            await this.config.channelManager.recordBet(this.config.channelId, fromAgent, satsBet);
          } catch (err: any) {
            this.log('CHANNEL', `⚠ Tick failed: ${err.message}`);
          }
        }

        this.emit('action', {
          player: active.name,
          action: decision.action,
          amount: decision.amount ?? 0,
          reasoning: decision.reasoning,
          phase,
          pot: this.table.pot,
          chips: active.chips,
        });

        // OP_RETURN: Anchor the agent's action in real time (skip in lean mode)
        if (this.stateMachine && !this.config.lean) {
          const actionTxid = await this.anchorEvent('action', {
            player: active.name,
            action: decision.action,
            amount: decision.amount ?? 0,
            phase,
            pot: this.table.pot,
            chipsAfter: active.chips,
            reasoning: decision.reasoning.slice(0, 80),
            seq,
          }, handTxids);
          if (actionTxid) {
            this.log('TX', `\x1b[33m✓ OP_RETURN\x1b[0m ${actionTxid} \x1b[90m(${active.name} ${decision.action})\x1b[0m`);
          }
        }

        // Check hand over (opponent folded)
        if (this.players.some(p => p.folded)) {
          const winner = this.players.find(p => !p.folded)!;
          winner.chips += this.table.pot;
          this.db.endHand(this.currentHandId, winner.id, this.table.pot);
          this.log('WIN', `${winner.name} wins ${this.table.pot} (opponent folded)`);
          this.emit('hand-end', {
            winner: winner.name,
            pot: this.table.pot,
            decidedBy: 'fold',
            players: this.players.map(p => ({ name: p.name, chips: p.chips })),
          });
          handOver = true;
          break;
        }

        // Check round done
        const canAct = this.players.filter(p => !p.folded && !p.allIn && !p.hasActed);
        if (canAct.length === 0) {
          roundDone = true;
        } else {
          this.table.activeIndex = 1 - this.table.activeIndex;
        }

        if (this.config.actionDelay > 0) {
          await new Promise(r => setTimeout(r, this.config.actionDelay));
        }
      }
    }

    // Showdown (if not already decided by fold)
    if (!handOver) {
      this.table.phase = 'showdown';
      const winner = this.simpleShowdown();
      winner.chips += this.table.pot;
      this.db.endHand(this.currentHandId, winner.id, this.table.pot);
      this.log('SHOWDOWN', `${winner.name} wins ${this.table.pot}`);
      this.emit('hand-end', {
        winner: winner.name,
        pot: this.table.pot,
        decidedBy: 'showdown',
        players: this.players.map(p => ({
          name: p.name, chips: p.chips,
          cards: p.holeCards.map(c => c.label),
        })),
        board: this.table.communityCards.map(c => c.label),
      });

      // OP_RETURN: Showdown reveal (skip in lean mode — results in final CellToken)
      if (this.stateMachine && !this.config.lean) {
        const showdownTx = await this.anchorEvent('showdown-reveal', {
          players: this.players.map(p => ({
            name: p.name,
            cards: p.holeCards.map(c => c.label),
            folded: p.folded,
          })),
          board: this.table.communityCards.map(c => c.label),
        }, handTxids);
        if (showdownTx) this.log('TX', `\x1b[33m✓ OP_RETURN\x1b[0m ${showdownTx} \x1b[90m(showdown)\x1b[0m`);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // LINEAR STATE TRANSITION: → complete
    // Final CellToken transition. The hand's on-chain state chain
    // is now a permanent, auditable record.
    // ══════════════════════════════════════════════════════════════
    if (this.stateMachine) {
      const winnerName = this.players.find(p => !p.folded)?.name ?? 'unknown';
      const finalState = this.buildStatePayload('complete', handActions);
      finalState.winner = winnerName;
      finalState.decidedBy = handOver ? 'fold' : 'showdown';
      const anchor = await this.stateMachine.endHand(finalState);
      if (anchor) {
        stateChain.push(anchor.txid);
        handTxids.push(anchor.txid);
        this.linearTxCount++;
        this.totalTxCount++;
        this.log('TX', `\x1b[32m✓ CellToken v${stateChain.length}\x1b[0m ${anchor.txid} \x1b[90m(complete)\x1b[0m`);
        this.log('TX', `  https://whatsonchain.com/tx/${anchor.txid}`);
        this.emit('tx', { txid: anchor.txid, kind: 'celltoken', label: 'complete', version: stateChain.length, kernelValidated: anchor.kernelValidated ?? false, kernelOpcodeCount: anchor.kernelOpcodeCount ?? 0 });
      }

      // OP_RETURN: Pot transfer + hand summary
      if (this.config.turbo && this.stateMachine) {
        const batchResult = await this.stateMachine.anchorEventBatch([
          {
            eventType: 'pot-award',
            data: {
              gameId: this.config.gameId, hand: this.table.handNumber,
              winner: winnerName, amount: this.table.pot,
              chips: this.players.map(p => ({ name: p.name, chips: p.chips })),
            },
          },
          {
            eventType: 'hand-summary',
            data: {
              gameId: this.config.gameId, hand: this.table.handNumber,
              winner: winnerName, pot: this.table.pot,
              decidedBy: handOver ? 'fold' : 'showdown', actions: handActions.length, stateChain,
            },
          },
        ]);
        if (batchResult) {
          handTxids.push(batchResult.txid);
          this.eventTxCount++;
          this.totalTxCount++;
          this.log('TX', `\x1b[33m✓ OP_RETURN\x1b[0m ${batchResult.txid} \x1b[90m(batch: pot+summary)\x1b[0m`);
          this.emit('tx', { txid: batchResult.txid, kind: 'opreturn', label: 'pot+summary' });
        }
      } else {
        const potTx = await this.anchorEvent('pot-award', {
          winner: winnerName, amount: this.table.pot,
          chips: this.players.map(p => ({ name: p.name, chips: p.chips })),
        }, handTxids);
        if (potTx) this.log('TX', `\x1b[33m✓ OP_RETURN\x1b[0m ${potTx} \x1b[90m(pot-award)\x1b[0m`);

        const summaryTx = await this.anchorEvent('hand-summary', {
          hand: this.table.handNumber, winner: winnerName, pot: this.table.pot,
          decidedBy: handOver ? 'fold' : 'showdown', actions: handActions.length, stateChain,
        }, handTxids);
        if (summaryTx) this.log('TX', `\x1b[33m✓ OP_RETURN\x1b[0m ${summaryTx} \x1b[90m(hand-summary)\x1b[0m`);
      }
    }

    // Report tx counts for this hand
    const handTxCount = handTxids.length;
    const handLinearCount = stateChain.length;
    this.log('CHAIN', `Hand #${this.table.handNumber}: ${handTxCount} txs (${handLinearCount} LINEAR state transitions + ${handTxCount - handLinearCount} OP_RETURN events)`);
    if (stateChain.length > 0) {
      this.log('CHAIN', `State: ${stateChain.map(t => t.slice(0, 10)).join(' → ')}`);
    }

    // Let agents reflect on the hand
    for (let i = 0; i < this.agents.length; i++) {
      const opponentIdx = 1 - i;
      const opponentActions = handActions
        .filter(a => a.player === this.players[opponentIdx].name)
        .map((a, idx) => ({ seq: idx, player: a.player, action: a.action, amount: a.amount, phase: a.phase }));

      await this.agents[i].reflect(this.config.gameId, {
        handNumber: this.table.handNumber,
        won: !this.players[i].folded && this.players[i].chips >= this.players[1 - i].chips,
        potSize: this.table.pot,
        opponentActions,
        showdown: !handOver,
      });
    }

    this.handResults.push({
      handNumber: this.table.handNumber,
      winner: this.players.find(p => !p.folded)?.name ?? 'unknown',
      potSize: this.table.pot,
      actions: handActions,
      txids: handTxids,
      stateChain,
    });

    this.log('CHIPS', `${this.players[0].name}: ${this.players[0].chips} | ${this.players[1].name}: ${this.players[1].chips}`);
  }

  // ── OP_RETURN Event Anchoring ──

  /**
   * Anchor a non-linear event via the state machine.
   * Sequential — awaits each tx before continuing.
   */
  private async anchorEvent(
    eventType: string,
    data: Record<string, unknown>,
    handTxids: string[],
  ): Promise<string | null> {
    if (!this.stateMachine) return null;
    const result = await this.stateMachine.anchorEvent(eventType, {
      gameId: this.config.gameId,
      hand: this.table.handNumber,
      ...data,
    });
    if (result) {
      handTxids.push(result.txid);
      this.eventTxCount++;
      this.totalTxCount++;
      return result.txid;
    }
    return null;
  }

  // ── State Payload Builder ──

  private buildStatePayload(phase: PokerPhase, actions: HandResult['actions']): HandStatePayload {
    return {
      gameId: this.config.gameId,
      handNumber: this.table.handNumber,
      phase,
      dealer: this.players[this.table.dealerIndex].name,
      players: this.players.map(p => ({
        name: p.name,
        chips: p.chips,
        folded: p.folded,
        allIn: p.allIn,
      })),
      pot: this.table.pot,
      communityCards: this.table.communityCards.map(c => c.label),
      currentBet: this.table.currentBet,
      actions: [...actions],
    };
  }

  // ── Phase 29.5: Kernel Policy Validation ──

  /**
   * Validate a betting action against compiled Lisp policies via the kernel.
   * Returns true if the action is legal, false if the policy rejects it.
   * When rejected, the agent's action is downgraded to fold.
   */
  private validateActionPolicy(
    player: SimplePlayer,
    decision: { action: string; amount?: number },
  ): boolean {
    const actionKey = decision.action === 'all-in' ? 'allIn' : decision.action;
    const policy = this.pokerPolicies[actionKey as keyof CompiledPokerPolicies];
    if (!policy) return true; // Unknown action, let executeAction handle it

    const toCall = this.table.currentBet - player.currentBet;

    // Freeze context for OP_CALLHOST predicates
    this.pokerRegistry.setContext({
      isActivePlayer: true, // Always true in the game loop (it's this player's turn)
      betToCall: toCall,
      betAmount: decision.amount ?? this.config.bigBlind,
      bigBlind: this.config.bigBlind,
      raiseBy: (decision.amount ?? (this.table.currentBet + this.table.minRaise)) - this.table.currentBet,
      minRaise: this.table.minRaise,
      playerChips: player.chips,
    });

    // Evaluate through host function registry (simulates OP_CALLHOST dispatch)
    // Each predicate reads from the frozen context
    const result = this.pokerRegistry.call(`is-active-player?`) === 1;

    // For compound policies, check all predicates
    let policyPassed = result;
    switch (actionKey) {
      case 'fold':
        // (is-active-player?) — always passes
        break;
      case 'check':
        // (and (is-active-player?) (no-bet-to-call?))
        policyPassed = result && this.pokerRegistry.call('no-bet-to-call?') === 1;
        break;
      case 'call':
        // (and (is-active-player?) (has-bet-to-call?))
        policyPassed = result && this.pokerRegistry.call('has-bet-to-call?') === 1;
        break;
      case 'bet':
        // (and (is-active-player?) (no-bet-to-call?) (meets-minimum-bet?))
        policyPassed = result
          && this.pokerRegistry.call('no-bet-to-call?') === 1
          && this.pokerRegistry.call('meets-minimum-bet?') === 1;
        break;
      case 'raise':
        // (and (is-active-player?) (has-bet-to-call?) (meets-minimum-raise?))
        policyPassed = result
          && this.pokerRegistry.call('has-bet-to-call?') === 1
          && this.pokerRegistry.call('meets-minimum-raise?') === 1;
        break;
      case 'allIn':
        // (and (is-active-player?) (has-chips?))
        policyPassed = result && this.pokerRegistry.call('has-chips?') === 1;
        break;
    }

    this.pokerRegistry.clearContext();
    return policyPassed;
  }

  // ── Action Execution ──

  private executeAction(player: SimplePlayer, decision: { action: string; amount?: number }): void {
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
        const amount = decision.amount ?? this.config.bigBlind;
        this.placeBet(player, amount);
        this.table.currentBet = player.currentBet;
        this.table.minRaise = amount;
        player.hasActed = true;
        this.players.filter(p => p !== player && !p.folded && !p.allIn).forEach(p => p.hasActed = false);
        break;
      }

      case 'raise': {
        const totalAmount = decision.amount ?? this.table.currentBet + this.table.minRaise;
        const toWager = totalAmount - player.currentBet;
        this.placeBet(player, toWager);
        this.table.currentBet = player.currentBet;
        this.table.minRaise = Math.max(this.table.minRaise, totalAmount - this.table.currentBet);
        player.hasActed = true;
        this.players.filter(p => p !== player && !p.folded && !p.allIn).forEach(p => p.hasActed = false);
        break;
      }

      case 'all-in': {
        const amount = player.chips;
        this.placeBet(player, amount);
        if (player.currentBet > this.table.currentBet) {
          this.table.minRaise = Math.max(this.table.minRaise, player.currentBet - this.table.currentBet);
          this.table.currentBet = player.currentBet;
          this.players.filter(p => p !== player && !p.folded && !p.allIn).forEach(p => p.hasActed = false);
        }
        player.hasActed = true;
        break;
      }
    }
  }

  private placeBet(player: SimplePlayer, amount: number): number {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.currentBet += actual;
    this.table.pot += actual;
    if (player.chips === 0) player.allIn = true;
    return actual;
  }

  private drawCard(): CardDescriptor {
    return this.deck[this.deckIndex++];
  }

  // ── Context Building ──

  private buildHandContext(playerIdx: number): import('./game-state-db').HandContext {
    const player = this.players[playerIdx];
    const opponent = this.players[1 - playerIdx];

    const ctx = this.db.getCurrentHandContext(this.config.gameId, this.agents[playerIdx].agentName);

    const handCtx = ctx ?? {
      handNumber: this.table.handNumber,
      dealerSeat: this.table.dealerIndex,
      myCards: [],
      communityCards: [],
      phase: this.table.phase,
      pot: this.table.pot,
      myChips: player.chips,
      opponentChips: opponent.chips,
      actions: [],
      legalActions: [],
    };

    handCtx.myCards = player.holeCards.map(c => c.label);
    handCtx.communityCards = this.table.communityCards.map(c => c.label);
    handCtx.pot = this.table.pot;
    handCtx.myChips = player.chips;
    handCtx.opponentChips = opponent.chips;
    handCtx.legalActions = this.getLegalActions(player);

    return handCtx;
  }

  private getLegalActions(player: SimplePlayer): string[] {
    const actions: string[] = ['fold'];
    const toCall = this.table.currentBet - player.currentBet;

    if (toCall === 0) {
      actions.push('check');
      actions.push(`bet (min ${this.config.bigBlind})`);
    } else {
      actions.push(`call ${toCall}`);
      const minRaise = this.table.currentBet + this.table.minRaise;
      if (player.chips + player.currentBet > this.table.currentBet) {
        actions.push(`raise (min ${minRaise})`);
      }
    }
    actions.push(`all-in ${player.chips}`);
    return actions;
  }

  // ── Simple Showdown ──

  private simpleShowdown(): SimplePlayer {
    const scores = this.players.map(p => {
      if (p.folded) return -1;
      const all = [...p.holeCards, ...this.table.communityCards];
      return all.reduce((sum, c) => sum + c.rank, 0);
    });
    return scores[0] >= scores[1] ? this.players[0] : this.players[1];
  }

  // ── Logging ──

  private log(label: string, msg: string): void {
    if (this.config.verbose) {
      console.log(`\x1b[36m[${label}]\x1b[0m ${msg}`);
    }
  }

  /** Emit a game event to the optional callback */
  private emit(type: GameEvent['type'], data: Record<string, unknown>): void {
    if (!this.config.onEvent) return;
    this.config.onEvent({
      type,
      matchId: this.config.matchId,
      gameId: this.config.gameId,
      handNumber: this.table.handNumber,
      ts: Date.now(),
      data,
    });
  }
}
