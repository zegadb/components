// price-chart (components/price-chart/): a price over time as a line or
// candlesticks, volume underneath, annotated moments.
import { heightFor, haloText, legendRows, titleRow, TYPE, type HoverColumn, type RenderContext, type Rendered } from "./chart.ts";
import { decimalsFor, formatNumber, linear, niceDomain, niceStep, ticks, type Locale } from "./scale.ts";
import { el, pathData, textWidth, type SvgNode } from "./svg.ts";
import { withAlpha } from "./theme.ts";
import { parseTime, timeText, timeTicks } from "./time.ts";
import { CONTRACT } from "./generated/contracts/price-chart.ts";
import type { Theme, ViewError } from "./types.ts";

export interface PricePoint { t: string; o?: number; h?: number; l?: number; c: number; v?: number }
export interface PriceSeries { label?: string; points: PricePoint[] }
export interface PriceChartData { series: PriceSeries[]; annotations?: { t: string; label: string }[] }
export interface PriceChartOptions {
  kind: "line" | "candle";
  scale: "price" | "percent";
  volume: boolean;
  currency: string | null;
  title: string | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function semantic(data: PriceChartData, options: PriceChartOptions): ViewError[] {
  const errors: ViewError[] = [];
  data.series.forEach((s, i) => {
    let prev = -Infinity, prevText = "";
    s.points.forEach((p, j) => {
      const at = `data.series[${i}].points[${j}]`;
      const t = parseTime(p.t);
      if (!Number.isFinite(t)) { errors.push({ code: "time", at: `${at}.t`, message: `${p.t} is not a real date or time`, help: "an ISO 8601 date (2026-11-13) or date-time (2026-11-13T14:30Z)" }); return; }
      if (!(t > prev)) errors.push({ code: "order", at: `${at}.t`, message: `${p.t} is not after ${prevText}`, help: "give the points oldest first, one per period" });
      prev = t; prevText = p.t;
      if (isNum(p.h) && isNum(p.l) && p.l > p.h) errors.push({ code: "ohlc", at, message: `the low (${p.l}) is above the high (${p.h})`, help: "h is the period's highest price and l its lowest: l ≤ o, c ≤ h" });
      else if (isNum(p.h) && p.h < Math.max(p.c, p.o ?? p.c)) errors.push({ code: "ohlc", at, message: `the high (${p.h}) is under the open or the close (${Math.max(p.c, p.o ?? p.c)})`, help: "h is the period's highest price and l its lowest: l ≤ o, c ≤ h" });
      else if (isNum(p.l) && p.l > Math.min(p.c, p.o ?? p.c)) errors.push({ code: "ohlc", at, message: `the low (${p.l}) is over the open or the close (${Math.min(p.c, p.o ?? p.c)})`, help: "h is the period's highest price and l its lowest: l ≤ o, c ≤ h" });
    });
  });
  if (options.kind === "candle") {
    if (data.series.length !== 1) errors.push({ code: "candle", at: "data.series", message: `candlesticks draw one series, got ${data.series.length}`, help: "give one series, or use kind \"line\" to compare several" });
    data.series[0]?.points.forEach((p, j) => {
      const missing = (["o", "h", "l"] as const).filter((k) => !isNum(p[k]));
      if (missing.length) errors.push({ code: "required", at: `data.series[0].points[${j}]`, message: `a candle needs o, h, l and c; this one has no ${missing.join(", ")}`, help: "give every point its open, high, low and close, or use kind \"line\"" });
    });
  }
  if (options.volume) {
    const j = data.series[0]?.points.findIndex((p) => !isNum(p.v)) ?? -1;
    if (j >= 0) errors.push({ code: "required", at: `data.series[0].points[${j}].v`, message: "volume is on but this point has no v", help: "give v on every point of the first series, or volume: false" });
  }
  if (options.scale === "percent") data.series.forEach((s, i) => { if (!(s.points[0]!.c > 0)) errors.push({ code: "range", at: `data.series[${i}].points[0].c`, message: "percent change needs a first close above 0", help: "use scale \"price\"" }); });
  (data.annotations ?? []).forEach((a, i) => {
    const t = parseTime(a.t);
    const pts = data.series[0]?.points ?? [];
    if (!Number.isFinite(t)) errors.push({ code: "time", at: `data.annotations[${i}].t`, message: `${a.t} is not a real date or time`, help: "an ISO 8601 date or date-time" });
    else if (pts.length && (t < parseTime(pts[0]!.t) || t > parseTime(pts[pts.length - 1]!.t))) errors.push({ code: "range", at: `data.annotations[${i}].t`, message: `${a.t} is outside the first series' time`, help: `annotate a moment from ${pts[0]!.t} to ${pts[pts.length - 1]!.t}` });
  });
  return errors;
}

interface Row { t: number; o: number; h: number; l: number; c: number; v: number | null }

export function render(data: PriceChartData, options: PriceChartOptions, ctx: RenderContext): Rendered {
  const { theme } = ctx;
  const locale: Locale = ctx.locale ?? "en";
  const id = ctx.id ?? "pc";
  const width = Math.round(ctx.width);
  const height = heightFor(CONTRACT.size, width, ctx.height);
  const candle = options.kind === "candle";
  const percent = options.scale === "percent";
  const font = theme.font.ui;
  const series = data.series.map((s, i) => {
    const c0 = s.points[0]!.c;
    const tr = (v: number) => (percent ? (v / c0 - 1) * 100 : v);
    const rows: Row[] = s.points.map((p) => ({ t: parseTime(p.t), o: tr(p.o ?? p.c), h: tr(p.h ?? p.c), l: tr(p.l ?? p.c), c: tr(p.c), v: isNum(p.v) ? p.v : null }));
    return { label: s.label ?? (data.series.length > 1 ? `Series ${i + 1}` : ""), colour: data.series.length === 1 ? theme.accent : theme.series[i % theme.series.length]!, rows, raw: s.points };
  });
  const first = series[0]!;
  const withTime = data.series.some((s) => s.points.some((p) => p.t.includes("T")));

  // Frame.
  const title = titleRow(options.title, theme, 0, width);
  const legend = legendRows(series.map((s) => ({ label: s.label, colour: s.colour })), theme, 0, title.height, width);
  const top = title.height + legend.height + 10;
  const xAxisH = 22;
  const lows = series.flatMap((s) => s.rows.map((r) => (candle ? r.l : r.c)));
  const highs = series.flatMap((s) => s.rows.map((r) => (candle ? r.h : r.c)));
  const plotBottomGuess = height - xAxisH;
  const yTickCount = Math.max(3, Math.round((plotBottomGuess - top) / 46));
  const yDomain = niceDomain(Math.min(...lows), Math.max(...highs), yTickCount);
  const yStep = niceStep(yDomain[1] - yDomain[0], yTickCount);
  const decimals = percent ? decimalsFor(yStep) : Math.max(decimalsFor(yStep), Math.max(...highs) < 1000 ? 2 : 0);
  const pct = locale === "fr" ? " %" : "%";
  const priceText = (v: number, exact = false) => (percent ? `${formatNumber(v, locale, { decimals: exact ? 2 : decimalsFor(yStep), sign: true })}${pct}` : formatNumber(v, locale, { decimals: exact ? Math.max(2, decimals) : decimals, currency: options.currency, compact: !exact }));
  const yTicks = ticks(yDomain[0], yDomain[1], yTickCount);
  const last = first.rows[first.rows.length - 1]!;
  const gutter = Math.ceil(Math.max(...[...yTicks.map((t) => priceText(t)), priceText(last.c, true)].map((s) => textWidth(s, TYPE.tick)))) + 14;
  const left = 4, right = width - gutter;
  const volH = options.volume ? Math.round((plotBottomGuess - top) * 0.2) : 0;
  const priceBottom = plotBottomGuess - (volH ? volH + 8 : 0);
  const sy = linear(yDomain, [priceBottom, top]);

  // x: candlesticks sit one per period, evenly (no gaps for weekends); lines sit at their times.
  const t0 = Math.min(...series.map((s) => s.rows[0]!.t)), t1 = Math.max(...series.map((s) => s.rows[s.rows.length - 1]!.t));
  const n = first.rows.length;
  const band = (right - left) / n;
  const bodyW = Math.max(1, Math.min(24, band * 0.7));
  const xAt = candle ? (i: number) => left + band * (i + 0.5) : null;
  const sx = linear([t0, t1], [left + (candle ? band / 2 : 6), right - (candle ? band / 2 : 6)]);
  const xOf = (s: (typeof series)[number], i: number) => (xAt && s === first ? xAt(i) : sx(s.rows[i]!.t));

  // Grid, price axis at the right, time axis at the bottom.
  const grid = yTicks.map((t) => el("line", { x1: left, x2: right, y1: sy(t), y2: sy(t), stroke: theme.rule, "stroke-width": 1 }));
  const lastY = sy(last.c);
  // Price labels keep clear of the last price and of the volume band's own label (its maximum) below them.
  const volLabelY = volH ? plotBottomGuess - volH + 10 : null;
  const yLabels = yTicks.filter((t) => Math.abs(sy(t) - lastY) > 14 && (volLabelY === null || volLabelY - (sy(t) + 4) > 16)).map((t) => el("text", { x: right + 8, y: sy(t) + 4, "font-size": TYPE.tick, fill: theme.soft, "font-family": font }, priceText(t)));
  const tTicks = timeTicks(t0, t1, Math.max(2, Math.floor((right - left) / 76)), locale);
  const tickX = (t: number) => {
    if (!xAt) return sx(t);
    let i = first.rows.findIndex((r) => r.t >= t);
    if (i < 0) i = n - 1;
    return xAt(i);
  };
  const placed: { x: number; label: string }[] = [];
  for (const tk of tTicks) {
    const x = tickX(tk.t);
    // The first label on the axis carries its context (Aug 17, not 17).
    const label = placed.length ? tk.label : tk.lead;
    const w = textWidth(label, TYPE.tick);
    if (x - w / 2 < left - 2 || x + w / 2 > right + gutter - 2) continue;
    if (placed.length && x - placed[placed.length - 1]!.x < (w + textWidth(placed[placed.length - 1]!.label, TYPE.tick)) / 2 + 10) continue;
    placed.push({ x, label });
  }
  const xLabels = placed.map((p) => el("text", { x: p.x, y: height - 6, "text-anchor": "middle", "font-size": TYPE.tick, fill: theme.soft, "font-family": font }, p.label));
  const baseline = el("line", { x1: left, x2: right, y1: priceBottom, y2: priceBottom, stroke: theme.axis, "stroke-width": 1 });

  // Marks.
  const marks: SvgNode[] = [];
  const up = (r: Row) => r.c >= r.o;
  if (candle) {
    first.rows.forEach((r, i) => {
      const x = xAt!(i);
      const colour = up(r) ? theme.up : theme.down;
      const yTop = sy(Math.max(r.o, r.c)), yBot = sy(Math.min(r.o, r.c));
      marks.push(el("line", { x1: x, x2: x, y1: sy(r.h), y2: sy(r.l), stroke: colour, "stroke-width": 1.25 }));
      // Rising candles are hollow and falling ones filled, so up and down never rest on colour alone.
      marks.push(el("rect", { x: x - bodyW / 2, y: yTop, width: bodyW, height: Math.max(1, yBot - yTop), rx: Math.min(2, bodyW / 4), fill: up(r) ? theme.ground : colour, stroke: colour, "stroke-width": 1.25, "data-part": up(r) ? "candle-up" : "candle-down" }));
    });
  } else {
    const gid = `${id}-wash`;
    for (const s of series) {
      const pts = s.rows.map((_, i): [number, number] => [xOf(s, i), sy(s.rows[i]!.c)]);
      if (series.length === 1) {
        marks.push(el("defs", {}, el("linearGradient", { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, el("stop", { offset: 0, "stop-color": s.colour, "stop-opacity": 0.16 }), el("stop", { offset: 1, "stop-color": s.colour, "stop-opacity": 0 }))));
        marks.push(el("path", { d: `${pathData(pts)}L${pts[pts.length - 1]![0]} ${priceBottom}L${pts[0]![0]} ${priceBottom}Z`, fill: `url(#${gid})`, stroke: "none" }));
      }
      marks.push(el("path", { d: pathData(pts), fill: "none", stroke: s.colour, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "data-part": "line" }));
    }
    if (percent) {
      const z = sy(0);
      if (z > top && z < priceBottom) marks.unshift(el("line", { x1: left, x2: right, y1: z, y2: z, stroke: theme.axis, "stroke-width": 1 }));
    }
  }

  // The last price: a dot on the line's end and its value on the axis, in ink.
  const ends: SvgNode[] = [];
  for (const s of candle ? [] : series) {
    const i = s.rows.length - 1;
    ends.push(el("circle", { cx: xOf(s, i), cy: sy(s.rows[i]!.c), r: 4, fill: s.colour, stroke: theme.ground, "stroke-width": 2 }));
  }
  ends.push(el("text", { x: right + 8, y: lastY + 4, "font-size": TYPE.tick, "font-weight": 600, fill: theme.ink, "font-family": font, "data-part": "last" }, priceText(last.c, true)));

  // Volume: bars in their own band, quiet, coloured by the period's direction.
  const volume: SvgNode[] = [];
  if (volH) {
    const vmax = Math.max(...first.rows.map((r) => r.v ?? 0)) || 1;
    const vy = linear([0, vmax], [plotBottomGuess, plotBottomGuess - volH]);
    const w = xAt ? bodyW : Math.max(1, Math.min(24, ((right - left) / n) * 0.7));
    first.rows.forEach((r, i) => {
      const prev = first.rows[i - 1];
      const rising = candle ? up(r) : !prev || r.c >= prev.c;
      const x = xOf(first, i);
      volume.push(el("rect", { x: x - w / 2, y: vy(r.v ?? 0), width: w, height: Math.max(0.5, plotBottomGuess - vy(r.v ?? 0)), fill: withAlpha(rising ? theme.up : theme.down, 0.45), "data-part": "volume" }));
    });
    volume.push(el("line", { x1: left, x2: right, y1: plotBottomGuess, y2: plotBottomGuess, stroke: theme.axis, "stroke-width": 1 }));
    volume.push(el("text", { x: right + 8, y: volLabelY!, "font-size": TYPE.small, fill: theme.soft, "font-family": font }, formatNumber(vmax, locale, { compact: true })));
  }

  // Annotations: a dashed rule from the moment's point up to its label, labels staggered so they don't overlap.
  const notes: SvgNode[] = [];
  let lastNote = { x: -Infinity, row: 1 };
  for (const a of (data.annotations ?? []).slice().sort((p, q) => parseTime(p.t) - parseTime(q.t))) {
    const t = parseTime(a.t);
    let i = 0;
    for (let k = 0; k < n; k++) if (Math.abs(first.rows[k]!.t - t) < Math.abs(first.rows[i]!.t - t)) i = k;
    const r = first.rows[i]!;
    const x = xOf(first, i), y = sy(candle ? r.h : r.c);
    const w = textWidth(a.label, TYPE.label);
    const row = x - lastNote.x < w + 12 ? (lastNote.row === 0 ? 1 : 0) : 0;
    lastNote = { x, row };
    const ly = top + 12 + row * 16;
    const anchor = x + w / 2 > right ? "end" : x - w / 2 < left ? "start" : "middle";
    notes.push(el("line", { x1: x, x2: x, y1: ly + 4, y2: y - 6, stroke: theme.soft, "stroke-width": 1, "stroke-dasharray": "3 3" }));
    notes.push(el("circle", { cx: x, cy: y, r: 4, fill: theme.ink, stroke: theme.ground, "stroke-width": 2, "data-part": "annotation" }));
    notes.push(haloText(a.label, { x, y: ly, "text-anchor": anchor, "font-weight": 600 }, theme));
  }

  // Hover: one column per period of the first series (and the others' values at the nearest time).
  const columns: HoverColumn[] = first.rows.map((r, i) => {
    const raw = first.raw[i]!;
    const rows: HoverColumn["rows"] = [];
    if (candle) rows.push({ colour: up(r) ? theme.up : theme.down, label: first.label || "Price", value: `O ${priceText(r.o, true)} · H ${priceText(r.h, true)} · L ${priceText(r.l, true)} · C ${priceText(r.c, true)}`, y: sy(r.c) });
    else for (const s of series) {
      let k = 0;
      for (let j = 0; j < s.rows.length; j++) if (Math.abs(s.rows[j]!.t - r.t) < Math.abs(s.rows[k]!.t - r.t)) k = j;
      rows.push({ colour: s.colour, label: s.label || "Price", value: percent ? `${priceText(s.rows[k]!.c, true)} (${formatNumber(s.raw[k]!.c, locale, { decimals: 2, currency: options.currency })})` : priceText(s.rows[k]!.c, true), y: sy(s.rows[k]!.c) });
    }
    if (isNum(raw.v)) rows.push({ colour: theme.soft, label: locale === "fr" ? "Volume" : "Volume", value: formatNumber(raw.v, locale, { compact: true }) });
    return { x: xOf(first, i), title: timeText(r.t, withTime, locale), rows };
  });

  const change = first.raw[first.raw.length - 1]!.c / first.raw[0]!.c - 1;
  const summary = `${candle ? "Candlesticks" : "A line"} of ${series.map((s) => s.label || "the price").join(", ")} from ${timeText(t0, withTime, locale)} to ${timeText(t1, withTime, locale)}${series.length === 1 ? `: ${formatNumber(first.raw[0]!.c, locale, { decimals: 2, currency: options.currency })} to ${formatNumber(first.raw[first.raw.length - 1]!.c, locale, { decimals: 2, currency: options.currency })} (${formatNumber(change * 100, locale, { decimals: 1, sign: true })}%)` : ""}.`;
  const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": summary, "font-family": font, "data-component": "price-chart" },
    el("title", {}, options.title ?? (series.map((s) => s.label).filter(Boolean).join(", ") || "Price")),
    title.node, legend.node, grid, baseline, volume, marks, notes, ends, yLabels, xLabels);
  return { svg, width, height, summary, hover: { plot: { x: left, y: top, width: right - left, height: plotBottomGuess - top }, columns } };
}

export type { Theme };
