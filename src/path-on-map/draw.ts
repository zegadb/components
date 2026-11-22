// Draws path-on-map on a MapLibre map in the browser (model.ts says what is
// drawn). The host owns the map, its style and its controls (but the 2D | 3D
// switch and, on a basemap with imagery, the Map | Satellite switch, which
// drawPaths puts on a map the reader can move unless the host places
// viewToggle() and mapTypeToggle() among its own); drawPaths adds
// the buildings (when the map has the basemap source), each path's casing,
// coloured segments, start ring and label, the legend over the map's
// bottom-left corner, and frames the camera. One implementation for every
// host: ava's maps (avacanada/ava-web) and Ava's chat draw with it.
//
// MapLibre is the host's (a peer dependency): this module only takes a map.
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { creditHtml, ESA_WORLDCOVER_2021, type Imagery, type MapType } from "../basemaps.ts";
import { hasImagery, setMapType } from "../imagery.ts";
import { validator } from "../registry.ts";
import type { Locale } from "../scale.ts";
import type { Theme, ViewError } from "../types.ts";
import { PATH_ON_MAP } from "./component.ts";
import { allPoints, buildingsLayer, frameCamera, labelPlacement, legendOf, MEASURES, PATH_LAYERS, PATH_SOURCES, pathColours, pathFeatures, pathLayers, UNDER_LABELS, viewLook, type Insets, type PathOnMapData, type PathOptionsInput, type Paths, type View } from "./model.ts";

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
  options?: Partial<PathOptionsInput>;
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
  /**
   * Draw the map's controls over its top-right corner (the spec's map controls): the 2D | 3D switch,
   * and the Map | Satellite switch when the map's style has imagery, with the imagery's credit
   * while it shows. Default: when the map is interactive (its drag-to-pan is on); a still
   * (`interactive: false`) has none. A host with its own controls passes false and puts
   * viewToggle() and mapTypeToggle() among them (and says the imagery's credit while it shows).
   */
  controls?: boolean;
  /** The imagery the map's style shows (its credit while it shows); default ESA_WORLDCOVER_2021, the one basemapStyle has. */
  imagery?: Imagery;
  /** The switch's words (default en). */
  locale?: Locale;
  /** No easing when the view switches (default: the reader's prefers-reduced-motion). */
  reducedMotion?: boolean;
}

export interface DrawnPaths {
  readonly paths: Paths;
  /** The view shown now: the paths' own, or what the reader switched to since. */
  readonly view: View;
  /** Switches to `view` as the 2D | 3D switch does (setMapView), and the switch with it. */
  setView(view: View): void;
  /** The map type shown now: the paths' own, or what the reader switched to since ("map" on a map without imagery). */
  readonly mapType: MapType;
  /** Switches to `mapType` as the Map | Satellite switch does (setMapType), and the switch with it. */
  setMapType(mapType: MapType): void;
  /** Shows or hides the extruded buildings, without re-tiling them. */
  showBuildings(visible: boolean): void;
  /** Takes every layer, source, label, the legend and the switch off the map. */
  remove(): void;
}

/** The switch's words: its group's name, and each button's hint (the buttons read "2D" and "3D" in both languages). */
export const VIEW_TOGGLE_WORDS: Record<Locale, { group: string; "2d": string; "3d": string }> = {
  en: { group: "Map view", "2d": "2D: flat, from above", "3d": "3D: tilted, buildings standing" },
  fr: { group: "Vue de la carte", "2d": "2D : à plat, vue du dessus", "3d": "3D : inclinée, bâtiments en relief" },
};

/** The Map | Satellite switch's words: its group's name, each button's word and hint. */
export const MAP_TYPE_TOGGLE_WORDS: Record<Locale, { group: string; map: string; satellite: string; hint: Record<MapType, string> }> = {
  en: { group: "Map type", map: "Map", satellite: "Satellite", hint: { map: "Map: streets and places", satellite: "Satellite: imagery, with the streets and names over it" } },
  fr: { group: "Type de carte", map: "Carte", satellite: "Satellite", hint: { map: "Carte : rues et lieux", satellite: "Satellite : imagerie, avec les rues et les noms par-dessus" } },
};

/**
 * Puts `map` in `view` (viewLook): pitch 0 or 60°, the extruded buildings laid flat or stood up by
 * their opacity (never re-tiled). The centre, zoom and bearing stay where they are, and nothing is
 * fetched again. Eased over {motion.duration.viewSwitch} unless `animate` is false.
 */
export function setMapView(map: MapLibreMap, view: View, showBuildings: boolean, animate: boolean): void {
  const look = viewLook(view, showBuildings);
  if (map.getLayer(PATH_LAYERS.buildings)) map.setPaintProperty(PATH_LAYERS.buildings, "fill-extrusion-opacity", look.buildingsOpacity);
  if (animate) map.easeTo({ pitch: look.pitch, duration: MEASURES.viewSwitchMs });
  else map.jumpTo({ pitch: look.pitch });
}

export interface ViewToggleOptions {
  /** The view it starts on. */
  view: View;
  locale?: Locale;
  /** The group's class (default `zc-view-toggle`, styled by components.css); a host's own controls give theirs. */
  className?: string;
  /** Called with the view the reader picked, after the map has been switched. */
  onChange(view: View): void;
}

export interface ViewToggle {
  /** The group: two buttons, "2D" and "3D", the current one aria-pressed. Not yet on the page: the caller places it. */
  readonly element: HTMLElement;
  readonly view: View;
  /** Marks `view` as the current one (what the reader sees), without calling onChange. */
  set(view: View): void;
}

/**
 * The 2D | 3D switch: a labelled group of two buttons, each a native button (focusable, Enter and
 * Space press it), the current one `aria-pressed="true"`. Pressing the other calls onChange; the
 * caller switches the map (setMapView). One piece for every host: path-on-map's own controls, and
 * ava's maps, which put it among their zoom buttons.
 */
export function viewToggle(doc: Document, options: ViewToggleOptions): ViewToggle {
  const words = VIEW_TOGGLE_WORDS[options.locale ?? "en"];
  const s = segmented(doc, options.className ?? "zc-view-toggle", words.group, (["2d", "3d"] as const).map((v) => ({ value: v, text: v.toUpperCase(), hint: words[v] })), options.view, options.onChange);
  return { element: s.element, get view() { return s.value; }, set: s.set };
}

export interface MapTypeToggleOptions {
  /** The map type it starts on. */
  mapType: MapType;
  locale?: Locale;
  /** The group's class (default `zc-map-type-toggle`, styled by components.css); a host's own controls give theirs. */
  className?: string;
  /** Called with the map type the reader picked; the caller switches the map (setMapType). */
  onChange(mapType: MapType): void;
}

export interface MapTypeToggle {
  /** The group: two buttons, "Map" and "Satellite", the current one aria-pressed. Not yet on the page: the caller places it. */
  readonly element: HTMLElement;
  readonly mapType: MapType;
  /** Marks `mapType` as the current one, without calling onChange. */
  set(mapType: MapType): void;
}

/**
 * The Map | Satellite switch, built as the 2D | 3D one: a labelled group of two native buttons, the
 * current one `aria-pressed="true"`. Pressing the other calls onChange; the caller switches the
 * map (setMapType). Only for a map whose style has imagery (hasImagery).
 */
export function mapTypeToggle(doc: Document, options: MapTypeToggleOptions): MapTypeToggle {
  const words = MAP_TYPE_TOGGLE_WORDS[options.locale ?? "en"];
  const s = segmented(doc, options.className ?? "zc-map-type-toggle", words.group, (["map", "satellite"] as const).map((v) => ({ value: v, text: words[v], hint: words.hint[v] })), options.mapType, options.onChange);
  return { element: s.element, get mapType() { return s.value; }, set: s.set };
}

/** A labelled group of native buttons, one pressed: the map's switches. */
function segmented<T extends string>(doc: Document, cls: string, name: string, items: { value: T; text: string; hint: string }[], start: T, onChange: (value: T) => void) {
  let current = start;
  const group = doc.createElement("div");
  group.className = cls;
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", name);
  const buttons = items.map((item) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = `${cls}-${item.value}`;
    b.textContent = item.text;
    b.title = item.hint;
    b.dataset.value = item.value;
    b.addEventListener("click", () => {
      if (item.value === current) return;
      s.set(item.value);
      onChange(item.value);
    });
    group.appendChild(b);
    return b;
  });
  const s = {
    element: group,
    get value() { return current; },
    set(value: T) {
      current = value;
      for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.value === value));
    },
  };
  s.set(current);
  return s;
}

const CREDIT_CLASS = "zc-imagery-credit";
/** The compact credit's button's name, per language. */
export const IMAGERY_CREDIT_WORDS: Record<Locale, { button: string }> = {
  en: { button: "Imagery credit" },
  fr: { button: "Crédit de l’imagerie" },
};
/**
 * A map narrower than this (px) says the imagery's credit compactly, as MapLibre's compact
 * attribution does: an "ⓘ" button that opens the full line. Wider, the full line fits on one line.
 */
export const COMPACT_CREDIT_BELOW = 560;
let creditIds = 0;

interface ImageryCredit {
  readonly element: HTMLElement;
  /** Compact (the ⓘ button) or the full line, for a map `width` px wide. */
  fit(width: number): void;
}

/**
 * The imagery's credit over the map's bottom-right corner, in the page's language: drawn while the
 * imagery shows. On a narrow map it is an "ⓘ" button (a native button: focusable, Enter and Space
 * press it, `aria-expanded`) that opens and closes the full line; on a wide map, the full line.
 */
function imageryCredit(doc: Document, imagery: Imagery, locale: Locale): ImageryCredit {
  const box = doc.createElement("div");
  box.className = CREDIT_CLASS;
  const id = `zc-imagery-credit-${++creditIds}`;
  const button = doc.createElement("button");
  button.type = "button";
  button.className = `${CREDIT_CLASS}-toggle`;
  button.textContent = "ⓘ";
  button.setAttribute("aria-label", IMAGERY_CREDIT_WORDS[locale].button);
  button.setAttribute("aria-controls", id);
  button.setAttribute("aria-expanded", "false");
  const text = doc.createElement("span");
  text.className = `${CREDIT_CLASS}-text`;
  text.id = id;
  text.innerHTML = creditHtml(imagery.credit[locale]);
  box.append(button, text);
  let open = false;
  button.addEventListener("click", () => {
    open = !open;
    box.dataset.open = String(open);
    button.setAttribute("aria-expanded", String(open));
  });
  box.dataset.open = "false";
  return {
    element: box,
    fit(width) {
      box.dataset.compact = String(width < COMPACT_CREDIT_BELOW);
    },
  };
}

/** Whether the reader can move the map: the switch is a control, and a still has none. */
const interactive = (map: MapLibreMap) => Boolean(map.dragPan?.isEnabled());

// The main entry's validate(), over path-on-map alone: the same check and errors, and a host that
// only draws paths bundles no other component's contract or renderer, and no tools.
const validate = /* @__PURE__ */ validator([PATH_ON_MAP]);

/** The contract's check, for drawPaths' input shape: the validated paths, or the errors. */
export function checkPaths(input: PathsInput): { ok: true; value: Paths } | { ok: false; errors: ViewError[] } {
  const { options, ...data } = input;
  const checked = validate({ component: "path-on-map", data, ...(options ? { options } : {}) });
  if (!checked.ok) return checked;
  return { ok: true, value: checked.view.paths };
}

const LABEL_CLASS = "zc-path-label";

/** The basemap's first label: the buildings and the route's line go under it, so place and street names stay readable. */
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

const drawn = new WeakMap<MapLibreMap, { markers: MapLibreMarker[]; cls: string; controls: HTMLElement | null; credit: HTMLElement | null; refit: (() => void) | null }>();
/** The view each map shows now: kept across a redraw that keeps the camera (`frame: false`), so a new style keeps the reader's choice. */
const shown = new WeakMap<MapLibreMap, View>();
/** The map type each map shows now, kept the same way (a theme change's new style keeps the imagery). */
const shownType = new WeakMap<MapLibreMap, MapType>();

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
  // A first frame shows the paths' own view; a redraw that keeps the camera keeps the one shown.
  let view: View = context.frame === false ? (shown.get(map) ?? p.options.view) : p.options.view;
  shown.set(map, view);
  const imagery = hasImagery(map);
  let mapType: MapType = imagery ? (context.frame === false ? (shownType.get(map) ?? p.options.mapType) : p.options.mapType) : "map";
  shownType.set(map, mapType);
  setMapType(map, mapType);
  const features = pathFeatures(p, theme);
  map.addSource(PATH_SOURCES.segments, { type: "geojson", data: features.segments });
  map.addSource(PATH_SOURCES.starts, { type: "geojson", data: features.starts });
  // The buildings and the route's line go under the basemap's labels, so street names stay readable
  // over the route; the start marker and the route's label go on top. With no basemap labels (the
  // plain ground) there is nothing to go under, and every layer goes on top, in order.
  const labels = firstSymbol(map);
  if (map.getSource("basemap")) map.addLayer(buildingsLayer(theme, viewLook(view, p.options.showBuildings).buildingsOpacity > 0), labels);
  const glyphs = Boolean(map.getStyle().glyphs);
  for (const layer of pathLayers(theme, p.options, glyphs)) map.addLayer(layer, UNDER_LABELS.has(layer.id) ? labels : undefined);
  const markers: MapLibreMarker[] = [];
  // Room the HTML labels need beside their starts, per side, so framing keeps them on the map.
  const room = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!glyphs && context.Marker) {
    const c = pathColours(theme);
    for (const path of p.paths) {
      if (!path.label) continue;
      const label = map.getContainer().ownerDocument.createElement("div");
      label.className = LABEL_CLASS;
      label.textContent = path.label;
      label.style.color = c.ink;
      label.style.setProperty("--zc-halo", c.halo);
      // Off the path, beside the start marker (labelPlacement): the same side the symbol layer uses.
      const at = labelPlacement(path.points, p.options.bearing);
      const gap = Math.max(MEASURES.markerMin, p.options.lineWidth) + MEASURES.labelOffset * MEASURES.labelSize / 2;
      const offset: [number, number] = [Math.sign(at.offset[0]) * gap, Math.sign(at.offset[1]) * gap];
      markers.push(new context.Marker({ element: label, anchor: at.anchor, offset, pitchAlignment: "viewport", rotationAlignment: "viewport" }).setLngLat([path.points[0]![0], path.points[0]![1]]).addTo(map));
      const need = { w: label.offsetWidth + gap, h: label.offsetHeight + gap };
      const side = ({ left: "right", right: "left", top: "bottom", bottom: "top" } as const)[at.anchor];
      room[side] = Math.max(room[side], side === "left" || side === "right" ? need.w : need.h);
    }
  }
  if (glyphs) {
    // The symbol layer's labels (a basemap's glyphs): MapLibre measures them only once placed, so
    // their room is estimated from the text (an average glyph is about 0.6 em wide), so framing
    // keeps a label on a narrow map (a phone's chat column) as it does the HTML ones.
    for (const path of p.paths) {
      if (!path.label) continue;
      const at = labelPlacement(path.points, p.options.bearing);
      const gap = Math.max(MEASURES.markerMin, p.options.lineWidth) + MEASURES.labelOffset * MEASURES.labelSize / 2;
      const need = { w: path.label.length * MEASURES.labelSize * 0.6 + gap, h: MEASURES.labelSize * 1.2 + gap };
      const side = ({ left: "right", right: "left", top: "bottom", bottom: "top" } as const)[at.anchor];
      room[side] = Math.max(room[side], side === "left" || side === "right" ? need.w : need.h);
    }
  }
  const animate = () => !(context.reducedMotion ?? map.getContainer().ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  let buildings = p.options.showBuildings;
  const switchTo = (next: View) => {
    view = next;
    shown.set(map, next);
    setMapView(map, next, buildings, animate());
  };
  const doc = map.getContainer().ownerDocument;
  const locale = context.locale ?? "en";
  const own = context.controls ?? interactive(map);
  const toggle = own ? viewToggle(doc, { view, locale, onChange: switchTo }) : null;
  // The imagery's credit, said only while it shows, beside the controls that switch it.
  const credit = own && imagery ? imageryCredit(doc, context.imagery ?? ESA_WORLDCOVER_2021, locale) : null;
  const showType = (next: MapType) => {
    mapType = next;
    shownType.set(map, next);
    setMapType(map, next);
    if (credit) credit.element.hidden = next !== "satellite";
  };
  const typeToggle = own && imagery ? mapTypeToggle(doc, { mapType, locale, onChange: showType }) : null;
  let controls: HTMLElement | null = null;
  if (toggle) {
    controls = doc.createElement("div");
    controls.className = "zc-map-controls";
    if (typeToggle) controls.appendChild(typeToggle.element);
    controls.appendChild(toggle.element);
    map.getContainer().appendChild(controls);
  }
  let refit: (() => void) | null = null;
  if (credit) {
    credit.element.hidden = mapType !== "satellite";
    // Compact or the full line by the map's width, again when the map is resized (a phone turned).
    refit = () => credit.fit(map.getContainer().clientWidth);
    refit();
    map.on?.("resize", refit);
    map.getContainer().appendChild(credit.element);
  }
  drawn.set(map, { markers, cls, controls, credit: credit?.element ?? null, refit });
  legend(map, p, theme, cls);
  if (context.frame !== false) {
    const el = map.getContainer();
    const given = context.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
    // On a small map (a chat column) the legend would cover the path's bottom: frame above it.
    const box = el.querySelector<HTMLElement>(`:scope > .${cls}`);
    const legendBottom = box && el.clientHeight < 600 ? el.clientHeight - box.offsetTop - MEASURES.frame / 2 : 0;
    const insets = { top: Math.max(given.top, room.top), right: Math.max(given.right, room.right), bottom: Math.max(given.bottom, legendBottom, room.bottom), left: Math.max(given.left, room.left) };
    const camera = frameCamera(allPoints(p), { width: el.clientWidth, height: el.clientHeight }, p.options, insets);
    map.jumpTo({ ...camera, padding: insets });
  }
  return {
    paths: p,
    get view() { return view; },
    setView: (next) => {
      toggle?.set(next);
      switchTo(next);
    },
    get mapType() { return mapType; },
    setMapType: (next) => {
      if (!imagery) return;
      typeToggle?.set(next);
      showType(next);
    },
    showBuildings: (visible) => {
      buildings = visible;
      if (map.getLayer(PATH_LAYERS.buildings)) map.setPaintProperty(PATH_LAYERS.buildings, "fill-extrusion-opacity", viewLook(view, visible).buildingsOpacity);
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
    was.controls?.remove();
    was.credit?.remove();
    if (was.refit) map.off?.("resize", was.refit);
    drawn.delete(map);
  }
}

export type { GeoJSONSource };
export { hasImagery, setMapType } from "../imagery.ts";
