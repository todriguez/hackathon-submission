/**
 * Shared Poker Table Engine — extracted from casino-floor for reuse by apex predator.
 *
 * Contains: Card types, deck management, hand evaluation, kernel policy validation,
 * CellToken construction, heuristic action selection, and the core table runner loop.
 *
 * Both casino-floor and apex-predator import from this module.
 *
 * Cross-references:
 *   entrypoint.casino-floor.ts  — floor nodes
 *   entrypoint.apex-predator.ts — apex hunters
 *   poker-policies.ts           — Lisp policies + host function registration
 *   host-functions.ts           — HostFunctionRegistry
 *   cell-token.ts               — BRC-48 PushDrop construction
 */

import { PrivateKey, PublicKey } from '@bsv/sdk';
import { createHash } from 'crypto';
import { personaForIndex, type BotPersona } from './bot-personas';
import {
  compilePokerPolicies,
  registerPokerHostFunctions,
  type CompiledPokerPolicies,
} from '../policies/poker-policies';
import { HostFunctionRegistry } from '../cell-engine/host-functions';
import { CellStore } from '../protocol/cell-store';
import { MemoryAdapter } from '../protocol/adapters/memory-adapter';
import { Linearity } from '../protocol/constants';
import { CellToken } from '../protocol/cell-token';
import type { DirectBroadcastEngine, BroadcastResult } from '../agent/direct-broadcast-engine';

// ── Poker Hand Type Hash ──
export const POKER_HAND_TYPE_HASH = createHash('sha256')
  .update('semantos/poker/hand-state/v1')
  .digest();

// ── Fee Config (tuneable by entrypoints) ──

/** Fee rate for overlay cost estimates. Set via setFeeConfig(). Default: TAAL 0.1 sat/byte */
let FEE_RATE = 0.1;
let MIN_FEE = 25;

export function setFeeConfig(feeRate: number, minFee: number): void {
  FEE_RATE = feeRate;
  MIN_FEE = minFee;
}

// ── Kernel Bootstrap ──

export function bootstrapKernel(): { pokerPolicies: CompiledPokerPolicies; registry: HostFunctionRegistry } {
  const pokerPolicies = compilePokerPolicies();
  const registry = new HostFunctionRegistry();
  registerPokerHostFunctions(registry);
  return { pokerPolicies, registry };
}

// ── Card Types & Deck ──

export interface Card {
  rank: number; // 2-14 (2=2, 14=A)
  suit: number; // 0-3 (hearts, diamonds, clubs, spades)
  id: number;   // 0-51
}

const SUIT_NAMES = ['h', 'd', 'c', 's'];
const RANK_NAMES = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export function cardLabel(c: Card): string {
  return `${RANK_NAMES[c.rank]}${SUIT_NAMES[c.suit]}`;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ rank, suit, id: deck.length });
    }
  }
  return deck;
}

export function shuffle(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ── Hand Evaluator (simplified but real) ──

export function handStrength(holeCards: Card[], community: Card[]): number {
  const all = [...holeCards, ...community];
  let score = 0;

  const rankCounts = new Map<number, number>();
  for (const c of all) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
  }
  for (const [rank, count] of rankCounts) {
    if (count === 4) score += 700 + rank;
    else if (count === 3) score += 400 + rank;
    else if (count === 2) score += 100 + rank;
  }

  const ranks = all.map((c) => c.rank).sort((a, b) => b - a);
  score += ranks[0] * 2 + (ranks[1] ?? 0);

  const suitCounts = new Map<number, number>();
  for (const c of all) {
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }
  for (const count of suitCounts.values()) {
    if (count >= 5) score += 500;
  }

  const uniqueRanks = [...new Set(all.map((c) => c.rank))].sort((a, b) => a - b);
  for (let i = 0; i <= uniqueRanks.length - 5; i++) {
    if (uniqueRanks[i + 4] - uniqueRanks[i] === 4) score += 450;
  }

  return score;
}

// ── Policy Validation via Kernel Host Functions ──

export type PokerAction = 'fold' | 'check' | 'call' | 'raise' | 'bet' | 'all-in';

export interface ValidationResult {
  action: PokerAction;
  valid: boolean;
  policyName: string;
  contextSnapshot: Record<string, unknown>;
}

export function validateActionViaKernel(
  registry: HostFunctionRegistry,
  action: PokerAction,
  playerId: string,
  activePlayerId: string,
  betToCall: number,
  betAmount: number,
  minRaise: number,
  playerChips: number,
  bigBlind: number,
): ValidationResult {
  const isActive = playerId === activePlayerId;

  const ctx: Record<string, unknown> = {
    isActivePlayer: isActive,
    betToCall,
    betAmount,
    raiseBy: betAmount - betToCall,
    minRaise,
    playerChips,
    bigBlind,
  };

  registry.setContext(ctx);

  const policyNames: Record<PokerAction, string> = {
    fold: 'FOLD',
    check: 'CHECK',
    call: 'CALL',
    bet: 'BET',
    raise: 'RAISE',
    'all-in': 'ALL_IN',
  };

  let valid = true;
  switch (action) {
    case 'fold':
      valid = registry.call('is-active-player?') === 1;
      break;
    case 'check':
      valid =
        registry.call('is-active-player?') === 1 &&
        registry.call('no-bet-to-call?') === 1;
      break;
    case 'call':
      valid =
        registry.call('is-active-player?') === 1 &&
        registry.call('has-bet-to-call?') === 1;
      break;
    case 'bet':
      valid =
        registry.call('is-active-player?') === 1 &&
        registry.call('no-bet-to-call?') === 1 &&
        registry.call('meets-minimum-bet?') === 1;
      break;
    case 'raise':
      valid =
        registry.call('is-active-player?') === 1 &&
        registry.call('has-bet-to-call?') === 1 &&
        registry.call('meets-minimum-raise?') === 1;
      break;
    case 'all-in':
      valid =
        registry.call('is-active-player?') === 1 &&
        registry.call('has-chips?') === 1;
      break;
  }

  registry.clearContext();

  return { action, valid, policyName: policyNames[action], contextSnapshot: ctx };
}

// ── Cell Construction ──

export interface CellAuditEntry {
  handId: string;
  phase: string;
  version: number;
  cellSize: number;
  semanticPath: string;
  contentHash: string;
  ownerPubKey: string;
  linearity: string;
  prevStateHash: string | null;
  scriptHex: string | null;
  /** Full PushDrop locking script hex (for shadow overlay) */
  fullScriptHex: string;
  /** The JSON state payload that was encoded into the cell */
  statePayload: Record<string, unknown>;
  /** Simulated txid — sha256 of the full script (deterministic, unique per cell) */
  shadowTxid: string;
  /** K6 chain link: sha256 of cell bytes */
  cellHash: string;
  /** Timestamp of cell construction */
  timestamp: number;
  wouldBroadcast: {
    type: 'CellToken' | 'OP_RETURN';
    estimatedBytes: number;
    estimatedFeeSats: number;
  };
}

export async function buildStateCell(
  gameId: string,
  handNumber: number,
  phase: string,
  statePayload: Record<string, unknown>,
  version: number,
  ownerPubKey: PublicKey,
  prevCellHash: string | null,
): Promise<{
  cellBytes: Uint8Array;
  contentHash: Uint8Array;
  semanticPath: string;
  scriptHex: string;
  audit: CellAuditEntry;
}> {
  const storage = new MemoryAdapter();
  const cellStore = new CellStore(storage);
  const semanticPath = `semantos:game/poker/${gameId}/hand-${handNumber}/${phase}`;
  const ownerId = createHash('sha256')
    .update(gameId)
    .digest()
    .subarray(0, 16);

  const payload = `semantos:${JSON.stringify({ gameId, handNumber, phase, v: version, ...statePayload })}`;
  const cellData = new TextEncoder().encode(payload);

  await cellStore.put(semanticPath, cellData, {
    linearity: Linearity.LINEAR,
    ownerId,
    typeHash: POKER_HAND_TYPE_HASH,
  });

  const cellBytes = await storage.read(semanticPath);
  if (!cellBytes) throw new Error('Failed to read constructed cell');

  if (version > 1) {
    const dv = new DataView(cellBytes.buffer, cellBytes.byteOffset, cellBytes.byteLength);
    dv.setUint32(20, version, true);
  }

  if (prevCellHash) {
    const prevBytes = Buffer.from(prevCellHash, 'hex');
    cellBytes.set(prevBytes.subarray(0, 32), 128);
  }

  const contentHash = createHash('sha256').update(cellData).digest();

  const lockingScript = CellToken.createOutputScript(
    cellBytes,
    semanticPath,
    contentHash,
    ownerPubKey,
  );
  const scriptHex = Buffer.from(lockingScript.toBinary()).toString('hex');

  const cellHashHex = createHash('sha256').update(cellBytes).digest('hex');
  const shadowTxid = createHash('sha256').update(scriptHex).digest('hex');

  const audit: CellAuditEntry = {
    handId: `${gameId}-hand-${handNumber}`,
    phase,
    version,
    cellSize: cellBytes.length,
    semanticPath,
    contentHash: contentHash.toString('hex'),
    ownerPubKey: ownerPubKey.toString().slice(0, 20) + '...',
    linearity: 'LINEAR',
    prevStateHash: prevCellHash,
    scriptHex: scriptHex.slice(0, 64) + '...',
    fullScriptHex: scriptHex,
    statePayload: statePayload,
    shadowTxid,
    cellHash: cellHashHex,
    timestamp: Date.now(),
    wouldBroadcast: {
      type: 'CellToken',
      estimatedBytes: 10 + 148 + 34 + 34, // overhead + input + CellToken out + change out (raw tx, not script)
      estimatedFeeSats: Math.max(MIN_FEE, Math.ceil((10 + 148 + 34 + 34) * FEE_RATE)),
    },
  };

  return { cellBytes, contentHash, semanticPath, scriptHex, audit };
}

// ── Swarm Moving Average (Adaptive Heuristic) ──

/**
 * Exponential moving average tracker for heuristic bots.
 * Adjusts persona parameters based on recent win/loss streaks,
 * creating emergent swarm adaptation that Paskian can detect.
 */
export class SwarmEMA {
  /** EMA of chip delta per hand (positive = winning) */
  emaChipDelta = 0;
  /** EMA of win rate (0-1) */
  emaWinRate = 0.25; // start at expected 1-in-4
  /** Number of hands observed */
  handsObserved = 0;
  /** EMA smoothing factor (lower = slower adaptation) */
  readonly alpha: number;

  constructor(alpha = 0.05) {
    this.alpha = alpha;
  }

  /** Update after a hand completes */
  update(won: boolean, chipDelta: number): void {
    this.handsObserved++;
    this.emaWinRate = this.alpha * (won ? 1 : 0) + (1 - this.alpha) * this.emaWinRate;
    this.emaChipDelta = this.alpha * chipDelta + (1 - this.alpha) * this.emaChipDelta;
  }

  /**
   * Return adjusted persona parameters based on EMA state.
   * Losing → tighten up (higher fold threshold, less bluffing)
   * Winning → loosen up (more aggression, more raises)
   * This creates a negative feedback loop that stabilizes the swarm.
   */
  adaptPersona(base: BotPersona): BotPersona {
    if (this.handsObserved < 5) return base; // need some data first

    // How far above/below expected win rate (0.25 for 4-player)
    const winDrift = this.emaWinRate - 0.25;
    // Clamp to [-0.2, +0.2] range for adjustment
    const adj = Math.max(-0.2, Math.min(0.2, winDrift));

    // Losing streak → tighten: higher fold threshold, less aggression/bluffing
    // Winning streak → loosen: lower fold threshold, more aggression/bluffing
    return {
      ...base,
      foldThreshold: clamp(base.foldThreshold - adj * 0.5, 0.1, 0.85),
      aggression: clamp(base.aggression + adj * 0.3, 0.05, 0.95),
      raiseFrequency: clamp(base.raiseFrequency + adj * 0.2, 0.05, 0.85),
      bluffFrequency: clamp(base.bluffFrequency + adj * 0.15, 0.0, 0.5),
    };
  }

  /** Snapshot for reporting to Paskian / router */
  snapshot(): { emaWinRate: number; emaChipDelta: number; handsObserved: number } {
    return {
      emaWinRate: parseFloat(this.emaWinRate.toFixed(4)),
      emaChipDelta: parseFloat(this.emaChipDelta.toFixed(2)),
      handsObserved: this.handsObserved,
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Heuristic Decision Engine ──

export function selectHeuristicAction(
  persona: BotPersona,
  playerChips: number,
  currentBet: number,
  playerBet: number,
  pot: number,
  handStr: number,
  isLatePosition: boolean,
  bigBlind: number,
): { action: PokerAction; amount: number } {
  const toCall = currentBet - playerBet;
  const normalizedStrength = Math.min(1, handStr / 800);

  const shouldFold = normalizedStrength < persona.foldThreshold;
  const wantsToRaise = Math.random() < persona.raiseFrequency;
  const isBluffing = Math.random() < persona.bluffFrequency;
  const posBonus = isLatePosition ? 0.1 : 0;
  const effectiveStr = normalizedStrength + posBonus;

  if (toCall === 0) {
    if (wantsToRaise && (effectiveStr > 0.5 || isBluffing)) {
      const raiseSize = Math.max(bigBlind, Math.floor(pot * (0.5 + persona.aggression * 0.5)));
      return { action: 'bet', amount: Math.min(raiseSize, playerChips) };
    }
    return { action: 'check', amount: 0 };
  }

  if (shouldFold && !isBluffing) {
    return { action: 'fold', amount: 0 };
  }

  if (wantsToRaise && (effectiveStr > 0.65 || isBluffing) && playerChips > toCall * 2) {
    const raiseSize = Math.max(bigBlind, Math.floor(toCall * (1.5 + persona.aggression)));
    return { action: 'raise', amount: Math.min(raiseSize, playerChips) };
  }

  if (playerChips >= toCall) {
    return { action: 'call', amount: toCall };
  }

  return { action: 'all-in', amount: playerChips };
}

// ── Player Identity ──

export interface PlayerIdentity {
  playerId: string;
  privateKey: PrivateKey;
  publicKey: PublicKey;
  address: string;
  persona: BotPersona;
}

export function derivePlayerIdentity(seedPrefix: string, tableIndex: number, seatIndex: number, seatsPerTable: number): PlayerIdentity {
  const seed = createHash('sha256')
    .update(`${seedPrefix}-table-${tableIndex}-seat-${seatIndex}-v1`)
    .digest('hex');
  const privKey = PrivateKey.fromString(seed.slice(0, 64), 'hex');
  const pubKey = privKey.toPublicKey();
  const personaIndex = (tableIndex * seatsPerTable + seatIndex) % 4;

  return {
    playerId: `player-${pubKey.toString().slice(0, 16)}`,
    privateKey: privKey,
    publicKey: pubKey,
    address: pubKey.toAddress(),
    persona: personaForIndex(personaIndex),
  };
}

export function deriveIdentityFromSeed(seedString: string, persona: BotPersona): PlayerIdentity {
  const seed = createHash('sha256').update(seedString).digest('hex');
  const privKey = PrivateKey.fromString(seed.slice(0, 64), 'hex');
  const pubKey = privKey.toPublicKey();

  return {
    playerId: `player-${pubKey.toString().slice(0, 16)}`,
    privateKey: privKey,
    publicKey: pubKey,
    address: pubKey.toAddress(),
    persona,
  };
}

// ── Seat State ──

export interface SeatState {
  identity: PlayerIdentity;
  chips: number;
  currentBet: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
}

// ── Action Record ──

export interface HandAction {
  playerId: string;
  action: PokerAction;
  amount: number;
  phase: string;
  validated: boolean;
  policyName: string;
}

// ── Table Runner Configuration ──

// ── Premium Hand Detection ──

export type PremiumHandRank = 'four-of-a-kind' | 'straight-flush' | 'royal-flush';

export interface PremiumHandEvent {
  handRank: PremiumHandRank;
  playerId: string;
  cards: string;
  communityCards: string;
  pot: number;
  handNumber: number;
  shadowTxid?: string;
}

/**
 * Detect premium hands (quads, straight flush, royal flush) from hole + community cards.
 * Uses the same Card type as the table engine.
 */
export function detectPremiumHand(holeCards: Card[], communityCards: Card[]): PremiumHandRank | null {
  const all = [...holeCards, ...communityCards];
  if (all.length < 5) return null;

  // Generate all C(n,5) combinations
  const combos: Card[][] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      for (let k = j + 1; k < all.length; k++)
        for (let l = k + 1; l < all.length; l++)
          for (let m = l + 1; m < all.length; m++)
            combos.push([all[i], all[j], all[k], all[l], all[m]]);

  let best: PremiumHandRank | null = null;

  for (const combo of combos) {
    const ranks = combo.map(c => c.rank).sort((a, b) => a - b);
    const suits = combo.map(c => c.suit);

    // Check four of a kind
    const rankCounts = new Map<number, number>();
    for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
    for (const count of rankCounts.values()) {
      if (count === 4) best = best === 'royal-flush' || best === 'straight-flush' ? best : 'four-of-a-kind';
    }

    // Check flush (all same suit)
    const isFlush = suits.every(s => s === suits[0]);

    // Check straight
    const isStraight = (ranks[4] - ranks[0] === 4 && new Set(ranks).size === 5) ||
      // Ace-low straight: A,2,3,4,5 → ranks [2,3,4,5,14]
      (ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 4 && ranks[3] === 5 && ranks[4] === 14);

    if (isFlush && isStraight) {
      // Royal flush: 10,J,Q,K,A of same suit
      if (ranks[0] === 10 && ranks[4] === 14) {
        return 'royal-flush'; // Can't beat this, return immediately
      }
      best = best === 'royal-flush' ? best : 'straight-flush';
    }
  }

  return best;
}

export interface TableRunnerConfig {
  tableId: string;
  gameId: string;
  seatsPerTable: number;
  handsPerTable: number;
  handDelayMs: number;
  actionDelayMs: number;
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  /** Optional per-action callback (for multicast, logging, etc.) */
  onAction?: (action: HandAction, tableId: string, handNumber: number) => void;
  /** Optional per-hand callback */
  onHandComplete?: (tableId: string, handNumber: number, winner: SeatState, pot: number, actions: HandAction[]) => void;
  /** Optional: called with cell audit entries after each hand (for shadow overlay) */
  onCells?: (cells: CellAuditEntry[]) => void;
  /** Optional DirectBroadcastEngine for live on-chain CellToken broadcast */
  broadcastEngine?: DirectBroadcastEngine;
  /** Stream ID for this table's broadcasts (default: 0) */
  broadcastStreamId?: number;
  /** Elimination mode: busted players are permanently eliminated (no auto-rebuy) */
  eliminationMode?: boolean;
  /** Called when a seat busts out in elimination mode. Return a replacement SeatState or null to leave empty. */
  onElimination?: (bustedSeat: SeatState, tableId: string, seatIndex: number, handNumber: number) => SeatState | null;
  /** Called when a player rebuys (non-elimination mode). Use to track rebuy count/cost. */
  onRebuy?: (seat: SeatState, rebuyAmount: number, handNumber: number) => void;
  /** Called when a premium hand (quads, straight flush, royal flush) is detected */
  onPremiumHand?: (event: PremiumHandEvent) => void;
  /** Enable swarm EMA adaptation for heuristic bots */
  enableSwarmEMA?: boolean;
  /** EMA smoothing factor (default 0.05 — 20-hand half-life) */
  swarmEMAAlpha?: number;
  /** Called periodically with EMA snapshots for Paskian/router reporting */
  onSwarmUpdate?: (snapshots: Array<{ playerId: string; persona: string; ema: ReturnType<SwarmEMA['snapshot']> }>) => void;
}

export interface TableRunnerResult {
  hands: number;
  txs: number;
  validations: number;
  rejections: number;
  cellAuditLog: CellAuditEntry[];
  /** Txids of broadcast CellTokens (only populated when broadcastEngine is set) */
  broadcastTxids: string[];
  /** Number of players eliminated (elimination mode only) */
  eliminations: number;
  /** Number of unique players who have sat at this table */
  uniquePlayers: number;
}

/**
 * Custom decision function type — allows the apex to plug in smarter play.
 * When provided for a seat, overrides the default heuristic.
 */
export type DecisionFn = (
  seat: SeatState,
  currentBet: number,
  pot: number,
  communityCards: Card[],
  isLatePosition: boolean,
  bigBlind: number,
) => { action: PokerAction; amount: number };

/**
 * Run a poker table with the given seats and configuration.
 * Supports optional custom decision functions per seat index.
 */
export async function runTableEngine(
  config: TableRunnerConfig,
  seats: SeatState[],
  registry: HostFunctionRegistry,
  customDecisions?: Map<number, DecisionFn>,
): Promise<TableRunnerResult> {
  const cellAuditLog: CellAuditEntry[] = [];
  const broadcastTxids: string[] = [];
  let handCellStartIdx = 0;
  let handsPlayed = 0;
  let totalTxs = 0;
  let totalValidations = 0;
  let totalRejections = 0;
  let totalEliminations = 0;
  const uniquePlayerIds = new Set<string>(seats.map(s => s.identity.playerId));
  let dealerIdx = 0;
  let prevCellHash: string | null = null;
  let cellVersion = 0;
  const engine = config.broadcastEngine;
  const streamId = config.broadcastStreamId ?? 0;

  // Swarm EMA trackers — one per seat (keyed by seat index)
  const seatEMAs = new Map<number, SwarmEMA>();
  if (config.enableSwarmEMA) {
    for (let i = 0; i < seats.length; i++) {
      seatEMAs.set(i, new SwarmEMA(config.swarmEMAAlpha ?? 0.05));
    }
  }

  // Helper: broadcast a cell if engine is available
  async function maybeBroadcast(cellBytes: Uint8Array, semanticPath: string, contentHash: Uint8Array): Promise<void> {
    if (!engine) return;
    try {
      const result = await engine.createCellToken(streamId, cellBytes, semanticPath, contentHash);
      broadcastTxids.push(result.txid);
    } catch (err: any) {
      // Don't crash the game loop on broadcast failure
      if (config.broadcastEngine) {
        console.log(`[broadcast] Failed: ${err.message}`);
      }
    }
  }

  const tableOwner = seats[0].identity;

  for (let h = 0; h < config.handsPerTable; h++) {
    const rebuyThreshold = config.bigBlind;

    if (config.eliminationMode) {
      // Elimination mode: busted players get replaced by fresh bots (or left empty)
      for (let si = 0; si < seats.length; si++) {
        const s = seats[si];
        if (s.chips < rebuyThreshold) {
          totalEliminations++;
          // Build elimination CellToken
          totalTxs++;
          const elimCell = await buildStateCell(
            config.gameId, h, 'elimination' as any,
            {
              playerId: s.identity.playerId,
              finalChips: s.chips,
              handsPlayed: h,
              reason: 'busted',
            },
            cellVersion++,
            tableOwner.publicKey,
            prevCellHash,
          );
          cellAuditLog.push(elimCell.audit);
          await maybeBroadcast(elimCell.cellBytes, elimCell.semanticPath, elimCell.contentHash);
          prevCellHash = createHash('sha256').update(elimCell.cellBytes).digest('hex');
          if (config.onCells) config.onCells([elimCell.audit]);

          // Try to get a replacement
          const replacement = config.onElimination?.(s, config.tableId, si, h) ?? null;
          if (replacement) {
            seats[si] = replacement;
            uniquePlayerIds.add(replacement.identity.playerId);
          } else {
            // Mark as permanently dead
            s.chips = 0;
            s.folded = true;
          }
        }
      }
    } else {
      // Original auto-rebuy: any player below 1 big blind gets topped back up.
      for (const s of seats) {
        if (s.chips < rebuyThreshold) {
          const rebuyAmount = config.startingChips - s.chips;
          s.chips = config.startingChips;
          totalTxs++;
          config.onRebuy?.(s, rebuyAmount, h);
          const rebuyCell = await buildStateCell(
            config.gameId, h, 'rebuy' as any,
            {
              playerId: s.identity.playerId,
              rebuyAmount,
              newStack: s.chips,
              reason: 'auto-rebuy',
            },
            cellVersion++,
            tableOwner.publicKey,
            prevCellHash,
          );
          cellAuditLog.push(rebuyCell.audit);
          await maybeBroadcast(rebuyCell.cellBytes, rebuyCell.semanticPath, rebuyCell.contentHash);
          prevCellHash = createHash('sha256').update(rebuyCell.cellBytes).digest('hex');
          if (config.onCells) config.onCells([rebuyCell.audit]);
        }
      }
    }

    const activePlayers = seats.filter((s) => s.chips > 0);
    if (activePlayers.length < 2) break;

    const deck = shuffle(createDeck());
    let deckPos = 0;
    let pot = 0;
    let currentBet = 0;
    cellVersion++;

    // Reset seat state
    for (const s of seats) {
      s.currentBet = 0;
      s.folded = s.chips <= 0;
      s.allIn = false;
      s.holeCards = s.chips > 0 ? [deck[deckPos++], deck[deckPos++]] : [];
    }

    // Post blinds
    const sbIdx = (dealerIdx + 1) % seats.length;
    const bbIdx = (dealerIdx + 2) % seats.length;
    if (!seats[sbIdx].folded) {
      const sb = Math.min(config.smallBlind, seats[sbIdx].chips);
      seats[sbIdx].chips -= sb;
      seats[sbIdx].currentBet = sb;
      pot += sb;
    }
    if (!seats[bbIdx].folded) {
      const bb = Math.min(config.bigBlind, seats[bbIdx].chips);
      seats[bbIdx].chips -= bb;
      seats[bbIdx].currentBet = bb;
      pot += bb;
      currentBet = bb;
    }

    const communityCards: Card[] = [];
    const handActions: HandAction[] = [];

    // Build initial hand state cell
    const initCell = await buildStateCell(
      config.gameId, h, 'preflop',
      {
        players: seats.map((s) => ({
          id: s.identity.playerId,
          pubkey: s.identity.publicKey.toString().slice(0, 20),
          chips: s.chips,
          folded: s.folded,
        })),
        pot,
        dealer: seats[dealerIdx].identity.playerId,
      },
      cellVersion,
      tableOwner.publicKey,
      prevCellHash,
    );
    cellAuditLog.push(initCell.audit);
    await maybeBroadcast(initCell.cellBytes, initCell.semanticPath, initCell.contentHash);
    prevCellHash = createHash('sha256').update(initCell.cellBytes).digest('hex');
    totalTxs++;

    const phases: Array<'preflop' | 'flop' | 'turn' | 'river'> = ['preflop', 'flop', 'turn', 'river'];

    for (const phase of phases) {
      if (phase === 'flop') {
        deckPos++;
        communityCards.push(deck[deckPos++], deck[deckPos++], deck[deckPos++]);
      } else if (phase === 'turn' || phase === 'river') {
        deckPos++;
        communityCards.push(deck[deckPos++]);
      }

      let startIdx = phase === 'preflop' ? (bbIdx + 1) % seats.length : (dealerIdx + 1) % seats.length;
      let actedCount = 0;
      let playersToAct = seats.filter((s) => !s.folded && !s.allIn && s.chips > 0).length;

      while (playersToAct > 1 && actedCount < playersToAct + seats.length) {
        const seatIdx = startIdx;
        const seat = seats[seatIdx];

        if (!seat.folded && !seat.allIn && seat.chips > 0) {
          const isLate = ((seatIdx - dealerIdx + seats.length) % seats.length) >= Math.floor(seats.length * 0.6);

          // Use custom decision function if available, otherwise heuristic
          let decision: { action: PokerAction; amount: number };
          const customFn = customDecisions?.get(seatIdx);
          if (customFn) {
            decision = customFn(seat, currentBet, pot, communityCards, isLate, config.bigBlind);
          } else {
            const hStr = handStrength(seat.holeCards, communityCards);
            // Use EMA-adapted persona if swarm mode is enabled
            const ema = seatEMAs.get(seatIdx);
            const persona = ema ? ema.adaptPersona(seat.identity.persona) : seat.identity.persona;
            decision = selectHeuristicAction(
              persona,
              seat.chips,
              currentBet,
              seat.currentBet,
              pot,
              hStr,
              isLate,
              config.bigBlind,
            );
          }

          // Validate via kernel
          let validation = validateActionViaKernel(
            registry,
            decision.action,
            seat.identity.playerId,
            seat.identity.playerId,
            currentBet - seat.currentBet,
            decision.amount,
            config.bigBlind,
            seat.chips,
            config.bigBlind,
          );
          totalValidations++;

          if (!validation.valid) {
            totalRejections++;
            const fallback: PokerAction = currentBet > seat.currentBet ? 'fold' : 'check';
            decision = { action: fallback, amount: 0 };
            validation = validateActionViaKernel(
              registry,
              decision.action,
              seat.identity.playerId,
              seat.identity.playerId,
              currentBet - seat.currentBet,
              0,
              config.bigBlind,
              seat.chips,
              config.bigBlind,
            );
            totalValidations++;
          }

          // Apply action
          switch (decision.action) {
            case 'fold':
              seat.folded = true;
              playersToAct--;
              break;
            case 'check':
              break;
            case 'call': {
              const amt = Math.min(currentBet - seat.currentBet, seat.chips);
              seat.chips -= amt;
              seat.currentBet += amt;
              pot += amt;
              break;
            }
            case 'bet':
            case 'raise': {
              const total = Math.min(decision.amount, seat.chips);
              seat.chips -= total;
              seat.currentBet += total;
              pot += total;
              if (seat.currentBet > currentBet) {
                currentBet = seat.currentBet;
                actedCount = 0;
              }
              break;
            }
            case 'all-in': {
              pot += seat.chips;
              seat.currentBet += seat.chips;
              seat.chips = 0;
              seat.allIn = true;
              if (seat.currentBet > currentBet) currentBet = seat.currentBet;
              playersToAct--;
              break;
            }
          }

          const actionRecord: HandAction = {
            playerId: seat.identity.playerId,
            action: decision.action,
            amount: decision.amount,
            phase,
            validated: validation.valid,
            policyName: validation.policyName,
          };
          handActions.push(actionRecord);
          config.onAction?.(actionRecord, config.tableId, h);

          totalTxs++; // OP_RETURN for action event
          actedCount++;
          if (config.actionDelayMs > 0) await new Promise((r) => setTimeout(r, config.actionDelayMs));
        }

        startIdx = (startIdx + 1) % seats.length;
        if (actedCount >= playersToAct) break;
      }

      // Reset bets for next phase
      for (const s of seats) s.currentBet = 0;
      currentBet = 0;

      // Phase transition cell
      cellVersion++;
      const phaseCell = await buildStateCell(
        config.gameId, h, phase,
        {
          pot,
          community: communityCards.map(cardLabel),
          remaining: seats.filter((s) => !s.folded).map((s) => s.identity.playerId),
        },
        cellVersion,
        tableOwner.publicKey,
        prevCellHash,
      );
      cellAuditLog.push(phaseCell.audit);
      await maybeBroadcast(phaseCell.cellBytes, phaseCell.semanticPath, phaseCell.contentHash);
      prevCellHash = createHash('sha256').update(phaseCell.cellBytes).digest('hex');
      totalTxs++;

      if (seats.filter((s) => !s.folded).length <= 1) break;
    }

    // Showdown
    const contenders = seats.filter((s) => !s.folded);
    let winner = contenders[0];
    let bestStr = -1;
    for (const s of contenders) {
      const str = handStrength(s.holeCards, communityCards);
      if (str > bestStr) {
        bestStr = str;
        winner = s;
      }
    }
    winner.chips += pot;

    // Detect premium hands for all showdown contenders
    if (communityCards.length >= 3) {
      for (const s of contenders) {
        const premium = detectPremiumHand(s.holeCards, communityCards);
        if (premium) {
          config.onPremiumHand?.({
            handRank: premium,
            playerId: s.identity.playerId,
            cards: s.holeCards.map(cardLabel).join(' ') + ' | ' + communityCards.map(cardLabel).join(' '),
            communityCards: communityCards.map(cardLabel).join(' '),
            pot,
            handNumber: h,
          });
        }
      }
    }

    // Update swarm EMA for each seat
    if (config.enableSwarmEMA) {
      for (let si = 0; si < seats.length; si++) {
        const s = seats[si];
        if (s.folded && s !== winner) continue; // skip permanently dead seats
        const ema = seatEMAs.get(si);
        if (ema) {
          const won = s === winner;
          const chipDelta = won ? pot : -(s.currentBet); // rough estimate
          ema.update(won, chipDelta);
        }
      }
      // Report EMA snapshots every 20 hands
      if (h > 0 && h % 20 === 0 && config.onSwarmUpdate) {
        const snapshots = seats.map((s, si) => ({
          playerId: s.identity.playerId,
          persona: s.identity.persona.name,
          ema: seatEMAs.get(si)?.snapshot() ?? { emaWinRate: 0, emaChipDelta: 0, handsObserved: 0 },
        }));
        config.onSwarmUpdate(snapshots);
      }
    }

    // Final "complete" cell
    cellVersion++;
    const finalCell = await buildStateCell(
      config.gameId, h, 'complete',
      {
        winner: winner.identity.playerId,
        winnerPubkey: winner.identity.publicKey.toString().slice(0, 20),
        pot,
        decidedBy: contenders.length === 1 ? 'fold' : 'showdown',
      },
      cellVersion,
      tableOwner.publicKey,
      prevCellHash,
    );
    cellAuditLog.push(finalCell.audit);
    await maybeBroadcast(finalCell.cellBytes, finalCell.semanticPath, finalCell.contentHash);
    prevCellHash = createHash('sha256').update(finalCell.cellBytes).digest('hex');
    totalTxs++;

    handsPlayed++;
    dealerIdx = (dealerIdx + 1) % seats.length;

    config.onHandComplete?.(config.tableId, h, winner, pot, handActions);

    // Report cells for this hand to the shadow overlay
    // Cells for this hand = everything added since last report
    const handCellCount = cellAuditLog.length - handCellStartIdx;
    if (handCellCount > 0 && config.onCells) {
      config.onCells(cellAuditLog.slice(handCellStartIdx));
    }
    handCellStartIdx = cellAuditLog.length;

    if (config.handDelayMs > 0) await new Promise((r) => setTimeout(r, config.handDelayMs));
  }

  return { hands: handsPlayed, txs: totalTxs, validations: totalValidations, rejections: totalRejections, cellAuditLog, broadcastTxids, eliminations: totalEliminations, uniquePlayers: uniquePlayerIds.size };
}
