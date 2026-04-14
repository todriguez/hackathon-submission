/**
 * ShadowLoop — Core orchestration for the Apex Agent cognitive layer.
 *
 * Runs an async background loop that continuously:
 *   1. Polls recent hand history
 *   2. Analyses opponent patterns
 *   3. Prompts Claude for improved Lisp policy
 *   4. Validates and compiles the response
 *   5. Hot-swaps the compiled policy into the game loop
 *   6. Logs the evolution to provenance chain
 *
 * Non-blocking: the game loop continues playing while the shadow loop thinks.
 */

import type {
  ShadowLoopConfig,
  PolicyVersion,
  GameLoopHandle,
  HandDataSource,
  LispValidation,
} from './shadow-loop-types';
import { OpponentAnalyser, HttpHandDataSource } from './opponent-analyser';
import { LLMPromptHandler } from './llm-prompt-handler';
import { LispPolicyAdapter } from './lisp-policy-adapter';
import { PolicyEvolutionChain } from './policy-evolution-chain';
import { createHash } from 'crypto';

export class ShadowLoop {
  private config: ShadowLoopConfig;
  private gameLoopRef: GameLoopHandle;
  private opponentAnalyser: OpponentAnalyser;
  private llmHandler: LLMPromptHandler;
  private lispAdapter: LispPolicyAdapter;
  private evolutionChain: PolicyEvolutionChain;
  private consecutiveErrors: number = 0;
  private lastKnownGoodPolicy: PolicyVersion;
  private running: boolean = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botId: string;
  /** External ref to cumulative chip delta — updated by the main loop */
  chipDeltaRef: { value: number } = { value: 0 };

  constructor(
    config: ShadowLoopConfig,
    gameLoopRef: GameLoopHandle,
    options?: {
      dataSource?: HandDataSource;
      llmHandler?: LLMPromptHandler;
      botId?: string;
    },
  ) {
    this.config = config;
    this.gameLoopRef = gameLoopRef;
    this.lastKnownGoodPolicy = gameLoopRef.getCurrentPolicy();
    this.botId = options?.botId ?? 'bot-0';

    const dataSource =
      options?.dataSource ?? new HttpHandDataSource(config.borderRouterUrl);
    this.opponentAnalyser = new OpponentAnalyser(dataSource);

    this.llmHandler =
      options?.llmHandler ??
      new LLMPromptHandler(config.anthropicApiKey, {
        modelId: config.modelId,
      });

    this.lispAdapter = new LispPolicyAdapter();
    this.evolutionChain = new PolicyEvolutionChain(config.borderRouterUrl);
  }

  /**
   * Main cycle: poll → analyse → prompt → compile → swap → log
   */
  async runCycle(): Promise<void> {
    try {
      // Step 1: Fetch recent hands
      const hands = await this.opponentAnalyser.fetchRecentHands(100);

      // Early return if no data to learn from
      if (hands.length === 0) {
        console.log('[ShadowLoop] No hands available, skipping cycle');
        return;
      }

      // Step 2: Extract opponent patterns
      const analysis = this.opponentAnalyser.analyseOpponents(hands);

      // Step 3: Prompt Claude for improved policy
      const currentPolicy = this.gameLoopRef.getCurrentPolicy();
      const botIndex = parseInt(this.botId.replace(/\D/g, '') || '0', 10);
      const llmResponse = await this.llmHandler.promptLLM({
        currentLisp: currentPolicy.lisp,
        opponentAnalysis: analysis,
        context: {
          agentName: this.botId,
          botIndex,
          gamePhase: 'preflop',
        },
        chipDelta: this.chipDeltaRef.value,
      });

      // Step 4: Validate Lisp syntax
      const validation = this.lispAdapter.validate(llmResponse.updatedLisp);
      if (!validation.isValid) {
        this.handleValidationError(validation);
        return;
      }

      // Step 5: Compile to bytecode
      const bytecode = this.lispAdapter.compile(llmResponse.updatedLisp);

      // Step 6: Create new policy version
      const newPolicy: PolicyVersion = {
        version: currentPolicy.version + 1,
        lisp: llmResponse.updatedLisp,
        bytecode,
        timestamp: Date.now(),
        prevHash: this.hashPolicy(currentPolicy),
        lispValidation: validation,
      };

      // Step 7: Hot-swap into game loop
      this.gameLoopRef.setPolicyReference(newPolicy);

      // Step 8: Capture training data context for overlay linkage
      const trainingContext = {
        vulnerabilitySnapshot: {
          opponentCount: analysis.opponents.length,
          opponents: analysis.opponents.map((o: any) => ({
            botId: o.botId,
            foldPercent: o.foldPercent,
            aggressionScore: o.aggressionScore,
            handsPlayed: o.handsPlayed,
          })),
          trends: analysis.trends ?? {},
          handsAnalysed: hands.length,
        },
        trainingCellRefs: hands.slice(0, 20).map((h: any) => h.id ?? ''),
      };

      // Step 9: Log to evolution chain (with training data refs for overlay)
      await this.evolutionChain.logVersion(newPolicy, this.botId, trainingContext);

      // Reset error counter on success
      this.consecutiveErrors = 0;
      this.lastKnownGoodPolicy = newPolicy;

      console.log(
        `[ShadowLoop] Policy v${newPolicy.version} compiled and hot-swapped`,
      );
    } catch (err) {
      this.handleShadowLoopError(err);
    }
  }

  private handleValidationError(validation: LispValidation): void {
    this.consecutiveErrors++;
    const max = this.config.maxConsecutiveErrors ?? 3;
    console.warn(
      `[ShadowLoop] Validation error (${this.consecutiveErrors}/${max}): ${validation.errors.join(', ')}`,
    );

    if (this.consecutiveErrors >= max) {
      console.error(
        '[ShadowLoop] Max consecutive errors reached. Reverting to last known good policy.',
      );
      this.gameLoopRef.setPolicyReference(this.lastKnownGoodPolicy);
      this.consecutiveErrors = 0;
    }
  }

  private handleShadowLoopError(err: unknown): void {
    this.consecutiveErrors++;
    const max = this.config.maxConsecutiveErrors ?? 3;
    console.error('[ShadowLoop] Error in cycle:', err);

    if (this.consecutiveErrors >= max) {
      console.error(
        '[ShadowLoop] Max consecutive errors reached. Reverting to last known good policy.',
      );
      this.gameLoopRef.setPolicyReference(this.lastKnownGoodPolicy);
      this.consecutiveErrors = 0;
    }
  }

  private hashPolicy(policy: PolicyVersion): string {
    const content = policy.lisp + policy.timestamp;
    return createHash('sha256').update(content).digest('hex');
  }

  /** Start the shadow loop on the configured cadence. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const cadenceMs = this.config.cadenceMs ?? 60000;
    console.log(`[ShadowLoop] Starting on ${cadenceMs}ms cadence`);
    this.scheduleNext(cadenceMs);
  }

  /** Stop the shadow loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[ShadowLoop] Stopped');
  }

  /** Run one cycle manually (for testing). */
  async runOnce(): Promise<void> {
    await this.runCycle();
  }

  /** Expose consecutive error count for testing. */
  getConsecutiveErrors(): number {
    return this.consecutiveErrors;
  }

  /** Expose evolution chain for testing. */
  getEvolutionChain(): PolicyEvolutionChain {
    return this.evolutionChain;
  }

  private scheduleNext(cadenceMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.runCycle();
      this.scheduleNext(cadenceMs);
    }, cadenceMs);
  }
}
