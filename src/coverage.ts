// Where an imagery overlay has imagery, and what that means on screen: whose credit a view shows and
// how close the map may go there. The overlay's coverage is its build's (aerial-coverage.ts), on a
// coarse tile grid (z13, about 3 km a side in southern Canada), as rows of runs.
// Pure: no MapLibre, no DOM (the main entry exports it, for a host that draws its own credit).
import type { BasemapLang, CreditPart, Imagery } from "./basemaps.ts";

/** An overlay's coverage, as its build writes it (coverage.json; tiles.addis.gg/aerial.json's `coverage`). */
export interface OverlayCoverage {
  /** The grid's zoom. */
  z: number;
  /** Per credit: the grid tiles where imagery under that credit is seen, as runs ("y:x0+n,x0+n;y:…"). */
  sources: Readonly<Record<string, string>>;
  /** The grid tiles the overlay covers at least half of: the map may go to its maxViewZoom there. */
  cap: string;
  /** The grid tiles the overlay covers whole (inside its feather): nothing of the base shows there. */
  full: string;
  /** Each credit's line, per language. */
  credits: Readonly<Record<string, Readonly<Record<BasemapLang, readonly CreditPart[]>>>>;
  /** [west, south, east, north] of everything it covers. */
  bounds: readonly [number, number, number, number];
}

/** A coverage's rows: y -> sorted [x0, x1] runs (inclusive). */
type Rows = ReadonlyMap<number, readonly (readonly [number, number])[]>;
const decoded = new Map<string, Rows>();

/** The runs a coverage string names, decoded once. */
export function rows(runs: string): Rows {
  let r = decoded.get(runs);
  if (r) return r;
  const m = new Map<number, [number, number][]>();
  for (const row of runs ? runs.split(";") : []) {
    const [y, xs] = row.split(":");
    m.set(Number(y), xs!.split(",").map((run) => { const [x0, n] = run.split("+").map(Number); return [x0!, x0! + n! - 1] as [number, number]; }));
  }
  decoded.set(runs, (r = m));
  return r;
}

/** Whether tile (x, y) is in the runs. */
export function hasTile(runs: string, x: number, y: number): boolean {
  return (rows(runs).get(y) ?? []).some(([x0, x1]) => x >= x0 && x <= x1);
}

/** The tile of the z grid that a point is in. */
export function tileAt(z: number, lon: number, lat: number): [number, number] {
  const n = 2 ** z;
  const phi = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/** A view: what the map shows ([west, south, east, north]) and at what zoom. */
export interface ImageryView {
  bounds: readonly [number, number, number, number];
  zoom: number;
}

/** A view wider than this many grid tiles is far out: the overlay's tiles are not drawn there anyway. */
const MOST_TILES = 4096;

/** The grid tiles a view's bounds cover, or null when it is far out (more than MOST_TILES). */
function tilesIn(z: number, b: ImageryView["bounds"]): [number, number][] | null {
  const [x0, y0] = tileAt(z, b[0], b[3]);
  const [x1, y1] = tileAt(z, b[2], b[1]);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MOST_TILES) return null;
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

/**
 * How close the map may go with `imagery` shown at a point: the overlay's maxViewZoom where it
 * covers the point's grid tile (its `cap` runs), the base's everywhere else.
 */
export function imageryCapAt(imagery: Pick<Imagery, "maxViewZoom" | "overlay">, lon: number, lat: number): number {
  const o = imagery.overlay;
  if (!o) return imagery.maxViewZoom;
  const [x, y] = tileAt(o.coverage.z, lon, lat);
  return hasTile(o.coverage.cap, x, y) ? o.maxViewZoom : imagery.maxViewZoom;
}

/** Whose imagery a view shows: "base" unless the overlay covers all of it, then each overlay credit seen. */
export function imageryCreditsIn(imagery: Pick<Imagery, "overlay">, view: ImageryView): string[] {
  const o = imagery.overlay;
  if (!o || view.zoom < o.fromZoom) return ["base"];
  const tiles = tilesIn(o.coverage.z, view.bounds);
  if (!tiles) return ["base"];
  const seen = Object.keys(o.coverage.sources).filter((id) => tiles.some(([x, y]) => hasTile(o.coverage.sources[id]!, x, y)));
  const whole = seen.length > 0 && tiles.every(([x, y]) => hasTile(o.coverage.full, x, y));
  return [...(whole ? [] : ["base"]), ...seen];
}

/** What separates two credits in one line. */
export const CREDIT_SEPARATOR = " · ";

/**
 * The imagery's credit for a view, in `lang`: the base's (unless the overlay covers the whole
 * view), then each overlay source seen in it. Without a view, the base's alone.
 */
export function imageryCredit(imagery: Imagery, lang: BasemapLang, view?: ImageryView): CreditPart[] {
  const ids = view ? imageryCreditsIn(imagery, view) : ["base"];
  const parts: CreditPart[] = [];
  for (const id of ids) {
    const line = id === "base" ? imagery.credit[lang] : imagery.overlay!.coverage.credits[id]![lang];
    if (parts.length) parts.push(CREDIT_SEPARATOR);
    parts.push(...line);
  }
  return parts;
}
