// function-plot (components/function-plot/): curves y = f(x), shaded areas,
// marked points and reference lines on the plane.
import { parse, type Fn } from "./expr.ts";
import { heightFor, haloText, legendRows, titleRow, TYPE, type Hover, type HoverColumn, type RenderContext, type Rendered } from "./chart.ts";
import { clamp, decimalsFor, formatNumber, linear, niceDomain, niceStep, piLabel, piTicks, quantile, ticks } from "./scale.ts";
import { el, pathData, textWidth, type SvgNode } from "./svg.ts";
import { withAlpha } from "./theme.ts";
import { CONTRACTS } from "./generated/contracts.ts";
import type { ViewError } from "./types.ts";

export interface FunctionSpec { id?: string; fn: string; label?: string; domain?: [number, number] }
export interface AreaSpec { above: string; below: string; from?: number; to?: number; label?: string }
export interface PointSpec { x: number; y?: number; on?: string; label?: string }
export interface LineSpec { x?: number; y?: number; label?: string }
export interface FunctionPlotData { functions: FunctionSpec[]; areas?: AreaSpec[]; points?: PointSpec[]; lines?: LineSpec[] }
export interface FunctionPlotOptions {
  x: [number, number];
  y: [number, number] | null;
  xTicks: "number" | "pi";
  grid: boolean;
  xLabel: string | null;
  yLabel: string | null;
  title: string | null;
}

const EDGES_ABOVE = ["axis", "top"];
const EDGES_BELOW = ["axis", "bottom"];
const idOf = (f: FunctionSpec, i: number) => f.id ?? `f${i + 1}`;

/** What the schema can't say: expressions parse, ids are unique and refer to something, ranges run forward. */
export function semantic(data: FunctionPlotData, options: FunctionPlotOptions): ViewError[] {
  const errors: ViewError[] = [];
  const ids = data.functions.map(idOf);
  const seen = new Set<string>();
  data.functions.forEach((f, i) => {
    const id = ids[i]!;
    if (seen.has(id)) errors.push({ code: "duplicate", at: `data.functions[${i}].id`, message: `two functions are called \`${id}\``, help: "give each function its own id" });
    seen.add(id);
    const parsed = parse(f.fn);
    if (!parsed.ok) errors.push({ code: "expression", at: `data.functions[${i}].fn`, message: `${parsed.error.message} (at character ${parsed.error.pos + 1})`, help: parsed.error.help });
    if (f.domain && !(f.domain[0] < f.domain[1])) errors.push({ code: "range", at: `data.functions[${i}].domain`, message: `[${f.domain.join(", ")}] does not run left to right`, help: "give [from, to] with from < to" });
  });
  const ref = (name: string, edges: string[], at: string) => {
    if (ids.includes(name) || edges.includes(name)) return;
    errors.push({ code: "reference", at, message: `\`${name}\` is not a function's id`, help: `use one of ${ids.join(", ")}, or ${edges.map((e) => JSON.stringify(e)).join(", ")}` });
  };
  (data.areas ?? []).forEach((a, i) => {
    ref(a.above, EDGES_ABOVE, `data.areas[${i}].above`);
    ref(a.below, EDGES_BELOW, `data.areas[${i}].below`);
    if (a.from !== undefined && a.to !== undefined && !(a.from < a.to)) errors.push({ code: "range", at: `data.areas[${i}]`, message: `from (${a.from}) is not left of to (${a.to})`, help: "give from < to" });
  });
  (data.points ?? []).forEach((p, i) => {
    if (p.on !== undefined) ref(p.on, [], `data.points[${i}].on`);
    else if (p.y === undefined) errors.push({ code: "required", at: `data.points[${i}]`, message: "a point needs y, or `on` a function", help: "give y, or on: the function's id" });
  });
  (data.lines ?? []).forEach((l, i) => {
    if ((l.x === undefined) === (l.y === undefined)) errors.push({ code: "line", at: `data.lines[${i}]`, message: "a line is either x = a or y = b", help: "give exactly one of x or y" });
  });
  if (!(options.x[0] < options.x[1])) errors.push({ code: "range", at: "options.x", message: `[${options.x.join(", ")}] does not run left to right`, help: "give [from, to] with from < to" });
  if (options.y && !(options.y[0] < options.y[1])) errors.push({ code: "range", at: "options.y", message: `[${options.y.join(", ")}] does not run bottom to top`, help: "give [from, to] with from < to" });
  return errors;
}

interface Curve { id: string; label: string; colour: string; fn: Fn; from: number; to: number }

/** The y range that fits the curves: their middle 96 %, so a spike (1/x near 0) doesn't flatten everything else. */
function fitY(curves: Curve[], xs: [number, number], extra: number[]): [number, number] {
  const values: number[] = [...extra];
  for (const c of curves) {
    const lo = Math.max(xs[0], c.from), hi = Math.min(xs[1], c.to);
    for (let i = 0; i <= 200; i++) { const y = c.fn(lo + ((hi - lo) * i) / 200); if (Number.isFinite(y)) values.push(y); }
  }
  values.sort((a, b) => a - b);
  if (!values.length) return [-1, 1];
  let lo = quantile(values, 0.02), hi = quantile(values, 0.98);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  return [lo, hi];
}

export function render(data: FunctionPlotData, options: FunctionPlotOptions, ctx: RenderContext): Rendered {
  const { theme } = ctx;
  const locale = ctx.locale ?? "en";
  const id = ctx.id ?? "fp";
  const width = Math.round(ctx.width);
  const height = heightFor(CONTRACTS["function-plot"].size, width, ctx.height);
  const curves: Curve[] = data.functions.map((f, i) => {
    const parsed = parse(f.fn);
    if (!parsed.ok) throw new Error("render() takes a validated view");
    return { id: idOf(f, i), label: f.label ?? `y = ${f.fn}`, colour: data.functions.length === 1 ? theme.accent : theme.series[i % theme.series.length]!, fn: parsed.fn, from: f.domain?.[0] ?? -Infinity, to: f.domain?.[1] ?? Infinity };
  });
  const byId = new Map(curves.map((c) => [c.id, c]));
  const yOfPoint = (p: PointSpec) => (p.on !== undefined ? byId.get(p.on)!.fn(p.x) : p.y!);

  // The frame: title, legend, then the plot with its tick gutters.
  const pad = { top: 8, right: 14, bottom: 0, left: 0 };
  const title = titleRow(options.title, theme, 0, width);
  const legend = legendRows(curves.map((c) => ({ label: c.label, colour: c.colour })), theme, 0, title.height, width);
  const xDomain = options.x;
  const rawY = options.y ?? fitY(curves, xDomain, (data.points ?? []).map(yOfPoint).filter(Number.isFinite));
  const yTickCount = Math.max(3, Math.round((height - 60) / 48));
  const yDomain: [number, number] = options.y ?? niceDomain(rawY[0], rawY[1], yTickCount);
  const yTicks = ticks(yDomain[0], yDomain[1], yTickCount);
  const yDecimals = decimalsFor(niceStep(yDomain[1] - yDomain[0], yTickCount));
  const yText = (v: number) => formatNumber(v, locale, { decimals: yDecimals, compact: true });
  const gutterLeft = Math.ceil(Math.max(...yTicks.map((t) => textWidth(yText(t), TYPE.tick)))) + 10 + (options.yLabel ? 18 : 0);
  const top = title.height + legend.height + pad.top;
  const bottom = height - 24 - (options.xLabel ? 18 : 0);
  const left = gutterLeft, right = width - pad.right;
  const plot = { x: left, y: top, width: Math.max(10, right - left), height: Math.max(10, bottom - top) };
  const sx = linear(xDomain, [left, right]);
  const sy = linear(yDomain, [bottom, top]);
  const xTickCount = Math.max(2, Math.round(plot.width / 70));
  const xTicks = options.xTicks === "pi" ? piTicks(xDomain[0], xDomain[1], xTickCount) : ticks(xDomain[0], xDomain[1], xTickCount);
  const xDecimals = decimalsFor(niceStep(xDomain[1] - xDomain[0], xTickCount));
  const xText = (v: number) => (options.xTicks === "pi" ? piLabel(v) : formatNumber(v, locale, { decimals: xDecimals, compact: true }));
  const font = theme.font.ui;
  const clip = `${id}-clip`;

  // Grid and axes. The axes are the lines through zero when zero is in view; otherwise the plot's edges.
  const grid: SvgNode[] = [];
  if (options.grid) {
    for (const t of xTicks) grid.push(el("line", { x1: sx(t), x2: sx(t), y1: top, y2: bottom, stroke: theme.rule, "stroke-width": 1 }));
    for (const t of yTicks) grid.push(el("line", { x1: left, x2: right, y1: sy(t), y2: sy(t), stroke: theme.rule, "stroke-width": 1 }));
  }
  const zeroX = xDomain[0] <= 0 && xDomain[1] >= 0 ? sx(0) : null;
  const zeroY = yDomain[0] <= 0 && yDomain[1] >= 0 ? sy(0) : null;
  const axes = [
    el("line", { x1: left, x2: right, y1: zeroY ?? bottom, y2: zeroY ?? bottom, stroke: theme.axis, "stroke-width": 1.25 }),
    el("line", { x1: zeroX ?? left, x2: zeroX ?? left, y1: top, y2: bottom, stroke: theme.axis, "stroke-width": 1.25 }),
  ];
  const tickLabels = [
    // The end ticks' labels hang inward so they never run off the chart's edge.
    ...xTicks.map((t) => {
      const w = textWidth(xText(t), TYPE.tick);
      const anchor = sx(t) - w / 2 < 0 ? "start" : sx(t) + w / 2 > width ? "end" : "middle";
      return el("text", { x: anchor === "start" ? Math.max(1, sx(t) - 2) : anchor === "end" ? width - 1 : sx(t), y: bottom + 16, "text-anchor": anchor, "font-size": TYPE.tick, fill: theme.soft, "font-family": font }, xText(t));
    }),
    ...yTicks.map((t) => el("text", { x: left - 7, y: sy(t) + 4, "text-anchor": "end", "font-size": TYPE.tick, fill: theme.soft, "font-family": font }, yText(t))),
  ];
  const axisNames = [
    options.xLabel ? el("text", { x: (left + right) / 2, y: height - 4, "text-anchor": "middle", "font-size": TYPE.label, fill: theme.soft, "font-family": font }, options.xLabel) : null,
    options.yLabel ? el("text", { x: 0, y: 0, transform: `translate(12 ${(top + bottom) / 2}) rotate(-90)`, "text-anchor": "middle", "font-size": TYPE.label, fill: theme.soft, "font-family": font }, options.yLabel) : null,
  ];

  // Curves: sampled every half point, broken where a value is undefined or jumps across the view (an asymptote).
  const samples = Math.max(200, Math.round(plot.width * 2));
  const span = yDomain[1] - yDomain[0];
  const lim = (y: number) => clamp(y, yDomain[0] - span * 2, yDomain[1] + span * 2);
  const curvePoints = (c: Curve): ([number, number] | null)[] => {
    const lo = Math.max(xDomain[0], c.from), hi = Math.min(xDomain[1], c.to);
    const pts: ([number, number] | null)[] = [];
    if (!(lo < hi)) return pts;
    let prev: number | null = null;
    for (let i = 0; i <= samples; i++) {
      const x = lo + ((hi - lo) * i) / samples;
      const y = c.fn(x);
      if (!Number.isFinite(y)) { pts.push(null); prev = null; continue; }
      if (prev !== null && Math.abs(y - prev) > span * 1.5 && Math.sign(y - (yDomain[0] + yDomain[1]) / 2) !== Math.sign(prev - (yDomain[0] + yDomain[1]) / 2)) pts.push(null);
      pts.push([sx(x), sy(lim(y))]);
      prev = y;
    }
    return pts;
  };
  const lines = curves.map((c) => el("path", { d: pathData(curvePoints(c)), fill: "none", stroke: c.colour, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "data-part": "curve", "data-id": c.id }));

  // Areas: between two edges, from..to, in the colour of the function that bounds them (the top one first).
  const edge = (name: string): ((x: number) => number) => (name === "axis" ? () => 0 : name === "top" ? () => yDomain[1] : name === "bottom" ? () => yDomain[0] : byId.get(name)!.fn);
  const areaNodes: SvgNode[] = [];
  const areaLabels: SvgNode[] = [];
  for (const a of data.areas ?? []) {
    const f = edge(a.above), g = edge(a.below);
    const colour = (byId.get(a.above) ?? byId.get(a.below))?.colour ?? theme.accent;
    const lo = Math.max(xDomain[0], a.from ?? xDomain[0]), hi = Math.min(xDomain[1], a.to ?? xDomain[1]);
    if (!(lo < hi)) continue;
    const n = Math.max(40, Math.round(((hi - lo) / (xDomain[1] - xDomain[0])) * samples));
    const upper: [number, number][] = [], lower: [number, number][] = [];
    let mid = { x: 0, y: 0, n: 0 };
    for (let i = 0; i <= n; i++) {
      const x = lo + ((hi - lo) * i) / n;
      const yt = f(x), yb = g(x);
      if (!Number.isFinite(yt) || !Number.isFinite(yb)) continue;
      upper.push([sx(x), sy(lim(yt))]);
      lower.push([sx(x), sy(lim(yb))]);
      if (Math.abs(i - n / 2) <= n / 6) { mid = { x: mid.x + x, y: mid.y + (clamp(yt, yDomain[0], yDomain[1]) + clamp(yb, yDomain[0], yDomain[1])) / 2, n: mid.n + 1 }; }
    }
    if (upper.length < 2) continue;
    areaNodes.push(el("path", { d: `${pathData(upper)}${pathData(lower.reverse()).replace(/^M/, "L")}Z`, fill: withAlpha(colour, 0.16), stroke: "none", "data-part": "area" }));
    if (a.label && mid.n) areaLabels.push(haloText(a.label, { x: sx(mid.x / mid.n), y: sy(mid.y / mid.n) + 4, "text-anchor": "middle", "font-weight": 600 }, theme));
  }

  // Reference lines: dashed, so they never read as a curve.
  const refs: SvgNode[] = [];
  for (const l of data.lines ?? []) {
    if (l.x !== undefined && l.x >= xDomain[0] && l.x <= xDomain[1]) {
      refs.push(el("line", { x1: sx(l.x), x2: sx(l.x), y1: top, y2: bottom, stroke: theme.soft, "stroke-width": 1.25, "stroke-dasharray": "5 4" }));
      if (l.label) refs.push(haloText(l.label, { x: sx(l.x) + 5, y: top + 14, fill: theme.soft }, theme));
    } else if (l.y !== undefined && l.y >= yDomain[0] && l.y <= yDomain[1]) {
      refs.push(el("line", { x1: left, x2: right, y1: sy(l.y), y2: sy(l.y), stroke: theme.soft, "stroke-width": 1.25, "stroke-dasharray": "5 4" }));
      if (l.label) refs.push(haloText(l.label, { x: right - 4, y: sy(l.y) - 6, "text-anchor": "end", fill: theme.soft }, theme));
    }
  }

  // Points: a dot with a ring in the ground colour, its label beside it, kept inside the plot.
  const dots: SvgNode[] = [];
  for (const p of data.points ?? []) {
    const y = yOfPoint(p);
    if (!Number.isFinite(y) || p.x < xDomain[0] || p.x > xDomain[1] || y < yDomain[0] || y > yDomain[1]) continue;
    const colour = p.on !== undefined ? byId.get(p.on)!.colour : theme.ink;
    const cx = sx(p.x), cy = sy(y);
    dots.push(el("circle", { cx, cy, r: 4.5, fill: colour, stroke: theme.ground, "stroke-width": 2, "data-part": "point" }));
    if (p.label) {
      const w = textWidth(p.label, TYPE.label);
      const toLeft = cx + 8 + w > right;
      const above = cy - 10 > top + 8;
      dots.push(haloText(p.label, { x: toLeft ? cx - 8 : cx + 8, y: above ? cy - 8 : cy + 16, "text-anchor": toLeft ? "end" : "start" }, theme));
    }
  }

  // Hover: a column every few points; each curve's value there.
  const columns: HoverColumn[] = [];
  const step = Math.max(2, Math.round(plot.width / 160));
  for (let px = left; px <= right + 0.01; px += step) {
    const x = sx.invert(px);
    const rows = curves.flatMap((c) => {
      const y = x >= c.from && x <= c.to ? c.fn(x) : NaN;
      return Number.isFinite(y) ? [{ colour: c.colour, label: c.label, value: formatNumber(y, locale, { decimals: Math.min(4, yDecimals + 2) }), ...(y >= yDomain[0] && y <= yDomain[1] ? { y: sy(y) } : {}) }] : [];
    });
    columns.push({ x: px, title: `x = ${options.xTicks === "pi" ? `${formatNumber(x / Math.PI, locale, { decimals: 2 })}π` : formatNumber(x, locale, { decimals: Math.min(4, xDecimals + 2) })}`, rows });
  }
  const hover: Hover = { plot, columns };

  const summary = describe(curves, data, xDomain, yDomain, locale);
  const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": summary, "font-family": font, "data-component": "function-plot" },
    el("title", {}, options.title ?? curves.map((c) => c.label).join(", ")),
    el("defs", {}, el("clipPath", { id: clip }, el("rect", { x: left, y: top, width: plot.width, height: plot.height }))),
    title.node, legend.node,
    el("g", { "data-part": "grid" }, grid),
    el("g", { "clip-path": `url(#${clip})` }, areaNodes, axes, refs, lines),
    tickLabels, axisNames,
    el("g", {}, areaLabels, dots));
  return { svg, width, height, summary, hover };
}

function describe(curves: Curve[], data: FunctionPlotData, x: [number, number], y: [number, number], locale: "en" | "fr"): string {
  const n = (v: number) => formatNumber(v, locale, { decimals: 2 });
  const names = curves.map((c) => c.label).join("; ");
  const extras = [
    data.areas?.length ? `${data.areas.length} shaded area${data.areas.length > 1 ? "s" : ""}` : "",
    data.points?.length ? `${data.points.length} marked point${data.points.length > 1 ? "s" : ""}${data.points.some((p) => p.label) ? ` (${data.points.filter((p) => p.label).map((p) => p.label).join(", ")})` : ""}` : "",
  ].filter(Boolean).join(", ");
  return `A plot of ${names}, for x from ${n(x[0])} to ${n(x[1])} and y from ${n(y[0])} to ${n(y[1])}${extras ? `, with ${extras}` : ""}.`;
}
