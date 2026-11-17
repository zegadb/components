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
import type { StyleSpecification } from "maplibre-gl";
import { BASEMAPS, type Basemap, type BasemapHost, type BasemapLang } from "./basemaps.ts";
import type { Mode } from "./types.ts";

export * from "./basemaps.ts";

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
 * own type and place, from the basemap's `credit`.
 */
export function basemapStyle(host: BasemapHost, mode: Mode, lang: BasemapLang = "en"): StyleSpecification {
  const b = BASEMAPS[host];
  return {
    version: 8,
    glyphs: b.glyphs,
    sprite: b.sprite(mode),
    sources: { [BASEMAP_SOURCE]: { type: "vector", tiles: [b.tiles], maxzoom: b.maxzoom } },
    layers: layers(BASEMAP_SOURCE, basemapFlavor(b, mode), { lang }),
  };
}
