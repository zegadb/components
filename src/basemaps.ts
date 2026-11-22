// The hosts' basemaps, as data: where each host's street map is read from, whose it is, and its
// palette. The one place a host's basemap is defined, so every surface of that host shows the same
// map: ava's maps (avacanada/ava-web lib/map-style.ts + lib/tiles.ts, where this was proven) and
// Ava's chat (avacanada/ava) draw on the same tiles in the same palette.
// No map code here (the main entry exports it, so a host can say the credit or allow the origin
// without loading anything); the MapLibre style is "@zegadb/components/basemap" (basemap.ts).
import { theme } from "./theme.ts";
import type { Mode } from "./types.ts";

/** The languages a basemap's labels and credit are written in. */
export type BasemapLang = "en" | "fr";

/** One part of a credit: text, or a link. Hosts draw it in their own type, links their own way. */
export type CreditPart = string | { text: string; href: string };

/** The basemap's colours, one mode. `rule` is minor roads, `bigRoad` highways and major roads, `strongRule` casings and borders. */
export interface BasemapPalette {
  ground: string; water: string; park: string; rule: string; bigRoad: string; strongRule: string; buildings: string; ink: string; soft: string;
}

/** What a map shows under its roads and names: the street map, or satellite imagery. */
export type MapType = "map" | "satellite";
export const MAP_TYPES: readonly MapType[] = ["map", "satellite"];

/**
 * Satellite imagery a basemap can show under its roads and names (the "Map | Satellite" switch):
 * raster tiles, and whose they are. The credit is said only while the imagery is shown.
 */
export interface Imagery {
  /** The raster tiles, as a MapLibre source's `tiles` (one GET per tile; nothing there answers 204). */
  tiles: string;
  /** The tiles' size in px. */
  tileSize: number;
  /** The deepest zoom the imagery has everywhere; MapLibre overzooms past it. */
  maxzoom: number;
  /** Where it goes deeper, to `detail.maxzoom` (its tiles outside `bounds` are not asked for). */
  detail?: { bounds: readonly [number, number, number, number]; maxzoom: number };
  /**
   * Past the imagery's resolution the street map comes back: the imagery fades out between these
   * map zooms (`from` = `to` cuts over at once), and the roads and names go back to the map's colours.
   */
  fade: { from: number; to: number };
  credit: Record<BasemapLang, readonly CreditPart[]>;
}

export interface Basemap {
  /** The tiles host: the one origin a map with this basemap reads from (a host's CSP allows exactly it). */
  origin: string;
  /** The vector tiles, as a MapLibre source's `tiles`. */
  tiles: string;
  /** The deepest zoom the archive has tiles for; MapLibre overzooms past it. */
  maxzoom: number;
  glyphs: string;
  sprite: (mode: Mode) => string;
  /** Whose map it is, said once with every map; never with a link to edit the map. */
  credit: Record<BasemapLang, readonly CreditPart[]>;
  palette: Record<Mode, BasemapPalette>;
  /** Satellite imagery for the "Map | Satellite" switch, when the basemap has some. */
  imagery?: Imagery;
}

const ADDIS_TILES = "https://tiles.addis.gg";
const PROTOMAPS: CreditPart = { text: "Protomaps", href: "https://protomaps.com" };
const OSM = "https://www.openstreetmap.org/copyright";

/**
 * Ava's basemap. The tiles are tiles.addis.gg: the world archive, Protomaps v4 (z0–15), one plain
 * GET per tile (`/world/{z}/{x}/{y}.mvt`; a tile with nothing in it answers 204), and the glyphs
 * and sprites the @protomaps/basemaps layers name. No key: the tiles are public.
 *
 * The palette is "Quiet" (Sami chose it, 13 Nov, from rendered light/dark comparisons on real
 * Calgary tiles): near-neutral greys with a faint violet lean, water clearly blue, parks a faint
 * green, roads in the background; the only strong colour is what is drawn on it. Dark (14 Nov,
 * from full-screen renders of Halifax and Tofino): the water a clear deep blue against the ground,
 * the roads a step quieter. The ground and ink are ava's theme's (tokens/themes.json), so the
 * map and what is drawn on it are one palette.
 */
/**
 * Satellite imagery on tiles.addis.gg (`/satellite/{z}/{x}/{y}.webp`): the ESA WorldCover 2021
 * Sentinel-2 composite (10 m, CC BY 4.0), 256 px WebP, Canada to z13 and the world to z10, built
 * and served by us (addiscorp/knowledgegraph tiles-worker); no reader's browser asks anyone else.
 * 10 m shows fields, forests, lakes and the shape of a city, not streets: past map zoom 13 the
 * street map fades back in (13 to 14.5; a cut at 13 is `fade: { from: 13, to: 13 }`).
 */
export const ESA_WORLDCOVER_2021: Imagery = {
  tiles: `${ADDIS_TILES}/satellite/{z}/{x}/{y}.webp`,
  tileSize: 256,
  maxzoom: 10,
  detail: { bounds: [-141.01, 41.67, -52.61, 83.12], maxzoom: 13 },
  fade: { from: 13, to: 14.5 },
  credit: {
    en: [{ text: "© ESA WorldCover project 2021", href: "https://esa-worldcover.org" }, " / contains modified Copernicus Sentinel data"],
    fr: [{ text: "© Projet ESA WorldCover 2021", href: "https://esa-worldcover.org" }, " / contient des données Copernicus Sentinel modifiées"],
  },
};

const ava = (mode: Mode) => { const t = theme("ava", mode); return { ground: t.ground, ink: t.ink }; };
export const AVA_BASEMAP: Basemap = {
  origin: ADDIS_TILES,
  tiles: `${ADDIS_TILES}/world/{z}/{x}/{y}.mvt`,
  maxzoom: 15,
  glyphs: `${ADDIS_TILES}/fonts/{fontstack}/{range}.pbf`,
  sprite: (mode) => `${ADDIS_TILES}/sprites/v4/${mode}`,
  credit: {
    en: [PROTOMAPS, " © ", { text: "OpenStreetMap contributors", href: OSM }],
    fr: [PROTOMAPS, " © ", { text: "contributeurs d’OpenStreetMap", href: OSM }],
  },
  palette: {
    light: { ...ava("light"), water: "#C6DAEA", park: "#E1ECDC", rule: "#FFFFFF", bigRoad: "#FFFFFF", strongRule: "#DEDBE5", buildings: "#EAE8EF", soft: "#6B6680" },
    dark: { ...ava("dark"), water: "#13304B", park: "#1A2722", rule: "#22202F", bigRoad: "#2C293B", strongRule: "#24222F", buildings: "#211F2E", soft: "#958FA8" },
  },
  imagery: ESA_WORLDCOVER_2021,
};

/** The hosts that have a basemap; a host without one draws on its plain ground (pathOnMap.plainStyle). */
export const BASEMAPS = { ava: AVA_BASEMAP } as const satisfies Record<string, Basemap>;
export type BasemapHost = keyof typeof BASEMAPS;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The credit as HTML links (for a host that writes markup, as ava-web's figure foot does). */
export const creditHtml = (parts: readonly CreditPart[]) => parts.map((p) => (typeof p === "string" ? escape(p) : `<a href="${escape(p.href)}" rel="noreferrer">${escape(p.text)}</a>`)).join("");
