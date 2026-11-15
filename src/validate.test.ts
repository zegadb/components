import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, explain, COMPONENT_IDS } from "./validate.ts";
import { CONTRACTS } from "./generated/contracts.ts";
import { toolDefinitions, componentOfTool } from "./index.ts";

const first = (spec: unknown) => {
  const v = validate(spec);
  assert.equal(v.ok, false, `expected ${JSON.stringify(spec).slice(0, 120)} to be refused`);
  return (v as { ok: false; errors: { code: string; at: string; message: string; help: string }[] }).errors[0]!;
};

test("every contract's valid examples validate, and its invalid ones give exactly the error written", () => {
  for (const id of COMPONENT_IDS) {
    const c = CONTRACTS[id];
    for (const e of c.examples.valid) assert.equal(validate(e.spec).ok, true, `${id}: ${e.title}: ${JSON.stringify(validate(e.spec))}`);
    for (const e of c.examples.invalid) {
      const v = validate(e.spec);
      assert.equal(v.ok, false, `${id}: ${e.title} passed`);
      if (!v.ok) assert.deepEqual(v.errors[0], e.error, `${id}: ${e.title}`);
    }
  }
});

test("the envelope: an object, a known component, data, known options", () => {
  assert.equal(first(null).code, "type");
  assert.equal(first("function-plot").code, "type");
  assert.deepEqual(first({ component: "function-plots", data: {} }), { code: "component", at: "component", message: "`function-plots` is not a component", help: "did you mean `function-plot`?" });
  assert.equal(first({ component: "function-plot" }).code, "required");
  assert.equal(first({ component: "function-plot", data: { functions: [{ fn: "x" }] }, colour: "red" }).code, "unknown");
  assert.deepEqual(first({ component: "function-plot", data: { functions: [{ fn: "x" }] }, options: { gird: false } }), { code: "unknown", at: "options.gird", message: "`gird` is not an option of function-plot", help: "did you mean `grid`?" });
  assert.equal(first({ component: "function-plot", version: "2", data: { functions: [{ fn: "x" }] } }).code, "version");
});

test("data is held to the contract's schema, with paths a model can follow", () => {
  const e = first({ component: "function-plot", data: { functions: [] } });
  assert.equal(e.at, "data.functions");
  assert.equal(first({ component: "function-plot", data: { functions: Array.from({ length: 7 }, () => ({ fn: "x" })) } }).code, "length");
  assert.equal(first({ component: "function-plot", data: { functions: [{ fn: "x", color: "red" }] } }).at, "data.functions[0].color");
  assert.equal(first({ component: "function-plot", data: { functions: [{ fn: 2 }] } }).code, "type");
  assert.equal(first({ component: "price-chart", data: { series: [{ points: [{ t: "13 Nov", c: 1 }, { t: "2026-11-14", c: 2 }] }] } }).at, "data.series[0].points[0].t");
  assert.equal(first({ component: "price-chart", data: { series: [{ points: [{ t: "2026-11-13", c: -1 }, { t: "2026-11-14", c: 2 }] }] } }).code, "range");
  assert.equal(first({ component: "path-on-map", data: { paths: [{ points: [[7.4, 43.7], [200, 43.7]] }] } }).at, "data.paths[0].points[1][0]");
  assert.equal(first({ component: "price-chart", data: { series: [{ points: [{ t: "2026-11-13", c: 1 }, { t: "2026-11-14", c: 2 }] }] }, options: { currency: "cad" } }).code, "pattern");
});

test("what a schema can't say: semantics", () => {
  assert.equal(first({ component: "function-plot", data: { functions: [{ fn: "sin(" }] } }).code, "expression");
  assert.equal(first({ component: "function-plot", data: { functions: [{ id: "f", fn: "x" }, { id: "f", fn: "x^2" }] } }).code, "duplicate");
  assert.equal(first({ component: "function-plot", data: { functions: [{ fn: "x" }] }, options: { x: [5, -5] } }).code, "range");
  assert.equal(first({ component: "function-plot", data: { functions: [{ fn: "x" }], points: [{ x: 1 }] } }).code, "required");
  assert.equal(first({ component: "function-plot", data: { functions: [{ fn: "x" }], lines: [{ x: 1, y: 2 }] } }).code, "line");
  assert.equal(first({ component: "price-chart", data: { series: [{ points: [{ t: "2026-02-30", c: 1 }, { t: "2026-03-01", c: 1 }] }] } }).code, "time");
  assert.equal(first({ component: "price-chart", data: { series: [{ points: [{ t: "2026-11-13", c: 1 }, { t: "2026-11-14", c: 2 }] }] }, options: { kind: "candle" } }).code, "required");
  assert.equal(first({ component: "price-chart", data: { series: [{ points: [{ t: "2026-11-13", c: 1 }, { t: "2026-11-14", c: 2 }] }] }, options: { volume: true } }).at, "data.series[0].points[0].v");
  assert.equal(first({ component: "price-chart", data: { series: [{ points: [{ t: "2026-11-13", c: 1 }, { t: "2026-11-14", c: 2 }] }], annotations: [{ t: "2027-01-01", label: "later" }] } }).code, "range");
  assert.equal(first({ component: "path-on-map", data: { paths: [{ points: [[7.4, 43.7], [7.41, 43.71]], values: [1, 2, 3] }] } }).code, "values-length");
});

test("defaults fill in, given options are kept", () => {
  const v = validate({ component: "function-plot", data: { functions: [{ fn: "x" }] }, options: { grid: false } });
  assert.ok(v.ok);
  assert.deepEqual(v.view.options, { x: [-10, 10], y: null, xTicks: "number", grid: false, xLabel: null, yLabel: null, title: null });
});

test("explain() is what a model gets back: every error, where and what to do", () => {
  const v = validate({ component: "function-plot", data: { functions: [{ fn: "y = x" }, { fn: "sinn(x)" }] } });
  assert.ok(!v.ok);
  const text = explain(v.errors);
  assert.match(text, /^The picture was not drawn/);
  assert.match(text, /- data\.functions\[0\]\.fn: an expression has no `=`/);
  assert.match(text, /- data\.functions\[1\]\.fn: .*did you mean `sin`/);
});

test("one tool per component, whose input schema is the contract's own", () => {
  const tools = toolDefinitions();
  assert.deepEqual(tools.map((t) => t.name), COMPONENT_IDS.map((id) => `draw_${id.replace(/-/g, "_")}`));
  for (const t of tools) {
    assert.equal(componentOfTool(t.name), t.component);
    assert.ok(!JSON.stringify(t.inputSchema).includes("$ref"), `${t.name} keeps a $ref`);
    const props = (t.inputSchema.properties as Record<string, unknown>);
    assert.deepEqual(Object.keys(props), ["data", "options"]);
  }
  assert.equal(componentOfTool("draw_nothing"), null);
  assert.equal(componentOfTool("function-plot"), null);
});
