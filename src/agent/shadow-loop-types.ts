/**
 * Shared types for Phase H4 — Apex Agent Shadow Loop.
 *
 * All shadow-loop modules import from here to avoid circular deps.
 */

// ── Policy Types ──

export interface PolicyVersion {
  version: number;
  lisp: string;
  bytecode: Uint8Array;
  timestamp: number;
  prevHash: string | null;
  lispValidation: LispValidation;
}

export interface LispValidation {
  isValid: boolean;
  errors: string[];
}

// ── Game Loop Handle (hot-swap interface) ──

export interface GameLoopHandle {
  setPolicyReference(policy: PolicyVersion): void;
  getCurrentPolicy(): PolicyVersion;
}

// ── Shadow Loop Config ──

export interface ShadowLoopConfig {
  borderRouterUrl: string;
  anthropicApiKey: string;
  cadenceMs?: number;
  handThreshold?: number;
  maxConsecutiveErrors?: number;
  modelId?: string;
}

// ── Hand Data (Border Router shape) ──

export interface HandAction {
  botId: string;
  type: 'fold' | 'call' | 'raise' | 'bet' | 'check' | 'three-bet' | 'all-in';
  timestamp: number;
  amount?: number;
}

export interface ShowdownEntry {
  botId: string;
  won: boolean;
}

export interface Hand {
  id: string;
  myBotId: string;
  actions: HandAction[];
  showdown: ShowdownEntry[];
  winner: string;
}

/** Abstraction over hand data source (Border Router, GameStateDB, mock). */
export interface HandDataSource {
  fetchRecentHands(count: number): Promise<Hand[]>;
}

// ── Opponent Analysis ──

export interface OpponentStats {
  botId: string;
  handsPlayed: number;
  foldPercent: number;
  raisePercent: number;
  threeBetPercent: number;
  showdownWinPercent: number;
  bluffFrequency: number;
  aggressionScore: number;
}

export interface OpponentAnalysis {
  opponents: OpponentStats[];
  selfWinRate: number;
  trends: {
    mostAggressive: OpponentStats | null;
    mostPassive: OpponentStats | null;
    mostBluffHeavy: OpponentStats | null;
  };
  summary: string;
}

// ── LLM Prompt/Response ──

export interface LLMPromptInput {
  currentLisp: string;
  opponentAnalysis: OpponentAnalysis;
  context: {
    agentName: string;
    botIndex: number;
    gamePhase: string;
  };
  /** Cumulative chip delta since session start (for reinforcement feedback) */
  chipDelta?: number;
}

export interface LLMResponse {
  reasoning: string;
  updatedLisp: string;
  rationale: string;
}

// ── Policy Evolution Chain ──

export interface PolicyEvolutionCell {
  cellType: 'policy.evolution';
  version: number;
  lisp: string;
  lispHash: string;
  bytecodeHash: string;
  timestamp: number;
  prevHash: string | null;
  botId: string;
  parentCellId: string;
  /** SHA-256 of the serialized training data (opponent analysis + hands) */
  trainingDataHash?: string;
  /** Shadow txids of hand cells used for this policy evolution */
  trainingCellRefs?: string[];
  /** Cell hash of this policy cell (for K6 chain linking in overlay) */
  policyCellHash?: string;
  /** Vulnerability analysis snapshot that drove this evolution */
  vulnerabilitySnapshot?: Record<string, unknown>;
}
