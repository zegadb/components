import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, render, theme, toSvgString, type SvgNode } from "./index.ts";
import * as pom from "./path-on-map/model.ts";

const ava = theme("ava", "light");
const draw = (spec: unknown, width = 600) => {
  const v = validate(spec);
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  const r = render(v.view, { width, theme: ava });
  if ("map" in r) throw new Error("a map");
  return r;
};
const all = (n: SvgNode | string, pred: (n: SvgNode) => boolean): SvgNode[] => (typeof n === "string" ? [] : [...(pred(n) ? [n] : []), ...n.children.flatMap((c) => all(c, pred))]);
const part = (n: SvgNode, name: string) => all(n, (x) => x.attrs["data-part"] === name);
/** The points of a path's `d`, run by run. */
const runs = (d: string) => d.split("M").filter(Boolean).map((r) => r.split("L").map((p) => p.trim().split(" ").map(Number) as [number, number]));

test("function-plot: the curve goes through the right pixels", () => {
  const r = draw({ component: "function-plot", data: { functions: [{ fn: "x" }] }, options: { x: [-10, 10], y: [-10, 10], grid: false } });
  const [curve] = part(r.svg, "curve");
  const pts = runs(String(curve!.attrs.d))[0]!;
  // y = x: the first point is the plot's bottom-left corner, the last its top-right, and it's straight.
  const [x0, y0] = pts[0]!, [x1, y1] = pts[pts.length - 1]!;
  assert.ok(x0 < x1 && y0 > y1);
  for (const [x, y] of pts) assert.ok(Math.abs((y - y0) / (y1 - y0) - (x - x0) / (x1 - x0)) < 0.01);
  assert.equal(curve!.attrs.stroke, ava.accent, "one series is the accent");
});

test("function-plot: an asymptote breaks the curve instead of drawing a wall", () => {
  const r = draw({ component: "function-plot", data: { functions: [{ fn: "1/(x-1)" }] }, options: { x: [-4, 6], y: [-6, 6] } });
  assert.equal(runs(String(part(r.svg, "curve")[0]!.attrs.d)).length, 2);
});

test("function-plot: areas, points and several series", () => {
  const r = draw({ component: "function-plot", data: { functions: [{ id: "f", fn: "4 - x^2" }, { id: "g", fn: "x" }], areas: [{ above: "f", below: "axis", from: -2, to: 2 }], points: [{ x: 2, on: "f", label: "(2, 0)" }] }, options: { x: [-4, 4], y: [-3, 5] } });
  const curves = part(r.svg, "curve");
  assert.deepEqual(curves.map((c) => c.attrs.stroke), [ava.series[0], ava.series[1]], "series take the fixed order");
  assert.equal(part(r.svg, "area").length, 1);
  assert.equal(part(r.svg, "legend").length, 1, "two series have a legend");
  const [dot] = part(r.svg, "point");
  // (2, 0) is on the x axis: the dot sits on the axis line through zero.
  const axisY = all(r.svg, (n) => n.tag === "line" && n.attrs.stroke === ava.axis && n.attrs.y1 === n.attrs.y2)[0]!.attrs.y1;
  assert.equal(dot!.attrs.cy, axisY);
  assert.ok(r.hover && r.hover.columns.length > 50 && r.hover.columns[0]!.rows.length === 2);
});

test("function-plot: sized for the column, phone included", () => {
  for (const width of [358, 600, 720]) {
    const r = draw({ component: "function-plot", data: { functions: [{ fn: "sin(x)" }] }, options: { xTicks: "pi", x: [-6.3, 6.3] } }, width);
    assert.equal(r.svg.attrs.width, width);
    assert.ok(Number(r.svg.attrs.height) >= 220 && Number(r.svg.attrs.height) <= 420);
  }
});

test("price-chart: candles hollow when they rise, filled when they fall; volume underneath", () => {
  const spec = { component: "price-chart", data: { series: [{ label: "RY.TO", points: [
    { t: "2026-11-09", o: 170, h: 172, l: 169, c: 171.5, v: 4e6 },
    { t: "2026-11-10", o: 171.5, h: 172, l: 168, c: 168.9, v: 5e6 },
    { t: "2026-11-11", o: 169, h: 171, l: 168.5, c: 170.2, v: 3e6 },
  ] }] }, options: { kind: "candle", volume: true } };
  const r = draw(spec);
  const up = part(r.svg, "candle-up"), down = part(r.svg, "candle-down");
  assert.equal(up.length, 2);
  assert.equal(down.length, 1);
  assert.equal(up[0]!.attrs.fill, ava.ground);
  assert.equal(down[0]!.attrs.fill, ava.down);
  const vols = part(r.svg, "volume");
  assert.equal(vols.length, 3);
  // The tallest volume bar is the 5M day.
  assert.ok(Number(vols[1]!.attrs.height) > Number(vols[0]!.attrs.height));
  assert.match(toSvgString(r.svg), /RY\.TO/);
});

test("price-chart: percent scale puts both series on one axis from 0 %", () => {
  const r = draw({ component: "price-chart", data: { series: [
    { label: "A", points: [{ t: "2026-10-01", c: 10 }, { t: "2026-11-01", c: 11 }] },
    { label: "B", points: [{ t: "2026-10-01", c: 1000 }, { t: "2026-11-01", c: 1100 }] },
  ] }, options: { scale: "percent" } });
  const [a, b] = part(r.svg, "line").map((l) => runs(String(l.attrs.d))[0]!);
  // Both rose 10 %: the two lines are the same line.
  assert.deepEqual(a, b);
  assert.match(String(part(r.svg, "last")[0]!.children[0]), /\+10\.00%/);
});

test("model text is text: labels are escaped, never markup", () => {
  const r = draw({ component: "function-plot", data: { functions: [{ fn: "x", label: "<script>alert(1)</script>" }, { fn: "x^2", label: "\"><img src=x onerror=alert(1)>" }] } });
  const s = toSvgString(r.svg);
  assert.ok(!s.includes("<script>") && !s.includes("<img"));
  assert.match(s, /&lt;script&gt;/);
});

test("path-on-map: the model draws segments in the theme's ramp", () => {
  const v = validate({ component: "path-on-map", data: { valueName: "speed", paths: [{ label: "Lap", points: [[7.42, 43.73], [7.43, 43.74], [7.44, 43.735]], values: [100, 200, 300] }] }, options: { valueUnit: "km/h" } });
  assert.ok(v.ok && v.view.component === "path-on-map");
  const f = pom.pathFeatures(v.view.paths, ava);
  assert.equal(f.segments.features.length, 2);
  assert.equal(f.segments.features[0]!.properties.c, ava.sequential[0]!.toUpperCase());
  assert.equal(f.starts.features[0]!.properties.label, "Lap");
  assert.deepEqual(pom.legendOf(v.view.paths, ava), { title: "speed (km/h)", low: "100", high: "300", ramp: ava.sequential });
  const dark = theme("ava", "dark");
  assert.notEqual(pom.pathFeatures(v.view.paths, dark).segments.features[0]!.properties.c, f.segments.features[0]!.properties.c);
  assert.equal(pom.pathFeatures(v.view.paths, theme("zega", "light")).segments.features[0]!.properties.c, theme("zega", "light").sequential[0]);
});
