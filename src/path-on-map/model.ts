// path-on-map (components/path-on-map/): ordered paths on the street map,
// each segment coloured by an optional value at its start point, a ring at
// each path's start with its name beside it, and a legend.
//
// Pure (no DOM, no MapLibre at run time): the colours, the GeoJSON, the
// layers, the legend's words and the camera. draw.ts puts them on a map. This
// is the implementation avacanada/ava-web drew its maps with (lib/path-on-map.ts,
// 14 Nov), moved here so maps and chat share one: its colours now come from
// the host's theme (tokens/themes.json) rather than one site's palette.
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { LayerSpecification } from "maplibre-gl";
import type { Theme } from "../types.ts";

export type LonLat = readonly [number, number];
export type ColorScale = "sequential" | "diverging" | "solid";
export type View = "2d" | "3d";
export const VALUE_UNITS = ["ft", "m", "deg", "pct", "fraction", "km/h", "yd", "s"] as const;
export type ValueUnit = (typeof VALUE_UNITS)[number];
/** [west, south, east, north] in degrees. */
export type Bounds = readonly [number, number, number, number];

export interface PathOptions {
  colorScale: ColorScale;
  valueUnit: ValueUnit | null;
  /** The line's width in CSS px, 1–16. */
  lineWidth: number;
  view: View;
  /** Degrees clockwise from north, −180–180. */
  bearing: number;
  showBuildings: boolean;
  /** What to frame; null frames the paths. */
  bounds: Bounds | null;
}

export interface PathInput {
  points: readonly LonLat[];
  values?: readonly (number | null)[];
  label?: string;
}

/** The contract's data. */
export interface PathOnMapData {
  paths: readonly PathInput[];
  valueName?: string;
}

/** A validated view, every option set. */
export interface Paths {
  paths: readonly PathInput[];
  options: PathOptions;
  valueName: string;
}

export const paths = (data: PathOnMapData, options: PathOptions): Paths => ({ paths: data.paths, options, valueName: data.valueName || "value" });

/** The spec's measurements (path-on-map.spec.md, "Measurements"; tokens). */
export const MEASURES = { casing: 4, casingOpacity: 0.95, markerMin: 6, marker: 3, labelSize: 14, labelOffset: 1.1, labelHalo: 2, buildingsOpacity: 0.88, buildingHeight: 9, frame: 40, pitch3d: 60, maxZoom: 17, zoomOut3d: 0.3 } as const;

/** The theme's colours for the parts that aren't the ramp. */
export function pathColours(theme: Theme) {
  return { casing: theme.panel, marker: theme.panel, ring: theme.ink, ink: theme.ink, halo: theme.ground, accent: theme.accent, buildings: theme.buildings };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** The ramp's colour at `t` (0–1): linear in RGB between its stops, clamped at its ends. */
export function sampleRamp(ramp: readonly string[], t: number): string {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [rgb(ramp[i]!), rgb(ramp[i + 1]!)];
  return toHex(a.map((v, k) => v + (b[k]! - v) * f));
}

/** The values' lowest and highest, over every path; null when there are none. */
export function valueRange(list: readonly PathInput[]): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of list) for (const v of p.values ?? []) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return lo <= hi ? { lo, hi } : null;
}

/**
 * Where a value falls on its ramp, 0–1. Sequential: the lowest at 0, the highest at 1, linear.
 * Diverging: the middle stop is 0 when the values span 0, else their midpoint; each half linear.
 */
export function rampPosition(scale: Exclude<ColorScale, "solid">, { lo, hi }: { lo: number; hi: number }, v: number): number {
  if (scale === "sequential") return (v - lo) / (hi - lo || 1);
  const mid = lo < 0 && hi > 0 ? 0 : (lo + hi) / 2;
  return v < mid ? (0.5 * (v - lo)) / (mid - lo || 1) : 0.5 + (0.5 * (v - mid)) / (hi - mid || 1);
}

/** Each value's colour: on the ramp when the paths have values and the scale isn't solid; else (and for a point with no value) the accent. */
export function colourOf(p: Paths, theme: Theme): (v: number | null | undefined) => string {
  const accent = theme.accent;
  const range = valueRange(p.paths);
  const scale = p.options.colorScale;
  if (!range || scale === "solid") return () => accent;
  const ramp = theme[scale];
  return (v) => (v === null || v === undefined ? accent : sampleRamp(ramp, rampPosition(scale, range, v)));
}

type Line = Feature<LineString, { g: number; c: string }>;
type Start = Feature<Point, { g: number; label: string }>;

/** The GeoJSON drawn: one line per segment (consecutive points), coloured by its start point's value; one start per path. */
export function pathFeatures(p: Paths, theme: Theme): { segments: FeatureCollection<LineString, { g: number; c: string }>; starts: FeatureCollection<Point, { g: number; label: string }> } {
  const colour = colourOf(p, theme);
  const segments: Line[] = [];
  const starts: Start[] = [];
  p.paths.forEach((path, g) => {
    const { points, values } = path;
    for (let i = 1; i < points.length; i++) {
      segments.push({ type: "Feature", properties: { g, c: colour(values?.[i - 1]) }, geometry: { type: "LineString", coordinates: [[...points[i - 1]!], [...points[i]!]] } });
    }
    starts.push({ type: "Feature", properties: { g, label: path.label ?? "" }, geometry: { type: "Point", coordinates: [...points[0]!] } });
  });
  return { segments: { type: "FeatureCollection", features: segments }, starts: { type: "FeatureCollection", features: starts } };
}

/** The ids of what drawPaths adds, back to front. */
export const PATH_SOURCES = { segments: "path-on-map", starts: "path-on-map-starts" } as const;
export const PATH_LAYERS = { buildings: "path-buildings-3d", casing: "path-casing", line: "path-line", start: "path-start", label: "path-label" } as const;

/**
 * The path's layers, back to front: casing, line, start ring and, when the map has a glyph set
 * (`labels`), the label as a symbol layer. A map without glyphs (no basemap host) gets its labels
 * as HTML beside the start instead (draw.ts), in the theme's UI face.
 */
export function pathLayers(theme: Theme, options: PathOptions, labels = true): LayerSpecification[] {
  const c = pathColours(theme);
  const w = options.lineWidth;
  const round = { "line-cap": "round" as const, "line-join": "round" as const };
  const out: LayerSpecification[] = [
    { id: PATH_LAYERS.casing, type: "line", source: PATH_SOURCES.segments, layout: round, paint: { "line-color": c.casing, "line-width": w + MEASURES.casing, "line-opacity": MEASURES.casingOpacity } },
    { id: PATH_LAYERS.line, type: "line", source: PATH_SOURCES.segments, layout: round, paint: { "line-color": ["get", "c"], "line-width": w } },
    { id: PATH_LAYERS.start, type: "circle", source: PATH_SOURCES.starts, paint: { "circle-radius": Math.max(MEASURES.markerMin, w), "circle-color": c.marker, "circle-stroke-color": c.ring, "circle-stroke-width": MEASURES.marker, "circle-pitch-alignment": "viewport" } },
  ];
  if (labels) out.push({
    id: PATH_LAYERS.label, type: "symbol", source: PATH_SOURCES.starts,
    layout: { "text-field": ["get", "label"], "text-font": [theme.font.map], "text-size": MEASURES.labelSize, "text-anchor": "left", "text-offset": [MEASURES.labelOffset, 0], "text-allow-overlap": true, "text-ignore-placement": false },
    paint: { "text-color": c.ink, "text-halo-color": c.halo, "text-halo-width": MEASURES.labelHalo },
  });
  return out;
}

/**
 * The basemap's buildings, extruded to their mapped heights: Protomaps v4's `buildings` layer
 * carries `height` in metres, and `min_height` where a part starts above the ground; a building
 * with no height is 9 m, as in the spec. Hidden by opacity, not visibility: hiding a layer drops
 * its tiles' buckets and showing it again re-tiles every building.
 */
export function buildingsLayer(theme: Theme, visible: boolean, source = "basemap"): LayerSpecification {
  return {
    id: PATH_LAYERS.buildings, type: "fill-extrusion", source, "source-layer": "buildings", minzoom: 13,
    paint: {
      "fill-extrusion-color": theme.buildings,
      "fill-extrusion-height": ["coalesce", ["get", "height"], MEASURES.buildingHeight],
      "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
      "fill-extrusion-opacity": visible ? MEASURES.buildingsOpacity : 0,
    },
  };
}

/** The legend: the value's name and unit, the ramp, its low and high ends. None for a solid line. */
export function legendOf(p: Paths, theme: Theme): { title: string; low: string; high: string; ramp: readonly string[] } | null {
  const range = valueRange(p.paths);
  const scale = p.options.colorScale;
  if (!range || scale === "solid") return null;
  const { lo, hi } = range;
  return { title: legendTitle(p), low: endText(lo, hi - lo), high: endText(hi, hi - lo), ramp: theme[scale] };
}

/** "speed (km/h)": the value's name, then its unit when there is one. */
export const legendTitle = (p: Paths) => `${p.valueName}${p.options.valueUnit ? ` (${p.options.valueUnit})` : ""}`;

/** A legend end: a whole number when the range is 10 or more, else 3 significant digits. */
export const endText = (v: number, span: number) => (span >= 10 ? String(Math.round(v)) : String(Number(v.toPrecision(3))));

export interface Camera { center: [number, number]; zoom: number; bearing: number; pitch: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

const mercator = ([lon, lat]: LonLat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)] as const;
};
const unmercator = (x: number, y: number): [number, number] => [x * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp((180 - y * 360) * (Math.PI / 180))) - 90];

/**
 * The camera on `points` (or the corners of `bounds`), as the spec frames it: fitted to the points
 * themselves in the screen's axes at `bearing`, with padding the smallest of 40 px, a sixth of the
 * width and a sixth of the height, inside what `insets` leaves of the map; 3d then tilts to 60° and
 * zooms out 0.3 of a level; never past zoom 17. The center is the middle of the points.
 */
export function frameCamera(points: readonly LonLat[], size: { width: number; height: number }, options: Pick<PathOptions, "view" | "bearing" | "bounds">, insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }): Camera {
  const b = options.bounds;
  const fit: readonly LonLat[] = b ? [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] : points;
  const width = Math.max(1, size.width - insets.left - insets.right);
  const height = Math.max(1, size.height - insets.top - insets.bottom);
  const pad = Math.max(0, Math.min(MEASURES.frame, width / 6, height / 6));
  const r = (options.bearing * Math.PI) / 180;
  const [cos, sin] = [Math.cos(r), Math.sin(r)];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of fit) {
    const [mx, my] = mercator(p);
    const x = mx * cos + my * sin;
    const y = -mx * sin + my * cos;
    [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
  }
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const center = unmercator(cx * cos - cy * sin, cx * sin + cy * cos);
  const scale = Math.min((width - 2 * pad) / (x1 - x0 || 1e-9), (height - 2 * pad) / (y1 - y0 || 1e-9)) / 512;
  const pitch = options.view === "3d" ? MEASURES.pitch3d : 0;
  const zoom = Math.max(0, Math.min(MEASURES.maxZoom, Math.log2(scale)) - (pitch ? MEASURES.zoomOut3d : 0));
  return { center, zoom, bearing: options.bearing, pitch };
}

/** Every point of every path. */
export const allPoints = (p: Paths): LonLat[] => p.paths.flatMap((x) => [...x.points]);

/** What the map shows, in words (its accessible description). */
export function describePaths(p: Paths): string {
  const names = p.paths.map((x, i) => x.label || `path ${i + 1}`);
  const range = valueRange(p.paths);
  const legend = range && p.options.colorScale !== "solid" ? `, coloured by ${legendTitle(p)} from ${endText(range.lo, range.hi - range.lo)} to ${endText(range.hi, range.hi - range.lo)}` : "";
  return `A map of ${names.join(", ")} (${p.paths.reduce((n, x) => n + x.points.length, 0)} points)${legend}.`;
}

/** What the schema can't say: values one per point. */
export function semantic(data: PathOnMapData): { code: string; at: string; message: string; help: string }[] {
  const out: { code: string; at: string; message: string; help: string }[] = [];
  data.paths.forEach((path, p) => {
    if (path.values !== undefined && path.values.length !== path.points.length) {
      out.push({ code: "values-length", at: `data.paths[${p}].values`, message: `path ${p} has ${path.points.length} points and ${path.values.length} values`, help: "one value per point (null for a point with none), or no values at all" });
    }
  });
  return out;
}

/**
 * The map style for a host with no basemap (Ava's app: nothing leaves the computer): the theme's
 * ground and nothing else, no tiles, no glyphs. The paths, their markers and the legend are the
 * same as on a street map; their labels are HTML (draw.ts).
 */
export function plainStyle(theme: Theme): import("maplibre-gl").StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "ground", type: "background", paint: { "background-color": theme.ground } }] };
}
