// Draws path-on-map on a MapLibre map in the browser (model.ts says what is
// drawn). The host owns the map, its style and its controls; drawPaths adds
// the buildings (when the map has the basemap source), each path's casing,
// coloured segments, start ring and label, the legend over the map's
// bottom-left corner, and frames the camera. One implementation for every
// host: ava's maps (avacanada/ava-web) and Ava's chat draw with it.
//
// MapLibre is the host's (a peer dependency): this module only takes a map.
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { validate } from "../validate.ts";
import type { Theme, ViewError } from "../types.ts";
import { allPoints, buildingsLayer, frameCamera, legendOf, MEASURES, PATH_LAYERS, PATH_SOURCES, pathColours, pathFeatures, pathLayers, type Insets, type PathOnMapData, type PathOptions, type Paths } from "./model.ts";

/** Thrown by drawPaths when the input doesn't meet the contract: nothing on the map has changed. */
export class PathInputError extends Error {
  readonly errors: ViewError[];
  constructor(errors: ViewError[]) {
    super(errors.map((e) => `${e.at}: ${e.message}${e.help ? ` (${e.help})` : ""}`).join("; "));
    this.name = "PathInputError";
    this.errors = errors;
  }
}

/** What drawPaths takes: the contract's data, and its options. */
export interface PathsInput extends PathOnMapData {
  options?: Partial<PathOptions>;
}

export interface DrawContext {
  theme: Theme;
  /** Frame the camera on the paths (default true). */
  frame?: boolean;
  /** What of the map is under the host's own things, in px, kept out of the framing. */
  insets?: Insets;
  /** The legend's class (default `zc-legend`, styled by the package's components.css). */
  legendClass?: string;
  /** maplibregl.Marker, for labels as HTML on a map without glyphs. */
  Marker?: typeof MapLibreMarker;
}

export interface DrawnPaths {
  readonly paths: Paths;
  /** Shows or hides the extruded buildings, without re-tiling them. */
  showBuildings(visible: boolean): void;
  /** Takes every layer, source, label and the legend off the map. */
  remove(): void;
}

/** The contract's check, for drawPaths' input shape: the validated paths, or the errors. */
export function checkPaths(input: PathsInput): { ok: true; value: Paths } | { ok: false; errors: ViewError[] } {
  const { options, ...data } = input;
  const checked = validate({ component: "path-on-map", data, ...(options ? { options } : {}) });
  if (!checked.ok) return checked;
  if (checked.view.component !== "path-on-map") throw new Error("unreachable");
  return { ok: true, value: checked.view.paths };
}

const LABEL_CLASS = "zc-path-label";

/** Under the basemap's first label, so place names stay readable over the buildings. */
function firstSymbol(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === "symbol" && !Object.values(PATH_LAYERS).includes(l.id as never))?.id;
}

function legend(map: MapLibreMap, p: Paths, theme: Theme, cls: string) {
  map.getContainer().querySelector(`:scope > .${cls}`)?.remove();
  const model = legendOf(p, theme);
  if (!model) return;
  const doc = map.getContainer().ownerDocument;
  const box = doc.createElement("div");
  box.className = cls;
  const title = doc.createElement("div");
  title.className = `${cls}-title`;
  title.textContent = model.title;
  const bar = doc.createElement("div");
  bar.className = `${cls}-bar`;
  bar.style.background = `linear-gradient(to right, ${model.ramp.join(", ")})`;
  const ends = doc.createElement("div");
  ends.className = `${cls}-ends`;
  const [low, high] = [doc.createElement("span"), doc.createElement("span")];
  low.textContent = model.low;
  high.textContent = model.high;
  ends.append(low, high);
  box.append(title, bar, ends);
  map.getContainer().appendChild(box);
}

const drawn = new WeakMap<MapLibreMap, { markers: MapLibreMarker[]; cls: string }>();

/**
 * Draws `input` on `map` (its style loaded). Throws PathInputError, changing nothing, when the
 * input breaks the contract. Drawing again replaces what an earlier call drew.
 */
export function drawPaths(map: MapLibreMap, input: PathsInput, context: DrawContext): DrawnPaths {
  const checked = checkPaths(input);
  if (!checked.ok) throw new PathInputError(checked.errors);
  return drawChecked(map, checked.value, context);
}

/** drawPaths for paths already validated (a view from validate()). */
export function drawChecked(map: MapLibreMap, p: Paths, context: DrawContext): DrawnPaths {
  const { theme } = context;
  const cls = context.legendClass ?? "zc-legend";
  clear(map);
  const features = pathFeatures(p, theme);
  map.addSource(PATH_SOURCES.segments, { type: "geojson", data: features.segments });
  map.addSource(PATH_SOURCES.starts, { type: "geojson", data: features.starts });
  if (map.getSource("basemap")) map.addLayer(buildingsLayer(theme, p.options.showBuildings), firstSymbol(map));
  const glyphs = Boolean(map.getStyle().glyphs);
  for (const layer of pathLayers(theme, p.options, glyphs)) map.addLayer(layer);
  const markers: MapLibreMarker[] = [];
  if (!glyphs && context.Marker) {
    const c = pathColours(theme);
    for (const path of p.paths) {
      if (!path.label) continue;
      const label = map.getContainer().ownerDocument.createElement("div");
      label.className = LABEL_CLASS;
      label.textContent = path.label;
      label.style.color = c.ink;
      label.style.setProperty("--zc-halo", c.halo);
      label.style.marginLeft = `${Math.max(MEASURES.markerMin, p.options.lineWidth) + MEASURES.labelOffset * MEASURES.labelSize}px`;
      markers.push(new context.Marker({ element: label, anchor: "left", pitchAlignment: "viewport", rotationAlignment: "viewport" }).setLngLat([path.points[0]![0], path.points[0]![1]]).addTo(map));
    }
  }
  drawn.set(map, { markers, cls });
  legend(map, p, theme, cls);
  if (context.frame !== false) {
    const el = map.getContainer();
    const given = context.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
    // On a small map (a chat column) the legend would cover the path's bottom: frame above it.
    const box = el.querySelector<HTMLElement>(`:scope > .${cls}`);
    const insets = box && el.clientHeight < 600 ? { ...given, bottom: Math.max(given.bottom, el.clientHeight - box.offsetTop - MEASURES.frame / 2) } : given;
    const camera = frameCamera(allPoints(p), { width: el.clientWidth, height: el.clientHeight }, p.options, insets);
    map.jumpTo({ ...camera, padding: insets });
  }
  return {
    paths: p,
    showBuildings: (visible) => {
      if (map.getLayer(PATH_LAYERS.buildings)) map.setPaintProperty(PATH_LAYERS.buildings, "fill-extrusion-opacity", visible ? MEASURES.buildingsOpacity : 0);
    },
    remove: () => clear(map),
  };
}

function clear(map: MapLibreMap) {
  for (const id of Object.values(PATH_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of Object.values(PATH_SOURCES)) if (map.getSource(id)) map.removeSource(id);
  const was = drawn.get(map);
  if (was) {
    for (const m of was.markers) m.remove();
    map.getContainer().querySelector(`:scope > .${was.cls}`)?.remove();
    drawn.delete(map);
  }
}

export type { GeoJSONSource };
