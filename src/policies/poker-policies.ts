/**
 * Poker Policies — Lisp s-expressions compiled to WASM opcodes.
 *
 * Validates betting actions via OP_CALLHOST predicates.
 * All predicates are zero-arity — they read from frozen evaluation context.
 */

import { parseExpression } from './lisp/parser';
import { LispCompiler } from './lisp/compiler';
import type { ScriptOutput } from './lisp/types';
import { HostFunctionRegistry } from '../cell-engine/host-functions';

// ── Policy Sources ──────────────────────────────────────────

/** Fold is always legal (if it's your turn). */
export const FOLD_POLICY = `(is-active-player?)`;

/** Check: no outstanding bet. */
export const CHECK_POLICY = `(and (is-active-player?) (no-bet-to-call?))`;

/** Call: there is a bet to call. */
export const CALL_POLICY = `(and (is-active-player?) (has-bet-to-call?))`;

/** Bet: no current bet, amount >= big blind. */
export const BET_POLICY = `(and (is-active-player?) (no-bet-to-call?) (meets-minimum-bet?))`;

/** Raise: current bet exists, raise amount >= min raise. */
export const RAISE_POLICY = `(and (is-active-player?) (has-bet-to-call?) (meets-minimum-raise?))`;

/** All-in: always legal if you have chips. */
export const ALL_IN_POLICY = `(and (is-active-player?) (has-chips?))`;

// ── Compiled Policies ───────────────────────────────────────

export interface CompiledPokerPolicies {
  fold: ScriptOutput;
  check: ScriptOutput;
  call: ScriptOutput;
  bet: ScriptOutput;
  raise: ScriptOutput;
  allIn: ScriptOutput;
}

const POLICY_MAP: Record<string, string> = {
  fold: FOLD_POLICY,
  check: CHECK_POLICY,
  call: CALL_POLICY,
  bet: BET_POLICY,
  raise: RAISE_POLICY,
  allIn: ALL_IN_POLICY,
};

export function compilePokerPolicies(): CompiledPokerPolicies {
  const compiler = new LispCompiler({ compiledAt: 'poker-init' });
  const result: Record<string, ScriptOutput> = {};
  for (const [name, source] of Object.entries(POLICY_MAP)) {
    const expr = parseExpression(source);
    result[name] = compiler.compile(expr);
  }
  return result as unknown as CompiledPokerPolicies;
}

// ── Host Functions ──────────────────────────────────────────

export function registerPokerHostFunctions(registry: HostFunctionRegistry): void {
  registry.register('is-active-player?', (ctx) => {
    return ctx.isActivePlayer ? 1 : 0;
  });

  registry.register('no-bet-to-call?', (ctx) => {
    return (ctx.betToCall ?? 0) === 0 ? 1 : 0;
  });

  registry.register('has-bet-to-call?', (ctx) => {
    return ((ctx.betToCall as number) ?? 0) > 0 ? 1 : 0;
  });

  registry.register('meets-minimum-bet?', (ctx) => {
    return (ctx.betAmount ?? 0) >= (ctx.bigBlind ?? 0) ? 1 : 0;
  });

  registry.register('meets-minimum-raise?', (ctx) => {
    return (ctx.raiseBy ?? 0) >= (ctx.minRaise ?? 0) ? 1 : 0;
  });

  registry.register('has-chips?', (ctx) => {
    return ((ctx.playerChips as number) ?? 0) > 0 ? 1 : 0;
  });
}
