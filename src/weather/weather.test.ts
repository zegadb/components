// The weather card: what validate() refuses, the glyphs ECCC's codes get, that it never shows a number
// nobody gave (a chance of precipitation, a feels-like), where the chart puts night and the week's
// days, its words in both languages, and that every text holds 4.5:1 on the panel and on the night
// band of every host in both modes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, render, WEATHER, ECCC_ICONS, ecccGlyph, nightBands, WEATHER_MAX_WIDTH, type WeatherData } from "./index.ts";
import { daylightText, subLine, windText } from "./card.ts";
import { theme, HOSTS } from "../theme.ts";
import { parseTime } from "../time.ts";
import { toSvgString, type SvgNode } from "../svg.ts";
import type { Mode } from "../types.ts";

const data = (name: string) => JSON.parse(readFileSync(new URL(`../../components/weather/web/data/${name}.json`, import.meta.url), "utf8")) as WeatherData;
const toronto = data("toronto"), montreal = data("montreal-fr"), clyde = data("clyde-river");

const draw = (d: WeatherData, options: Record<string, unknown> = {}, width = 640, mode: Mode = "light") => {
  const checked = validate({ component: "weather", data: d, options });
  assert.ok(checked.ok, JSON.stringify(!checked.ok && checked.errors));
  const drawn = render(checked.view, { width, theme: theme("ava", mode), id: "t" });
  assert.ok("svg" in drawn);
  return { ...drawn, text: toSvgString(drawn.svg) };
};

/** Every node with data-part = `part`. */
const parts = (node: SvgNode, part: string): SvgNode[] => [...(node.attrs["data-part"] === part ? [node] : []), ...node.children.flatMap((c) => (typeof c === "string" ? [] : parts(c, part)))];
/** A node's words, a halo's copy left out. */
const words = (node: SvgNode): string => (node.attrs.fill === "none" && node.tag === "text" ? "" : node.children.map((c) => (typeof c === "string" ? c : words(c))).join(" ").replace(/\s+/g, " ").trim());
const num = (n: SvgNode, k: string) => Number(n.attrs[k]);

// ---------------------------------------------------------------------------
// Contrast: every text on the panel and on the night band, both modes, every host.

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]) => { const l = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** Every text drawn on a card (a halo's copy is not text), with its own size, weight and colour. */
const textsOf = (node: SvgNode, inherited: { size: number; weight: number; fill: string } | null = null): { s: string; size: number; weight: number; fill: string; opacity: number }[] => {
  if (node.tag !== "text" && node.tag !== "tspan") return node.children.flatMap((c) => (typeof c === "string" ? [] : textsOf(c)));
  const own = { size: Number(node.attrs["font-size"] ?? inherited?.size), weight: Number(node.attrs["font-weight"] ?? inherited?.weight ?? 400), fill: String(node.attrs.fill ?? inherited?.fill) };
  if (own.fill === "none") return [];
  const direct = node.children.filter((c): c is string => typeof c === "string").join("").trim();
  return [...(direct ? [{ s: direct, ...own, opacity: Number(node.attrs["fill-opacity"] ?? 1) }] : []), ...node.children.flatMap((c) => (typeof c === "string" ? [] : textsOf(c, own)))];
};

test("every text holds 4.5:1 (3:1 when large) on the panel and on the night band: every host, mode, size and width", () => {
  let checked = 0;
  for (const host of HOSTS) for (const mode of ["light", "dark"] as const) {
    const t = theme(host, mode);
    for (const size of ["compact", "full"]) for (const width of [300, 358, 640]) for (const [d, lang] of [[toronto, "en"], [montreal, "fr"], [clyde, "en"]] as const) {
      const card = { ...d, stale: { as_of: "Sat 21 Nov, 15:45 EST", offline: true } };
      const v = validate({ component: "weather", data: card, options: { size, lang } });
      assert.ok(v.ok);
      const drawn = render(v.view, { width, theme: t, id: "c" });
      assert.ok("svg" in drawn);
      assert.equal(parts(drawn.svg, "panel")[0]!.attrs.fill, t.panel, "the card is the theme's panel");
      for (const x of textsOf(drawn.svg)) {
        assert.equal(x.opacity, 1, `"${x.s}" is drawn at full opacity`);
        // WCAG's large text: 24 pt, or 18.66 pt bold.
        const need = x.size >= 24 || (x.size >= 18.66 && x.weight >= 600) ? 3 : 4.5;
        for (const [ground, colour] of [["panel", t.panel], ["night", t.weather.night]] as const) {
          const r = ratio(x.fill, colour);
          assert.ok(r >= need, `${host} ${mode} ${size} ${width}: "${x.s}" (${x.size} pt, ${x.fill}) on the ${ground} ${colour} at ${r.toFixed(2)}:1, needs ${need}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 3_000, `${checked} checks`);
});

test("the card draws no sky: no gradient behind it, no white text, no colour ramp", () => {
  for (const mode of ["light", "dark"] as const) for (const size of ["compact", "full"]) {
    const { svg, text } = draw(clyde, { size }, 640, mode);
    const t = theme("ava", mode);
    const fills = new Set(textsOf(svg).map((x) => x.fill));
    for (const f of fills) assert.ok([t.ink, t.soft, t.weather.pop].includes(f), `${mode} ${size}: a text in ${f}`);
    // The only gradient is the line's wash, in the accent; none here (Clyde River has a feels-like, so two lines and no wash).
    assert.ok(!text.includes("linearGradient"), "no gradient");
  }
  const { text } = draw(toronto, { size: "full" });
  assert.equal((text.match(/<linearGradient/g) ?? []).length, 1, "one gradient: the line's wash");
  assert.match(text, /stop-color="#6646EE" stop-opacity="0.18"/);
});

// ---------------------------------------------------------------------------
// Glyphs: ECCC's codes and words, in one table; our own line drawings.

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

test("the glyphs are line drawings: ink shapes, accent for what falls, the sun in its own colour, clouds filled with the panel", () => {
  for (const mode of ["light", "dark"] as const) {
    const t = theme("ava", mode);
    const { svg } = draw({ place: "X", today: "2026-11-21", days: [
      { date: "2026-11-21", low_c: 1, icon: "snow" }, { date: "2026-11-22", high_c: 4, low_c: 1, icon: "showers" }, { date: "2026-11-23", high_c: 4, low_c: 1, icon: "clear" },
    ] }, { size: "full" }, 640, mode);
    const all = (n: SvgNode): SvgNode[] => [n, ...n.children.flatMap((c) => (typeof c === "string" ? [] : all(c)))];
    const glyphs = all(svg).filter((n) => n.attrs["data-icon"]);
    const of = (kind: string) => all(glyphs.find((g) => g.attrs["data-icon"] === kind)!);
    const strokes = (nodes: SvgNode[], glyph: string) => nodes.filter((n) => n.attrs["data-glyph"] === glyph).map((n) => n.attrs.stroke);
    assert.deepEqual([...new Set(strokes(of("snow"), "cloud"))], [t.ink]);
    assert.deepEqual([...new Set(of("snow").filter((n) => n.attrs["data-glyph"] === "cloud").map((n) => n.attrs.fill))], [t.panel], "a cloud hides what's behind it");
    assert.deepEqual([...new Set(strokes(of("snow"), "flake"))], [t.accent]);
    assert.deepEqual([...new Set(strokes(of("showers"), "drop"))], [t.accent]);
    const sun = of("clear").filter((n) => n.tag === "circle" || n.tag === "line");
    assert.ok(sun.length === 9 && sun.every((c) => c.attrs.stroke === t.weather.sun), "the sun is a ring and eight rays in the sun's colour");
    assert.ok(sun.filter((c) => c.tag === "circle").every((c) => c.attrs.fill === "none"), "a ring, not a disc");
  }
});

// ---------------------------------------------------------------------------
// The chart.

const chartOf = (svg: SvgNode) => {
  const c = parts(svg, "chart")[0]!;
  const [t0, t1, x0, x1] = ["data-t0", "data-t1", "data-x0", "data-x1"].map((k) => num(c, k)) as [number, number, number, number];
  return { node: c, x: (t: number) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0), t0, t1 };
};

test("night is shaded from sunset to the next sunrise, where those fall on the chart", () => {
  // Toronto from 4 PM: night from 4:47 PM to 7:19 AM, the next sunrise a day after today's.
  const { svg } = draw(toronto, { size: "full" });
  const ch = chartOf(svg);
  const bands = parts(svg, "night");
  assert.equal(bands.length, 1);
  const set = parseTime(toronto.sun!.set!), rise = parseTime(toronto.sun!.rise!) + 86_400_000;
  assert.ok(Math.abs(num(bands[0]!, "x") - ch.x(set)) < 0.02, "starts at sunset");
  assert.ok(Math.abs(num(bands[0]!, "x") + num(bands[0]!, "width") - ch.x(rise)) < 0.02, "ends at the next sunrise");
  // Clyde River (1 h 38 min of daylight) from 4 PM: night until 10:28 AM, day until 12:06 PM, night again to the chart's end.
  const c = draw(clyde, { size: "full" });
  const cc = chartOf(c.svg);
  const cb = parts(c.svg, "night");
  assert.equal(cb.length, 2);
  const crise = parseTime(clyde.sun!.rise!) + 86_400_000, cset = parseTime(clyde.sun!.set!) + 86_400_000;
  assert.ok(Math.abs(num(cb[0]!, "x") - cc.x(cc.t0)) < 0.02, "night from the chart's start");
  assert.ok(Math.abs(num(cb[0]!, "x") + num(cb[0]!, "width") - cc.x(crise)) < 0.02, "to tomorrow's sunrise");
  assert.ok(Math.abs(num(cb[1]!, "x") - cc.x(cset)) < 0.02, "from tomorrow's sunset");
  assert.ok(Math.abs(num(cb[1]!, "x") + num(cb[1]!, "width") - cc.x(cc.t1)) < 0.02, "to the chart's end");
  // One label over a short day: both times.
  assert.equal(words(parts(c.svg, "sun-label")[0]!), "10:28 AM 12:06 PM");
  // Tomorrow's sunrise, when the source gives it, ends tonight instead of today's a day later.
  const next = "2026-11-22T07:21-05:00";
  const n = draw({ ...toronto, sun: { ...toronto.sun, next_rise: next } }, { size: "full" });
  const nb = parts(n.svg, "night")[0]!;
  assert.ok(Math.abs(num(nb, "x") + num(nb, "width") - chartOf(n.svg).x(parseTime(next))) < 0.02);
  // No sunrise and sunset, no night drawn: nothing is made up.
  const { sun: _, ...noSun } = toronto;
  assert.equal(parts(draw(noSun, { size: "full" }).svg, "night").length, 0);
  assert.deepEqual(nightBands(undefined, 0, 1), []);
});

test("the chance of precipitation is a bar only for the hours the source gave one (10 % and up), never a 0", () => {
  // Toronto: every hour's chance is ECCC's 0: no bars, no % in the chart.
  const t = draw(toronto, { size: "full" });
  assert.equal(parts(t.svg, "pop-bar").length, 0);
  assert.ok(!/\d\s?%/.test(toSvgString(parts(t.svg, "chart")[0]!)), "no % on the chart");
  // Clyde River: a bar at each hour ECCC gave 10 % or more, exactly those.
  const given = clyde.hours!.filter((h) => typeof h.pop === "number" && h.pop >= 10).map((h) => h.at);
  assert.ok(given.length > 0 && given.length < clyde.hours!.length, "some hours, not all");
  const c = draw(clyde, { size: "full" });
  assert.deepEqual(parts(c.svg, "pop-bar").map((b) => b.attrs["data-at"]), given);
  const ch = chartOf(c.svg);
  for (const b of parts(c.svg, "pop-bar")) assert.ok(Math.abs(num(b, "x") + 1.5 - ch.x(parseTime(String(b.attrs["data-at"])))) < 0.02, "at its hour");
  // The highest, once.
  assert.deepEqual(parts(c.svg, "pop").filter((p) => parts(p, "pop").length === 1 && p.tag === "g").map(words), [`${Math.max(...clyde.hours!.map((h) => h.pop ?? 0))}%`]);
  // Leave out the chances of the first six hours: those hours get no bar, the rest keep theirs.
  const fewer = { ...clyde, hours: clyde.hours!.map((h, i) => (i < 6 ? (({ pop: _, ...rest }) => rest)(h) : h)) };
  assert.deepEqual(parts(draw(fewer, { size: "full" }).svg, "pop-bar").map((b) => b.attrs["data-at"]), given.filter((at) => clyde.hours!.findIndex((h) => h.at === at) >= 6));
  // And none at all: no bars, no % anywhere.
  const none = draw({ ...clyde, hours: clyde.hours!.map(({ pop: _, ...h }) => h), days: clyde.days!.map(({ pop: _, ...d }) => d) }, { size: "full" });
  assert.equal(parts(none.svg, "pop-bar").length, 0);
  assert.ok(!/\d\s?%/.test(none.text), "no % anywhere when none was given");
  // The days' chances: Toronto's Monday, Tuesday and Thursday 30 % from ECCC's words; the others none.
  assert.deepEqual(parts(t.svg, "week").flatMap((w) => parts(w, "pop")).map(words), ["30%", "30%", "30%"]);
});

test("what it feels like is drawn only when the source gives it: the hero, the second line and the gap", () => {
  // Toronto at 10 °C: no wind chill. The air leads, one line over a wash.
  const t = draw(toronto, { size: "full" });
  assert.equal(words(parts(t.svg, "now")[0]!), "10°");
  for (const p of ["feels", "feels-label", "feels-line", "gap", "feels-name"]) assert.equal(parts(t.svg, p).length, 0, `no ${p}`);
  assert.equal(parts(t.svg, "wash").length, 1);
  // Clyde River: "Feels like −21°" leads, "Air −9°" under it; the chart has both lines and the gap filled.
  const c = draw(clyde, { size: "full" });
  assert.equal(words(parts(c.svg, "feels-label")[0]!), "Feels like");
  assert.equal(words(parts(c.svg, "feels")[0]!), "−21°");
  assert.equal(words(parts(c.svg, "air")[0]!), "Air −9°");
  assert.equal(parts(c.svg, "feels-line").length, 1);
  assert.equal(parts(c.svg, "gap").length, 1);
  assert.equal(parts(c.svg, "wash").length, 0);
  // Feels-like for only the last hours: the line starts at the first of them.
  const later = { ...clyde, hours: clyde.hours!.map((h, i) => (i < 10 ? (({ feels_c: _, ...rest }) => rest)(h) : h)) };
  const l = draw(later, { size: "full" });
  const start = Number(/^M([\d.]+)/.exec(String(parts(l.svg, "feels-line")[0]!.attrs.d))![1]);
  assert.ok(Math.abs(start - chartOf(l.svg).x(parseTime(clyde.hours![10]!.at))) < 0.02, "from the 11th hour");
  // None in the hours, none now: one line, the air leading.
  const none = draw({ ...clyde, now: (({ feels_c: _, ...n }) => n)(clyde.now!), hours: clyde.hours!.map(({ feels_c: _, ...h }) => h) }, { size: "full" });
  for (const p of ["feels", "feels-line", "gap"]) assert.equal(parts(none.svg, p).length, 0, `no ${p}`);
  assert.equal(words(parts(none.svg, "now")[0]!), "−9°");
});

test("the chart marks the next hours' lowest and highest at their hours", () => {
  for (const d of [toronto, clyde]) {
    const { svg } = draw(d, { size: "full" });
    const ch = chartOf(svg);
    const temps = d.hours!.map((h) => h.temp_c!);
    const hi = Math.max(...temps), lo = Math.min(...temps);
    const max = parts(svg, "max")[0]!, min = parts(svg, "min")[0]!;
    assert.ok(Math.abs(num(max, "cx") - ch.x(parseTime(d.hours![temps.indexOf(hi)]!.at))) < 0.02);
    assert.ok(Math.abs(num(min, "cx") - ch.x(parseTime(d.hours![temps.lastIndexOf(lo)]!.at))) < 0.02);
    assert.ok(num(max, "cy") < num(min, "cy"), "the highest above the lowest");
    assert.equal(words(parts(svg, "max-label")[0]!), `${Math.round(hi)}°`.replace("-", "−"));
    assert.equal(words(parts(svg, "min-label")[0]!), `${Math.round(lo)}°`.replace("-", "−"));
  }
});

// ---------------------------------------------------------------------------
// The days.

test("the full card's days share one scale for the week: the night's low a ring, the day's high a dot", () => {
  const { svg } = draw(toronto, { size: "full" });
  const week = parts(svg, "week")[0]!;
  const [lo, hi, x0, x1] = ["data-lo", "data-hi", "data-x0", "data-x1"].map((k) => num(week, k)) as [number, number, number, number];
  const days = toronto.days!.slice(0, 6);
  const temps = days.flatMap((d) => [d.low_c, d.high_c]).filter((t): t is number => t !== undefined);
  assert.deepEqual([lo, hi], [Math.min(...temps), Math.max(...temps)]);
  const at = (t: number) => x0 + ((t - lo) / (hi - lo)) * (x1 - x0);
  const rows = parts(svg, "day");
  assert.equal(rows.length, days.length);
  rows.forEach((r, i) => {
    const d = days[i]!;
    const ring = parts(r, "low-dot")[0], dot = parts(r, "high-dot")[0];
    if (d.low_c !== undefined) { assert.ok(Math.abs(num(ring!, "cx") - at(d.low_c)) < 0.02, `${d.date}: its low`); assert.equal(ring!.attrs.fill, theme("ava", "light").panel, "a hollow ring"); }
    else assert.equal(ring, undefined);
    if (d.high_c !== undefined) assert.ok(Math.abs(num(dot!, "cx") - at(d.high_c)) < 0.02, `${d.date}: its high`);
    else assert.equal(dot, undefined, `${d.date}: no high, no dot`);
    const track = parts(r, "track")[0]!;
    assert.deepEqual([num(track, "x1"), num(track, "x2")], [x0, x1], "one track for the week");
  });
  // The week's coldest and warmest reach the scale's ends.
  const xs = rows.flatMap((r) => [...parts(r, "low-dot"), ...parts(r, "high-dot")].map((c) => num(c, "cx")));
  assert.ok(Math.abs(Math.min(...xs) - x0) < 0.02 && Math.abs(Math.max(...xs) - x1) < 0.02);
  assert.equal(words(parts(rows[0]!, "day-name")[0]!), "Tonight", "today with only its night left");
});

test("compact: the next 12 hours as a chart and up to four days as tiles, stacked two by two in a narrow column", () => {
  const wide = draw(toronto, {}, 640);
  assert.equal(wide.width, WEATHER_MAX_WIDTH.compact);
  assert.equal(parts(wide.svg, "chart").length, 1);
  const ch = chartOf(wide.svg);
  assert.equal(Math.round((ch.t1 - ch.t0) / 3_600_000), 12, "12 hours");
  assert.equal(parts(wide.svg, "day").length, 4);
  assert.equal(parts(wide.svg, "week").length, 0, "no week scale in compact");
  assert.deepEqual(parts(wide.svg, "day").map((d) => d.attrs["data-date"]), toronto.days!.filter((d) => d.date > toronto.today).slice(0, 4).map((d) => d.date), "the days after today");
  const phone = draw(toronto, {}, 330);
  assert.equal(parts(phone.svg, "day").length, 3, "three across a phone's bubble");
  const tops = (svg: SvgNode) => [...new Set(parts(svg, "tile").map((t) => num(t, "y")))];
  assert.equal(tops(phone.svg).length, 1, "in one row");
  const narrow = draw(toronto, {}, 230);
  assert.equal(parts(narrow.svg, "day").length, 4);
  assert.equal(tops(narrow.svg).length, 2, "two rows of two");
});

// ---------------------------------------------------------------------------
// Never a number nobody gave; words.

test("a value the data leaves out is left out of the card", () => {
  const { svg } = draw({ place: "Willow Creek", today: "2026-11-21", days: [{ date: "2026-11-21", low_c: -4 }, { date: "2026-11-22", high_c: 3 }] }, { size: "full" });
  const rows = parts(svg, "day");
  assert.equal(rows.length, 2);
  assert.deepEqual(parts(rows[0]!, "high"), []);
  assert.deepEqual(parts(rows[1]!, "low"), []);
  assert.equal(JSON.stringify(rows[0]).includes("data-icon"), false, "no glyph without one");
  assert.deepEqual(parts(svg, "now"), []);
  assert.deepEqual(parts(svg, "chart"), [], "no hours, no chart");
  for (const p of ["wind", "sunrise", "sunset", "daylight"]) assert.deepEqual(parts(svg, p), [], `no ${p}`);
});

test("the footer: wind, sunrise, sunset and daylight, each only when given", () => {
  const { svg } = draw(clyde, { size: "full" });
  assert.equal(words(parts(svg, "wind")[0]!), "Wind NW 59 km/h, gusts 72");
  assert.equal(words(parts(svg, "sunrise")[0]!), "Sunrise 10:28 AM");
  assert.equal(words(parts(svg, "sunset")[0]!), "Sunset 12:06 PM");
  assert.equal(words(parts(svg, "daylight")[0]!), "Daylight 1 h 38 min");
  assert.equal(daylightText({ rise: "2026-11-21T07:19-05:00" }, "en"), null, "no sunset, no daylight");
  assert.equal(daylightText({ rise: "2026-11-21T07:01-05:00", set: "2026-11-21T16:19-05:00" }, "fr"), "Durée du jour 9 h 18");
  assert.equal(windText({ speed_kmh: 0 }, "en"), "Wind calm");
  assert.equal(windText({ speed_kmh: 15, dir: "O" }, "fr"), "Vent O 15 km/h");
  const { now: _, ...noNow } = clyde;
  assert.equal(parts(draw(noNow, { size: "full" }).svg, "wind").length, 0);
});

test("temperatures are rounded, with a true minus and no −0", () => {
  const { text } = draw({ place: "X", today: "2026-11-21", now: { temp_c: -0.4 }, days: [{ date: "2026-11-21", high_c: -2.6, low_c: -9.5 }] }, { size: "full" });
  assert.ok(text.includes(">0°<"), text);
  assert.ok(text.includes(">−3°<") && text.includes(">−9°<"));
  assert.ok(!text.includes("-3°") && !text.includes("−0°"));
});

test("in French, every word of the card is French", () => {
  const { text } = draw(montreal, { size: "full", lang: "fr" });
  for (const w of ["Cette nuit", "Dim.", "Vent N 2 km/h, rafales 32", "Lever 7 h 01", "Coucher 16 h 19", "Durée du jour 9 h 18", ">19 h<","Cette nuit min. 4°", "PROCHAINES 24 HEURES"]) assert.ok(text.includes(w), `no ${w}`);
  for (const w of ["Today", "Tonight", "Wind", "Sunrise", "Sun<", "PM", "AM", "Next", "Daylight"]) assert.ok(!text.includes(w), `English ${w}`);
  // The host's language when the spec doesn't say.
  const checked = validate({ component: "weather", data: montreal });
  assert.ok(checked.ok);
  const fr = render(checked.view, { width: 640, theme: theme("ava", "light"), locale: "fr" });
  assert.ok("svg" in fr && toSvgString(fr.svg).includes("Cette nuit min."));
});

test("the header's line: tonight's low once the day is over, else today's high and low", () => {
  assert.equal(words(parts(draw(toronto, { size: "full" }).svg, "sub")[0]!), "Tonight low 5°");
  assert.equal(subLine({ ...toronto, days: [{ date: toronto.today, high_c: 8, low_c: -1 }] }, "en"), "High 8° · Low −1°");
  assert.equal(subLine(montreal, "fr"), "Cette nuit min. 4°");
  assert.equal(subLine({ ...montreal, days: [{ date: montreal.today, high_c: 3, low_c: -4 }] }, "fr"), "Max. 3° · min. −4°");
  assert.equal(subLine({ ...toronto, days: [] }, "en"), null);
});

test("the stale card says offline and as of when; a fresh one says neither", () => {
  const stale = draw({ ...toronto, stale: { as_of: "Sat 21 Nov, 15:30 EST", offline: true } });
  assert.equal(words(parts(stale.svg, "stale")[0]!), "Offline · as of Sat 21 Nov, 15:30 EST");
  // In the header, under the place.
  const y = (n: SvgNode) => Number(JSON.stringify(n).match(/"y":([\d.]+)/)![1]);
  assert.ok(y(parts(stale.svg, "stale")[0]!) > y(parts(stale.svg, "place")[0]!));
  assert.ok(y(parts(stale.svg, "stale")[0]!) < y(parts(stale.svg, "chart")[0]!));
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
  // Hours ticked every 6 under 380 pt, every 3 above.
  assert.equal(parts(phone.svg, "hour").length, 4);
  assert.equal(parts(draw(toronto, { size: "full" }, 640).svg, "hour").length, 8);
});

test("validate refuses what the schema can't say", () => {
  const v = (d: unknown) => validate({ component: "weather", data: d });
  const first = (d: unknown) => { const r = v(d); return r.ok ? null : r.errors[0]; };
  assert.deepEqual(first({ place: "X", today: "2026-11-21" }), WEATHER.contract.examples.invalid[1]!.error);
  assert.equal(first({ place: "X", today: "2026-11-21", days: [{ date: "2026-11-22" }, { date: "2026-11-22" }] })?.code, "order");
  assert.equal(first({ place: "X", today: "2026-02-30", days: [{ date: "2026-11-22" }] })?.code, "time");
  assert.equal(first({ place: "X", today: "2026-11-21", hours: [{ at: "2026-11-21T17:00-05:00" }, { at: "2026-11-21T16:00-05:00" }] })?.code, "order");
  assert.equal(first({ place: "X", today: "2026-11-21", days: [{ date: "2026-11-22", high_c: 2, low_c: 8 }] })?.code, "range");
  assert.equal(first({ place: "X", today: "2026-11-21", now: { temp_c: 3, icon: "sunny" } })?.code, "enum");
  assert.equal(first({ place: "X", today: "2026-11-21", days: [{ date: "2026-11-22", pop: 140 }] })?.at, "data.days[0].pop");
  assert.equal(first({ place: "X", today: "2026-11-21", now: { temp_c: 3, wind: "NW 10 km/h" } })?.at, "data.now.wind", "the wind is structured, not words");
  assert.equal(first({ place: "X", today: "2026-11-21", now: { temp_c: 3, wind: { speed_kmh: 30, gust_kmh: 20 } } })?.code, "range");
  assert.equal(first({ place: "X", today: "2026-11-21", hours: Array.from({ length: 25 }, (_, i) => ({ at: `2026-11-2${1 + Math.floor((i + 16) / 24)}T${String((i + 16) % 24).padStart(2, "0")}:00-05:00` })) })?.at, "data.hours");
  assert.ok(v(toronto).ok && v(clyde).ok && v(montreal).ok);
});
