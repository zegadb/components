// Math expressions for function-plot: y = f(x), written the way people and
// models write them ("x^2 - 4", "2sin(x)", "e^(-x^2/2)/sqrt(2pi)", "|x|").
//
// A parser, never eval or Function: the text is tokenised, parsed by
// recursive descent into a tree of the operators and functions below, and
// compiled into plain closures. Nothing else can run. One variable, `x`.
//
//   numbers      2, 0.5, .5, 1e-3
//   constants    pi (π), e, tau
//   operators    + - * / ^ (or **), unary - and +, parentheses, |x| for abs,
//                implicit multiplication ("2x", "3(x+1)", "x sin(x)")
//   functions    sin cos tan asin acos atan sinh cosh tanh sqrt cbrt abs exp
//                ln log (base 10) log2 log10 floor ceil round sign
//                min(a, b, …) max(a, b, …) pow(a, b) atan2(y, x); a one-argument
//                function may skip its parentheses: "sin x"
//   also         − (U+2212) as minus, × and · as times, √ as sqrt
//
// -x^2 is -(x^2); 2^3^2 is 2^(3^2); "sin x^2" is sin(x^2).

export type Fn = (x: number) => number;

export interface ExprError {
  /** Character offset in the text where the problem is. */
  pos: number;
  message: string;
  help: string;
}

export type Parsed = { ok: true; fn: Fn; uses: { x: boolean } } | { ok: false; error: ExprError };

/** The longest expression accepted, in characters. */
export const MAX_LENGTH = 400;
const MAX_DEPTH = 64;

const UNARY: Readonly<Record<string, (a: number) => number>> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  sec: (a) => 1 / Math.cos(a), csc: (a) => 1 / Math.sin(a), cot: (a) => 1 / Math.tan(a),
};
const VARIADIC: Readonly<Record<string, { min: number; max: number; f: (args: number[]) => number }>> = {
  min: { min: 1, max: 16, f: (a) => Math.min(...a) },
  max: { min: 1, max: 16, f: (a) => Math.max(...a) },
  pow: { min: 2, max: 2, f: (a) => Math.pow(a[0]!, a[1]!) },
  atan2: { min: 2, max: 2, f: (a) => Math.atan2(a[0]!, a[1]!) },
};
const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, "π": Math.PI, e: Math.E, tau: 2 * Math.PI };
const FUNCTION_NAMES = [...Object.keys(UNARY), ...Object.keys(VARIADIC)];
const NAMES = ["x", ...Object.keys(CONSTANTS), ...FUNCTION_NAMES];

type Tok =
  | { t: "num"; v: number; pos: number }
  | { t: "id"; v: string; pos: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" | "(" | ")" | "," | "|"; pos: number }
  | { t: "end"; pos: number };

class Fail extends Error {
  readonly at: ExprError;
  constructor(at: ExprError) { super(at.message); this.at = at; }
}
const fail = (pos: number, message: string, help: string): never => { throw new Fail({ pos, message, help }); };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    // "2e" is 2·e, not a malformed exponent: the exponent needs its digits.
    if (num) { out.push({ t: "num", v: Number(num[0]), pos: i }); i += num[0].length; continue; }
    const id = /^(?:[A-Za-z_][A-Za-z0-9_]*|π)/.exec(text.slice(i));
    if (id) { out.push({ t: "id", v: id[0], pos: i }); i += id[0].length; continue; }
    if (text.startsWith("**", i)) { out.push({ t: "op", v: "^", pos: i }); i += 2; continue; }
    const op = ({ "+": "+", "-": "-", "−": "-", "*": "*", "×": "*", "·": "*", "/": "/", "÷": "/", "^": "^", "(": "(", ")": ")", ",": ",", "|": "|" } as const)[c as "+"];
    if (op) { out.push({ t: "op", v: op, pos: i }); i++; continue; }
    if (c === "√") { out.push({ t: "id", v: "sqrt", pos: i }); i++; continue; }
    if (c === "=" ) fail(i, "an expression has no `=`", "write only the right-hand side: for y = x^2 - 4, write \"x^2 - 4\"");
    fail(i, `\`${c}\` is not part of an expression`, "use numbers, x, + - * / ^, parentheses and functions like sin(x)");
  }
  out.push({ t: "end", pos: text.length });
  return out;
}

type Node = (x: number) => number;

/** Parse `text` into a function of x. */
export function parse(text: string): Parsed {
  if (typeof text !== "string") return { ok: false, error: { pos: 0, message: "the expression is not text", help: "give it as a string, e.g. \"x^2 - 4\"" } };
  if (text.length > MAX_LENGTH) return { ok: false, error: { pos: MAX_LENGTH, message: `the expression is longer than ${MAX_LENGTH} characters`, help: "simplify it, or split it into several series" } };
  if (!text.trim()) return { ok: false, error: { pos: 0, message: "the expression is empty", help: "write y = f(x)'s right-hand side, e.g. \"x^2 - 4\"" } };
  const uses = { x: false };
  try {
    const toks = tokenize(text);
    let k = 0;
    let depth = 0;
    const peek = () => toks[k]!;
    const next = () => toks[k++]!;
    const isOp = (tok: Tok, v: string) => tok.t === "op" && tok.v === v;
    const deeper = <T>(pos: number, f: () => T): T => {
      if (++depth > MAX_DEPTH) fail(pos, "the expression is nested too deeply", "simplify it");
      try { return f(); } finally { depth--; }
    };
    // Inside |…| a bare `|` closes; elsewhere it opens.
    let bars = 0;
    /** Whether the next token can start a factor (for implicit multiplication). */
    const startsFactor = (tok: Tok) => tok.t === "num" || tok.t === "id" || isOp(tok, "(") || (isOp(tok, "|") && bars === 0);

    const additive = (): Node => deeper(peek().pos, () => {
      let left = multiplicative();
      for (;;) {
        const tok = peek();
        if (isOp(tok, "+")) { next(); const a = left, b = multiplicative(); left = (x) => a(x) + b(x); }
        else if (isOp(tok, "-")) { next(); const a = left, b = multiplicative(); left = (x) => a(x) - b(x); }
        else return left;
      }
    });
    const multiplicative = (): Node => {
      let left = unary();
      for (;;) {
        const tok = peek();
        if (isOp(tok, "*")) { next(); const a = left, b = unary(); left = (x) => a(x) * b(x); }
        else if (isOp(tok, "/")) { next(); const a = left, b = unary(); left = (x) => a(x) / b(x); }
        else if (startsFactor(tok)) { const a = left, b = power(); left = (x) => a(x) * b(x); }
        else return left;
      }
    };
    const unary = (): Node => deeper(peek().pos, () => {
      const tok = peek();
      if (isOp(tok, "-")) { next(); const a = unary(); return (x) => -a(x); }
      if (isOp(tok, "+")) { next(); return unary(); }
      return power();
    });
    const power = (): Node => {
      const base = primary();
      if (isOp(peek(), "^")) { next(); const exp = unary(); return (x) => Math.pow(base(x), exp(x)); }
      return base;
    };
    const args = (name: string, pos: number): Node[] => {
      const out: Node[] = [];
      if (isOp(peek(), ")")) fail(peek().pos, `${name}() needs an argument`, `e.g. ${name}(x)`);
      for (;;) {
        out.push(additive());
        const tok = next();
        if (isOp(tok, ")")) return out;
        if (!isOp(tok, ",")) fail(tok.pos, `expected \`,\` or \`)\` in ${name}(…)`, `close the call opened at ${pos + 1}`);
      }
    };
    const primary = (): Node => deeper(peek().pos, () => {
      const tok = next();
      if (tok.t === "num") { const v = tok.v; return () => v; }
      if (isOp(tok, "(")) {
        const inner = additive();
        const close = next();
        if (!isOp(close, ")")) fail(close.pos, "a `(` is never closed", "add the matching `)`");
        return inner;
      }
      if (isOp(tok, "|") && bars === 0) {
        bars++;
        const inner = additive();
        bars--;
        const close = next();
        if (!isOp(close, "|")) fail(close.pos, "a `|` is never closed", "write |x| with a closing bar, or abs(x)");
        return (x) => Math.abs(inner(x));
      }
      if (tok.t === "id") {
        const name = tok.v;
        if (name === "x") { uses.x = true; return (x) => x; }
        if (Object.hasOwn(CONSTANTS, name)) { const v = CONSTANTS[name]!; return () => v; }
        const lower = name.toLowerCase();
        if (Object.hasOwn(UNARY, lower)) {
          const f = UNARY[lower]!;
          if (isOp(peek(), "(")) {
            const open = next();
            const a = args(lower, open.pos);
            if (a.length !== 1) fail(open.pos, `${lower}() takes one argument, got ${a.length}`, `e.g. ${lower}(x)`);
            const arg = a[0]!;
            return (x) => f(arg(x));
          }
          if (!startsFactor(peek())) fail(peek().pos, `${lower} needs an argument`, `e.g. ${lower}(x)`);
          const arg = power();
          return (x) => f(arg(x));
        }
        if (Object.hasOwn(VARIADIC, lower)) {
          const v = VARIADIC[lower]!;
          const open = next();
          if (!isOp(open, "(")) fail(open.pos, `${lower} needs its arguments in parentheses`, `e.g. ${lower}(x, 0)`);
          const a = args(lower, open.pos);
          if (a.length < v.min || a.length > v.max) fail(open.pos, `${lower}() takes ${v.min === v.max ? v.min : `${v.min} to ${v.max}`} arguments, got ${a.length}`, `e.g. ${lower}(x, 0)`);
          return (x) => v.f(a.map((g) => g(x)));
        }
        // "xsin(x)" or "pix": a run of known names written together.
        const split = splitNames(name);
        if (split) {
          k--;
          toks.splice(k, 1, ...split.map((v, j) => ({ t: "id" as const, v, pos: tok.pos + split.slice(0, j).join("").length })));
          return primary();
        }
        const guess = closestName(name);
        return fail(tok.pos, `\`${name}\` is not a variable, constant or function here`,
          guess ? `did you mean \`${guess}\`? (the one variable is x)` : "the one variable is x; constants are pi, e, tau; functions are sin, cos, sqrt, ln, log, exp, abs…");
      }
      if (tok.t === "end") return fail(tok.pos, "the expression ends too soon", "finish it, e.g. \"x^2 - 4\"");
      return fail(tok.pos, `\`${tok.v}\` is out of place`, "check the operators and parentheses around it");
    });

    const root = additive();
    const end = peek();
    if (end.t !== "end") fail(end.pos, isOp(end, ")") ? "a `)` has no `(`" : `\`${end.t === "num" ? end.v : end.v}\` is out of place`, "check the parentheses");
    return { ok: true, fn: root, uses };
  } catch (error) {
    if (error instanceof Fail) return { ok: false, error: error.at };
    throw error;
  }
}

/** "xsinx" → ["x", "sin", "x"]: a word made only of known names, longest first; null if it isn't one. */
function splitNames(word: string): string[] | null {
  if (word.length > 32) return null;
  const names = [...NAMES].sort((a, b) => b.length - a.length);
  const go = (rest: string): string[] | null => {
    if (!rest) return [];
    for (const n of names) {
      if (rest.startsWith(n)) {
        const tail = go(rest.slice(n.length));
        if (tail) return [n, ...tail];
      }
    }
    return null;
  };
  const parts = go(word);
  return parts && parts.length > 1 ? parts : null;
}

function closestName(word: string): string | null {
  const w = word.toLowerCase();
  let best: string | null = null, score = Infinity;
  for (const n of NAMES) {
    const d = distance(w, n);
    if (d < score) { score = d; best = n; }
  }
  return score <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}
