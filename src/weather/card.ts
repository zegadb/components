// weather (components/weather/): one place's weather as a card. compact: the place, the temperature
// now, one line on tomorrow and the days ahead; full: the condition and today's high and low, the
// next hours, the days, and the details (feels like, wind, precipitation, sunrise and sunset).
//
// The sky is a gradient chosen by the condition and day or night, with white text on it in both chat
// modes ({theme.weather}); every number comes from the data, and anything the data leaves out is left
// out of the card (a chance of precipitation is shown only when the source gave one). The card has
// no credit line: the host shows its source once, under it.
import { el, textWidth, type SvgNode } from "../svg.ts";
import { parseTime } from "../time.ts";
import type { RenderContext, Rendered } from "../chart.ts";
import type { SkyName, ViewError, WeatherColours } from "../types.ts";
import { glyph, type Icon } from "./icons.ts";

export interface WeatherNow { temp_c: number; condition?: string; icon?: Icon; night?: boolean; feels_c?: number; wind?: string; observed?: string }
export interface WeatherHour { at: string; temp_c?: number; icon?: Icon; night?: boolean; pop?: number }
export interface WeatherDay { date: string; high_c?: number; low_c?: number; icon?: Icon; night?: boolean; condition?: string; pop?: number }
export interface WeatherData {
  place: string;
  today: string;
  now?: WeatherNow;
  hours?: WeatherHour[];
  days?: WeatherDay[];
  sun?: { rise?: string; set?: string };
  stale?: { as_of: string; offline: boolean };
  summary?: string;
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
  if (data.sun?.rise) real(data.sun.rise, "data.sun.rise", "time");
  if (data.sun?.set) real(data.sun.set, "data.sun.set", "time");
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
    today: "Today", now: "Now", feels: "Feels like", wind: "Wind", precip: "Precipitation", sunrise: "Sunrise", sunset: "Sunset",
    high: "H:", low: "L:", offline: "Offline", asOf: "as of", nextHours: (n: number) => `next ${n} h`, todayLower: "today",
    warmer: (t: string) => `Warmer tomorrow, with a high of ${t}`, cooler: (t: string) => `Cooler tomorrow, with a high of ${t}`,
    tomorrow: (c: string | null, t: string | null) => `Tomorrow: ${[c, t && `high of ${t}`].filter(Boolean).join(", ")}`,
    sentenceHigh: "high", sentenceLow: "low",
  },
  fr: {
    today: "Auj.", now: "Maint.", feels: "Ressenti", wind: "Vent", precip: "Précipitations", sunrise: "Lever du soleil", sunset: "Coucher",
    high: "Max.", low: "Min.", offline: "Hors ligne", asOf: "en date du", nextHours: (n: number) => `${n} prochaines h`, todayLower: "aujourd’hui",
    warmer: (t: string) => `Plus chaud demain, maximum de ${t}`, cooler: (t: string) => `Plus froid demain, maximum de ${t}`,
    tomorrow: (c: string | null, t: string | null) => `Demain : ${[c && c.charAt(0).toLowerCase() + c.slice(1), t && `maximum de ${t}`].filter(Boolean).join(", ")}`,
    sentenceHigh: "max.", sentenceLow: "min.",
  },
} as const;

/** 10.3 → "10°", −0.4 → "0°", −3 → "−3°". */
export const temp = (c: number) => `${Math.round(c) === 0 ? 0 : Math.round(c)}°`.replace("-", "−");

/** A date-time's own clock (the place's: its offset is the place's), as [hour, minute]. */
const clock = (t: string): [number, number] => { const m = /T(\d{2}):(\d{2})/.exec(t)!; return [Number(m[1]), Number(m[2])]; };

/** "5 PM" / "17 h": an hour in the strip. */
export function hourText(t: string, lang: Lang): string {
  const [h] = clock(t);
  return lang === "fr" ? `${h} h` : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}

/** "7:19 AM" / "7 h 19": sunrise, sunset. */
export function timeText(t: string, lang: Lang): string {
  const [h, m] = clock(t);
  return lang === "fr" ? `${h} h ${String(m).padStart(2, "0")}` : `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Sun" / "dim.", or "Today" / "Auj." for today. */
export function dayText(date: string, today: string, lang: Lang): string {
  if (date === today) return WORDS[lang].today;
  const name = new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { weekday: "short", timeZone: "UTC" }).format(new Date(parseTime(date)));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Below 10 % is shown as nothing, as the source's own "nil". Never shown when not given. */
const POP_SHOWN = 10;
const popShown = (p: number | undefined): p is number => typeof p === "number" && p >= POP_SHOWN;
const popText = (p: number, lang: Lang) => (lang === "fr" ? `${Math.round(p)} %` : `${Math.round(p)}%`);

/** The compact card's one line: how tomorrow compares with today, from the days given. */
export function summaryLine(data: WeatherData, lang: Lang): string | null {
  if (data.summary) return data.summary;
  const days = data.days ?? [];
  const today = days.find((d) => d.date === data.today);
  const next = days.find((d) => d.date > data.today);
  if (!next) return null;
  const w = WORDS[lang];
  const high = next.high_c !== undefined ? temp(next.high_c) : null;
  if (today?.high_c !== undefined && next.high_c !== undefined) {
    const change = Math.round(next.high_c) - Math.round(today.high_c);
    if (change >= 3) return w.warmer(high!);
    if (change <= -3) return w.cooler(high!);
  }
  if (!next.condition && !high) return null;
  return w.tomorrow(next.condition ?? null, high);
}

// ---------------------------------------------------------------------------
// The sky.

/** The card's sky: from the condition now (else the next hour's, else today's), and day or night. */
export function skyOf(data: WeatherData): SkyName {
  const lead = data.now?.icon ?? data.hours?.[0]?.icon ?? data.days?.[0]?.icon;
  let night = data.now?.night ?? data.hours?.[0]?.night;
  if (night === undefined && data.now?.observed && data.sun?.rise && data.sun?.set) {
    const t = parseTime(data.now.observed);
    night = t < parseTime(data.sun.rise) || t > parseTime(data.sun.set);
  }
  night ??= data.days?.[0]?.night ?? false;
  if (lead === "thunderstorm") return "storm";
  if (night) return lead === "clear" || lead === "mainly-clear" ? "clear-night" : "cloudy-night";
  switch (lead) {
    case "clear": case "mainly-clear": return "clear-day";
    case "cloudy": case "fog": return "overcast-day";
    case "showers": case "rain": case "freezing-rain": case "mix": return "rain-day";
    case "flurries": case "snow": case "blowing-snow": return "snow-day";
    default: return "partly-day";
  }
}

// ---------------------------------------------------------------------------
// Drawing.

/** The softer ink's opacity: lows, labels, the hours' times. Every sky holds it at 4.5:1 (the tests check). */
export const SOFT = 0.86;
/** The card's widest, so it reads as a card in a wide column rather than a banner. */
export const MAX_WIDTH = { compact: 480, full: 500 } as const;

interface Ctx { c: WeatherColours; font: string }

function text(ctx: Ctx, s: string, x: number, y: number, size: number, attrs: Record<string, string | number | undefined> = {}): SvgNode {
  return el("text", { x, y, "font-size": size, fill: ctx.c.ink, "font-family": ctx.font, ...attrs }, s);
}

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
  const words = s.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (textWidth(next, size) <= width || !line) { line = next; continue; }
    lines.push(line);
    line = words[i]!;
    if (lines.length === max - 1) { line = words.slice(i).join(" "); break; }
  }
  if (line) lines.push(lines.length === max - 1 || lines.length < max ? fit(line, width, size) : line);
  // No word left alone on the last line ("…high of / 14°"): the one before it goes down with it.
  const n = lines.length;
  if (n >= 2 && !lines[n - 1]!.includes(" ") && lines[n - 2]!.includes(" ")) {
    const prev = lines[n - 2]!, cut = prev.lastIndexOf(" ");
    const moved = `${prev.slice(cut + 1)} ${lines[n - 1]}`;
    if (textWidth(moved, size) <= width) { lines[n - 2] = prev.slice(0, cut); lines[n - 1] = moved; }
  }
  return lines.slice(0, max);
}

/** Today's high and low, as the header shows them ("H:8° L:−1°"), or null. */
function highLow(data: WeatherData, lang: Lang): string | null {
  const today = data.days?.find((d) => d.date === data.today);
  if (!today) return null;
  const w = WORDS[lang];
  const parts = [today.high_c !== undefined ? `${w.high}${lang === "fr" ? " " : ""}${temp(today.high_c)}` : null, today.low_c !== undefined ? `${w.low}${lang === "fr" ? " " : ""}${temp(today.low_c)}` : null].filter(Boolean);
  return parts.length ? parts.join("  ") : null;
}

/** One day's row: its name, its sky, its chance of precipitation (when given), its high and low. */
function dayRow(ctx: Ctx, d: WeatherDay, data: WeatherData, lang: Lang, x0: number, x1: number, top: number, rowH: number, iconX: number, size: number): SvgNode {
  const base = top + rowH / 2 + size * 0.36;
  const icon = 22;
  const parts: (SvgNode | null)[] = [
    text(ctx, fit(dayText(d.date, data.today, lang), iconX - x0 - 6, size), x0, base, size),
    d.icon ? glyph(d.icon, d.night ?? false, iconX, top + (rowH - icon) / 2, icon, ctx.c) : null,
    popShown(d.pop) ? text(ctx, popText(d.pop, lang), iconX + icon + 3, base - 0.5, size - 1.5, { fill: ctx.c.pop, "font-weight": 600, "data-part": "pop" }) : null,
    d.high_c !== undefined ? text(ctx, temp(d.high_c), x1 - 38, base, size, { "text-anchor": "end", "font-weight": 600, "data-part": "high" }) : null,
    d.low_c !== undefined ? text(ctx, temp(d.low_c), x1, base, size, { "text-anchor": "end", "fill-opacity": SOFT, "data-part": "low" }) : null,
  ];
  return el("g", { "data-part": "day", "data-date": d.date }, parts);
}

/** The "as of" line when the card isn't the latest. */
function staleRow(ctx: Ctx, data: WeatherData, lang: Lang, x: number, y: number, width: number): SvgNode | null {
  if (!data.stale) return null;
  const w = WORDS[lang];
  const words = data.stale.offline ? `${w.offline} · ${w.asOf} ${data.stale.as_of}` : `${w.asOf.charAt(0).toUpperCase()}${w.asOf.slice(1)} ${data.stale.as_of}`;
  // A small clock: the card shows an older reading.
  return el("g", { "data-part": "stale" },
    el("circle", { cx: x + 6, cy: y - 4.5, r: 5.5, fill: "none", stroke: ctx.c.ink, "stroke-width": 1.3, "stroke-opacity": SOFT }),
    el("path", { d: `M${x + 6} ${y - 7.5}v3.2l2 1.4`, fill: "none", stroke: ctx.c.ink, "stroke-width": 1.3, "stroke-linecap": "round", "stroke-opacity": SOFT }),
    text(ctx, fit(words, width - 18, 12.5), x + 17, y, 12.5, { "fill-opacity": SOFT }));
}

function frame(ctx: Ctx, id: string, sky: SkyName, width: number, height: number): SvgNode[] {
  const [top, bottom] = ctx.c.skies[sky];
  return [
    el("defs", {}, el("linearGradient", { id: `${id}-sky`, x1: 0, x2: 0, y1: 0, y2: 1 }, el("stop", { offset: 0, "stop-color": top! }), el("stop", { offset: 1, "stop-color": bottom! }))),
    el("rect", { x: 0.5, y: 0.5, width: width - 1, height: height - 1, rx: 22, fill: `url(#${id}-sky)`, stroke: ctx.c.edge, "stroke-opacity": 0.1, "data-part": "sky", "data-sky": sky }),
  ];
}

/** What the card says, for a screen reader: the place, now, today and the days. */
function sentence(data: WeatherData, lang: Lang): string {
  const w = WORDS[lang];
  const out: string[] = [];
  const now = data.now ? `${temp(data.now.temp_c)}${data.now.condition ? `, ${data.now.condition}` : ""}` : null;
  out.push(`${data.place}${now ? `: ${now}` : ""}.`);
  for (const d of (data.days ?? []).slice(0, 6)) {
    const bits = [d.condition, d.high_c !== undefined ? `${w.sentenceHigh} ${temp(d.high_c)}` : null, d.low_c !== undefined ? `${w.sentenceLow} ${temp(d.low_c)}` : null, popShown(d.pop) ? popText(d.pop, lang) : null].filter(Boolean);
    if (bits.length) out.push(`${dayText(d.date, data.today, lang)}: ${bits.join(", ")}.`);
  }
  if (data.stale) out.push(`${data.stale.offline ? `${w.offline}, ` : ""}${w.asOf} ${data.stale.as_of}.`);
  return out.join(" ");
}

export function render(data: WeatherData, options: WeatherOptions, rctx: RenderContext): Rendered {
  const lang: Lang = options.lang ?? rctx.locale ?? "en";
  const ctx: Ctx = { c: rctx.theme.weather, font: rctx.theme.font.ui };
  const id = rctx.id ?? "wx";
  const width = Math.round(Math.min(rctx.width, MAX_WIDTH[options.size]));
  const sky = skyOf(data);
  const drawn = options.size === "full" ? full(ctx, data, lang, width) : compact(ctx, data, lang, width);
  const summary = sentence(data, lang);
  const svg = el("svg", { width, height: drawn.height, viewBox: `0 0 ${width} ${drawn.height}`, role: "img", "aria-label": summary, "font-family": ctx.font, "data-component": "weather", "data-size": options.size },
    el("title", {}, data.place), frame(ctx, id, sky, width, drawn.height), drawn.parts);
  return { svg, width, height: drawn.height, summary, hover: null };
}

/** The place, the temperature now and one line at the left; the days at the right. */
function compact(ctx: Ctx, data: WeatherData, lang: Lang, width: number): { parts: SvgNode[]; height: number } {
  const pad = width < 400 ? 16 : 18;
  const days = (data.days ?? []).slice(0, 5);
  const twoCol = days.length > 0 && width >= 320;
  const leftW = twoCol ? Math.round((width - 2 * pad) * 0.4) : width - 2 * pad;
  const parts: SvgNode[] = [];
  const placeSize = 16, numeral = width < 400 ? 50 : 56;
  parts.push(text(ctx, fit(data.place, leftW, placeSize), pad, pad + 14, placeSize, { "font-weight": 600, "data-part": "place" }));
  let y = pad + 14;
  if (data.now) {
    y += numeral * 0.95;
    parts.push(text(ctx, temp(data.now.temp_c), pad - 2, y, numeral, { "font-weight": 300, "data-part": "now" }));
  } else {
    const hl = highLow(data, lang);
    if (hl) { y += 26; parts.push(text(ctx, hl, pad, y, 18, { "data-part": "high-low" })); }
  }
  const line = summaryLine(data, lang);
  const lines = line ? wrap(line, leftW, 13.5, twoCol ? 3 : 2) : [];
  const icon = data.now?.icon;
  const bottomH = (icon ? 26 : 0) + lines.length * 17;
  const rowH = 31;
  const rightH = twoCol ? days.length * rowH : 0;
  const leftH = y - pad + 14 + bottomH;
  const staleH = data.stale ? 26 : 0;
  // A narrow card (under 320 pt: a phone's chat bubble) stacks the days under the line, full width.
  const stackH = !twoCol && days.length ? 8 + days.length * rowH : 0;
  const inner = twoCol ? Math.max(leftH, rightH, 116) : leftH;
  const height = Math.round(pad * 2 + inner + stackH + staleH);
  const bottom = pad + inner;
  if (stackH) {
    const x0 = pad, x1 = width - pad;
    const nameW = Math.max(...days.map((d) => textWidth(dayText(d.date, data.today, lang), 14))) + 12;
    const iconX = x0 + Math.min(Math.max(nameW, 48), 64);
    parts.push(el("line", { x1: x0, x2: x1, y1: bottom + 4, y2: bottom + 4, stroke: ctx.c.ink, "stroke-opacity": 0.22, "stroke-width": 1, "data-part": "rule" }));
    days.forEach((d, i) => parts.push(dayRow(ctx, d, data, lang, x0, x1, bottom + 8 + i * rowH, rowH, iconX, 14)));
  }
  let by = bottom - lines.length * 17;
  if (icon) parts.push(glyph(icon, data.now?.night ?? false, pad, by - 26, 22, ctx.c));
  for (const l of lines) { by += 17; parts.push(text(ctx, l, pad, by - 4, 13.5, { "data-part": "summary" })); }
  if (twoCol) {
    const x0 = pad + leftW + 16, x1 = width - pad;
    const nameW = Math.max(...days.map((d) => textWidth(dayText(d.date, data.today, lang), 14))) + 10;
    const iconX = x0 + Math.min(Math.max(nameW, 44), 58);
    const top = pad + (inner - rightH) / 2;
    days.forEach((d, i) => parts.push(dayRow(ctx, d, data, lang, x0, x1, top + i * rowH, rowH, iconX, 14)));
  }
  const st = staleRow(ctx, data, lang, pad, height - pad + 2, width - 2 * pad);
  if (st) parts.push(st);
  return { parts, height };
}

/** The header (place, now, condition, high and low), the next hours, the days, the details. */
function full(ctx: Ctx, data: WeatherData, lang: Lang, width: number): { parts: SvgNode[]; height: number } {
  const w = WORDS[lang];
  const pad = width < 400 ? 16 : 20;
  const inner = width - 2 * pad;
  const parts: SvgNode[] = [];
  const rule = (y: number) => el("line", { x1: pad, x2: width - pad, y1: y, y2: y, stroke: ctx.c.ink, "stroke-opacity": 0.22, "stroke-width": 1, "data-part": "rule" });

  // Header: the place and the temperature at the left; the sky, its words, and today's high and low at the right.
  const numeral = width < 400 ? 56 : 64;
  parts.push(text(ctx, fit(data.place, inner * 0.55, 17), pad, pad + 15, 17, { "font-weight": 600, "data-part": "place" }));
  let y = pad + 15;
  const numeralText = data.now ? temp(data.now.temp_c) : null;
  if (numeralText) parts.push(text(ctx, numeralText, pad - 2, y + numeral * 0.95, numeral, { "font-weight": 300, "data-part": "now" }));
  const rightW = inner - (numeralText ? Math.max(textWidth(numeralText, numeral) * 0.92, textWidth(data.place, 17) * 0.6) : 0) - 12;
  const right = width - pad;
  const icon = data.now?.icon ?? data.days?.[0]?.icon;
  if (icon) parts.push(glyph(icon, data.now?.night ?? data.days?.[0]?.night ?? false, right - 30, pad - 2, 30, ctx.c));
  const cond = data.now?.condition ?? data.days?.[0]?.condition;
  let ry = pad + 46;
  for (const l of cond ? wrap(cond, rightW, 14, 2) : []) { parts.push(text(ctx, l, right, ry, 14, { "text-anchor": "end", "font-weight": 600, "data-part": "condition" })); ry += 18; }
  const hl = highLow(data, lang);
  if (hl) parts.push(text(ctx, hl, right, ry, 14, { "text-anchor": "end", "data-part": "high-low" }));
  y = Math.max(y + numeral * 0.95 + 14, ry + 12);

  // The next hours: now first, then each hour after it.
  const after = data.now?.observed ? parseTime(data.now.observed) : -Infinity;
  const hours = (data.hours ?? []).filter((h) => parseTime(h.at) > after);
  const cols = Math.max(5, Math.min(8, Math.floor(inner / 56)));
  const strip: { label: string; icon?: Icon; night: boolean; temp?: number; pop?: number }[] = [];
  if (data.now) strip.push({ label: w.now, icon: data.now.icon, night: data.now.night ?? false, temp: data.now.temp_c });
  for (const h of hours) { if (strip.length >= cols) break; strip.push({ label: hourText(h.at, lang), icon: h.icon, night: h.night ?? false, temp: h.temp_c, pop: h.pop }); }
  if (strip.length > 1 || (strip.length && hours.length)) {
    parts.push(rule(y));
    const colW = inner / cols;
    const withPop = strip.some((s) => popShown(s.pop));
    const top = y + 10;
    strip.forEach((s, i) => {
      const cx = pad + colW * (i + 0.5);
      const g: (SvgNode | null)[] = [
        text(ctx, s.label, cx, top + 13, 12.5, { "text-anchor": "middle", "fill-opacity": SOFT, "font-weight": i === 0 && data.now ? 600 : 400 }),
        s.icon ? glyph(s.icon, s.night, cx - 13, top + 21, 26, ctx.c) : null,
        popShown(s.pop) ? text(ctx, popText(s.pop, lang), cx, top + 61, 11.5, { "text-anchor": "middle", fill: ctx.c.pop, "font-weight": 600, "data-part": "pop" }) : null,
        s.temp !== undefined ? text(ctx, temp(s.temp), cx + 2, top + (withPop ? 80 : 67), 15, { "text-anchor": "middle", "font-weight": 600 }) : null,
      ];
      parts.push(el("g", { "data-part": "hour" }, g));
    });
    y = top + (withPop ? 90 : 77);
  }

  // The days.
  const days = (data.days ?? []).slice(0, 6);
  if (days.length) {
    parts.push(rule(y));
    const rowH = 32, top = y + 4;
    const iconX = pad + Math.round(inner * 0.36);
    days.forEach((d, i) => parts.push(dayRow(ctx, d, data, lang, pad, width - pad, top + i * rowH, rowH, iconX, 14.5)));
    y = top + days.length * rowH + 4;
  }

  // The details: only those the data has.
  const today = data.days?.find((d) => d.date === data.today);
  // The chance of precipitation: today's when the source gave one, else the highest of the next six hours'
  // (when one of them reaches the shown 10 %); never a 0 nobody gave.
  const next = hours.slice(0, 6);
  const popNext = Math.max(...next.map((h) => (typeof h.pop === "number" ? h.pop : -1)));
  const tiles: { label: string; value: string; sub?: string; part: string }[] = [];
  if (data.now?.feels_c !== undefined) tiles.push({ label: w.feels, value: temp(data.now.feels_c), part: "feels" });
  if (data.now?.wind) { const [v, ...rest] = data.now.wind.split(", "); tiles.push({ label: w.wind, value: v!, sub: rest.join(", ") || undefined, part: "wind" }); }
  if (popShown(today?.pop)) tiles.push({ label: w.precip, value: popText(today.pop, lang), sub: w.todayLower, part: "precip" });
  else if (popShown(popNext)) tiles.push({ label: w.precip, value: popText(popNext, lang), sub: w.nextHours(next.length), part: "precip" });
  // Sunrise, and sunset under it: one tile.
  const { rise, set } = data.sun ?? {};
  if (rise) tiles.push({ label: w.sunrise, value: timeText(rise, lang), sub: set ? `${w.sunset} ${timeText(set, lang)}` : undefined, part: "sun" });
  else if (set) tiles.push({ label: w.sunset, value: timeText(set, lang), part: "sun" });
  if (tiles.length) {
    parts.push(rule(y));
    const per = width >= 440 ? Math.min(4, Math.max(tiles.length, 3)) : 2;
    const colW = inner / per;
    const tileH = tiles.some((t) => t.sub) ? 62 : 50;
    tiles.forEach((t, i) => {
      const x = pad + (i % per) * colW, top = y + 8 + Math.floor(i / per) * tileH;
      parts.push(el("g", { "data-part": t.part },
        text(ctx, fit(t.label, colW - 10, 12.5), x, top + 14, 12.5, { "fill-opacity": SOFT }),
        text(ctx, fit(t.value, colW - 10, 16), x, top + 35, 16, { "font-weight": 600 }),
        t.sub ? text(ctx, fit(t.sub, colW - 10, 12.5), x, top + 52, 12.5, { "fill-opacity": SOFT }) : null));
    });
    y += 8 + Math.ceil(tiles.length / per) * tileH;
  }

  if (data.stale) { y += 8; parts.push(staleRow(ctx, data, lang, pad, y + 10, inner)!); y += 16; }
  return { parts, height: Math.round(y + pad - 4) };
}
