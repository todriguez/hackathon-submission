/**
 * Pure TypeScript s-expression parser for the Lisp policy DSL.
 *
 * Parses s-expressions into an AST of Atom and List nodes.
 * No external dependencies. No runtime evaluation.
 */

// ── AST Types ──────────────────────────────────────────────────

export type SExpression = Atom | List;

export interface Atom {
  type: 'atom';
  kind: 'symbol' | 'number' | 'string' | 'keyword';
  value: string | number;
  line: number;
  column: number;
}

export interface List {
  type: 'list';
  elements: SExpression[];
  line: number;
  column: number;
}

/** Syntax error with source location. */
export class ParseError extends Error {
  line: number;
  column: number;

  constructor(message: string, line: number, column: number) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = 'ParseError';
    this.line = line;
    this.column = column;
  }
}

// ── Parser State ───────────────────────────────────────────────

interface ParserState {
  input: string;
  pos: number;
  line: number;
  column: number;
}

function makeState(input: string): ParserState {
  return { input, pos: 0, line: 1, column: 1 };
}

function peek(s: ParserState): string | undefined {
  return s.input[s.pos];
}

function advance(s: ParserState): string {
  const ch = s.input[s.pos];
  s.pos++;
  if (ch === '\n') {
    s.line++;
    s.column = 1;
  } else {
    s.column++;
  }
  return ch;
}

function atEnd(s: ParserState): boolean {
  return s.pos >= s.input.length;
}

// ── Whitespace & Comments ──────────────────────────────────────

function skipWhitespaceAndComments(s: ParserState): void {
  while (!atEnd(s)) {
    const ch = peek(s)!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      advance(s);
    } else if (ch === ';') {
      // Skip to end of line
      while (!atEnd(s) && peek(s) !== '\n') {
        advance(s);
      }
    } else {
      break;
    }
  }
}

// ── Atom Parsers ───────────────────────────────────────────────

function parseString(s: ParserState): Atom {
  const startLine = s.line;
  const startCol = s.column;
  advance(s); // consume opening "

  let value = '';
  while (!atEnd(s)) {
    const ch = peek(s)!;
    if (ch === '"') {
      advance(s); // consume closing "
      return { type: 'atom', kind: 'string', value, line: startLine, column: startCol };
    }
    if (ch === '\\') {
      advance(s); // consume backslash
      if (atEnd(s)) break;
      const escaped = advance(s);
      switch (escaped) {
        case 'n': value += '\n'; break;
        case 't': value += '\t'; break;
        case '\\': value += '\\'; break;
        case '"': value += '"'; break;
        default: value += escaped;
      }
    } else {
      value += advance(s);
    }
  }
  throw new ParseError('Unterminated string literal', startLine, startCol);
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isSymbolChar(ch: string): boolean {
  return ch !== '(' && ch !== ')' && ch !== '"' && ch !== ';' &&
         ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r' &&
         ch !== "'" && ch !== '`' && ch !== ',';
}

function parseAtomToken(s: ParserState): Atom {
  const startLine = s.line;
  const startCol = s.column;
  let token = '';

  while (!atEnd(s) && isSymbolChar(peek(s)!)) {
    token += advance(s);
  }

  if (token.length === 0) {
    throw new ParseError(`Unexpected character '${peek(s) ?? 'EOF'}'`, startLine, startCol);
  }

  // Keyword: starts with :
  if (token[0] === ':') {
    return { type: 'atom', kind: 'keyword', value: token, line: startLine, column: startCol };
  }

  // Number: integer or float, optionally negative
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    const numVal = token.includes('.') ? parseFloat(token) : parseInt(token, 10);
    return { type: 'atom', kind: 'number', value: numVal, line: startLine, column: startCol };
  }

  // Symbol
  return { type: 'atom', kind: 'symbol', value: token, line: startLine, column: startCol };
}

// ── Recursive Descent ──────────────────────────────────────────

function parseForm(s: ParserState): SExpression {
  skipWhitespaceAndComments(s);

  if (atEnd(s)) {
    throw new ParseError('Unexpected end of input', s.line, s.column);
  }

  const ch = peek(s)!;

  // List
  if (ch === '(') {
    return parseList(s);
  }

  // Quote shorthand: 'x → (quote x)
  if (ch === "'") {
    const startLine = s.line;
    const startCol = s.column;
    advance(s); // consume '
    const inner = parseForm(s);
    return {
      type: 'list',
      elements: [
        { type: 'atom', kind: 'symbol', value: 'quote', line: startLine, column: startCol },
        inner,
      ],
      line: startLine,
      column: startCol,
    };
  }

  // String
  if (ch === '"') {
    return parseString(s);
  }

  // Closing paren outside a list
  if (ch === ')') {
    throw new ParseError('Unexpected closing parenthesis', s.line, s.column);
  }

  // Atom (keyword, number, or symbol)
  return parseAtomToken(s);
}

function parseList(s: ParserState): List {
  const startLine = s.line;
  const startCol = s.column;
  advance(s); // consume (

  const elements: SExpression[] = [];

  while (true) {
    skipWhitespaceAndComments(s);

    if (atEnd(s)) {
      throw new ParseError('Unmatched opening parenthesis', startLine, startCol);
    }

    if (peek(s) === ')') {
      advance(s); // consume )
      return { type: 'list', elements, line: startLine, column: startCol };
    }

    elements.push(parseForm(s));
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Parse a single s-expression from the input string.
 * Throws ParseError on malformed input.
 */
export function parseExpression(input: string): SExpression {
  const s = makeState(input);
  const expr = parseForm(s);

  // Ensure no trailing non-whitespace
  skipWhitespaceAndComments(s);
  if (!atEnd(s)) {
    throw new ParseError(
      `Unexpected input after expression: '${s.input.slice(s.pos, s.pos + 20)}...'`,
      s.line,
      s.column,
    );
  }

  return expr;
}

/**
 * Parse multiple s-expressions from the input string.
 * Returns an array of top-level forms.
 */
export function parseProgram(input: string): SExpression[] {
  const s = makeState(input);
  const expressions: SExpression[] = [];

  while (true) {
    skipWhitespaceAndComments(s);
    if (atEnd(s)) break;
    expressions.push(parseForm(s));
  }

  return expressions;
}
