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
};

/** The hosts that have a basemap; a host without one draws on its plain ground (pathOnMap.plainStyle). */
export const BASEMAPS = { ava: AVA_BASEMAP } as const satisfies Record<string, Basemap>;
export type BasemapHost = keyof typeof BASEMAPS;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The credit as HTML links (for a host that writes markup, as ava-web's figure foot does). */
export const creditHtml = (parts: readonly CreditPart[]) => parts.map((p) => (typeof p === "string" ? escape(p) : `<a href="${escape(p.href)}" rel="noreferrer">${escape(p.text)}</a>`)).join("");
