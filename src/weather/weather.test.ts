// The weather card: what validate() refuses, which sky and glyph it draws, that it never shows a
// chance of precipitation nobody gave, its words in both languages, and that its text holds 4.5:1
// on every sky of every host in both modes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, render, WEATHER, ECCC_ICONS, ecccGlyph, skyOf, summaryLine, WEATHER_SOFT, WEATHER_MAX_WIDTH, type WeatherData } from "./index.ts";
import { theme, HOSTS } from "../theme.ts";
import { toSvgString, type SvgNode } from "../svg.ts";
import type { Mode } from "../types.ts";

const toronto = JSON.parse(readFileSync(new URL("../../components/weather/web/data/toronto.json", import.meta.url), "utf8")) as WeatherData;
const montreal = JSON.parse(readFileSync(new URL("../../components/weather/web/data/montreal-fr.json", import.meta.url), "utf8")) as WeatherData;

const draw = (data: WeatherData, options: Record<string, unknown> = {}, width = 640, mode: Mode = "light") => {
  const checked = validate({ component: "weather", data, options });
  assert.ok(checked.ok, JSON.stringify(!checked.ok && checked.errors));
  const drawn = render(checked.view, { width, theme: theme("ava", mode), id: "t" });
  assert.ok("svg" in drawn);
  return { ...drawn, text: toSvgString(drawn.svg) };
};

/** Every node with data-part = `part`. */
const parts = (node: SvgNode, part: string): SvgNode[] => [...(node.attrs["data-part"] === part ? [node] : []), ...node.children.flatMap((c) => (typeof c === "string" ? [] : parts(c, part)))];
const words = (node: SvgNode): string => node.children.map((c) => (typeof c === "string" ? c : words(c))).join(" ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Contrast: the card is white on its sky in both chat modes.

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]) => { const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!; };
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg: number[], alpha: number, bg: number[]) => fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha));

test("every sky's every stop holds the ink, the softer ink and the chance's blue at 4.5:1, in every host and mode", () => {
  let checked = 0;
  for (const host of HOSTS) for (const mode of ["light", "dark"] as const) {
    const w = theme(host, mode).weather;
    for (const [sky, stops] of Object.entries(w.skies)) for (const stop of stops) {
      const bg = rgb(stop);
      for (const [what, fg] of [["ink", rgb(w.ink)], ["softer ink", over(rgb(w.ink), WEATHER_SOFT, bg)], ["chance", rgb(w.pop)]] as const) {
        const r = ratio(fg, bg);
        assert.ok(r >= 4.5, `${host} ${mode} ${sky} ${stop}: ${what} at ${r.toFixed(2)}:1`);
        checked++;
      }
    }
  }
  assert.equal(checked, HOSTS.length * 2 * 8 * 2 * 3);
});

// ---------------------------------------------------------------------------
// Glyphs: ECCC's codes and words, in one table.

test("ECCC's codes map to our glyphs, day and night where the code says", () => {
  for (const code of [...Array(20).keys(), 22, 23, 24, 25, 26, 27, 28, ...Array.from({ length: 19 }, (_, i) => 30 + i)]) assert.ok(ECCC_ICONS[code], `code ${code} has no glyph`);
  assert.deepEqual(ecccGlyph(0), { icon: "clear", night: false });
  assert.deepEqual(ecccGlyph(30), { icon: "clear", night: true });
  assert.deepEqual(ecccGlyph(31), { icon: "mainly-clear", night: true });
  assert.deepEqual(ecccGlyph(6), { icon: "showers", night: false });
  assert.deepEqual(ecccGlyph(15), { icon: "mix", night: null });
  assert.deepEqual(ecccGlyph(14), { icon: "freezing-rain", night: null });
  assert.deepEqual(ecccGlyph(19), { icon: "thunderstorm", night: null });
  assert.deepEqual(ecccGlyph(40), { icon: "blowing-snow", night: null });
  assert.deepEqual(ecccGlyph(24), { icon: "fog", night: null });
  assert.deepEqual(ecccGlyph(43), { icon: "wind", night: null });
});

test("a period with only words gets its glyph from them, in English or French; unknown words get none", () => {
  const icon = (t: string) => ecccGlyph(null, t)?.icon ?? null;
  assert.equal(icon("Chance of flurries"), "flurries");
  assert.equal(icon("Cloudy periods"), "partly-cloudy");
  assert.equal(icon("Mainly cloudy"), "partly-cloudy");
  assert.equal(icon("A mix of sun and cloud"), "partly-cloudy");
  assert.equal(icon("Cloudy"), "cloudy");
  assert.equal(icon("Chance of rain showers or flurries"), "mix");
  assert.equal(icon("Blizzard"), "blowing-snow");
  assert.equal(icon("Généralement ensoleillé"), "mainly-clear");
  assert.equal(icon("Pluie verglaçante"), "freezing-rain");
  assert.equal(icon("Orages"), "thunderstorm");
  assert.equal(icon("Sunny"), "clear");
  assert.equal(icon("Not available"), null);
  assert.equal(ecccGlyph(null, null), null);
  assert.equal(ecccGlyph(99, "Snow")?.icon, "snow", "a code we don't know falls back to the words");
});

// ---------------------------------------------------------------------------
// The sky.

test("the sky follows the condition now and day or night", () => {
  const base = { place: "X", today: "2026-11-21" };
  assert.equal(skyOf({ ...base, now: { temp_c: 1, icon: "clear", night: true } }), "clear-night");
  assert.equal(skyOf({ ...base, now: { temp_c: 1, icon: "snow", night: true } }), "cloudy-night");
  assert.equal(skyOf({ ...base, now: { temp_c: 1, icon: "snow" } }), "snow-day");
  assert.equal(skyOf({ ...base, now: { temp_c: 1, icon: "rain" } }), "rain-day");
  assert.equal(skyOf({ ...base, now: { temp_c: 1, icon: "fog" } }), "overcast-day");
  assert.equal(skyOf({ ...base, now: { temp_c: 1, icon: "thunderstorm" } }), "storm");
  assert.equal(skyOf({ ...base, now: { temp_c: 1, icon: "mainly-clear" } }), "clear-day");
  // No night flag: the observation against sunrise and sunset.
  assert.equal(skyOf({ ...base, now: { temp_c: 1, icon: "cloudy", observed: "2026-11-21T18:00-05:00" }, sun: { rise: "2026-11-21T07:19-05:00", set: "2026-11-21T16:47-05:00" } }), "cloudy-night");
  // No observation: the next hour's.
  assert.equal(skyOf({ ...base, hours: [{ at: "2026-11-21T22:00-05:00", icon: "clear", night: true }] }), "clear-night");
});

test("the drawn sky is the theme's, by mode", () => {
  for (const mode of ["light", "dark"] as const) {
    const { svg } = draw(toronto, {}, 640, mode);
    const stops = JSON.stringify(svg).match(/"stop-color":"(#[0-9A-F]{6})"/g)!.map((s) => s.slice(-8, -1));
    assert.deepEqual(stops, [...theme("ava", mode).weather.skies["clear-day"]]);
    assert.equal(parts(svg, "sky")[0]!.attrs["data-sky"], "clear-day");
  }
});

// ---------------------------------------------------------------------------
// Never a number nobody gave.

test("a chance of precipitation is shown only where the source gave one (10 % and up), never as 0", () => {
  const { svg } = draw(toronto, { size: "full" });
  const shown = parts(svg, "pop").map(words);
  // Toronto: ECCC's words give Monday, Tuesday and Thursday 30 %; every hour says 0, which is shown as nothing.
  assert.deepEqual(shown, ["30%", "30%", "30%"]);
  assert.equal(parts(svg, "precip").length, 0, "no precipitation tile from hours of 0 %");
  const none = draw({ ...toronto, hours: toronto.hours!.map(({ pop: _, ...h }) => h), days: toronto.days!.map(({ pop: _, ...d }) => d) }, { size: "full" });
  assert.equal(parts(none.svg, "pop").length, 0);
  assert.ok(!/\d\s?%/.test(none.text), "no % anywhere when none was given");
  const wet = draw({ ...toronto, hours: toronto.hours!.map((h, i) => ({ ...h, pop: i === 2 ? 60 : h.pop })) }, { size: "full" });
  assert.equal(words(parts(wet.svg, "precip")[0]!), "Precipitation 60% next 6 h");
});

test("a value the data leaves out is left out of the card", () => {
  const { svg } = draw({ place: "Willow Creek", today: "2026-11-21", days: [{ date: "2026-11-21", low_c: -4 }, { date: "2026-11-22", high_c: 3 }] });
  const rows = parts(svg, "day");
  assert.equal(rows.length, 2);
  assert.deepEqual(parts(rows[0]!, "high"), []);
  assert.deepEqual(parts(rows[1]!, "low"), []);
  assert.equal(JSON.stringify(rows[0]).includes("data-icon"), false, "no glyph without one");
  assert.deepEqual(parts(svg, "now"), []);
});

test("temperatures are rounded, with a true minus and no −0", () => {
  const { text } = draw({ place: "X", today: "2026-11-21", now: { temp_c: -0.4 }, days: [{ date: "2026-11-21", high_c: -2.6, low_c: -9.5 }] });
  assert.ok(text.includes(">0°<"), text);
  assert.ok(text.includes(">−3°<") && text.includes(">−9°<"));
  assert.ok(!text.includes("-3°") && !text.includes("−0°"));
});

// ---------------------------------------------------------------------------
// Words.

test("tomorrow's line: warmer, cooler, or tomorrow's words and high", () => {
  const day = (date: string, high_c?: number, condition?: string) => ({ date, ...(high_c !== undefined ? { high_c } : {}), ...(condition ? { condition } : {}) });
  const base = { place: "X", today: "2026-11-21" };
  assert.equal(summaryLine({ ...base, days: [day("2026-11-21", 20), day("2026-11-22", 29)] }, "en"), "Warmer tomorrow, with a high of 29°");
  assert.equal(summaryLine({ ...base, days: [day("2026-11-21", 8), day("2026-11-22", 2)] }, "en"), "Cooler tomorrow, with a high of 2°");
  assert.equal(summaryLine({ ...base, days: [day("2026-11-21"), day("2026-11-22", 14, "Sunny")] }, "en"), "Tomorrow: Sunny, high of 14°");
  assert.equal(summaryLine({ ...base, days: [day("2026-11-21", 20), day("2026-11-22", 29)] }, "fr"), "Plus chaud demain, maximum de 29°");
  assert.equal(summaryLine({ ...base, days: [day("2026-11-21"), day("2026-11-22", 14, "Ensoleillé")] }, "fr"), "Demain : ensoleillé, maximum de 14°");
  assert.equal(summaryLine({ ...base, days: [day("2026-11-21", 3)] }, "en"), null);
  assert.equal(summaryLine({ ...base, summary: "As given", days: [] }, "en"), "As given");
});

test("in French, every word of the card is French", () => {
  const { text } = draw(montreal, { size: "full", lang: "fr" });
  for (const w of ["Maint.", "Auj.", "Dim.", "Vent", "rafales 32 km/h", "Lever du soleil", "7 h 01", "Coucher 16 h 19", "17 h", "Min. 4°"]) assert.ok(text.includes(w), `no ${w}`);
  for (const w of ["Today", "Now", "Wind", "Sunrise", "Sun<", "PM", "AM"]) assert.ok(!text.includes(w), `English ${w}`);
  // The host's language when the spec doesn't say.
  const checked = validate({ component: "weather", data: montreal });
  assert.ok(checked.ok);
  const fr = render(checked.view, { width: 640, theme: theme("ava", "light"), locale: "fr" });
  assert.ok("svg" in fr && toSvgString(fr.svg).includes("Auj."));
});

test("the stale card says offline and as of when; a fresh one says neither", () => {
  const stale = draw({ ...toronto, stale: { as_of: "Sat 21 Nov, 15:30 EST", offline: true } });
  assert.equal(words(parts(stale.svg, "stale")[0]!), "Offline · as of Sat 21 Nov, 15:30 EST");
  assert.match(stale.summary, /Offline, as of Sat 21 Nov, 15:30 EST\.$/);
  assert.equal(parts(draw(toronto).svg, "stale").length, 0);
  const older = draw({ ...toronto, stale: { as_of: "Sat 21 Nov, 12:00 EST", offline: false } }, { size: "full" });
  assert.equal(words(parts(older.svg, "stale")[0]!), "As of Sat 21 Nov, 12:00 EST");
});

test("the card draws no credit and no link: the host says the source once, under it", () => {
  for (const size of ["compact", "full"]) {
    const { text } = draw({ ...toronto, stale: { as_of: "x", offline: true } }, { size });
    assert.ok(!/environ|source|edit|href|<a/i.test(text), text.slice(0, 200));
  }
});

// ---------------------------------------------------------------------------
// Size and checks.

test("the card keeps its own width in a wide column, and the column's in a narrow one", () => {
  assert.equal(draw(toronto, {}, 640).width, WEATHER_MAX_WIDTH.compact);
  assert.equal(draw(toronto, { size: "full" }, 640).width, WEATHER_MAX_WIDTH.full);
  const phone = draw(toronto, { size: "full" }, 358);
  assert.equal(phone.width, 358);
  assert.equal(parts(phone.svg, "hour").length, 5, "Now and four hours at a phone's width");
  assert.equal(parts(draw(toronto, { size: "full" }, 640).svg, "hour").length, 8);
  assert.equal(parts(draw(toronto, {}, 358).svg, "day").length, 5);
});

test("validate refuses what the schema can't say", () => {
  const v = (data: unknown) => validate({ component: "weather", data });
  const first = (data: unknown) => { const r = v(data); return r.ok ? null : r.errors[0]; };
  assert.deepEqual(first({ place: "X", today: "2026-11-21" }), WEATHER.contract.examples.invalid[1]!.error);
  assert.equal(first({ place: "X", today: "2026-11-21", days: [{ date: "2026-11-22" }, { date: "2026-11-22" }] })?.code, "order");
  assert.equal(first({ place: "X", today: "2026-02-30", days: [{ date: "2026-11-22" }] })?.code, "time");
  assert.equal(first({ place: "X", today: "2026-11-21", hours: [{ at: "2026-11-21T17:00-05:00" }, { at: "2026-11-21T16:00-05:00" }] })?.code, "order");
  assert.equal(first({ place: "X", today: "2026-11-21", days: [{ date: "2026-11-22", high_c: 2, low_c: 8 }] })?.code, "range");
  assert.equal(first({ place: "X", today: "2026-11-21", now: { temp_c: 3, icon: "sunny" } })?.code, "enum");
  assert.equal(first({ place: "X", today: "2026-11-21", days: [{ date: "2026-11-22", pop: 140 }] })?.at, "data.days[0].pop");
  assert.ok(v(toronto).ok);
});
