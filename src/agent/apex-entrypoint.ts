/**
 * Apex Agent Entrypoint — Wires up GameLoop + ShadowLoop concurrently.
 *
 * The Apex Agent starts with a baseline Lisp policy (e.g., The Calculator)
 * and runs an asynchronous shadow loop that continuously learns opponent
 * patterns, prompts Claude for policy improvements, and hot-swaps compiled
 * policies into the running game loop.
 */

import type { PolicyVersion, HandDataSource } from './shadow-loop-types';
import { PolicyHotSwapper } from './policy-hot-swap';
import { ShadowLoop } from './shadow-loop';
import type { LLMPromptHandler } from './llm-prompt-handler';

export interface ApexConfig {
  botIndex: number;
  persona: 'calculator' | 'nit' | 'maniac' | 'apex';
  borderRouterUrl: string;
  anthropicApiKey: string;
  shadowLoopCadenceMs?: number;
  initialPolicy?: PolicyVersion;
  dataSource?: HandDataSource;
  llmHandler?: LLMPromptHandler;
}

export interface ApexAgentHandle {
  swapper: PolicyHotSwapper;
  shadowLoop: ShadowLoop;
  stop(): void;
}

/**
 * Start an Apex Agent with game loop + shadow loop running concurrently.
 * Returns a handle for inspection and cleanup.
 */
export function createApexAgent(config: ApexConfig): ApexAgentHandle {
  console.log(`[Apex] Starting bot-${config.botIndex} (${config.persona})`);

  // 1. Load initial policy
  const initialPolicy = config.initialPolicy ?? loadBaselinePolicy(config.persona);

  // 2. Create hot-swap reference
  const swapper = new PolicyHotSwapper(initialPolicy);

  // 3. Create shadow loop
  const shadowLoop = new ShadowLoop(
    {
      borderRouterUrl: config.borderRouterUrl,
      anthropicApiKey: config.anthropicApiKey,
      cadenceMs: config.shadowLoopCadenceMs ?? 60000,
      modelId: 'claude-3-5-haiku-20241022',
    },
    swapper,
    {
      dataSource: config.dataSource,
      llmHandler: config.llmHandler,
      botId: `bot-${config.botIndex}`,
    },
  );

  // 4. Start shadow loop (non-blocking)
  shadowLoop.start();

  console.log(
    `[Apex] Shadow loop active on ${config.shadowLoopCadenceMs ?? 60000}ms cadence`,
  );

  return {
    swapper,
    shadowLoop,
    stop() {
      shadowLoop.stop();
    },
  };
}

/**
 * Load a hardcoded baseline policy for a given persona.
 * When Phase H2 Lisp profiles are built, this loads from compiled .lisp files.
 */
export function loadBaselinePolicy(persona: string): PolicyVersion {
  const policies: Record<string, string> = {
    calculator: '(defpolicy calculator (if (pot-odds-good?) (call) (fold)))',
    nit: '(defpolicy nit (if (have-strong-hand?) (raise) (fold)))',
    maniac: '(defpolicy maniac (if (position-late?) (raise) (bet)))',
    apex: '(defpolicy apex (if (opponent-aggressive?) (call) (if (have-strong-hand?) (raise) (fold))))',
  };

  const lisp = policies[persona] ?? policies.calculator;

  return {
    version: 0,
    lisp,
    bytecode: new TextEncoder().encode(lisp),
    timestamp: Date.now(),
    prevHash: null,
    lispValidation: { isValid: true, errors: [] },
  };
}
