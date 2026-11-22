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

/**
 * Shows the street map or the imagery under the roads and names: the imagery layers' visibility
 * (a hidden one fetches nothing) and the global state the roads' and names' colours read. Nothing
 * else is fetched again; the camera stays. Does nothing on a map without imagery.
 */
export function setMapType(map: Pick<MapLibreMap, "getLayer" | "setLayoutProperty" | "setGlobalStateProperty">, mapType: MapType): void {
  if (!hasImagery(map)) return;
  for (const id of Object.values(IMAGERY_LAYERS)) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", mapType === "satellite" ? "visible" : "none");
  map.setGlobalStateProperty(MAP_TYPE_STATE, mapType);
}
