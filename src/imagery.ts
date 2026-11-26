// The "Map | Satellite" switch's side of a map: which layers and sources are the imagery, and how a
// map is switched. No MapLibre or Protomaps import (draw.ts and hosts read it without loading
// either); basemap.ts builds the style these name.
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapType } from "./basemaps.ts";
import { hasTile, tileAt } from "./coverage.ts";

/** The style's global state that says which map type is shown; the roads' and names' colours read it. */
export const MAP_TYPE_STATE = "zcMapType";
/** The imagery's sources: the base everywhere, the detail where it goes deeper, and the overlay (aerial photographs) over both. */
export const IMAGERY_SOURCES = { base: "imagery", detail: "imagery-detail", overlay: "imagery-overlay" } as const;
/**
 * The imagery's layers: the base and the detail, the overlay over them where the imagery has one,
 * then the ocean drawn over them in the deep-sea ground (`ocean`) with a feathered edge
 * (`oceanEdge`). All shown and hidden together.
 */
export const IMAGERY_LAYERS = { base: "imagery", detail: "imagery-detail", overlay: "imagery-overlay", ocean: "imagery-ocean", oceanEdge: "imagery-ocean-edge" } as const;

/** Whether `map`'s style has imagery (basemapStyle of a basemap that has some). */
export const hasImagery = (map: Pick<MapLibreMap, "getLayer">): boolean => Boolean(map.getLayer(IMAGERY_LAYERS.base));

/** The style's metadata key for how close the map may go while the imagery shows (withImagery writes it). */
export const IMAGERY_MAX_ZOOM = "zc:imageryMaxZoom";
/**
 * The style's metadata key for where the map may go closer than that: the overlay's crisp limit and
 * the coverage grid tiles it holds over (withImagery writes it from the overlay's `cap` runs).
 */
export const IMAGERY_OVERLAY_CAP = "zc:imageryOverlayCap";
export interface OverlayCap { maxViewZoom: number; z: number; cap: string }

/** What setMapType touches (getCenter, on and off for the cap that follows the view, when the map has them). */
export type MapTypeTarget = Pick<MapLibreMap, "getLayer" | "setLayoutProperty" | "setGlobalStateProperty" | "getStyle" | "getMaxZoom" | "setMaxZoom" | "getZoom" | "easeTo" | "once">
  & Partial<Pick<MapLibreMap, "getCenter" | "on" | "off">>;

/** The map's own max zoom while satellite caps it, to give back on the way out. */
const uncapped = new WeakMap<object, number>();
/** The moveend listener that keeps the cap where the view is, while satellite shows. */
const following = new WeakMap<object, () => void>();
/** The map type each map shows now. */
const shownType = new WeakMap<object, MapType>();

/**
 * How close `map` may go while its imagery shows, where it is now: the overlay's crisp limit where
 * the overlay covers the view's centre, the base imagery's elsewhere; undefined without imagery.
 */
export function imageryMaxZoom(map: Pick<MapLibreMap, "getStyle"> & Partial<Pick<MapLibreMap, "getCenter">>): number | undefined {
  const meta = map.getStyle()?.metadata as Record<string, unknown> | undefined;
  const v = meta?.[IMAGERY_MAX_ZOOM];
  if (typeof v !== "number") return undefined;
  const o = meta?.[IMAGERY_OVERLAY_CAP] as OverlayCap | undefined;
  const c = o && map.getCenter?.();
  if (!o || !c) return v;
  const [x, y] = tileAt(o.z, c.lng, c.lat);
  return hasTile(o.cap, x, y) ? Math.max(v, o.maxViewZoom) : v;
}

/** The map type `map` shows now ("map" until setMapType says otherwise). */
export const mapTypeOf = (map: object): MapType => shownType.get(map) ?? "map";

/**
 * Shows the street map or the imagery under the roads and names: the imagery layers' visibility
 * (a hidden one fetches nothing) and the global state the roads' and names' colours read. Nothing
 * else is fetched again. The map's extruded buildings (every fill-extrusion layer) are not drawn
 * while the imagery shows: flat-coloured boxes over a photograph bury the city it already shows; the
 * tilt stays, and the street map draws them again. Satellite caps the map's max zoom at the imagery's crisp limit (easing out
 * to it first when the map is closer, unless `animate` is false); the street map gives the map its
 * own max zoom back. Does nothing on a map without imagery.
 */
export function setMapType(map: MapTypeTarget, mapType: MapType, animate = true): void {
  if (!hasImagery(map)) return;
  shownType.set(map, mapType);
  for (const id of Object.values(IMAGERY_LAYERS)) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", mapType === "satellite" ? "visible" : "none");
  map.setGlobalStateProperty(MAP_TYPE_STATE, mapType);
  for (const l of map.getStyle()?.layers ?? []) if (l.type === "fill-extrusion") map.setLayoutProperty(l.id, "visibility", mapType === "satellite" ? "none" : "visible");
  if (imageryMaxZoom(map) === undefined) return;
  if (mapType === "satellite") {
    if (!uncapped.has(map)) uncapped.set(map, map.getMaxZoom());
    capTo(map, animate);
    // The cap follows the view: over the overlay the map may go closer; moved off it, it eases out.
    if (!following.has(map) && map.on) {
      const follow = () => capTo(map, true);
      following.set(map, follow);
      map.on("moveend", follow);
    }
  } else {
    const follow = following.get(map);
    if (follow) {
      map.off?.("moveend", follow);
      following.delete(map);
    }
    if (uncapped.has(map)) {
      map.setMaxZoom(uncapped.get(map)!);
      uncapped.delete(map);
    }
  }
}

/** Caps `map` at its imagery's limit where it is now (never past the map's own max), easing out to it first when closer. */
function capTo(map: MapTypeTarget, animate: boolean): void {
  if (mapTypeOf(map) !== "satellite") return;
  const own = uncapped.get(map) ?? map.getMaxZoom();
  const cap = Math.min(imageryMaxZoom(map) ?? own, own);
  if (animate && map.getZoom() > cap + 0.01) {
    map.easeTo({ zoom: cap, duration: 400 });
    // Capped once there, if it is still satellite by then (and the cap where it ended up).
    map.once("moveend", () => { if (mapTypeOf(map) === "satellite") map.setMaxZoom(Math.min(imageryMaxZoom(map) ?? own, own)); });
  } else if (map.getMaxZoom() !== cap) map.setMaxZoom(cap);
}
