// The weather card's glyphs: our own drawings (never ECCC's icons, which its licence excludes, and
// never another vendor's symbol set), one per kind of sky, and the one table from ECCC's icon codes
// and condition text to them. A host that reads ECCC (Ava's Rust core) reads ECCC_ICONS and
// ECCC_TEXT as data rather than copying them (avacanada/ava scripts/views.ts writes them out for it).
import { el, type SvgNode } from "../svg.ts";
import type { WeatherColours } from "../types.ts";

/** Every kind of sky the card draws. Sun or moon is the `night` flag's, not the kind's. */
export const ICONS = ["clear", "mainly-clear", "partly-cloudy", "cloudy", "showers", "rain", "freezing-rain", "mix", "flurries", "snow", "thunderstorm", "fog", "wind", "blowing-snow"] as const;
export type Icon = (typeof ICONS)[number];

/** An ECCC code's glyph: `night` true or false when the code says (00–09 day, 30–39 night), null when it doesn't. */
export interface Glyph { icon: Icon; night: boolean | null }

const g = (icon: Icon, night: boolean | null = null): Glyph => ({ icon, night });

/**
 * ECCC's icon codes (the `iconCode` / `abbreviatedForecast.icon` values of a city page, 00–48), each
 * to our glyph. Codes ECCC doesn't use (20, 21, 29) are not here; neither is anything we can't draw
 * truthfully (a funnel cloud is "wind", the nearest kind, and its words say the rest).
 */
export const ECCC_ICONS: Readonly<Record<number, Glyph>> = {
  0: g("clear", false), 1: g("mainly-clear", false), 2: g("partly-cloudy", false), 3: g("partly-cloudy", false),
  4: g("partly-cloudy", false), 5: g("mainly-clear", false), 6: g("showers", false), 7: g("mix", false),
  8: g("flurries", false), 9: g("thunderstorm", false),
  10: g("cloudy"), 11: g("rain"), 12: g("rain"), 13: g("rain"), 14: g("freezing-rain"), 15: g("mix"),
  16: g("snow"), 17: g("snow"), 18: g("snow"), 19: g("thunderstorm"),
  22: g("partly-cloudy"), 23: g("fog"), 24: g("fog"), 25: g("blowing-snow"), 26: g("flurries"), 27: g("freezing-rain"), 28: g("rain"),
  30: g("clear", true), 31: g("mainly-clear", true), 32: g("partly-cloudy", true), 33: g("partly-cloudy", true),
  34: g("partly-cloudy", true), 35: g("mainly-clear", true), 36: g("showers", true), 37: g("mix", true),
  38: g("flurries", true), 39: g("thunderstorm", true),
  40: g("blowing-snow"), 41: g("wind"), 42: g("wind"), 43: g("wind"), 44: g("fog"), 45: g("fog"),
  46: g("thunderstorm"), 47: g("thunderstorm"), 48: g("wind"),
};

/**
 * When a period has no code, its words: the first entry with a word in the (accent-folded, lower-case)
 * condition wins, so the more specific come first. English and French.
 */
export const ECCC_TEXT: readonly { readonly words: readonly string[]; readonly icon: Icon }[] = [
  { words: ["thunder", "orage"], icon: "thunderstorm" },
  { words: ["freezing", "verglas", "verglacant", "ice pellets", "granules de glace", "hail", "grele"], icon: "freezing-rain" },
  { words: ["blizzard", "blowing snow", "drifting snow", "poudrerie"], icon: "blowing-snow" },
  { words: ["rain and snow", "snow and rain", "rain or snow", "snow or rain", "showers or flurries", "flurries or rain", "pluie et neige", "neige et pluie", "pluie ou neige", "averses ou neige", "neige ou pluie"], icon: "mix" },
  { words: ["flurries", "flurry", "averses de neige", "neige passagere", "ice crystals", "cristaux de glace"], icon: "flurries" },
  { words: ["snow", "neige"], icon: "snow" },
  { words: ["showers", "averses"], icon: "showers" },
  { words: ["rain", "drizzle", "pluie", "bruine"], icon: "rain" },
  { words: ["fog", "mist", "haze", "smoke", "brouillard", "brume", "fumee"], icon: "fog" },
  { words: ["wind", "vent"], icon: "wind" },
  { words: ["mix of sun and cloud", "partly", "cloudy periods", "mainly cloudy", "mostly cloudy", "alternance", "partiellement", "passages nuageux", "generalement nuageux"], icon: "partly-cloudy" },
  { words: ["overcast", "cloudy", "nuageux", "couvert"], icon: "cloudy" },
  { words: ["mainly sunny", "mainly clear", "few clouds", "generalement", "quelques nuages"], icon: "mainly-clear" },
  { words: ["sunny", "clear", "ensoleille", "degage"], icon: "clear" },
];

/** Lower case, accents off: "Généralement ensoleillé" → "generalement ensoleille". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The glyph for an ECCC period: its code if ECCC gave one we know, else its words, else null (the card
 * then draws no glyph: it never guesses a sky).
 */
export function ecccGlyph(code: number | null | undefined, text?: string | null): Glyph | null {
  if (typeof code === "number" && Object.hasOwn(ECCC_ICONS, code)) return ECCC_ICONS[code]!;
  if (!text) return null;
  const t = fold(text);
  for (const rule of ECCC_TEXT) if (rule.words.some((w) => t.includes(w))) return g(rule.icon);
  return null;
}

// ---------------------------------------------------------------------------
// The drawings, on a 24-unit square (placed and scaled by `glyph`).

/** Which kinds show the sun (or the moon) behind them. */
const WITH_SKY: ReadonlySet<Icon> = new Set(["clear", "mainly-clear", "partly-cloudy", "showers", "flurries"]);

/** A cloud: a flat base from x 3.5 to 20.5 at y = 15, three lobes. */
const CLOUD = "M7 15.5h10.4a3.6 3.6 0 0 0 .5-7.15 5.6 5.6 0 0 0-10.7.9 3.15 3.15 0 0 0-.2 6.25z";

function sun(c: WeatherColours, cx: number, cy: number, r: number, rays: boolean): SvgNode {
  const lines: SvgNode[] = [];
  if (rays) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      lines.push(el("line", { x1: cx + Math.cos(a) * (r + 2.1), y1: cy + Math.sin(a) * (r + 2.1), x2: cx + Math.cos(a) * (r + 4), y2: cy + Math.sin(a) * (r + 4), stroke: c.sun, "stroke-width": 1.7, "stroke-linecap": "round" }));
    }
  }
  return el("g", { "data-glyph": "sun" }, el("circle", { cx, cy, r, fill: c.sun }), lines);
}

/** A crescent: a disc with a bite out of its upper right. */
function moon(c: WeatherColours, cx: number, cy: number, r: number): SvgNode {
  const k = r * 0.78;
  return el("path", { "data-glyph": "moon", d: `M${cx + k * 0.55} ${cy - r * 0.92}A${r} ${r} 0 1 0 ${cx + r * 0.98} ${cy + k * 0.32}A${k} ${k} 0 0 1 ${cx + k * 0.55} ${cy - r * 0.92}z`, fill: c.moon });
}

const cloud = (c: WeatherColours, transform?: string, back = false) => el("path", { "data-glyph": "cloud", d: CLOUD, fill: back ? c.cloudBack : c.cloud, transform });

const drops = (c: WeatherColours, xs: number[], y = 18, len = 3.6) =>
  xs.map((x) => el("line", { x1: x, y1: y, x2: x - 1.2, y2: y + len, stroke: c.drop, "stroke-width": 1.8, "stroke-linecap": "round" }));

function flake(c: WeatherColours, cx: number, cy: number, r = 1.9): SvgNode {
  const arms: SvgNode[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 2;
    arms.push(el("line", { x1: cx - Math.cos(a) * r, y1: cy - Math.sin(a) * r, x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r, stroke: c.cloud, "stroke-width": 1.3, "stroke-linecap": "round" }));
  }
  return el("g", { "data-glyph": "flake" }, arms);
}

const bolt = (c: WeatherColours) => el("path", { "data-glyph": "bolt", d: "M12.6 15.2 9.6 19.6h2.6l-1 3.6 3.9-5h-2.6l1.3-3z", fill: c.bolt });

const windLines = (c: WeatherColours, y0: number) => [
  el("path", { d: `M3.5 ${y0}h11.2a2.6 2.6 0 1 0-2.6-2.6`, fill: "none", stroke: c.cloud, "stroke-width": 1.7, "stroke-linecap": "round" }),
  el("path", { d: `M3.5 ${y0 + 4}h14.6a2.6 2.6 0 1 1-2.6 2.6`, fill: "none", stroke: c.cloud, "stroke-width": 1.7, "stroke-linecap": "round" }),
  el("path", { d: `M3.5 ${y0 + 8}h7`, fill: "none", stroke: c.cloud, "stroke-width": 1.7, "stroke-linecap": "round" }),
];

/** One kind's drawing on the 24-unit square. */
function drawing(icon: Icon, night: boolean, c: WeatherColours): SvgNode[] {
  // The sun or moon: whole for a clear sky, peeking from behind the cloud otherwise.
  const body = (cx: number, cy: number, r: number) => (night ? moon(c, cx, cy, r * 1.15) : sun(c, cx, cy, r, true));
  switch (icon) {
    case "clear": return [night ? moon(c, 12, 12, 7.2) : sun(c, 12, 12, 4.6, true)];
    case "mainly-clear": return [body(10.5, 10, 4.2), cloud(c, "translate(9.2 10.4) scale(0.58)")];
    case "partly-cloudy": return [body(8.4, 8.2, 3.6), cloud(c, "translate(1.6 4.2) scale(0.92)")];
    case "cloudy": return [cloud(c, "translate(4.6 -1.4) scale(0.8)", true), cloud(c, "translate(0 3)")];
    case "showers": return [body(7.6, 6.4, 3.1), cloud(c, "translate(1.4 0.6) scale(0.92)"), ...drops(c, [9.6, 14.6])];
    case "rain": return [cloud(c), ...drops(c, [8.2, 12.2, 16.2])];
    case "freezing-rain": return [cloud(c), ...drops(c, [8.2, 16.2]), el("path", { "data-glyph": "ice", d: "M12.2 17.6l1.9 2.3-1.9 2.3-1.9-2.3z", fill: c.drop })];
    case "mix": return [cloud(c), ...drops(c, [8.6]), flake(c, 12.6, 20), ...drops(c, [17])];
    case "flurries": return [body(7.6, 6.4, 3.1), cloud(c, "translate(1.4 0.6) scale(0.92)"), flake(c, 10, 19.6), flake(c, 15.2, 19.6)];
    case "snow": return [cloud(c), flake(c, 7.8, 19.4), flake(c, 12.2, 21), flake(c, 16.6, 19.4)];
    case "thunderstorm": return [cloud(c), bolt(c), ...drops(c, [7.4, 17.6])];
    case "fog": return [cloud(c, "translate(0 -2.4)"), ...[15.6, 18.6, 21.6].map((y, i) => el("line", { x1: 3.5 + (i % 2) * 2, y1: y, x2: 20.5 - ((i + 1) % 2) * 2, y2: y, stroke: c.cloud, "stroke-width": 1.7, "stroke-linecap": "round", "stroke-opacity": 0.85 }))];
    case "wind": return windLines(c, 8);
    case "blowing-snow": return [...windLines(c, 5).slice(0, 2), flake(c, 7.2, 18.4), flake(c, 12.6, 20.4), flake(c, 18, 18.4)];
  }
}

/** True when a kind is drawn with the sun or moon (so night changes it). */
export const showsSky = (icon: Icon) => WITH_SKY.has(icon);

/** A glyph, `size` points square, its top-left at (x, y). */
export function glyph(icon: Icon, night: boolean, x: number, y: number, size: number, c: WeatherColours): SvgNode {
  return el("g", { transform: `translate(${x} ${y}) scale(${size / 24})`, "data-icon": icon, "data-night": showsSky(icon) && night ? "1" : undefined, "aria-hidden": "true" }, drawing(icon, night, c));
}
