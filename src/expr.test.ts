import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./expr.ts";

const at = (text: string, x: number) => {
  const p = parse(text);
  if (!p.ok) throw new Error(`${text}: ${p.error.message}`);
  return p.fn(x);
};
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("arithmetic, precedence and associativity", () => {
  close(at("x^2 - 4", 3), 5);
  close(at("-x^2", 3), -9);
  close(at("2^3^2", 0), 512);
  close(at("2**3", 0), 8);
  close(at("1 - 2 - 3", 0), -4);
  close(at("8 / 4 / 2", 0), 1);
  close(at("(1 + 2) * 3", 0), 9);
  close(at("2^-x", 1), 0.5);
  close(at("1e-3 * x", 1000), 1);
  close(at(".5x", 4), 2);
});

test("implicit multiplication, as people write maths", () => {
  close(at("2x", 3), 6);
  close(at("3(x+1)", 1), 6);
  close(at("x(x+1)", 2), 6);
  close(at("2sin(x)", Math.PI / 2), 2);
  close(at("sin x cos x", 0.3), Math.sin(0.3) * Math.cos(0.3));
  close(at("sin x^2", 2), Math.sin(4));
  close(at("2pi x", 1), 2 * Math.PI);
  close(at("xsin(x)", 2), 2 * Math.sin(2));
  close(at("e^(-x^2/2)/sqrt(2pi)", 0), 1 / Math.sqrt(2 * Math.PI));
});

test("functions, constants, |x| and typographic operators", () => {
  close(at("|x - 3|", 1), 2);
  close(at("|x| - |x - 1|", 0.5), 0);
  close(at("abs(x)", -2), 2);
  close(at("ln(e)", 0), 1);
  close(at("log(100)", 0), 2);
  close(at("max(x, 0)", -3), 0);
  close(at("min(1, 2, x)", -1), -1);
  close(at("atan2(1, 1)", 0), Math.PI / 4);
  close(at("2 × x − 1", 3), 5);
  close(at("√x", 9), 3);
  close(at("π", 0), Math.PI);
  assert.ok(Number.isNaN(at("sqrt(x)", -1)));
  assert.equal(at("1/x", 0), Infinity);
});

test("teaching errors, with where the problem is", () => {
  const err = (text: string) => { const p = parse(text); assert.ok(!p.ok, `${text} parsed`); return p.error; };
  assert.deepEqual(err("y = x^2"), { pos: 2, message: "an expression has no `=`", help: "write only the right-hand side: for y = x^2 - 4, write \"x^2 - 4\"" });
  assert.match(err("sinn(x)").help, /did you mean `sin`\?/);
  assert.match(err("t^2").message, /`t` is not a variable/);
  assert.match(err("(x + 1").message, /never closed/);
  assert.match(err("x +").message, /ends too soon/);
  assert.match(err("x)").message, /has no `\(`/);
  assert.match(err("pow(x)").message, /takes 2 arguments/);
  assert.match(err("").message, /empty/);
  assert.match(err("x".repeat(401)).message, /longer than 400/);
  assert.match(err("((((".repeat(30) + "x" + "))))".repeat(30)).message, /nested too deeply/);
});

test("nothing but maths can run: no names reach JavaScript", () => {
  for (const text of ["constructor", "process.exit(1)", "globalThis", "this", "x.constructor", "eval(x)", "Function(x)", "__proto__", "x[0]", "`x`", "'x'", "x; 1", "require(x)"]) {
    const p = parse(text);
    assert.equal(p.ok, false, `${text} must not parse`);
  }
});
