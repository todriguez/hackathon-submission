/**
 * Lisp-to-script compiler — pure transformation from policy
 * s-expressions to cell engine opcode sequences.
 *
 * Compilation is deterministic: same input always produces same output.
 * No I/O, no side effects, no external calls.
 */

import type { SExpression } from './parser';
import {
  interpretConstraint,
  interpretPolicy,
  type ConstraintExpr,
  type ScriptOutput,
  type PolicyForm,
} from './types';

// ── Opcode Constants ───────────────────────────────────────────
// Sourced from packages/cell-engine/src/opcodes/standard.zig and plexus.zig

const OP_PUSHDATA1 = 0x4C;
const OP_VERIFY = 0x69;
const OP_EQUAL = 0x87;
const OP_NOT = 0x91;
const OP_NUMNOTEQUAL = 0x9E;
const OP_BOOLAND = 0x9A;
const OP_BOOLOR = 0x9B;
const OP_LESSTHAN = 0x9F;
const OP_GREATERTHAN = 0xA0;
const OP_LESSTHANOREQUAL = 0xA1;
const OP_GREATERTHANOREQUAL = 0xA2;
const OP_CHECKCAPABILITY = 0xC3;
const OP_CHECKDOMAINFLAG = 0xC6;
const OP_CHECKTYPEHASH = 0xC7;
const OP_DEREF_POINTER = 0xC8;
const OP_CALLHOST = 0xD0;

// NOP1 used as field-load extension opcode
const OP_LOADFIELD = 0xB0;

// ── Byte Encoding ──────────────────────────────────────────────

/**
 * Encode a number as minimal-length little-endian signed bytes
 * (Bitcoin script numeric format).
 */
function encodeScriptNumber(n: number): Uint8Array {
  if (n === 0) return new Uint8Array([0]);

  const negative = n < 0;
  let abs = Math.abs(n);
  const bytes: number[] = [];

  while (abs > 0) {
    bytes.push(abs & 0xFF);
    abs >>= 8;
  }

  // If the high bit is set, add a sign byte
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(negative ? 0x80 : 0x00);
  } else if (negative) {
    bytes[bytes.length - 1] |= 0x80;
  }

  return new Uint8Array(bytes);
}

/**
 * Encode a push-data instruction: length prefix + data.
 * For data ≤ 75 bytes: [length, ...data]
 * For data ≤ 255 bytes: [OP_PUSHDATA1, length, ...data]
 */
function encodePushData(data: Uint8Array): Uint8Array {
  if (data.length <= 75) {
    const result = new Uint8Array(1 + data.length);
    result[0] = data.length;
    result.set(data, 1);
    return result;
  }
  // OP_PUSHDATA1: 1-byte length prefix
  const result = new Uint8Array(2 + data.length);
  result[0] = OP_PUSHDATA1;
  result[1] = data.length;
  result.set(data, 2);
  return result;
}

/** Encode a number push onto the stack. */
function encodePushNumber(n: number): Uint8Array {
  return encodePushData(encodeScriptNumber(n));
}

/** Encode a string push (field name index for field-load). */
function encodePushString(s: string): Uint8Array {
  const encoder = new TextEncoder();
  return encodePushData(encoder.encode(s));
}

/** Decode a hex string to a Uint8Array (e.g., 64 hex chars → 32 bytes). */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ── Script Compilation ─────────────────────────────────────────

interface CompileResult {
  words: string[];
  bytes: number[];
}

function concatResults(...results: CompileResult[]): CompileResult {
  return {
    words: results.flatMap(r => r.words),
    bytes: results.flatMap(r => r.bytes),
  };
}

const COMPARISON_OP_MAP: Record<string, { suffix: string; opcode: number }> = {
  '>':  { suffix: 'GT',  opcode: OP_GREATERTHAN },
  '<':  { suffix: 'LT',  opcode: OP_LESSTHAN },
  '>=': { suffix: 'GTE', opcode: OP_GREATERTHANOREQUAL },
  '<=': { suffix: 'LTE', opcode: OP_LESSTHANOREQUAL },
  '=':  { suffix: 'EQ',  opcode: OP_EQUAL },
  '!=': { suffix: 'NE',  opcode: OP_NUMNOTEQUAL },
};

function compileConstraint(expr: ConstraintExpr): CompileResult {
  switch (expr.kind) {
    case 'comparison': {
      const opInfo = COMPARISON_OP_MAP[expr.op];
      if (!opInfo) throw new Error(`Unknown comparison operator: ${expr.op}`);

      const fieldUpper = expr.field.toUpperCase();
      const valueStr = typeof expr.value === 'string' ? `"${expr.value}"` : String(expr.value);

      // Script: <value> <FIELD>-<OP>
      const pushBytes = typeof expr.value === 'number'
        ? [...encodePushNumber(expr.value)]
        : [...encodePushString(expr.value as string)];

      // Field load: push field name + OP_LOADFIELD
      const fieldBytes = [...encodePushString(expr.field), OP_LOADFIELD];

      return {
        words: [`${valueStr} ${fieldUpper}-${opInfo.suffix}`],
        bytes: [...pushBytes, ...fieldBytes, opInfo.opcode],
      };
    }

    case 'logical': {
      if (expr.op === 'not') {
        const inner = compileConstraint(expr.operands[0]);
        return {
          words: [...inner.words, 'BOOLNOT'],
          bytes: [...inner.bytes, OP_NOT],
        };
      }

      // and / or: compile all operands, then chain BOOLAND/BOOLOR (n-1 times)
      const opcode = expr.op === 'and' ? OP_BOOLAND : OP_BOOLOR;
      const opWord = expr.op === 'and' ? 'BOOLAND' : 'BOOLOR';

      const compiled = expr.operands.map(compileConstraint);
      const words = compiled.flatMap(c => c.words);
      const bytes = compiled.flatMap(c => c.bytes);

      // Chain: after all operands, add (n-1) boolean ops
      for (let i = 0; i < expr.operands.length - 1; i++) {
        words.push(opWord);
        bytes.push(opcode);
      }

      return { words, bytes };
    }

    case 'capability': {
      return {
        words: [`${expr.capabilityNumber} CHECK-CAP`],
        bytes: [...encodePushNumber(expr.capabilityNumber), OP_CHECKCAPABILITY],
      };
    }

    case 'domainCheck': {
      const flag = typeof expr.domainFlag === 'number'
        ? expr.domainFlag
        : parseInt(expr.domainFlag as string, 16) || 0;
      const flagStr = typeof expr.domainFlag === 'number'
        ? String(expr.domainFlag)
        : String(expr.domainFlag);

      return {
        words: [`${flagStr} CHECK-DOMAIN`],
        bytes: [...encodePushNumber(flag), OP_CHECKDOMAINFLAG],
      };
    }

    case 'timeConstraint': {
      const unix = Math.floor(new Date(expr.isoTimestamp).getTime() / 1000);
      const opWord = expr.op === 'timeAfter' ? 'TIME-AFTER' : 'TIME-BEFORE';
      // Use GREATERTHAN for after, LESSTHAN for before
      const opcode = expr.op === 'timeAfter' ? OP_GREATERTHAN : OP_LESSTHAN;

      return {
        words: [`${unix} ${opWord}`],
        bytes: [...encodePushNumber(unix), opcode],
      };
    }

    case 'hostCall': {
      // (call-host "name") or (predicate?) → push "name" OP_CALLHOST
      const nameBytes = [...encodePushString(expr.functionName)];
      return {
        words: [`"${expr.functionName}" OP_CALLHOST`],
        bytes: [...nameBytes, OP_CALLHOST],
      };
    }

    case 'typeHashCheck': {
      // (check-type-hash "hex") → push <32-byte-hash> OP_CHECKTYPEHASH
      const hashBytes = hexToBytes(expr.expectedHash);
      return {
        words: [`"${expr.expectedHash}" CHECK-TYPE-HASH`],
        bytes: [...encodePushData(hashBytes), OP_CHECKTYPEHASH],
      };
    }

    case 'deref': {
      // (deref) → OP_DEREF_POINTER (no arguments)
      return {
        words: ['DEREF'],
        bytes: [OP_DEREF_POINTER],
      };
    }
  }
}

function compileSubject(subject: PolicyForm['subject']): CompileResult {
  switch (subject.type) {
    case 'role': {
      const roleUpper = subject.name.toUpperCase();
      return {
        words: [`${roleUpper}-FLAG CHECK-DOMAIN`],
        bytes: [...encodePushString(subject.name), OP_CHECKDOMAINFLAG],
      };
    }
    case 'domainFlag': {
      return {
        words: [`${subject.flag} CHECK-DOMAIN`],
        bytes: [...encodePushNumber(subject.flag), OP_CHECKDOMAINFLAG],
      };
    }
    case 'certPattern': {
      return {
        words: [`"${subject.pattern}" CHECK-DOMAIN`],
        bytes: [...encodePushString(subject.pattern), OP_CHECKDOMAINFLAG],
      };
    }
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * LispCompiler — pure transformation from s-expressions to cell engine scripts.
 *
 * Same input always produces same output. No I/O. No side effects.
 */
export class LispCompiler {
  private compiledAt: string;

  constructor(options?: { compiledAt?: string }) {
    // Allow freezing timestamp for deterministic output in tests
    this.compiledAt = options?.compiledAt ?? new Date().toISOString();
  }

  /**
   * Compile a constraint expression to a cell engine script.
   * Input: a parsed SExpression representing a constraint.
   */
  compile(expr: SExpression): ScriptOutput {
    const constraint = interpretConstraint(expr);
    const result = compileConstraint(constraint);
    const inputExpr = sExprToString(expr);

    return {
      scriptWords: result.words.join(' '),
      scriptBytes: new Uint8Array(result.bytes),
      metadata: {
        inputExpr,
        compiledAt: this.compiledAt,
      },
    };
  }

  /**
   * Compile a full policy form to a cell engine script.
   * Input: a parsed SExpression of the form (policy :subject ... :action ... :constraint ... :linearity ...)
   */
  compilePolicy(expr: SExpression): ScriptOutput {
    const policy = interpretPolicy(expr);
    const inputExpr = sExprToString(expr);

    // Compile subject check
    const subjectResult = compileSubject(policy.subject);

    // Compile constraint
    const constraintResult = compileConstraint(policy.constraint);

    // Combine: subject check + constraint + BOOLAND
    const combined = concatResults(subjectResult, constraintResult);
    combined.words.push('BOOLAND');
    combined.bytes.push(OP_BOOLAND);

    // Add VERIFY at the end
    combined.words.push('VERIFY');
    combined.bytes.push(OP_VERIFY);

    return {
      scriptWords: combined.words.join(' '),
      scriptBytes: new Uint8Array(combined.bytes),
      metadata: {
        subject: policy.subject.type === 'role' ? policy.subject.name : String(policy.subject),
        action: policy.action,
        linearity: policy.linearity,
        inputExpr,
        compiledAt: this.compiledAt,
      },
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────

/** Convert an SExpression back to a string representation. */
function sExprToString(expr: SExpression): string {
  if (expr.type === 'atom') {
    if (expr.kind === 'string') return `"${expr.value}"`;
    if (expr.kind === 'keyword') return String(expr.value);
    return String(expr.value);
  }
  return `(${expr.elements.map(sExprToString).join(' ')})`;
}
