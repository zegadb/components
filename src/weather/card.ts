// weather (components/weather/): one place's weather as a card, in the chart family's own style
// (function-plot, price-chart): a plain panel, ink and soft text, one accent.
//
// compact: the temperature now (or what it feels like), the place, the sky and tonight's low; the next
// 12 hours as a small chart; up to four days as tiles.
// full: the same header; the next 24 hours as a chart (the temperature as a line, its lowest and
// highest marked, night shaded from sunset to sunrise, the chance of precipitation as thin bars, and
// what it feels like as a second line when the source gives one); every day on one scale for the week
// (the night's low a ring, the day's high a dot); a footer with wind, sunrise, sunset and daylight.
//
// Every number comes from the data, and anything the data leaves out is left out of the card (a chance
// of precipitation is shown only when the source gave one, a feels-like only when it gave a wind chill
// or humidex). The card has no credit line: the host shows its source once, under it.
import { el, round, textWidth, type SvgNode } from "../svg.ts";
import { parseTime } from "../time.ts";
import { haloText, TYPE, type RenderContext, type Rendered } from "../chart.ts";
import type { Theme, ViewError } from "../types.ts";
import { glyph, type GlyphColours, type Icon } from "./icons.ts";

export interface WeatherWind { speed_kmh: number; gust_kmh?: number; dir?: string }
export interface WeatherNow { temp_c: number; condition?: string; icon?: Icon; night?: boolean; feels_c?: number; wind?: WeatherWind; observed?: string }
export interface WeatherHour { at: string; temp_c?: number; feels_c?: number; icon?: Icon; night?: boolean; pop?: number }
export interface WeatherDay { date: string; high_c?: number; low_c?: number; icon?: Icon; night?: boolean; condition?: string; pop?: number }
export interface WeatherSun { rise?: string; set?: string; next_rise?: string }
export interface WeatherData {
  place: string;
  today: string;
  now?: WeatherNow;
  hours?: WeatherHour[];
  days?: WeatherDay[];
  sun?: WeatherSun;
  stale?: { as_of: string; offline: boolean };
}
export interface WeatherOptions { size: "compact" | "full"; lang: "en" | "fr" | null }

type Lang = "en" | "fr";

// ---------------------------------------------------------------------------
// What a schema can't say.

export function semantic(data: WeatherData): ViewError[] {
  const errors: ViewError[] = [];
  if (!data.now && !data.hours?.length && !data.days?.length) {
    errors.push({ code: "required", at: "data", message: "a weather card needs now, hours or days", help: "give the observation (now), the next hours or the days ahead" });
  }
  const real = (t: string, at: string, what: string) => {
    if (Number.isFinite(parseTime(t))) return true;
    errors.push({ code: "time", at, message: `${t} is not a real ${what}`, help: what === "date" ? "YYYY-MM-DD, the place's own date" : "YYYY-MM-DDTHH:MM with the place's UTC offset, e.g. 2026-11-21T16:00-05:00" });
    return false;
  };
  real(data.today, "data.today", "date");
  if (data.now?.observed) real(data.now.observed, "data.now.observed", "time");
  for (const k of ["rise", "set", "next_rise"] as const) if (data.sun?.[k]) real(data.sun[k]!, `data.sun.${k}`, "time");
  if (data.now?.wind?.gust_kmh !== undefined && data.now.wind.gust_kmh < data.now.wind.speed_kmh) {
    errors.push({ code: "range", at: "data.now.wind", message: `the gusts (${data.now.wind.gust_kmh}) are below the wind (${data.now.wind.speed_kmh})`, help: "gust_kmh is the strongest gust, at least speed_kmh; leave it out when the source gives none" });
  }
  let prev = -Infinity, prevText = "";
  (data.days ?? []).forEach((d, i) => {
    const at = `data.days[${i}]`;
    if (!real(d.date, `${at}.date`, "date")) return;
    const t = parseTime(d.date);
    if (!(t > prev)) errors.push({ code: "order", at: `${at}.date`, message: `${d.date} is not after ${prevText}`, help: "one entry per day, from today on" });
    prev = t; prevText = d.date;
    if (d.high_c !== undefined && d.low_c !== undefined && d.low_c > d.high_c) errors.push({ code: "range", at, message: `the low (${d.low_c}) is above the high (${d.high_c})`, help: "high_c is the day's highest and low_c the night's lowest" });
  });
  prev = -Infinity; prevText = "";
  (data.hours ?? []).forEach((h, i) => {
    const at = `data.hours[${i}].at`;
    if (!real(h.at, at, "time")) return;
    const t = parseTime(h.at);
    if (!(t > prev)) errors.push({ code: "order", at, message: `${h.at} is not after ${prevText}`, help: "the hours in order, one each" });
    prev = t; prevText = h.at;
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Words, numbers and times, in the card's language.

const WORDS = {
  en: {
    today: "Today", tonight: "Tonight", feels: "Feels like", air: "Air", feelsLine: "feels like", airLine: "air",
    tonightLow: (t: string) => `Tonight low ${t}`, highLow: (h: string, l: string) => `High ${h} · Low ${l}`, high: (h: string) => `High ${h}`, low: (l: string) => `Low ${l}`,
    nextHours: (n: number) => `Next ${n} hours`, wind: "Wind", gusts: "gusts", calm: "calm", sunrise: "Sunrise", sunset: "Sunset", daylight: "Daylight",
    offline: "Offline", asOf: "as of", sentenceHigh: "high", sentenceLow: "low",
  },
  fr: {
    today: "Auj.", tonight: "Cette nuit", feels: "Ressenti", air: "Air", feelsLine: "ressenti", airLine: "air",
    tonightLow: (t: string) => `Cette nuit min. ${t}`, highLow: (h: string, l: string) => `Max. ${h} · min. ${l}`, high: (h: string) => `Max. ${h}`, low: (l: string) => `Min. ${l}`,
    nextHours: (n: number) => `Prochaines ${n} heures`, wind: "Vent", gusts: "rafales", calm: "calme", sunrise: "Lever", sunset: "Coucher", daylight: "Durée du jour",
    offline: "Hors ligne", asOf: "en date du", sentenceHigh: "max.", sentenceLow: "min.",
  },
} as const;

/** 10.3 → "10°", −0.4 → "0°", −3 → "−3°". */
export const temp = (c: number) => `${Math.round(c) === 0 ? 0 : Math.round(c)}°`.replace("-", "−");

/** A date-time's own clock (the place's: its offset is the place's), as [hour, minute]. */
const clock = (t: string): [number, number] => { const m = /T(\d{2}):(\d{2})/.exec(t)!; return [Number(m[1]), Number(m[2])]; };

/** "5 PM" / "17 h": an hour on the chart's axis. */
export function hourText(t: string, lang: Lang): string {
  const [h] = clock(t);
  return lang === "fr" ? `${h} h` : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}

/** "7:19 AM" / "7 h 19": sunrise, sunset. */
export function timeText(t: string, lang: Lang): string {
  const [h, m] = clock(t);
  return lang === "fr" ? `${h} h ${String(m).padStart(2, "0")}` : `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Sun" / "Dim.", "Today" / "Auj." for today, "Tonight" / "Cette nuit" when today has only its night left. */
export function dayText(d: WeatherDay, today: string, lang: Lang): string {
  if (d.date === today) return d.high_c === undefined && d.low_c !== undefined ? WORDS[lang].tonight : WORDS[lang].today;
  const name = new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { weekday: "short", timeZone: "UTC" }).format(new Date(parseTime(d.date)));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Below 10 % is shown as nothing, as the source's own "nil". Never shown when not given. */
const POP_SHOWN = 10;
const popShown = (p: number | undefined): p is number => typeof p === "number" && p >= POP_SHOWN;
const popText = (p: number, lang: Lang) => (lang === "fr" ? `${Math.round(p)} %` : `${Math.round(p)}%`);

/** "Wind SSE 10 km/h, gusts 27" / "Vent SSE 10 km/h, rafales 27"; "Wind calm". */
export function windText(w: WeatherWind, lang: Lang): string {
  const words = WORDS[lang];
  if (Math.round(w.speed_kmh) === 0) return `${words.wind} ${words.calm}`;
  const gust = w.gust_kmh !== undefined && Math.round(w.gust_kmh) > Math.round(w.speed_kmh) ? `, ${words.gusts} ${Math.round(w.gust_kmh)}` : "";
  return `${words.wind} ${w.dir ? `${w.dir} ` : ""}${Math.round(w.speed_kmh)} km/h${gust}`;
}

/** "Daylight 9 h 28 min" / "Durée du jour 9 h 28": today's sunrise to sunset, or null without both. */
export function daylightText(sun: WeatherSun | undefined, lang: Lang): string | null {
  if (!sun?.rise || !sun.set) return null;
  const mins = Math.round((parseTime(sun.set) - parseTime(sun.rise)) / 60_000);
  if (!(mins > 0)) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return lang === "fr" ? `${WORDS.fr.daylight} ${h} h ${String(m).padStart(2, "0")}` : `${WORDS.en.daylight} ${h} h ${m} min`;
}

/**
 * The header's line under the sky: "Tonight low 5°" once the day is over and only tonight's low is
 * left, else today's high and low ("High 8° · Low −1°"). Or null.
 */
export function subLine(data: WeatherData, lang: Lang): string | null {
  const today = data.days?.find((d) => d.date === data.today);
  if (!today) return null;
  const w = WORDS[lang];
  const { high_c: hi, low_c: lo } = today;
  if (hi === undefined && lo !== undefined) return w.tonightLow(temp(lo));
  if (hi !== undefined && lo !== undefined) return w.highLow(temp(hi), temp(lo));
  if (hi !== undefined) return w.high(temp(hi));
  return null;
}

// ---------------------------------------------------------------------------
// Night, from sunrise and sunset.

const HOUR = 3_600_000, DAY = 24 * HOUR;

export interface SunEvent { t: number; kind: "rise" | "set"; at: string }

/**
 * Sunrises and sunsets from a day before `t0` to a day after `t1`: today's, and each day's next at the
 * same clock time a day later (ECCC gives only today's; the next day's are within minutes of it).
 * `next_rise`, when given, is tomorrow's sunrise instead.
 */
export function sunEvents(sun: WeatherSun | undefined, t0: number, t1: number): SunEvent[] {
  if (!sun?.rise || !sun.set) return [];
  const rise = parseTime(sun.rise), set = parseTime(sun.set);
  const out: SunEvent[] = [];
  for (let k = -1; k <= Math.ceil((t1 - rise) / DAY) + 1; k++) {
    const r = k === 1 && sun.next_rise ? { t: parseTime(sun.next_rise), at: sun.next_rise } : { t: rise + k * DAY, at: sun.rise };
    out.push({ t: r.t, kind: "rise", at: r.at }, { t: set + k * DAY, kind: "set", at: sun.set });
  }
  return out.filter((e) => e.t >= t0 - DAY && e.t <= t1 + DAY).sort((a, b) => a.t - b.t);
}

/** The nights within [t0, t1]: each from a sunset to the sunrise after it, clipped to the window. */
export function nightBands(sun: WeatherSun | undefined, t0: number, t1: number): [number, number][] {
  const ev = sunEvents(sun, t0, t1);
  const out: [number, number][] = [];
  for (let i = 0; i < ev.length; i++) {
    if (ev[i]!.kind !== "set") continue;
    const end = ev.slice(i + 1).find((e) => e.kind === "rise");
    if (!end) continue;
    const a = Math.max(ev[i]!.t, t0), b = Math.min(end.t, t1);
    if (b > a) out.push([a, b]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing.

/** The card's widest, so it reads as a card in a wide column rather than a banner. */
export const MAX_WIDTH = { compact: 480, full: 520 } as const;

interface Ctx { t: Theme; g: GlyphColours; ui: string; mono: string; lang: Lang; id: string }

/** IBM Plex Mono and its kin: every character the same width. */
const monoWidth = (s: string, size: number) => [...s].length * 0.6 * size;

function text(ctx: Ctx, s: string, x: number, y: number, size: number, attrs: Record<string, string | number | undefined> = {}): SvgNode {
  return el("text", { x, y, "font-size": size, fill: ctx.t.ink, "font-family": ctx.ui, ...attrs }, s);
}
const mono = (ctx: Ctx, s: string, x: number, y: number, size: number, attrs: Record<string, string | number | undefined> = {}) =>
  text(ctx, s, x, y, size, { "font-family": ctx.mono, fill: ctx.t.soft, ...attrs });

/** `s` cut to `width` at `size`, with an ellipsis. */
function fit(s: string, width: number, size: number): string {
  if (textWidth(s, size) <= width) return s;
  let out = s;
  while (out.length > 1 && textWidth(`${out}…`, size) > width) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** `s` in lines of at most `width` at `size`, at most `max` of them (the last cut with an ellipsis). */
function wrap(s: string, width: number, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) <= width || !line) { line = next; continue; }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length > max) { lines.length = max; lines[max - 1] = fit(`${lines[max - 1]} …`, width, size); }
  return lines;
}

/** A smooth path through points, monotone (Fritsch–Carlson), so the line never overshoots a lowest or highest. */
export function smooth(pts: readonly [number, number][]): string {
  const n = pts.length;
  if (n < 2) return "";
  const dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1]![0] - pts[i]![0]; m[i] = (pts[i + 1]![1] - pts[i]![1]) / dx[i]!; }
  t[0] = m[0]!; t[n - 1] = m[n - 2]!;
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i]! / m[i]!, b = t[i + 1]! / m[i]!, h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]!; t[i + 1] = k * b * m[i]!; }
  }
  let d = `M${round(pts[0]![0])} ${round(pts[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!, h = dx[i]! / 3;
    d += `C${round(x0 + h)} ${round(y0 + t[i]! * h)} ${round(x1 - h)} ${round(y1 - t[i + 1]! * h)} ${round(x1)} ${round(y1)}`;
  }
  return d;
}

/** A small arrow, up for a sunrise or down for a sunset, 7 pt wide with its base on `y`. */
const arrow = (ctx: Ctx, x: number, y: number, up: boolean) =>
  el("path", { d: up ? `M${x + 3.5} ${y}V${y - 8}M${x + 0.6} ${y - 5.2}L${x + 3.5} ${y - 8.2}L${x + 6.4} ${y - 5.2}` : `M${x + 3.5} ${y - 8.2}V${y}M${x + 0.6} ${y - 3}L${x + 3.5} ${y}L${x + 6.4} ${y - 3}`, fill: "none", stroke: ctx.t.soft, "stroke-width": 1.2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });

/** "Offline · as of …" (or "As of …"), small, with a clock: when the card isn't the latest. One or two lines. */
function staleLine(ctx: Ctx, data: WeatherData, x: number, y: number, width: number): { node: SvgNode; height: number } | null {
  if (!data.stale) return null;
  const w = WORDS[ctx.lang];
  const words = data.stale.offline ? `${w.offline} · ${w.asOf} ${data.stale.as_of}` : `${w.asOf.charAt(0).toUpperCase()}${w.asOf.slice(1)} ${data.stale.as_of}`;
  const lines = wrap(words, width - 15, 12, 2);
  return {
    node: el("g", { "data-part": "stale" },
      el("circle", { cx: x + 5, cy: y - 4, r: 4.6, fill: "none", stroke: ctx.t.soft, "stroke-width": 1.2 }),
      el("path", { d: `M${x + 5} ${y - 6.6}v2.7l1.7 1.2`, fill: "none", stroke: ctx.t.soft, "stroke-width": 1.2, "stroke-linecap": "round" }),
      lines.map((l, i) => text(ctx, l, x + 14, y + i * 15, 12, { fill: ctx.t.soft }))),
    height: 4 + lines.length * 15,
  };
}

/**
 * The header: the temperature now, large and light, at the left (or, when the source gives a wind
 * chill or humidex, what it feels like, with "Feels like" over it and the air's temperature under it);
 * the place, the sky's glyph and words, and tonight's low (or today's high and low) at the right.
 */
function header(ctx: Ctx, data: WeatherData, x: number, y: number, width: number, narrow: boolean): { parts: SvgNode[]; height: number } {
  const w = WORDS[ctx.lang];
  const parts: SvgNode[] = [];
  const numeral = narrow ? 48 : 54;
  const now = data.now;
  const feels = now?.feels_c;
  let leftW = 0, leftH = 0;
  if (now) {
    const big = temp(feels ?? now.temp_c);
    const top = feels !== undefined ? 15 : 0;
    if (feels !== undefined) parts.push(text(ctx, w.feels, x, y + 11, 12, { fill: ctx.t.soft, "data-part": "feels-label" }));
    parts.push(text(ctx, big, x - 1, y + top + numeral * 0.78, numeral, { "font-weight": 300, "letter-spacing": -0.5, "data-part": feels !== undefined ? "feels" : "now" }));
    leftW = textWidth(big, numeral) * 0.92;
    leftH = top + numeral * 0.78;
    if (feels !== undefined) {
      const air = el("text", { x, y: y + leftH + 19, "font-size": 13, fill: ctx.t.ink, "font-family": ctx.ui, "data-part": "air" }, `${w.air} `, el("tspan", { "font-weight": 600, "data-part": "now" }, temp(now.temp_c)));
      parts.push(air);
      leftW = Math.max(leftW, textWidth(w.feels, 12), textWidth(`${w.air} ${temp(now.temp_c)}`, 13));
      leftH += 24;
    }
  }
  const mx = now ? x + leftW + 14 : x;
  const mw = x + width - mx;
  let my = y + 15;
  parts.push(text(ctx, fit(data.place, mw, 16), mx, my, 16, { "font-weight": 600, "data-part": "place" }));
  const icon = now?.icon ?? data.days?.[0]?.icon;
  const cond = now?.condition ?? data.days?.[0]?.condition;
  if (icon || cond) {
    my += 22;
    if (icon) parts.push(glyph(icon, now?.night ?? data.days?.[0]?.night ?? false, mx - 1, my - 14, 18, ctx.g));
    if (cond) parts.push(text(ctx, fit(cond, mw - (icon ? 24 : 0), 13.5), mx + (icon ? 24 : 0), my, 13.5, { "data-part": "condition" }));
  }
  const sub = subLine(data, ctx.lang);
  if (sub) { my += 20; parts.push(text(ctx, fit(sub, mw, 12.5), mx, my, 12.5, { fill: ctx.t.soft, "data-part": "sub" })); }
  const stale = staleLine(ctx, data, mx, my + 19, mw);
  if (stale) { parts.push(stale.node); my += stale.height; }
  return { parts, height: Math.max(leftH, my - y) + 4 };
}

interface ChartOpts { plotH: number; popH: number; ticksEvery: number; label: string | null }

/**
 * The next hours as a chart, in function-plot's and price-chart's grammar: hairline grid labelled at
 * the right, the line over a wash of the accent, the lowest and highest as dots with halo labels, an
 * axis under the plot with the hours. Behind it, night from sunset to sunrise; under it, the chance of
 * precipitation as thin bars, only for hours the source gave one. With feels-like hours, two lines:
 * the air in ink, what it feels like in the accent, the gap between them filled.
 */
function hoursChart(ctx: Ctx, data: WeatherData, hours: WeatherHour[], x: number, y: number, width: number, o: ChartOpts): { parts: SvgNode[]; height: number } | null {
  const pts = hours.map((h) => ({ t: parseTime(h.at), h })).filter((p) => p.h.temp_c !== undefined);
  if (pts.length < 2) return null;
  const { t: th, lang } = ctx;
  const panelHalo = { ...th, ground: th.panel } as Theme;
  const parts: SvgNode[] = [];
  let top = y;
  if (o.label) {
    parts.push(text(ctx, o.label.toLocaleUpperCase(lang === "fr" ? "fr-CA" : "en-CA"), x, top + 11, 11, { "font-weight": 600, "letter-spacing": 0.66, fill: th.soft, "data-part": "chart-label" }));
    top += 18;
  }
  const t0 = pts[0]!.t - HOUR / 2, t1 = pts[pts.length - 1]!.t + HOUR / 2;
  // Feels-like: runs of consecutive hours that have one.
  const runs: { t: number; air: number; feels: number }[][] = [];
  let run: { t: number; air: number; feels: number }[] = [];
  for (const p of pts) {
    if (p.h.feels_c !== undefined) run.push({ t: p.t, air: p.h.temp_c!, feels: p.h.feels_c });
    else { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  const temps = pts.map((p) => p.h.temp_c!);
  const feelsAll = runs.flat().map((r) => r.feels);
  let lo = Math.min(...temps, ...feelsAll), hi = Math.max(...temps, ...feelsAll);
  if (hi - lo < 6) { const c = (hi + lo) / 2; lo = c - 3; hi = c + 3; }
  const pad = (hi - lo) * 0.22; lo -= pad * 1.7; hi += pad;
  const step = [1, 2, 5, 10, 20].find((k) => (hi - lo) / k <= 4) ?? 20;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const gutter = Math.max(...ticks.map((v) => monoWidth(temp(v), 10.5))) + 12;
  // Sunrise and sunset get a row of their own above the plot, clear of the highest's label.
  const events = sunEvents(data.sun, t0, t1).filter((e) => e.t >= t0 && e.t <= t1);
  const bands = nightBands(data.sun, t0, t1);
  const labelRow = events.length ? 16 : 0;
  // Room over the highest for its label, under the sun's times: a short plot (compact) needs more.
  const maxOff = ((hi - Math.max(...temps)) / (hi - lo)) * o.plotH;
  const plotTop = top + labelRow + Math.max(6, 24 - maxOff);
  const left = x + 2, right = x + width - gutter;
  const sx = (t: number) => left + ((t - t0) / (t1 - t0)) * (right - left);
  const sy = (c: number) => plotTop + ((hi - c) / (hi - lo)) * o.plotH;
  const bottom = plotTop + o.plotH;
  const pops = pts.filter((p) => popShown(p.h.pop));
  const popH = pops.length ? o.popH : 0;
  const axisY = bottom + popH;

  // Night behind everything, its edges at sunset and sunrise.
  for (const [a, b] of bands) parts.push(el("rect", { x: sx(a), y: plotTop - 6, width: sx(b) - sx(a), height: axisY - plotTop + 6, fill: th.weather.night, "data-part": "night", "data-from": a, "data-to": b }));
  for (const e of events) parts.push(el("line", { x1: sx(e.t), x2: sx(e.t), y1: plotTop - 6, y2: axisY, stroke: th.weather.nightEdge, "stroke-width": 1, "data-part": "sun-edge" }));
  // Their times: each over its edge; a short day (Clyde River: 1 h 38 min) gets one label over its daylight.
  const labels: { x: number; items: { up: boolean; s: string }[] }[] = [];
  for (let k = 0; k < events.length; k++) {
    const e = events[k]!, n = events[k + 1];
    if (n && e.kind === "rise" && sx(n.t) - sx(e.t) < 130) { labels.push({ x: (sx(e.t) + sx(n.t)) / 2, items: [{ up: true, s: timeText(e.at, lang) }, { up: false, s: timeText(n.at, lang) }] }); k++; }
    else labels.push({ x: sx(e.t), items: [{ up: e.kind === "rise", s: timeText(e.at, lang) }] });
  }
  for (const l of labels) {
    const w = l.items.reduce((s, it) => s + 9 + monoWidth(it.s, 10.5), 0) + (l.items.length - 1) * 8;
    let lx = Math.max(x, Math.min(l.x - w / 2, right - w));
    const g: SvgNode[] = [];
    for (const it of l.items) { g.push(arrow(ctx, lx, top + 12, it.up), mono(ctx, it.s, lx + 9, top + 12, 10.5)); lx += 9 + monoWidth(it.s, 10.5) + 8; }
    parts.push(el("g", { "data-part": "sun-label" }, g));
  }
  // The grid, labelled at the right.
  for (const v of ticks) {
    const gy = sy(v);
    if (gy < plotTop + 4 || gy > bottom - 4) continue;
    parts.push(el("line", { x1: left, x2: right + 4, y1: gy, y2: gy, stroke: v === 0 ? th.axis : th.rule, "stroke-width": 1, "data-part": "grid" }));
    parts.push(mono(ctx, temp(v), right + 8, gy + 3.5, 10.5, { "data-part": "grid-label" }));
  }
  // The line(s).
  const air: [number, number][] = pts.map((p) => [sx(p.t), sy(p.h.temp_c!)]);
  const d = smooth(air);
  if (runs.length) {
    for (const r of runs) {
      const a: [number, number][] = r.map((q) => [sx(q.t), sy(q.air)]), f: [number, number][] = r.map((q) => [sx(q.t), sy(q.feels)]);
      parts.push(el("path", { d: `${smooth(a)}L${smooth([...f].reverse()).slice(1)}Z`, fill: th.accent, "fill-opacity": 0.14, "data-part": "gap" }));
    }
    parts.push(el("path", { d, fill: "none", stroke: th.ink, "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round", "data-part": "air-line" }));
    for (const r of runs) parts.push(el("path", { d: smooth(r.map((q) => [sx(q.t), sy(q.feels)])), fill: "none", stroke: th.accent, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round", "data-part": "feels-line" }));
  } else {
    const gid = `${ctx.id}-wash`;
    parts.push(el("defs", {}, el("linearGradient", { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, el("stop", { offset: 0, "stop-color": th.accent, "stop-opacity": 0.18 }), el("stop", { offset: 1, "stop-color": th.accent, "stop-opacity": 0 }))));
    parts.push(el("path", { d: `${d}L${round(air[air.length - 1]![0])} ${round(bottom)}L${round(air[0]![0])} ${round(bottom)}Z`, fill: `url(#${gid})`, "data-part": "wash" }));
    parts.push(el("path", { d, fill: "none", stroke: th.accent, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "data-part": "air-line" }));
  }
  // The lowest and highest, marked.
  const iMax = temps.indexOf(Math.max(...temps)), iMin = temps.lastIndexOf(Math.min(...temps));
  const marks: [number, boolean][] = Math.round(temps[iMax]!) === Math.round(temps[iMin]!) ? [[iMax, true]] : [[iMax, true], [iMin, false]];
  for (const [i, above] of marks) {
    const [px, py] = air[i]!;
    parts.push(el("circle", { cx: px, cy: py, r: 4, fill: runs.length ? th.ink : th.accent, stroke: th.panel, "stroke-width": 2, "data-part": above ? "max" : "min" }));
    const s = temp(temps[i]!), half = textWidth(s, 12.5) / 2 + 2;
    // The lowest's label under its dot, unless that would reach the hours under the axis: then beside it, to the left.
    const beside = !above && py + 18 > axisY + 4;
    const at = beside ? { x: px - 8, y: py + 4.5, "text-anchor": "end" } : { x: Math.max(left + half, Math.min(px, right - half)), y: above ? py - 9 : py + 18, "text-anchor": "middle" };
    parts.push(el("g", { "data-part": above ? "max-label" : "min-label" }, haloText(s, { ...at, "font-size": 12.5, "font-weight": 600 }, panelHalo)));
  }
  // Which line is which, once, where the longest run is.
  if (runs.length) {
    const longest = runs.reduce((a, b) => (b.length > a.length ? b : a));
    const q = longest[Math.min(longest.length - 1, Math.round(longest.length * 0.62))]!;
    parts.push(el("g", { "data-part": "air-name" }, haloText(WORDS[lang].airLine, { x: sx(q.t), y: sy(q.air) - 7, "font-size": 11, "text-anchor": "middle", fill: th.soft }, panelHalo)));
    parts.push(el("g", { "data-part": "feels-name" }, haloText(WORDS[lang].feelsLine, { x: sx(q.t), y: sy(q.feels) + 15, "font-size": 11, "font-weight": 600, "text-anchor": "middle", fill: th.weather.pop }, panelHalo)));
  }
  // The chance of precipitation: a thin bar per hour the source gave one for, and the highest once.
  if (pops.length) {
    const maxPop = Math.max(...pops.map((p) => p.h.pop!));
    for (const p of pops) {
      const bh = (p.h.pop! / 100) * (popH - 6);
      parts.push(el("rect", { x: sx(p.t) - 1.5, y: axisY - bh, width: 3, height: bh, rx: 1.5, fill: th.accent, "fill-opacity": 0.75, "data-part": "pop-bar", "data-at": p.h.at }));
    }
    const s = popText(maxPop, lang), w = monoWidth(s, 10.5);
    const lastX = sx(pops[pops.length - 1]!.t), firstX = sx(pops[0]!.t);
    // After the run of bars, else before it, else (bars from end to end) in the gutter at the right.
    const at = lastX + 7 + w <= right ? { x: lastX + 7, "text-anchor": "start" } : firstX - 7 - w >= left ? { x: firstX - 7, "text-anchor": "end" } : { x: right + 8, "text-anchor": "start" };
    parts.push(el("g", { "data-part": "pop" }, haloText(s, { ...at, y: axisY - 6, "font-size": 10.5, "font-family": ctx.mono, fill: th.weather.pop }, panelHalo)));
  }
  parts.push(el("line", { x1: left, x2: right, y1: axisY, y2: axisY, stroke: th.axis, "stroke-width": 1, "data-part": "axis" }));
  // The hours.
  pts.forEach((p, i) => {
    if (i % o.ticksEvery) return;
    const px = sx(p.t), s = hourText(p.h.at, lang), half = monoWidth(s, 10.5) / 2;
    parts.push(el("line", { x1: px, x2: px, y1: axisY, y2: axisY + 4, stroke: th.axis, "stroke-width": 1 }));
    parts.push(mono(ctx, s, Math.max(x + half, Math.min(px, x + width - half)), axisY + 16, 10.5, { "text-anchor": "middle", "data-part": "hour" }));
  });
  return { parts: [el("g", { "data-part": "chart", "data-t0": t0, "data-t1": t1, "data-x0": left, "data-x1": right }, parts)], height: axisY + 20 - y };
}

/** The days on one scale for the week: a hollow ring at the night's low, a filled dot at the day's high, joined. */
function dayRows(ctx: Ctx, data: WeatherData, days: WeatherDay[], x: number, y: number, width: number, narrow: boolean): { parts: SvgNode[]; height: number } {
  const { t: th, lang } = ctx;
  // The chance's column only when a day has one.
  const rowH = 31, nameW = narrow ? 64 : 76, gW = 28, popW = days.some((d) => popShown(d.pop)) ? 40 : 4, labW = 34;
  const vals = days.flatMap((d) => [d.low_c, d.high_c]).filter((v): v is number => v !== undefined);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x0 = x + nameW + gW + popW + labW, x1 = x + width - labW;
  const px = (v: number) => (hi > lo ? x0 + ((v - lo) / (hi - lo)) * (x1 - x0) : (x0 + x1) / 2);
  const parts: SvgNode[] = [];
  days.forEach((d, i) => {
    const cy = y + i * rowH + rowH / 2, base = cy + 4.5;
    const g: (SvgNode | null)[] = [
      text(ctx, fit(dayText(d, data.today, lang), nameW - 6, 13.5), x, base, 13.5, { "data-part": "day-name" }),
      d.icon ? glyph(d.icon, d.night ?? false, x + nameW, cy - 10, 20, ctx.g) : null,
      popShown(d.pop) ? mono(ctx, popText(d.pop, lang), x + nameW + gW, cy + 4, 11, { fill: th.weather.pop, "data-part": "pop" }) : null,
      el("line", { x1: x0, x2: x1, y1: cy, y2: cy, stroke: th.rule, "stroke-width": 1, "stroke-dasharray": "1 3", "data-part": "track" }),
    ];
    if (d.low_c !== undefined && d.high_c !== undefined) g.push(el("line", { x1: px(d.low_c), x2: px(d.high_c), y1: cy, y2: cy, stroke: th.accent, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-opacity": 0.55, "data-part": "span" }));
    if (d.low_c !== undefined) {
      g.push(el("circle", { cx: px(d.low_c), cy, r: 4, fill: th.panel, stroke: th.accent, "stroke-width": 2, "data-part": "low-dot" }));
      g.push(text(ctx, temp(d.low_c), px(d.low_c) - 8, base, 12.5, { "text-anchor": "end", fill: th.soft, "data-part": "low" }));
    }
    if (d.high_c !== undefined) {
      g.push(el("circle", { cx: px(d.high_c), cy, r: 4.5, fill: th.accent, "data-part": "high-dot" }));
      g.push(text(ctx, temp(d.high_c), px(d.high_c) + 8, base, 12.5, { "font-weight": 600, "data-part": "high" }));
    }
    parts.push(el("g", { "data-part": "day", "data-date": d.date }, g));
  });
  return { parts: [el("g", { "data-part": "week", "data-lo": lo, "data-hi": hi, "data-x0": x0, "data-x1": x1 }, parts)], height: days.length * rowH };
}

/** Up to four of the next days as small outlined tiles: the day, its glyph, high and low, the chance under them. */
function dayTiles(ctx: Ctx, data: WeatherData, days: WeatherDay[], x: number, y: number, width: number): { parts: SvgNode[]; height: number } {
  const { t: th, lang } = ctx;
  const gap = 6, minW = 84;
  const fits = Math.max(1, Math.floor((width + gap) / (minW + gap)));
  // One row of as many as fit (at most four); a column too narrow for three stacks them two by two.
  const perRow = fits >= 3 ? Math.min(4, fits) : 2;
  const shown = days.slice(0, fits >= 3 ? perRow : 4);
  const withPop = shown.some((d) => popShown(d.pop));
  const tileH = withPop ? 58 : 46, tileW = (width - gap * (perRow - 1)) / perRow;
  const parts = shown.map((d, i) => {
    const tx = x + (i % perRow) * (tileW + gap), ty = y + Math.floor(i / perRow) * (tileH + gap);
    const hi = d.high_c !== undefined ? temp(d.high_c) : null, lo = d.low_c !== undefined ? temp(d.low_c) : null;
    const tempsX = tx + 8 + (d.icon ? 24 : 0);
    return el("g", { "data-part": "day", "data-date": d.date },
      el("rect", { x: tx + 0.5, y: ty + 0.5, width: tileW - 1, height: tileH - 1, rx: 8, fill: "none", stroke: th.rule, "stroke-width": 1, "data-part": "tile" }),
      text(ctx, fit(dayText(d, data.today, lang), tileW - 16, 12), tx + 8, ty + 17, 12, { "font-weight": 600, fill: th.soft, "data-part": "day-name" }),
      d.icon ? glyph(d.icon, d.night ?? false, tx + 7, ty + 22, 18, ctx.g) : null,
      el("text", { x: tempsX, y: ty + 36, "font-size": 12.5, fill: th.ink, "font-family": ctx.ui },
        hi ? el("tspan", { "font-weight": 600, "data-part": "high" }, hi) : null, hi && lo ? " " : null, lo ? el("tspan", { "data-part": "low" }, lo) : null),
      popShown(d.pop) ? mono(ctx, popText(d.pop, lang), tx + 8, ty + 51, 11, { fill: th.weather.pop, "data-part": "pop" }) : null);
  });
  const rows = Math.ceil(shown.length / perRow);
  return { parts, height: rows * tileH + (rows - 1) * gap };
}

/** The footer: wind, sunrise, sunset and daylight, the ones the data has, in mono, wrapping as needed. */
function footer(ctx: Ctx, data: WeatherData, x: number, y: number, width: number): { parts: SvgNode[]; height: number } | null {
  const w = WORDS[ctx.lang];
  const items: { s: string; part: string }[] = [];
  if (data.now?.wind) items.push({ s: windText(data.now.wind, ctx.lang), part: "wind" });
  if (data.sun?.rise) items.push({ s: `${w.sunrise} ${timeText(data.sun.rise, ctx.lang)}`, part: "sunrise" });
  if (data.sun?.set) items.push({ s: `${w.sunset} ${timeText(data.sun.set, ctx.lang)}`, part: "sunset" });
  const daylight = daylightText(data.sun, ctx.lang);
  if (daylight) items.push({ s: daylight, part: "daylight" });
  if (!items.length) return null;
  const size = 11.5, lineH = 17, gap = 14;
  const parts: SvgNode[] = [el("line", { x1: x, x2: x + width, y1: y, y2: y, stroke: ctx.t.rule, "stroke-width": 1, "data-part": "rule" })];
  let cx = x, line = 0;
  for (const it of items) {
    const iw = monoWidth(it.s, size);
    if (cx > x && cx + iw > x + width) { cx = x; line++; }
    parts.push(mono(ctx, it.s, cx, y + 18 + line * lineH, size, { "data-part": it.part }));
    cx += iw + gap;
  }
  return { parts, height: 18 + line * lineH + 4 };
}

/** What the card says, for a screen reader: the place, now, the next hours' range, the days. */
function sentence(data: WeatherData, lang: Lang): string {
  const w = WORDS[lang];
  const out: string[] = [];
  const now = data.now ? `${temp(data.now.temp_c)}${data.now.condition ? `, ${data.now.condition}` : ""}${data.now.feels_c !== undefined ? `, ${w.feelsLine} ${temp(data.now.feels_c)}` : ""}` : null;
  out.push(`${data.place}${now ? `: ${now}` : ""}.`);
  for (const d of (data.days ?? []).slice(0, 6)) {
    const bits = [d.condition, d.high_c !== undefined ? `${w.sentenceHigh} ${temp(d.high_c)}` : null, d.low_c !== undefined ? `${w.sentenceLow} ${temp(d.low_c)}` : null, popShown(d.pop) ? popText(d.pop, lang) : null].filter(Boolean);
    if (bits.length) out.push(`${dayText(d, data.today, lang)}: ${bits.join(", ")}.`);
  }
  if (data.stale) out.push(`${data.stale.offline ? `${w.offline}, ` : ""}${w.asOf} ${data.stale.as_of}.`);
  return out.join(" ");
}

export function render(data: WeatherData, options: WeatherOptions, rctx: RenderContext): Rendered {
  const lang: Lang = options.lang ?? rctx.locale ?? "en";
  const th = rctx.theme;
  const ctx: Ctx = { t: th, g: { ink: th.ink, accent: th.accent, sun: th.weather.sun, fill: th.panel }, ui: th.font.ui, mono: th.font.mono, lang, id: rctx.id ?? "wx" };
  const width = Math.round(Math.min(rctx.width, MAX_WIDTH[options.size]));
  const narrow = width < 380;
  const padX = narrow ? 14 : 17, padTop = 14, padBottom = 12;
  const inner = width - 2 * padX;
  const full = options.size === "full";
  const parts: SvgNode[] = [];
  let y = padTop;

  const head = header(ctx, data, padX, y, inner, narrow);
  parts.push(...head.parts);
  y += head.height;

  const hours = (data.hours ?? []).slice(0, full ? 24 : 12);
  const chart = hoursChart(ctx, data, hours, padX, y + (full ? 10 : 4), inner, full
    ? { plotH: narrow ? 84 : 96, popH: 26, ticksEvery: narrow ? 6 : 3, label: WORDS[lang].nextHours(hours.length) }
    : { plotH: 46, popH: 18, ticksEvery: 6, label: null });
  if (chart) { parts.push(...chart.parts); y += (full ? 10 : 4) + chart.height; }

  if (full) {
    const days = (data.days ?? []).slice(0, 6).filter((d) => d.low_c !== undefined || d.high_c !== undefined);
    if (days.length) {
      parts.push(el("line", { x1: padX, x2: width - padX, y1: y + 8, y2: y + 8, stroke: th.rule, "stroke-width": 1, "data-part": "rule" }));
      const rows = dayRows(ctx, data, days, padX, y + 12, inner, narrow);
      parts.push(...rows.parts);
      y += 12 + rows.height;
    }
    const foot = footer(ctx, data, padX, y + 6, inner);
    if (foot) { parts.push(...foot.parts); y += 6 + foot.height; }
  } else {
    const next = (data.days ?? []).filter((d) => d.date > data.today && (d.high_c !== undefined || d.low_c !== undefined));
    if (next.length) {
      const tiles = dayTiles(ctx, data, next, padX, y + 8, inner);
      parts.push(...tiles.parts);
      y += 8 + tiles.height;
    }
  }

  const height = Math.round(y + padBottom);
  const summary = sentence(data, lang);
  const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": summary, "font-family": ctx.ui, "data-component": "weather", "data-size": options.size },
    el("title", {}, data.place),
    el("rect", { x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: 12, fill: th.panel, stroke: th.rule, "stroke-width": 1, "data-part": "panel" }),
    parts);
  return { svg, width, height, summary, hover: null };
}
