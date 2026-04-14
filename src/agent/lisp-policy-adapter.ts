/**
 * LispPolicyAdapter — Bridges the PRD's defpolicy grammar to the real compiler.
 *
 * The LLM produces (defpolicy name (if (predicate?) action1 action2)) forms.
 * The real LispCompiler in packages/shell/src/lisp/ expects constraint-grammar
 * policy forms. Since no kernel runtime exists to execute poker predicates
 * (opponent-aggressive?, have-strong-hand?, etc.) via OP_CALLHOST yet, this
 * adapter validates and encodes the Lisp as placeholder bytecode.
 *
 * TODO: Wire to real LispCompiler.compile() when OP_CALLHOST poker predicates
 * are registered (Phase 25.5 integration).
 */

import { parseExpression } from '../policies/lisp/parser';
import type { LispValidation } from './shadow-loop-types';

export class LispPolicyAdapter {
  /**
   * Validate raw Lisp string from LLM.
   * Checks: balanced parens, defpolicy prefix, forbidden atoms, parseable.
   */
  validate(rawLisp: string): LispValidation {
    const errors: string[] = [];

    // Structural checks
    let parenCount = 0;
    for (const char of rawLisp) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (parenCount < 0) {
        errors.push('Unbalanced parentheses (closing before opening)');
        break;
      }
    }
    if (parenCount !== 0 && !errors.some((e) => e.includes('closing before'))) {
      errors.push('Unbalanced parentheses (unclosed)');
    }

    if (!rawLisp.trim().startsWith('(defpolicy')) {
      errors.push('Lisp must start with (defpolicy ...)');
    }

    const forbidden = ['defun', 'quote', 'eval', 'load', 'save'];
    for (const atom of forbidden) {
      if (rawLisp.includes(atom)) {
        errors.push(`Forbidden atom: ${atom}`);
      }
    }

    // Early return on structural errors before trying to parse
    if (errors.length > 0) {
      return { isValid: false, errors };
    }

    // Try parsing as S-expression
    try {
      parseExpression(rawLisp);
    } catch (err) {
      errors.push(
        `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Compile raw Lisp to bytecode.
   *
   * Currently encodes the validated Lisp string as UTF-8 bytes (placeholder).
   * Real compilation requires OP_CALLHOST poker predicate registration.
   */
  compile(rawLisp: string): Uint8Array {
    const validation = this.validate(rawLisp);
    if (!validation.isValid) {
      throw new Error(
        `Cannot compile invalid Lisp: ${validation.errors.join(', ')}`,
      );
    }
    // Placeholder: encode Lisp as UTF-8 bytes.
    // TODO: transform defpolicy predicates to host-call expressions
    // and compile via LispCompiler when kernel predicates exist.
    return new TextEncoder().encode(rawLisp);
  }
}
