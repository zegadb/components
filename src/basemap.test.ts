import { test } from "node:test";
import assert from "node:assert/strict";
import { AVA_BASEMAP, BASEMAP_SOURCE, basemapStyle, creditHtml } from "./basemap.ts";
import { theme } from "./theme.ts";

test("ava's basemap reads ava's tiles host, and only it", () => {
  for (const mode of ["light", "dark"] as const) {
    const s = basemapStyle("ava", mode);
    const source = s.sources[BASEMAP_SOURCE];
    assert.ok(source && source.type === "vector");
    assert.deepEqual(source.tiles, ["https://tiles.addis.gg/world/{z}/{x}/{y}.mvt"]);
    assert.equal(source.maxzoom, 15);
    assert.equal(s.glyphs, "https://tiles.addis.gg/fonts/{fontstack}/{range}.pbf");
    assert.equal(s.sprite, `https://tiles.addis.gg/sprites/v4/${mode}`);
    // Every URL in the style is on the one origin a host's CSP allows.
    const urls = JSON.stringify(s).match(/https?:\/\/[^"/]+/g) ?? [];
    assert.ok(urls.length >= 3);
    for (const u of urls) assert.equal(u, AVA_BASEMAP.origin);
  }
});

test("the street map is drawn: land, water, roads and labels, all from the basemap source", () => {
  const s = basemapStyle("ava", "light");
  const ids = s.layers.map((l) => l.id);
  for (const id of ["background", "water", "roads_minor", "roads_highway", "places_locality"]) assert.ok(ids.includes(id), `${id} in ${ids.join(",")}`);
  for (const l of s.layers) if (l.type !== "background") assert.equal((l as { source: string }).source, BASEMAP_SOURCE, l.id);
  // Labels in the page's language.
  assert.match(JSON.stringify(basemapStyle("ava", "light", "fr").layers.find((l) => l.id === "places_locality")), /name:fr/);
});

test("in the Quiet palette, light and dark: the ground is ava's theme's, the water its own blue", () => {
  for (const mode of ["light", "dark"] as const) {
    const s = basemapStyle("ava", mode);
    const bg = s.layers.find((l) => l.type === "background");
    assert.equal((bg?.paint as Record<string, unknown>)["background-color"], theme("ava", mode).ground);
    const water = s.layers.find((l) => l.id === "water");
    assert.equal((water?.paint as Record<string, unknown>)["fill-color"], AVA_BASEMAP.palette[mode].water);
  }
  assert.notEqual(AVA_BASEMAP.palette.light.water, AVA_BASEMAP.palette.dark.water);
});

test("the credit: Protomaps and OpenStreetMap's copyright page, no edit link", () => {
  assert.equal(
    creditHtml(AVA_BASEMAP.credit.en),
    '<a href="https://protomaps.com" rel="noreferrer">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap contributors</a>',
  );
  for (const parts of Object.values(AVA_BASEMAP.credit)) for (const p of parts) if (typeof p !== "string") assert.doesNotMatch(p.href, /edit|fixthemap/i);
});
