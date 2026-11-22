// The weather card's glyphs: our own drawings (never ECCC's icons, which its licence excludes, and
// never another vendor's symbol set), one per kind of sky, and the one table from ECCC's icon codes
// and condition text to them. A host that reads ECCC (Ava's Rust core) reads ECCC_ICONS and
// ECCC_TEXT as data rather than copying them (avacanada/ava scripts/views.ts writes them out for it).
import { el, type SvgNode } from "../svg.ts";

/**
 * A glyph's colours: line drawings in our stroke (1.6 on a 24 grid, round caps). Shapes are `ink`,
 * what falls (rain, snow, ice, a bolt) is `accent`, the sun is `sun` (a shape colour, never text), and
 * a cloud is filled with `fill`, the surface it sits on, so it hides the sun behind it.
 */
export interface GlyphColours { ink: string; accent: string; sun: string; fill: string }

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

/** A cloud: a flat base from x 6.6 to 17.2 at y 18.6, two lobes. */
const CLOUD = "M6.6 18.6h10.6a3.7 3.7 0 0 0 .5-7.36 5.3 5.3 0 0 0-10.2 1.06A3.2 3.2 0 0 0 6.6 18.6z";

/** The stroke in the 24 grid: 1.6, a little heavier when the glyph is drawn small, so it stays near 1.3 to 1.6 pt on screen. */
const strokeAt = (size: number) => 1.6 * (24 / size) ** 0.35;

type Pen = GlyphColours & { w: number };

const round = { "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

/** The sun: a ring and eight short rays, in the sun's colour. */
function sun(p: Pen, cx: number, cy: number, r: number, rays = true): SvgNode {
  const lines: SvgNode[] = [];
  if (rays) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      lines.push(el("line", { x1: cx + Math.cos(a) * (r + 2.2), y1: cy + Math.sin(a) * (r + 2.2), x2: cx + Math.cos(a) * (r + 3.8), y2: cy + Math.sin(a) * (r + 3.8), stroke: p.sun, "stroke-width": p.w, ...round }));
    }
  }
  return el("g", { "data-glyph": "sun" }, el("circle", { cx, cy, r, fill: "none", stroke: p.sun, "stroke-width": p.w }), lines);
}

/** A crescent, outlined in ink. */
function moon(p: Pen, cx: number, cy: number, r: number): SvgNode {
  return el("path", { "data-glyph": "moon", d: `M${cx + r * 0.35} ${cy - r * 1.05}a${r * 1.1} ${r * 1.1} 0 1 0 ${r * 0.95} ${r * 1.55}a${r * 0.95} ${r * 0.95} 0 0 1 ${-r * 0.95} ${-r * 1.55}z`, fill: p.fill, stroke: p.ink, "stroke-width": p.w, ...round });
}

/** A cloud outlined in ink and filled with the surface, so whatever is behind it is hidden. */
const cloud = (p: Pen, transform?: string) => el("path", { "data-glyph": "cloud", d: CLOUD, transform, fill: p.fill, stroke: p.ink, "stroke-width": p.w, ...round });

const drops = (p: Pen, xs: number[], y = 19.6) => xs.map((x) => el("line", { "data-glyph": "drop", x1: x, y1: y, x2: x - 1.4, y2: y + 3, stroke: p.accent, "stroke-width": p.w, ...round }));

function flake(p: Pen, x: number, y: number): SvgNode {
  const w = p.w * 0.85;
  return el("g", { "data-glyph": "flake", stroke: p.accent, "stroke-width": w, "stroke-linecap": "round" },
    el("line", { x1: x - 1.5, y1: y, x2: x + 1.5, y2: y }),
    el("line", { x1: x - 0.75, y1: y - 1.3, x2: x + 0.75, y2: y + 1.3 }),
    el("line", { x1: x + 0.75, y1: y - 1.3, x2: x - 0.75, y2: y + 1.3 }));
}

const windLines = (p: Pen, y0: number) =>
  el("g", { "data-glyph": "wind", fill: "none", stroke: p.ink, "stroke-width": p.w, "stroke-linecap": "round" },
    el("path", { d: `M3 ${y0}h11a2.6 2.6 0 1 0-2.6-2.6` }),
    el("path", { d: `M3 ${y0 + 4}h15a2.6 2.6 0 1 1-2.6 2.6` }),
    el("path", { d: `M3 ${y0 + 8}h7` }));

/** One kind's drawing on the 24-unit square. */
function drawing(icon: Icon, night: boolean, p: Pen): SvgNode[] {
  // The sun or moon: whole for a clear sky, behind the cloud otherwise.
  const body = (cx: number, cy: number, r: number) => (night ? moon(p, cx, cy, r) : sun(p, cx, cy, r));
  const up = "translate(0 -2.6)";
  switch (icon) {
    case "clear": return [night ? moon(p, 11, 12.5, 6.2) : sun(p, 12, 12, 4.2)];
    case "mainly-clear": return [body(9.5, 9, 3.4), cloud(p, "translate(4.2 3.6) scale(0.72)")];
    case "partly-cloudy": return [body(8.4, 8.2, 3.2), cloud(p, "translate(1 1.2)")];
    case "cloudy": return [cloud(p, "translate(3.6 -3) scale(0.78)"), cloud(p, "translate(-1 1)")];
    case "showers": return [body(8, 6.6, 2.8), cloud(p, up), ...drops(p, [10, 15])];
    case "rain": return [cloud(p, up), ...drops(p, [8.6, 12.6, 16.6])];
    case "freezing-rain": return [cloud(p, up), ...drops(p, [8.6, 16.6]), el("path", { "data-glyph": "ice", d: "M12.6 19.4l1.6 1.9-1.6 1.9-1.6-1.9z", fill: "none", stroke: p.accent, "stroke-width": p.w * 0.85, ...round })];
    case "mix": return [cloud(p, up), ...drops(p, [8.6, 16.6]), flake(p, 12.6, 21)];
    case "flurries": return [body(8, 6.6, 2.8), cloud(p, up), flake(p, 10, 20.8), flake(p, 15.2, 20.8)];
    case "snow": return [cloud(p, up), flake(p, 8, 20.2), flake(p, 12.4, 21.8), flake(p, 16.8, 20.2)];
    case "thunderstorm": return [cloud(p, up), el("path", { "data-glyph": "bolt", d: "M12.8 15.6 10.4 19.4h2.6l-1.2 3.4", fill: "none", stroke: p.accent, "stroke-width": p.w, ...round })];
    case "fog": return [cloud(p, "translate(0 -3.4)"), el("g", { stroke: p.ink, "stroke-width": p.w, "stroke-linecap": "round" }, el("line", { x1: 4, y1: 18.6, x2: 20, y2: 18.6 }), el("line", { x1: 6.5, y1: 21.8, x2: 17.5, y2: 21.8 }))];
    case "wind": return [windLines(p, 8)];
    case "blowing-snow": return [windLines(p, 5), flake(p, 6.4, 19.4), flake(p, 12, 21.2), flake(p, 17.6, 19.4)];
  }
}

/** True when a kind is drawn with the sun or moon (so night changes it). */
export const showsSky = (icon: Icon) => WITH_SKY.has(icon);

/** A glyph, `size` points square, its top-left at (x, y). */
export function glyph(icon: Icon, night: boolean, x: number, y: number, size: number, c: GlyphColours): SvgNode {
  return el("g", { transform: `translate(${x} ${y}) scale(${size / 24})`, "data-icon": icon, "data-night": showsSky(icon) && night ? "1" : undefined, "aria-hidden": "true" }, drawing(icon, night, { ...c, w: strokeAt(size) }));
}
