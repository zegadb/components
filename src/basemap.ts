// A host's basemap as a MapLibre style: the street map a map component (path-on-map) is drawn on.
// The host owns its map (draw.ts); what the basemap is (its tiles host, credit and palette) is
// basemaps.ts, exported from the main entry too.
//
// The style is Protomaps v4: the @protomaps/basemaps layers over the host's vector tiles, a
// Protomaps flavour recoloured with the host's palette for light and dark, labels in the page's
// language, glyphs and sprites from the same tiles host (as ava-web lib/map-style.ts and zega.earth's
// map-style.js). MapLibre is the host's, and so is @protomaps/basemaps (optional peers: only a host
// that imports "@zegadb/components/basemap" needs it).
// Pure (no DOM, no MapLibre): hosts and tests build the same style.
import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import { BASEMAPS, type Basemap, type BasemapHost, type BasemapLang, type Imagery, type MapType } from "./basemaps.ts";
import { IMAGERY_LAYERS, IMAGERY_SOURCES, MAP_TYPE_STATE } from "./imagery.ts";
import type { Mode } from "./types.ts";

export * from "./basemaps.ts";
export * from "./imagery.ts";

/** The MapLibre source the basemap's layers read (draw.ts adds the extruded buildings when a map has it). */
export const BASEMAP_SOURCE = "basemap";

/** The Protomaps flavour recoloured with the palette (as zega.earth's basemapFlavor). */
export function basemapFlavor(b: Basemap, mode: Mode): Flavor {
  const c = b.palette[mode];
  const base = namedFlavor(mode);
  const flavor: Flavor = { ...base };
  const colours = flavor as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(base)) {
    if (typeof value !== "string" || key === "regular" || key === "bold" || key === "italic") continue;
    colours[key] = key.includes("halo") ? c.ground
      : key.includes("label") ? (key === "city_label" || key === "country_label" || key === "state_label" ? c.ink : c.soft)
      : /^(tunnel|bridges|minor|major|highway|link|other|railway|runway|boundaries|pier)/.test(key) ? (key.includes("casing") || key === "boundaries" ? c.strongRule : /^(highway|major)/.test(key) ? c.bigRoad : c.rule)
      : /park|wood|scrub|zoo/.test(key) ? c.park : key === "water" ? c.water : key === "buildings" ? c.buildings : c.ground;
  }
  if (base.landcover) flavor.landcover = Object.fromEntries(Object.keys(base.landcover).map((key) => [key, /forest|grass|scrub/.test(key) ? c.park : c.ground])) as unknown as Flavor["landcover"];
  if (base.pois) flavor.pois = Object.fromEntries(Object.keys(base.pois).map((key) => [key, c.soft])) as unknown as Flavor["pois"];
  return flavor;
}

/**
 * The basemap alone, as a whole MapLibre style: the host adds what it draws on it (drawPaths).
 * The credit is not in the style (no MapLibre attribution control): the host says it once, in its
 * own type and place, from the basemap's `credit` (and the imagery's, while it is shown).
 *
 * A basemap with imagery gets it in the same style, hidden unless `mapType` is "satellite", so the
 * "Map | Satellite" switch (setMapType) changes one layout property and one global state, and the
 * street map's tiles are never fetched again. See satelliteLayers for what changes.
 */
export function basemapStyle(host: BasemapHost, mode: Mode, lang: BasemapLang = "en", mapType: MapType = "map"): StyleSpecification {
  const b = BASEMAPS[host];
  const style: StyleSpecification = {
    version: 8,
    glyphs: b.glyphs,
    sprite: b.sprite(mode),
    sources: { [BASEMAP_SOURCE]: { type: "vector", tiles: [b.tiles], maxzoom: b.maxzoom } },
    layers: layers(BASEMAP_SOURCE, basemapFlavor(b, mode), { lang }),
  };
  return b.imagery ? withImagery(style, b.imagery, mapType) : style;
}

/**
 * `style` (a street map over BASEMAP_SOURCE, and whatever a host adds on top) with `imagery` in it:
 * the imagery's sources, the global state the switch sets, and satelliteLayers. The one way a style
 * gets imagery, for basemapStyle and for a host that builds its own style (ava-web's maps).
 */
export function withImagery(style: StyleSpecification, i: Imagery, mapType: MapType = "map"): StyleSpecification {
  return {
    ...style,
    state: { ...style.state, [MAP_TYPE_STATE]: { default: mapType } },
    sources: {
      ...style.sources,
      [IMAGERY_SOURCES.base]: { type: "raster", tiles: [i.tiles], tileSize: i.tileSize, maxzoom: i.maxzoom },
      ...(i.detail ? { [IMAGERY_SOURCES.detail]: { type: "raster", tiles: [i.tiles], tileSize: i.tileSize, minzoom: i.maxzoom + 1, maxzoom: i.detail.maxzoom, bounds: [...i.detail.bounds] } } : {}),
    },
    layers: satelliteLayers(style.layers, i, mapType),
  };
}

/** The roads' and names' colours over imagery, the same in light and dark: it is a photograph either way. */
export const OVER_IMAGERY = {
  label: "#FFFFFF",
  halo: "rgba(16, 14, 24, 0.78)",
  bigRoad: "rgba(255, 255, 255, 0.78)",
  road: "rgba(255, 255, 255, 0.45)",
  casing: "rgba(0, 0, 0, 0.28)",
  rail: "rgba(255, 255, 255, 0.35)",
  boundary: "rgba(255, 255, 255, 0.6)",
  /** The ground where there is no imagery (open sea, a gap in the Arctic composite): a deep sea, as the photographs' own. */
  ground: "#0B1621",
  hidden: "rgba(0, 0, 0, 0)",
} as const;

/** What a street-map line layer is drawn in over imagery (by its Protomaps id). */
function lineOverImagery(id: string): string {
  if (id.startsWith("water")) return OVER_IMAGERY.hidden;
  if (id.startsWith("boundaries")) return OVER_IMAGERY.boundary;
  if (id.includes("casing")) return OVER_IMAGERY.casing;
  if (id === "roads_rail") return OVER_IMAGERY.rail;
  if (/highway|major/.test(id)) return OVER_IMAGERY.bigRoad;
  return OVER_IMAGERY.road;
}

const SATELLITE: ExpressionSpecification = ["==", ["global-state", MAP_TYPE_STATE], "satellite"];
const isZoomCurve = (v: unknown): v is unknown[] => Array.isArray(v) && (v[0] === "interpolate" || v[0] === "step") && JSON.stringify(v[v[0] === "step" ? 1 : 2]) === '["zoom"]';
const mentionsZoom = (v: unknown): boolean => Array.isArray(v) ? (v[0] === "zoom" && v.length === 1) || v.some(mentionsZoom) : false;

/**
 * One paint value that is `over` while the imagery shows (map type "satellite") and the street
 * map's own value otherwise, at every zoom. A street value that is a curve over zoom (MapLibre takes
 * zoom only as a top-level curve's input) keeps its curve, each stop choosing between the two.
 */
function overImagery(street: unknown, over: unknown): unknown {
  if (street === undefined) return street;
  const choose = (v: unknown) => ["case", SATELLITE, over, v];
  if (isZoomCurve(street)) {
    // step: [step, input, out, z, out, …]; interpolate: [interpolate, type, input, z, out, …].
    const outputs = street[0] === "step" ? 2 : 4;
    if (street.some((v, k) => k >= outputs && (k - outputs) % 2 === 0 && mentionsZoom(v))) return street;
    return street.map((v, k) => (k >= outputs && (k - outputs) % 2 === 0 ? choose(v) : v));
  }
  if (mentionsZoom(street)) return street;
  return choose(street);
}

/**
 * The street map with imagery under its roads and names, over a deep-sea ground (the imagery has
 * nothing over open water; the street map's light ground there read as land). The imagery goes in
 * under the first line (the land, landcover and parks are under it); the fills the street map draws
 * above that (water, buildings, runways, piers) are cleared while it shows; lines turn to white over
 * a dark casing, names to white on a dark halo. At every zoom: past its deepest tiles the imagery is
 * overzoomed, never swapped for the street map. Two imagery layers: the base everywhere (overzoomed
 * past its maxzoom) and the detail over it where it has deeper tiles; a detail tile with nothing in
 * it lets the base show through.
 */
export function satelliteLayers(street: readonly LayerSpecification[], i: Imagery, mapType: MapType): LayerSpecification[] {
  if (street.some((l) => l.id === IMAGERY_LAYERS.base)) return [...street];
  const visibility = mapType === "satellite" ? "visible" : "none";
  const raster = (id: string, source: string): LayerSpecification => ({ id, type: "raster", source, layout: { visibility }, paint: { "raster-fade-duration": 0 } });
  const imagery = [raster(IMAGERY_LAYERS.base, IMAGERY_SOURCES.base), ...(i.detail ? [raster(IMAGERY_LAYERS.detail, IMAGERY_SOURCES.detail)] : [])];
  const at = street.findIndex((l) => l.type === "line");
  const out: LayerSpecification[] = [];
  street.forEach((l, n) => {
    if (n === at) out.push(...imagery);
    // Below the imagery, the background, and a host's own layers (its markers, not the street map's): as they are.
    if (l.type === "background") {
      const paint = { ...(l.paint as Record<string, unknown>) };
      paint["background-color"] = overImagery(paint["background-color"], OVER_IMAGERY.ground);
      return void out.push({ ...l, paint } as LayerSpecification);
    }
    if (n < at || (l as { source?: string }).source !== BASEMAP_SOURCE) return void out.push(l);
    const paint: Record<string, unknown> = { ...(l as { paint?: Record<string, unknown> }).paint };
    if (l.type === "fill") paint["fill-opacity"] = overImagery(paint["fill-opacity"] ?? 1, 0);
    else if (l.type === "line") paint["line-color"] = overImagery(paint["line-color"], lineOverImagery(l.id));
    else if (l.type === "symbol" && paint["text-halo-color"] !== undefined) {
      paint["text-color"] = overImagery(paint["text-color"], OVER_IMAGERY.label);
      paint["text-halo-color"] = overImagery(paint["text-halo-color"], OVER_IMAGERY.halo);
    }
    out.push({ ...l, paint } as LayerSpecification);
  });
  return out;
}
