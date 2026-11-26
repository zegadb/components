import { test } from "node:test";
import assert from "node:assert/strict";
import { featureFilter, latest, normalizePropertyExpression, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { layers } from "@protomaps/basemaps";
import { AERIAL_CANADA, AVA_BASEMAP, AVA_IMAGERY, BASEMAP_SOURCE, basemapFlavor, basemapStyle, creditHtml, ESA_WORLDCOVER_2021, IMAGERY_LAYERS, IMAGERY_MAX_ZOOM, IMAGERY_OVERLAY_CAP, IMAGERY_SOURCES, MAP_TYPE_STATE, OCEAN_EDGE, OVER_IMAGERY, withImagery } from "./basemap.ts";
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
  for (const l of s.layers) if (l.type !== "background" && l.type !== "raster") assert.equal((l as { source: string }).source, BASEMAP_SOURCE, l.id);
  // Labels in the page's language.
  assert.match(JSON.stringify(basemapStyle("ava", "light", "fr").layers.find((l) => l.id === "places_locality")), /name:fr/);
});

test("in the Quiet palette, light and dark: the ground is ava's theme's, the water its own blue", () => {
  for (const mode of ["light", "dark"] as const) {
    const s = basemapStyle("ava", mode);
    assert.equal(paintAt("background", "background-color", 10, "map", mode), rgbaOf(theme("ava", mode).ground));
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

/**
 * A paint property's value on the drawn map: MapLibre's own expression evaluator, at a zoom, with
 * the map type the switch set (the style's global state).
 */
function paintAt(layerId: string, property: string, zoom: number, mapType: "map" | "satellite", mode: "light" | "dark" = "light", plain = false): string | number {
  // plain: the street map alone, as it was before it had imagery.
  const style = plain ? { ...basemapStyle("ava", mode), layers: layers(BASEMAP_SOURCE, basemapFlavor(AVA_BASEMAP, mode), { lang: "en" }) } : basemapStyle("ava", mode);
  const layer = style.layers.find((l) => l.id === layerId) as { type: string; paint?: Record<string, unknown> };
  const spec = (latest as unknown as Record<string, Record<string, unknown>>)[`paint_${layer.type}`]![property];
  const value = layer.paint?.[property] ?? (spec as { default: unknown }).default;
  const e = normalizePropertyExpression(value as never, "paint", spec as never, { [MAP_TYPE_STATE]: mapType });
  const out = e.evaluate({ zoom, globalState: { [MAP_TYPE_STATE]: mapType } } as never, { type: 2, properties: { kind: "major_road", min_zoom: 0 } } as never) as unknown;
  return typeof out === "number" ? out : String(out).replace(/\s/g, "");
}
const rgba = (s: string) => s.replace(/\s/g, "");
/** "#RRGGBB" as MapLibre's evaluator prints it. */
const rgbaOf = (hex: string) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},1)`;

test("satellite: the imagery is ava's tiles host's, the base everywhere to z10 and the detail over Canada to z13", () => {
  const s = basemapStyle("ava", "light", "en", "satellite");
  const base = s.sources[IMAGERY_SOURCES.base];
  const detail = s.sources[IMAGERY_SOURCES.detail];
  assert.ok(base && base.type === "raster" && detail && detail.type === "raster");
  assert.deepEqual(base.tiles, ["https://tiles.addis.gg/satellite/{z}/{x}/{y}.webp"]);
  assert.deepEqual(detail.tiles, base.tiles, "one archive, read at two depths");
  assert.equal(base.tileSize, 256);
  assert.equal(base.maxzoom, 10);
  assert.deepEqual([detail.minzoom, detail.maxzoom], [11, 13]);
  assert.deepEqual(detail.bounds, [-141.01, 41.67, -52.61, 83.12], "Canada's box: no detail tile is asked for outside it");
  for (const u of JSON.stringify(s).match(/https?:\/\/[^"/]+/g) ?? []) assert.equal(u, AVA_BASEMAP.origin);
});

test("satellite: the imagery is under every road and name, over the land; hidden (nothing fetched) on the street map", () => {
  for (const mapType of ["map", "satellite"] as const) {
    const s = basemapStyle("ava", "dark", "en", mapType);
    const ids = s.layers.map((l) => l.id);
    const at = ids.indexOf(IMAGERY_LAYERS.base);
    assert.equal(ids[at + 1], IMAGERY_LAYERS.detail, "the detail over the base");
    assert.equal(ids[at + 2], IMAGERY_LAYERS.overlay, "the aerial overlay over both");
    assert.ok(at > ids.indexOf("earth") && at > ids.indexOf("landcover"));
    s.layers.forEach((l, n) => { if (l.type === "line" || l.type === "symbol") assert.ok(n > at, `${l.id} over the imagery`); });
    for (const id of Object.values(IMAGERY_LAYERS)) assert.equal((s.layers.find((l) => l.id === id)!.layout as { visibility: string }).visibility, mapType === "satellite" ? "visible" : "none");
    for (const id of Object.values(IMAGERY_LAYERS)) {
      const l = s.layers.find((x) => x.id === id)!;
      assert.equal(l.maxzoom, undefined, "never cut by zoom: the map's own zoom is capped instead (setMapType)");
      // Never faded out; the overlay only fades in, over the half zoom before its first tiles.
      if (id !== IMAGERY_LAYERS.overlay) assert.equal((l.paint as Record<string, unknown>)["raster-opacity"], undefined, "never faded out");
    }
    assert.equal((s.metadata as Record<string, unknown>)[IMAGERY_MAX_ZOOM], 13, "how close the map may go while it shows: its crisp limit");
    assert.equal(ESA_WORLDCOVER_2021.maxViewZoom, 13);
    assert.deepEqual(validateStyleMin(s as never), [], "valid MapLibre");
    assert.deepEqual(s.state, { [MAP_TYPE_STATE]: { default: mapType } });
  }
});

test("satellite: roads white and names white on dark over the imagery at every zoom; water cleared; the street map untouched", () => {
  for (const mode of ["light", "dark"] as const) {
    // On the street map nothing changed, at any zoom, from the street map without imagery.
    for (const zoom of [8, 12, 14, 16, 18]) {
      for (const [id, prop] of [["water", "fill-opacity"], ["roads_highway", "line-color"], ["roads_minor", "line-color"], ["places_locality", "text-color"], ["background", "background-color"]] as const) {
        assert.equal(paintAt(id, prop, zoom, "map", mode), paintAt(id, prop, zoom, "map", mode, true), `${id} ${prop} at z${zoom}`);
      }
    }
    assert.notEqual(paintAt("roads_highway", "line-color", 12, "map", mode), rgba(OVER_IMAGERY.bigRoad));
    // Over the imagery, at every zoom (it is overzoomed past z13, never swapped for the street map).
    for (const zoom of [5, 12, 13, 14, 15, 17]) {
      assert.equal(paintAt("roads_highway", "line-color", zoom, "satellite", mode), rgba(OVER_IMAGERY.bigRoad), `z${zoom}`);
      assert.equal(paintAt("roads_minor", "line-color", zoom, "satellite", mode), rgba(OVER_IMAGERY.road), `roads_minor (a zoom curve) z${zoom}`);
      assert.equal(paintAt("places_locality", "text-color", zoom, "satellite", mode), "rgba(255,255,255,1)");
      assert.equal(paintAt("places_locality", "text-halo-color", zoom, "satellite", mode), rgba(OVER_IMAGERY.halo));
      assert.equal(paintAt("water", "fill-opacity", zoom, "satellite", mode), 0);
      // Where there is no imagery (open sea), a deep sea, not the street map's light ground.
      assert.equal(paintAt("background", "background-color", zoom, "satellite", mode), "rgba(11,22,33,1)");
    }
    assert.notEqual(paintAt("background", "background-color", 5, "map", mode), "rgba(11,22,33,1)");
  }
});

test("satellite in a host's own style (withImagery): its layers on top stay as they are, and adding it twice adds it once", () => {
  // A host's street map without imagery (as ava-web's mapStyle builds it), and a marker of its own on top.
  const street = { version: 8 as const, sources: { [BASEMAP_SOURCE]: { type: "vector" as const, tiles: [AVA_BASEMAP.tiles] } }, layers: layers(BASEMAP_SOURCE, basemapFlavor(AVA_BASEMAP, "light"), { lang: "en" }) };
  assert.equal(street.layers.filter((l) => l.type === "raster").length, 0);
  const marker = { id: "place", type: "circle" as const, source: "place", paint: { "circle-color": "#5B4BDB" } };
  const own = { ...street, sources: { ...street.sources, place: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } } }, layers: [...street.layers, marker] };
  const s = withImagery(own, AVA_IMAGERY, "satellite");
  assert.deepEqual(s.layers.at(-1), marker);
  assert.equal(s.layers.filter((l) => l.type === "raster").length, 3, "the base, the detail and the aerial overlay");
  assert.equal(withImagery(s, AVA_IMAGERY, "satellite").layers.filter((l) => l.type === "raster").length, 3);
  assert.equal(basemapStyle("ava", "light", "en", "satellite").layers.length, s.layers.length - 1);
  // The ESA imagery alone (no overlay): two, and no overlay source.
  const esa = withImagery(own, ESA_WORLDCOVER_2021, "satellite");
  assert.equal(esa.layers.filter((l) => l.type === "raster").length, 2);
  assert.equal(esa.sources[IMAGERY_SOURCES.overlay], undefined);
  assert.equal((esa.metadata as Record<string, unknown>)[IMAGERY_OVERLAY_CAP], undefined);
});

test("satellite: the ocean is drawn over the imagery in the deep sea, feathered; lakes and rivers stay imagery", () => {
  for (const mapType of ["map", "satellite"] as const) {
    const s = basemapStyle("ava", "light", "en", mapType);
    const ids = s.layers.map((l) => l.id);
    const fill = s.layers.find((l) => l.id === IMAGERY_LAYERS.ocean) as { type: string; source: string; "source-layer": string; filter: unknown; layout: { visibility: string }; paint: Record<string, unknown> };
    const edge = s.layers.find((l) => l.id === IMAGERY_LAYERS.oceanEdge) as typeof fill;
    assert.equal(fill.type, "fill");
    assert.equal(edge.type, "line");
    // Over both imagery layers, under the first road or name.
    assert.ok(ids.indexOf(IMAGERY_LAYERS.ocean) > ids.indexOf(IMAGERY_LAYERS.detail));
    assert.equal(ids.indexOf(IMAGERY_LAYERS.oceanEdge), ids.indexOf(IMAGERY_LAYERS.ocean) + 1);
    const firstStreet = s.layers.findIndex((l, n) => n > ids.indexOf(IMAGERY_LAYERS.oceanEdge) && (l.type === "line" || l.type === "symbol"));
    assert.ok(firstStreet > ids.indexOf(IMAGERY_LAYERS.oceanEdge));
    for (const l of [fill, edge]) {
      assert.deepEqual([l.source, l["source-layer"]], [BASEMAP_SOURCE, "water"], "the street map's own water");
      assert.equal(l.layout.visibility, mapType === "satellite" ? "visible" : "none");
      // Which water: the basemap's own filter, evaluated as MapLibre does.
      const f = featureFilter(l.filter as never, "layers[0].filter");
      const passes = (kind: string, type: 1 | 2 | 3 = 3) => f.filter({ zoom: 6 } as never, { type, properties: { kind } } as never);
      assert.equal(passes("ocean"), true, "the ocean");
      for (const kind of ["water", "lake", "river", "basin", "canal", "reservoir"]) assert.equal(passes(kind), false, `${kind} stays imagery`);
    }
    assert.equal(fill.paint["fill-color"], OVER_IMAGERY.ground, "the deep sea, as the ground where there is no imagery");
    assert.equal(fill.paint["fill-antialias"], true);
    assert.deepEqual([edge.paint["line-color"], edge.paint["line-width"], edge.paint["line-blur"]], [OVER_IMAGERY.ground, OCEAN_EDGE.width, OCEAN_EDGE.blur], "a 1 px feather");
    assert.ok(OCEAN_EDGE.blur >= 1);
  }
});

test("satellite over Canada's cities: the aerial overlay is ava's tiles host's, z13-19 in its bounds, faded in from z12.5", () => {
  const s = basemapStyle("ava", "light", "en", "satellite");
  const o = s.sources[IMAGERY_SOURCES.overlay];
  assert.ok(o && o.type === "raster");
  assert.deepEqual(o.tiles, ["https://tiles.addis.gg/aerial/{z}/{x}/{y}.webp"]);
  assert.deepEqual([o.minzoom, o.maxzoom, o.tileSize], [13, 19, 256]);
  assert.deepEqual(o.bounds, [...AERIAL_CANADA.coverage.bounds], "no tile is asked for outside what the build covered");
  // Southern Canada, Vancouver to the Gaspé: inside Canada's own box.
  const [w, s_, e, n] = o.bounds!;
  assert.ok(w > -141.01 && s_ > 41.67 && e < -52.61 && n < 83.12);
  const layer = s.layers.find((l) => l.id === IMAGERY_LAYERS.overlay)!;
  assert.equal((layer as { source: string }).source, IMAGERY_SOURCES.overlay);
  const opacity = (zoom: number) => paintOf(layer, "raster-opacity", zoom);
  assert.equal(opacity(12), 0, "nothing of it below its tiles");
  assert.equal(opacity(12.75), 0.5);
  assert.equal(opacity(13), 1);
  assert.equal(opacity(18), 1);
  // Where the map may go closer: the overlay's limit and its coverage, for setMapType.
  assert.deepEqual((s.metadata as Record<string, unknown>)[IMAGERY_OVERLAY_CAP], { maxViewZoom: 19, z: 13, cap: AERIAL_CANADA.coverage.cap });
  assert.equal((s.metadata as Record<string, unknown>)[IMAGERY_MAX_ZOOM], 13, "elsewhere the ESA cap holds");
  assert.deepEqual(validateStyleMin(s as never), [], "valid MapLibre");
  // Every URL is still the one origin a host's CSP allows.
  for (const u of JSON.stringify(s).match(/https?:\/\/[^"/]+/g) ?? []) assert.equal(u, AVA_BASEMAP.origin);
});

/** A layer's paint value at a zoom, by MapLibre's own evaluator. */
function paintOf(layer: { type: string; paint?: unknown }, property: string, zoom: number): number {
  const spec = (latest as unknown as Record<string, Record<string, unknown>>)[`paint_${layer.type}`]![property];
  const e = normalizePropertyExpression((layer.paint as Record<string, unknown>)[property] as never, "paint", spec as never);
  return e.evaluate({ zoom } as never) as number;
}
