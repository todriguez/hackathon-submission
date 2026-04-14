/**
 * Policy type system for the Lisp axiom compiler.
 *
 * Defines typed AST nodes for compiled policy expressions,
 * identity references, and constraint forms.
 */

import type { FieldDefinition } from '../../stubs/extension-config';
import type { SExpression } from './parser';

// ── Identity References ────────────────────────────────────────

export type IdentityRef =
  | { type: 'role'; name: string }
  | { type: 'domainFlag'; flag: number }
  | { type: 'certPattern'; pattern: string };

// ── Constraint Expressions ─────────────────────────────────────

export type ComparisonOp = '>' | '<' | '>=' | '<=' | '=' | '!=';

export interface ComparisonExpr {
  kind: 'comparison';
  op: ComparisonOp;
  field: string;
  value: number | string;
}

export interface LogicalExpr {
  kind: 'logical';
  op: 'and' | 'or' | 'not';
  operands: ConstraintExpr[];
}

export interface CapabilityExpr {
  kind: 'capability';
  capabilityNumber: number;
}

export interface DomainCheckExpr {
  kind: 'domainCheck';
  domainFlag: number | string;
}

export interface TimeConstraintExpr {
  kind: 'timeConstraint';
  op: 'timeAfter' | 'timeBefore';
  isoTimestamp: string;
}

export interface HostCallExpr {
  kind: 'hostCall';
  functionName: string;
}

export interface TypeHashCheckExpr {
  kind: 'typeHashCheck';
  expectedHash: string;  // hex-encoded SHA-256 (64 hex chars = 32 bytes)
}

export interface DerefExpr {
  kind: 'deref';
}

export type ConstraintExpr =
  | ComparisonExpr
  | LogicalExpr
  | CapabilityExpr
  | DomainCheckExpr
  | TimeConstraintExpr
  | HostCallExpr
  | TypeHashCheckExpr
  | DerefExpr;

// ── Policy Form ────────────────────────────────────────────────

export type LinearityMode = 'LINEAR' | 'AFFINE' | 'RELEVANT' | 'FUNGIBLE';

export interface PolicyForm {
  subject: IdentityRef;
  action: string;
  constraint: ConstraintExpr;
  linearity: LinearityMode;
  description?: string;
}

// ── Script Output ──────────────────────────────────────────────

export interface ScriptOutput {
  /** Human-readable opcode mnemonics, e.g. "500 AMOUNT-GT" */
  scriptWords: string;
  /** Packed opcode bytes for the Zig 2PDA cell engine */
  scriptBytes: Uint8Array;
  /** Compilation metadata */
  metadata: {
    subject?: string;
    action?: string;
    linearity?: string;
    inputExpr: string;
    compiledAt: string;
  };
}

// ── Validation ─────────────────────────────────────────────────

/**
 * Validate that all field references in a constraint exist in the given field definitions.
 * Returns a list of error messages (empty = valid).
 */
export function validateConstraintFields(
  constraint: ConstraintExpr,
  fields: FieldDefinition[],
): string[] {
  const fieldNames = new Set(fields.map(f => f.name));
  const errors: string[] = [];

  function walk(expr: ConstraintExpr): void {
    switch (expr.kind) {
      case 'comparison': {
        if (!fieldNames.has(expr.field)) {
          errors.push(`Unknown field '${expr.field}'. Available: ${[...fieldNames].join(', ')}`);
        }
        break;
      }
      case 'logical': {
        for (const operand of expr.operands) {
          walk(operand);
        }
        break;
      }
      case 'capability':
      case 'domainCheck':
      case 'timeConstraint':
      case 'hostCall':
      case 'typeHashCheck':
      case 'deref':
        // No field references to validate
        break;
    }
  }

  walk(constraint);
  return errors;
}

/**
 * Interpret an SExpression as a constraint expression.
 * Throws on invalid forms.
 */
export function interpretConstraint(expr: SExpression): ConstraintExpr {
  if (expr.type !== 'list' || expr.elements.length === 0) {
    throw new Error(`Expected a constraint list, got ${expr.type} at line ${expr.line}`);
  }

  const head = expr.elements[0];
  if (head.type !== 'atom' || head.kind !== 'symbol') {
    throw new Error(`Expected constraint operator symbol at line ${head.line}`);
  }

  const op = head.value as string;

  // Comparison: (> field value), (< field value), etc.
  const comparisonOps: Record<string, ComparisonOp> = {
    '>': '>', '<': '<', '>=': '>=', '<=': '<=', '=': '=', '!=': '!=',
  };
  if (op in comparisonOps) {
    if (expr.elements.length !== 3) {
      throw new Error(`Comparison '${op}' requires exactly 2 arguments at line ${expr.line}`);
    }
    const fieldAtom = expr.elements[1];
    const valueAtom = expr.elements[2];
    if (fieldAtom.type !== 'atom' || fieldAtom.kind !== 'symbol') {
      throw new Error(`Expected field name symbol at line ${fieldAtom.line}`);
    }
    if (valueAtom.type !== 'atom' || (valueAtom.kind !== 'number' && valueAtom.kind !== 'string')) {
      throw new Error(`Expected number or string value at line ${valueAtom.line}`);
    }
    return {
      kind: 'comparison',
      op: comparisonOps[op],
      field: fieldAtom.value as string,
      value: valueAtom.value,
    };
  }

  // Logical: (and ...), (or ...), (not ...)
  if (op === 'and' || op === 'or') {
    if (expr.elements.length < 3) {
      throw new Error(`'${op}' requires at least 2 operands at line ${expr.line}`);
    }
    return {
      kind: 'logical',
      op,
      operands: expr.elements.slice(1).map(interpretConstraint),
    };
  }
  if (op === 'not') {
    if (expr.elements.length !== 2) {
      throw new Error(`'not' requires exactly 1 operand at line ${expr.line}`);
    }
    return {
      kind: 'logical',
      op: 'not',
      operands: [interpretConstraint(expr.elements[1])],
    };
  }

  // Capability: (has-capability n)
  if (op === 'has-capability') {
    if (expr.elements.length !== 2) {
      throw new Error(`'has-capability' requires exactly 1 argument at line ${expr.line}`);
    }
    const numAtom = expr.elements[1];
    if (numAtom.type !== 'atom' || numAtom.kind !== 'number') {
      throw new Error(`Expected capability number at line ${numAtom.line}`);
    }
    return { kind: 'capability', capabilityNumber: numAtom.value as number };
  }

  // Domain check: (check-domain flag)
  if (op === 'check-domain') {
    if (expr.elements.length !== 2) {
      throw new Error(`'check-domain' requires exactly 1 argument at line ${expr.line}`);
    }
    const flagAtom = expr.elements[1];
    if (flagAtom.type !== 'atom') {
      throw new Error(`Expected domain flag at line ${flagAtom.line}`);
    }
    return {
      kind: 'domainCheck',
      domainFlag: flagAtom.kind === 'number' ? flagAtom.value as number : flagAtom.value as string,
    };
  }

  // Time constraints: (time-after iso), (time-before iso)
  if (op === 'time-after' || op === 'time-before') {
    if (expr.elements.length !== 2) {
      throw new Error(`'${op}' requires exactly 1 argument at line ${expr.line}`);
    }
    const tsAtom = expr.elements[1];
    if (tsAtom.type !== 'atom' || tsAtom.kind !== 'string') {
      throw new Error(`Expected ISO timestamp string at line ${tsAtom.line}`);
    }
    return {
      kind: 'timeConstraint',
      op: op === 'time-after' ? 'timeAfter' : 'timeBefore',
      isoTimestamp: tsAtom.value as string,
    };
  }

  // Type hash check: (check-type-hash "hex-hash")
  if (op === 'check-type-hash') {
    if (expr.elements.length !== 2) {
      throw new Error(`'check-type-hash' requires exactly 1 argument at line ${expr.line}`);
    }
    const hashAtom = expr.elements[1];
    if (hashAtom.type !== 'atom' || hashAtom.kind !== 'string') {
      throw new Error(`Expected hex hash string at line ${hashAtom.line}`);
    }
    const hexHash = hashAtom.value as string;
    if (hexHash.length !== 64) {
      throw new Error(`Expected 64-char hex hash (32 bytes SHA-256), got ${hexHash.length} chars at line ${hashAtom.line}`);
    }
    return { kind: 'typeHashCheck', expectedHash: hexHash };
  }

  // Deref pointer: (deref)
  if (op === 'deref') {
    if (expr.elements.length !== 1) {
      throw new Error(`'deref' takes no arguments at line ${expr.line}`);
    }
    return { kind: 'deref' };
  }

  // Host call: (call-host "function-name")
  if (op === 'call-host') {
    if (expr.elements.length !== 2) {
      throw new Error(`'call-host' requires exactly 1 argument at line ${expr.line}`);
    }
    const nameAtom = expr.elements[1];
    if (nameAtom.type !== 'atom' || nameAtom.kind !== 'string') {
      throw new Error(`Expected host function name string at line ${nameAtom.line}`);
    }
    return { kind: 'hostCall', functionName: nameAtom.value as string };
  }

  // Zero-arity predicate sugar: (predicate-name?) → host call
  // Symbols ending in '?' that aren't known built-in operators
  if (op.endsWith('?') && expr.elements.length === 1) {
    return { kind: 'hostCall', functionName: op };
  }

  throw new Error(`Unknown constraint operator '${op}' at line ${head.line}`);
}

/**
 * Interpret an SExpression as a full policy form.
 * Expects: (policy :subject <ref> :action <verb> :constraint <expr> :linearity <mode>)
 */
export function interpretPolicy(expr: SExpression): PolicyForm {
  if (expr.type !== 'list' || expr.elements.length === 0) {
    throw new Error(`Expected policy form list at line ${expr.line}`);
  }

  const head = expr.elements[0];
  if (head.type !== 'atom' || head.value !== 'policy') {
    throw new Error(`Expected 'policy' keyword at line ${head.line}`);
  }

  // Parse keyword arguments
  const kwargs = new Map<string, SExpression>();
  let i = 1;
  while (i < expr.elements.length) {
    const key = expr.elements[i];
    if (key.type !== 'atom' || key.kind !== 'keyword') {
      throw new Error(`Expected keyword argument at line ${key.line}, got ${key.type}:${key.type === 'atom' ? key.kind : 'list'}`);
    }
    if (i + 1 >= expr.elements.length) {
      throw new Error(`Missing value for keyword ${key.value} at line ${key.line}`);
    }
    kwargs.set(key.value as string, expr.elements[i + 1]);
    i += 2;
  }

  // Extract subject
  const subjectExpr = kwargs.get(':subject');
  if (!subjectExpr) throw new Error(`Missing :subject in policy at line ${expr.line}`);
  const subject = interpretSubject(subjectExpr);

  // Extract action
  const actionExpr = kwargs.get(':action');
  if (!actionExpr) throw new Error(`Missing :action in policy at line ${expr.line}`);
  if (actionExpr.type !== 'atom' || actionExpr.kind !== 'symbol') {
    throw new Error(`Expected action symbol at line ${actionExpr.line}`);
  }
  const action = actionExpr.value as string;

  // Extract constraint
  const constraintExpr = kwargs.get(':constraint');
  if (!constraintExpr) throw new Error(`Missing :constraint in policy at line ${expr.line}`);
  const constraint = interpretConstraint(constraintExpr);

  // Extract linearity
  const linearityExpr = kwargs.get(':linearity');
  if (!linearityExpr) throw new Error(`Missing :linearity in policy at line ${expr.line}`);
  if (linearityExpr.type !== 'atom' || linearityExpr.kind !== 'symbol') {
    throw new Error(`Expected linearity symbol at line ${linearityExpr.line}`);
  }
  const linearityStr = (linearityExpr.value as string).toUpperCase();
  const validLinearities: LinearityMode[] = ['LINEAR', 'AFFINE', 'RELEVANT', 'FUNGIBLE'];
  if (!validLinearities.includes(linearityStr as LinearityMode)) {
    throw new Error(`Invalid linearity '${linearityStr}' at line ${linearityExpr.line}. Expected: ${validLinearities.join(', ')}`);
  }
  const linearity = linearityStr as LinearityMode;

  // Optional description
  const descExpr = kwargs.get(':description');
  const description = descExpr?.type === 'atom' && descExpr.kind === 'string'
    ? descExpr.value as string
    : undefined;

  return { subject, action, constraint, linearity, description };
}

function interpretSubject(expr: SExpression): IdentityRef {
  // Simple symbol → role reference
  if (expr.type === 'atom' && expr.kind === 'symbol') {
    return { type: 'role', name: expr.value as string };
  }
  // Number → domain flag
  if (expr.type === 'atom' && expr.kind === 'number') {
    return { type: 'domainFlag', flag: expr.value as number };
  }
  // String → cert pattern
  if (expr.type === 'atom' && expr.kind === 'string') {
    return { type: 'certPattern', pattern: expr.value as string };
  }
  throw new Error(`Invalid subject reference at line ${expr.line}`);
}
