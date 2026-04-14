/**
 * AgentRuntime — Claude-powered poker agent with local state awareness.
 *
 * Each agent:
 *   1. Queries GameStateDB for context (not conversation memory)
 *   2. Sends structured context to Claude API for decision-making
 *   3. Receives a poker action (fold/check/call/bet/raise/all-in)
 *   4. Executes the action through the poker engine
 *   5. Records the result back to the DB (incrementing seq)
 *
 * The agent's personality (aggressive/conservative) is baked into
 * the system prompt, not the game logic.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { GameStateDB, HandContext, GameHistory, ActionSummary } from './game-state-db';
import type { AgentContext } from '../protocol/agent-context';

// ── Types ──

export interface AgentPersonality {
  /** Short name: "Shark", "Turtle", etc. */
  name: string;
  /** Playing style description for the system prompt. */
  style: string;
  /** Risk tolerance: 0.0 (ultra-conservative) to 1.0 (reckless). */
  aggression: number;
  /** Bluff frequency: 0.0 (never bluffs) to 1.0 (always bluffs). */
  bluffFrequency: number;
}

export interface AgentDecision {
  action: string;
  amount?: number;
  reasoning: string;
  confidence: number;
}

export const PERSONALITIES: Record<string, AgentPersonality> = {
  shark: {
    name: 'Shark',
    style: `You are an aggressive, skilled HEADS-UP poker player. This is a 1v1 match —
ranges are MUCH wider than a full table. You should be raising or calling with 60-70%
of hands preflop, not just premium holdings.

Key heads-up adjustments:
- Open-raise most hands from the button/SB (any ace, any king, suited connectors, pairs, any two broadway cards, suited gappers).
- Only fold true trash (like 2-7 offsuit, 3-8 offsuit).
- Apply relentless pressure with frequent raises and re-raises.
- Bluff strategically when the board texture supports it.
- Exploit tight opponents by stealing pots — if they fold too much, raise every hand.
- Slow-play monster hands to trap.
- Size bets to maximize fold equity (2-3x BB preflop, 50-75% pot postflop).
- When behind, find creative ways to apply pressure.
- When ahead, extract maximum value.

IMPORTANT: In heads-up, folding preflop from the SB/button is a major leak. You are
GIVING UP your positional advantage. Raise or call with most hands.`,
    aggression: 0.8,
    bluffFrequency: 0.35,
  },
  turtle: {
    name: 'Turtle',
    style: `You are a solid, disciplined HEADS-UP poker player. This is a 1v1 match —
ranges must be wider than a full table, but you still maintain an edge through
selectivity and position awareness.

Key heads-up adjustments:
- Play wider than a full table: open 40-50% of hands from the button/SB.
- Raise with any pair, any ace, suited kings/queens, broadway cards, suited connectors.
- Fold bottom 50% of hands (weak offsuit, unconnected low cards).
- When you do enter a pot, bet for value and occasionally bluff.
- Position matters: from the button, raise wider. As BB facing a raise, defend with ~50% of hands.
- Calculate pot odds precisely and only call when the math supports it.
- Your edge comes from discipline and reading the opponent's patterns.
- If your opponent is aggressive (raising too much), trap them with strong hands.
- If your opponent is passive, steal more blinds.
- Occasionally make a well-timed bluff when you've established a tight image.

IMPORTANT: In heads-up, folding every marginal hand is a losing strategy. You must
defend your blinds and contest pots.`,
    aggression: 0.4,
    bluffFrequency: 0.15,
  },
};

// ── System Prompt Builder ──

function buildSystemPrompt(personality: AgentPersonality): string {
  return `You are ${personality.name}, an AI poker agent playing Texas Hold'em No-Limit.

${personality.style}

You will receive the current game state as structured data. You must respond with
EXACTLY one action in JSON format:

{
  "action": "fold" | "check" | "call" | "bet" | "raise" | "all-in",
  "amount": <number or null>,
  "reasoning": "<1-2 sentences explaining your decision>",
  "confidence": <0.0 to 1.0>
}

Rules:
- "fold": give up the hand (no amount needed)
- "check": pass (only legal if no bet to you; no amount needed)
- "call": match the current bet (amount is automatic)
- "bet": open betting (amount must be >= big blind; only when no current bet)
- "raise": increase the bet (amount is the TOTAL new bet, not the raise increment)
- "all-in": wager all your remaining chips

Your response must be valid JSON and nothing else. No markdown, no explanation
outside the JSON. Think carefully about pot odds, your hand strength, opponent
tendencies, and position.`;
}

function buildUserPrompt(
  handCtx: HandContext,
  gameHistory: GameHistory,
  agentMemory: Record<string, string>,
): string {
  const parts: string[] = [];

  // Game history overview
  parts.push(`=== GAME OVERVIEW ===
Hands played: ${gameHistory.handsPlayed}
Your wins: ${gameHistory.myWins} | Opponent wins: ${gameHistory.opponentWins}
Chip delta: ${gameHistory.myChipDelta > 0 ? '+' : ''}${gameHistory.myChipDelta}`);

  if (gameHistory.recentHands.length > 0) {
    parts.push(`\nRecent hands:`);
    for (const h of gameHistory.recentHands.slice(0, 5)) {
      parts.push(`  Hand ${h.handNumber}: ${h.winner} won ${h.potSize} (you: ${h.myAction})`);
    }
  }

  // Current hand state
  parts.push(`\n=== CURRENT HAND #${handCtx.handNumber} ===
Phase: ${handCtx.phase}
Your cards: ${handCtx.myCards.join(', ') || '(not dealt yet)'}
Community: ${handCtx.communityCards.join(', ') || '(none yet)'}
Pot: ${handCtx.pot}
Your chips: ${handCtx.myChips}
Opponent chips: ${handCtx.opponentChips}
Dealer seat: ${handCtx.dealerSeat}`);

  // Action history this hand
  if (handCtx.actions.length > 0) {
    parts.push(`\nActions this hand:`);
    for (const a of handCtx.actions) {
      const amtStr = a.amount > 0 ? ` ${a.amount}` : '';
      parts.push(`  [${a.phase}] ${a.player}: ${a.action}${amtStr}`);
    }
  }

  // Legal actions
  parts.push(`\nLegal actions: ${handCtx.legalActions.join(', ')}`);

  // Agent's own memory/notes from previous hands
  if (Object.keys(agentMemory).length > 0) {
    parts.push(`\n=== YOUR NOTES ===`);
    for (const [k, v] of Object.entries(agentMemory)) {
      parts.push(`${k}: ${v}`);
    }
  }

  parts.push(`\nRespond with your action as JSON.`);

  return parts.join('\n');
}

// ── Agent Runtime ──

export class AgentRuntime {
  readonly personality: AgentPersonality;
  readonly agentName: string;
  private claude: Anthropic;
  private model: string;
  private db: GameStateDB;
  private identity: AgentContext;
  private lastSeenSeq: number = 0;

  constructor(opts: {
    personality: AgentPersonality;
    apiKey: string;
    model?: string;
    db: GameStateDB;
    identity: AgentContext;
  }) {
    this.personality = opts.personality;
    this.agentName = opts.personality.name;
    this.claude = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? 'claude-sonnet-4-20250514';
    this.db = opts.db;
    this.identity = opts.identity;
  }

  /**
   * Ask the agent to decide on an action for the current game state.
   *
   * This is the core loop:
   *   1. Query DB for context
   *   2. Send to Claude
   *   3. Parse response
   *   4. Return decision
   */
  async decide(gameId: string, handCtx: HandContext): Promise<AgentDecision> {
    // Fill in agent-specific context
    const gameHistory = this.db.getGameHistory(gameId, this.agentName);
    const agentMemory = this.db.getAllMemory(this.agentName);

    const systemPrompt = buildSystemPrompt(this.personality);
    const userPrompt = buildUserPrompt(handCtx, gameHistory, agentMemory);

    try {
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3 + (this.personality.aggression * 0.4), // more aggressive → more variance
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseDecision(text, handCtx);
    } catch (err: any) {
      // Fallback: if Claude API fails, use simple heuristic
      console.warn(`[${this.agentName}] Claude API error: ${err.message} — using fallback`);
      return this.fallbackDecision(handCtx);
    }
  }

  /**
   * After a decision is executed, let the agent update its memory.
   * This runs after each hand completes — the agent can note opponent tendencies.
   */
  async reflect(gameId: string, handResult: {
    handNumber: number;
    won: boolean;
    potSize: number;
    opponentActions: ActionSummary[];
    showdown: boolean;
  }): Promise<void> {
    // Update memory with opponent tendencies
    const opRaises = handResult.opponentActions.filter(a => a.action === 'raise' || a.action === 'all-in').length;
    const opFolds = handResult.opponentActions.filter(a => a.action === 'fold').length;
    const opCalls = handResult.opponentActions.filter(a => a.action === 'call').length;

    // Running opponent stats
    const totalRaises = parseInt(this.db.getMemory(this.agentName, 'opponent_raises') ?? '0') + opRaises;
    const totalFolds = parseInt(this.db.getMemory(this.agentName, 'opponent_folds') ?? '0') + opFolds;
    const totalCalls = parseInt(this.db.getMemory(this.agentName, 'opponent_calls') ?? '0') + opCalls;
    const totalHands = parseInt(this.db.getMemory(this.agentName, 'hands_observed') ?? '0') + 1;

    this.db.setMemory(this.agentName, 'opponent_raises', totalRaises.toString());
    this.db.setMemory(this.agentName, 'opponent_folds', totalFolds.toString());
    this.db.setMemory(this.agentName, 'opponent_calls', totalCalls.toString());
    this.db.setMemory(this.agentName, 'hands_observed', totalHands.toString());

    // Compute tendencies
    const total = totalRaises + totalFolds + totalCalls;
    if (total > 0) {
      const aggPct = Math.round((totalRaises / total) * 100);
      const foldPct = Math.round((totalFolds / total) * 100);
      this.db.setMemory(this.agentName, 'opponent_profile',
        `aggressive=${aggPct}% fold=${foldPct}% (${totalHands} hands)`);
    }

    // Note if opponent showed down
    if (handResult.showdown) {
      const showdowns = parseInt(this.db.getMemory(this.agentName, 'showdowns_seen') ?? '0') + 1;
      this.db.setMemory(this.agentName, 'showdowns_seen', showdowns.toString());
    }
  }

  // ── Parse Claude's response ──

  /**
   * Extract the base action type from legal action strings.
   * "raise (min 20)" → "raise", "call 10" → "call", "all-in 500" → "all-in"
   */
  private static BASE_ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'all-in'];

  private isLegalAction(action: string, legalActions: string[]): boolean {
    const base = action.toLowerCase();
    return legalActions.some(legal => {
      const legalBase = legal.toLowerCase().split(/[\s(]/)[0]; // "raise (min 20)" → "raise"
      return legalBase === base;
    });
  }

  private parseDecision(text: string, handCtx: HandContext): AgentDecision {
    try {
      // Strip markdown code fences if present
      const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      // Validate action is legal — match base type, not full string
      let action = parsed.action?.toLowerCase();

      // Common LLM confusion: "raise" when no bet is open (should be "bet"),
      // or "bet" when a bet is already open (should be "raise").
      // Poker players use these interchangeably — fix it silently.
      if (action === 'raise' && !this.isLegalAction('raise', handCtx.legalActions)
          && this.isLegalAction('bet', handCtx.legalActions)) {
        action = 'bet';
      } else if (action === 'bet' && !this.isLegalAction('bet', handCtx.legalActions)
          && this.isLegalAction('raise', handCtx.legalActions)) {
        action = 'raise';
      }

      if (!this.isLegalAction(action, handCtx.legalActions)) {
        console.warn(`[${this.agentName}] Illegal action "${action}", falling back`);
        return this.fallbackDecision(handCtx);
      }

      return {
        action,
        amount: parsed.amount ?? undefined,
        reasoning: parsed.reasoning ?? '',
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      };
    } catch {
      console.warn(`[${this.agentName}] Failed to parse response: ${text.slice(0, 100)}`);
      return this.fallbackDecision(handCtx);
    }
  }

  /** Simple rule-based fallback if Claude API fails. */
  private fallbackDecision(handCtx: HandContext): AgentDecision {
    // Match base types against legal actions
    if (this.isLegalAction('check', handCtx.legalActions)) {
      return { action: 'check', reasoning: 'API fallback: check', confidence: 0.3 };
    }
    if (this.isLegalAction('call', handCtx.legalActions)) {
      return { action: 'call', reasoning: 'API fallback: call', confidence: 0.3 };
    }
    return { action: 'fold', reasoning: 'API fallback: fold', confidence: 0.2 };
  }

  /** Get the underlying AgentContext (identity + wallet). */
  getIdentity(): AgentContext { return this.identity; }

  /** Get the agent's current sequence marker. */
  getLastSeenSeq(): number { return this.lastSeenSeq; }

  /** Advance the agent's sequence marker. */
  advanceSeq(seq: number): void { this.lastSeenSeq = seq; }
}
