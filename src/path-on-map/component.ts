// path-on-map, for registry(): its own module, so path-on-map/draw can check a path against
// path-on-map's contract alone, without the main entry's registry (builtin.ts) and with it
// function-plot, price-chart and the assistant's tools.
import * as pathOnMap from "./model.ts";
import { CONTRACT as PATH_ON_MAP_CONTRACT } from "../generated/contracts/path-on-map.ts";
import type { Component } from "../registry.ts";

export interface PathOnMapView { component: "path-on-map"; data: pathOnMap.PathOnMapData; options: pathOnMap.PathOptions; paths: pathOnMap.Paths }

/** path-on-map draws on the host's MapLibre map: render() says so, and the host calls drawChecked() from "@zegadb/components/path-on-map/draw". */
export const PATH_ON_MAP: Component<PathOnMapView, { map: true; height: number }, typeof PATH_ON_MAP_CONTRACT> = {
  contract: PATH_ON_MAP_CONTRACT,
  view: (data, options) => {
    const d = data as pathOnMap.PathOnMapData, o = options as unknown as pathOnMap.PathOptions;
    return { component: "path-on-map", data: d, options: o, paths: pathOnMap.paths(d, o) };
  },
  semantic: (view) => pathOnMap.semantic(view.data),
  render: (_view, ctx) => {
    const size = PATH_ON_MAP_CONTRACT.size;
    return { map: true, height: Math.round(Math.max(size.minHeight, Math.min(size.maxHeight, ctx.width * size.aspect))) };
  },
};
