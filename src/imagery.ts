// The "Map | Satellite" switch's side of a map: which layers and sources are the imagery, and how a
// map is switched. No MapLibre or Protomaps import (draw.ts and hosts read it without loading
// either); basemap.ts builds the style these name.
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapType } from "./basemaps.ts";

/** The style's global state that says which map type is shown; the roads' and names' colours read it. */
export const MAP_TYPE_STATE = "zcMapType";
/** The imagery's sources: the base everywhere, and the detail where it goes deeper. */
export const IMAGERY_SOURCES = { base: "imagery", detail: "imagery-detail" } as const;
export const IMAGERY_LAYERS = { base: "imagery", detail: "imagery-detail" } as const;

/** Whether `map`'s style has imagery (basemapStyle of a basemap that has some). */
export const hasImagery = (map: Pick<MapLibreMap, "getLayer">): boolean => Boolean(map.getLayer(IMAGERY_LAYERS.base));

/** The style's metadata key for how close the map may go while the imagery shows (withImagery writes it). */
export const IMAGERY_MAX_ZOOM = "zc:imageryMaxZoom";

/** What setMapType touches. */
export type MapTypeTarget = Pick<MapLibreMap, "getLayer" | "setLayoutProperty" | "setGlobalStateProperty" | "getStyle" | "getMaxZoom" | "setMaxZoom" | "getZoom" | "easeTo" | "once">;

/** The map's own max zoom while satellite caps it, to give back on the way out. */
const uncapped = new WeakMap<object, number>();
/** The map type each map shows now. */
const shownType = new WeakMap<object, MapType>();

/** How close `map` may go while its imagery shows (its style's), or undefined without imagery. */
export function imageryMaxZoom(map: Pick<MapLibreMap, "getStyle">): number | undefined {
  const v = (map.getStyle()?.metadata as Record<string, unknown> | undefined)?.[IMAGERY_MAX_ZOOM];
  return typeof v === "number" ? v : undefined;
}

/** The map type `map` shows now ("map" until setMapType says otherwise). */
export const mapTypeOf = (map: object): MapType => shownType.get(map) ?? "map";

/**
 * Shows the street map or the imagery under the roads and names: the imagery layers' visibility
 * (a hidden one fetches nothing) and the global state the roads' and names' colours read. Nothing
 * else is fetched again. Satellite caps the map's max zoom at the imagery's crisp limit (easing out
 * to it first when the map is closer, unless `animate` is false); the street map gives the map its
 * own max zoom back. Does nothing on a map without imagery.
 */
export function setMapType(map: MapTypeTarget, mapType: MapType, animate = true): void {
  if (!hasImagery(map)) return;
  shownType.set(map, mapType);
  for (const id of Object.values(IMAGERY_LAYERS)) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", mapType === "satellite" ? "visible" : "none");
  map.setGlobalStateProperty(MAP_TYPE_STATE, mapType);
  const cap = imageryMaxZoom(map);
  if (cap === undefined) return;
  if (mapType === "satellite") {
    if (!uncapped.has(map)) uncapped.set(map, map.getMaxZoom());
    if (animate && map.getZoom() > cap) {
      map.easeTo({ zoom: cap, duration: 400 });
      // Capped once there, if it is still satellite by then.
      map.once("moveend", () => { if (mapTypeOf(map) === "satellite") map.setMaxZoom(cap); });
    } else map.setMaxZoom(cap);
  } else if (uncapped.has(map)) {
    map.setMaxZoom(uncapped.get(map)!);
    uncapped.delete(map);
  }
}
