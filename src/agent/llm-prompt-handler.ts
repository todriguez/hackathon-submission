/**
 * LLMPromptHandler — Formats structured prompts to Claude for policy evolution.
 *
 * Sends current Lisp policy + opponent analysis to Claude Haiku/Sonnet,
 * receives improved Lisp policy, parses and validates the response.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMPromptInput,
  LLMResponse,
  LispValidation,
} from './shadow-loop-types';

export class LLMPromptHandler {
  private anthropicClient: Anthropic;
  private modelId: string;

  constructor(
    apiKey: string,
    options?: { modelId?: string; client?: Anthropic },
  ) {
    this.anthropicClient =
      options?.client ?? new Anthropic({ apiKey });
    this.modelId = options?.modelId ?? 'claude-3-5-haiku-20241022';
  }

  buildPrompt(input: LLMPromptInput): string {
    const chipLine = input.chipDelta !== undefined
      ? `\nYour cumulative chip delta: ${input.chipDelta > 0 ? '+' : ''}${input.chipDelta} (${input.chipDelta > 0 ? 'winning' : input.chipDelta < -50 ? 'losing — consider tightening' : 'roughly even'})`
      : '';

    return `You are an autonomous poker AI agent evolving your strategy through S-expression policies.
Your agent name: ${input.context.agentName} (index ${input.context.botIndex}).

## Current Policy (Lisp S-expression)
\`\`\`lisp
${input.currentLisp}
\`\`\`

## Opponent Analysis (from ${input.opponentAnalysis.opponents?.length ?? 0} observed players)
${input.opponentAnalysis.summary}

Your win rate: ${input.opponentAnalysis.selfWinRate.toFixed(1)}%${chipLine}

## Available Predicates & Actions
Predicates (return t/nil): (opponent-aggressive?), (have-strong-hand?), (have-decent-hand?), (pot-odds-good?), (pot-odds-good? threshold), (position-late?), (position-early?), (opponent-calling-station?), (draws-present?), (steal-profitable? pct), (postflop?)
Actions: fold, call, raise, (raise Nx), check, bet, (bet-size Nx expr), (overbet Nx)
Structures: (if cond then else), (when cond body), (begin expr...), (defpolicy name body), (default-action expr)
Meta: (bluff-frequency N% qualifiers), (tighten-range N% note), (widen-range N% note), (plan-streets (flop ...) (turn ...) (river ...))

## FORBIDDEN (do NOT use these atoms — they will be rejected)
defun, quote, eval, load, save

## Task
Evolve the policy based on opponent weaknesses. Generate a UNIQUE strategy — do not copy the current policy unchanged. Each version should be structurally different, adapting to what you observe:
- High fold% opponents → steal more aggressively, widen bluff range
- Calling stations (low fold%) → value bet thicker, reduce bluffs
- Aggressive opponents → trap with strong hands, tighten call range
- Use comments (;; ...) to document your reasoning inline

Name your policy: (defpolicy apex-{descriptive-name}-v{next_version} ...)

## Output Format (strict)

REASONING:
[2-3 sentences analyzing the meta and what needs to change]

LISP:
[complete (defpolicy ...) S-expression with balanced parens]

RATIONALE:
[1-2 sentences on expected improvement]`;
  }

  async promptLLM(input: LLMPromptInput): Promise<LLMResponse> {
    const prompt = this.buildPrompt(input);

    const message = await this.anthropicClient.messages.create({
      model: this.modelId,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';

    return this.parseResponse(responseText);
  }

  parseResponse(text: string): LLMResponse {
    const reasoningMatch = text.match(/REASONING:\s*([\s\S]*?)(?=LISP:)/);
    const lispMatch = text.match(/LISP:\s*([\s\S]*?)(?=RATIONALE:)/);
    const rationaleMatch = text.match(/RATIONALE:\s*([\s\S]*?)$/);

    let rawLisp = lispMatch ? lispMatch[1].trim() : '';

    // Strip markdown code fences that Claude often wraps around code
    rawLisp = rawLisp.replace(/^```(?:lisp|scheme|s-expression)?\s*\n?/m, '');
    rawLisp = rawLisp.replace(/\n?```\s*$/m, '');
    rawLisp = rawLisp.trim();

    // If the regex didn't match LISP: section, try to find (defpolicy anywhere in the text
    if (!rawLisp.startsWith('(defpolicy')) {
      const defpolicyMatch = text.match(/(\(defpolicy[\s\S]*?\)\s*\))/);
      if (defpolicyMatch) {
        rawLisp = defpolicyMatch[1].trim();
      }
    }

    const updatedLisp = rawLisp || '(defpolicy fallback (fold))';

    return {
      reasoning: reasoningMatch ? reasoningMatch[1].trim() : '',
      updatedLisp,
      rationale: rationaleMatch ? rationaleMatch[1].trim() : '',
    };
  }

  validateLispResponse(lisp: string): LispValidation {
    const errors: string[] = [];

    // Check balanced parens
    let parenCount = 0;
    for (const char of lisp) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (parenCount < 0) {
        errors.push('Unbalanced parentheses (closing before opening)');
        break;
      }
    }
    if (parenCount !== 0 && !errors.length) {
      errors.push('Unbalanced parentheses (unclosed)');
    }

    // Check defpolicy prefix
    if (!lisp.trim().startsWith('(defpolicy')) {
      errors.push('Lisp must start with (defpolicy ...)');
    }

    // Check for forbidden atoms
    const forbidden = ['defun', 'quote', 'eval', 'load', 'save'];
    for (const atom of forbidden) {
      if (lisp.includes(atom)) {
        errors.push(`Forbidden atom: ${atom}`);
      }
    }

    return { isValid: errors.length === 0, errors };
  }
}
