import { test } from "node:test";
import assert from "node:assert/strict";
import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { BASEMAPS, basemapStyle, type BasemapHost } from "../basemap.ts";
import { theme } from "../theme.ts";
import { drawPaths } from "./draw.ts";
import { PATH_LAYERS, plainStyle } from "./model.ts";

/**
 * A map with MapLibre's layer stack: addLayer(layer, before) inserts the layer before `before`
 * (and throws when there is no such layer, as MapLibre does), or on top without it. Only what
 * drawPaths touches; the stack is what is asserted.
 */
function fakeMap(style: StyleSpecification) {
  const layers: LayerSpecification[] = [...style.layers];
  const sources = new Map<string, unknown>(Object.entries(style.sources));
  const container = { querySelector: () => null, clientWidth: 640, clientHeight: 400, ownerDocument: {}, appendChild: () => {} };
  const map = {
    getStyle: () => ({ ...style, layers: [...layers] }),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: unknown) => void sources.set(id, s),
    removeSource: (id: string) => void sources.delete(id),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: (layer: LayerSpecification, before?: string) => {
      if (layers.some((l) => l.id === layer.id)) throw new Error(`layer ${layer.id} already exists`);
      if (before === undefined) return void layers.push(layer);
      const at = layers.findIndex((l) => l.id === before);
      if (at < 0) throw new Error(`no layer ${before} to add ${layer.id} before`);
      layers.splice(at, 0, layer);
    },
    removeLayer: (id: string) => void layers.splice(layers.findIndex((l) => l.id === id), 1),
    setPaintProperty: () => {},
    getContainer: () => container,
    jumpTo: () => {},
  };
  return { map: map as unknown as MapLibreMap, ids: () => layers.map((l) => l.id), layers: () => [...layers] };
}

// A walk up Bay Street in Toronto (Union Station to City Hall), named: no values, so no legend.
const walk = { paths: [{ label: "Union Station to City Hall", points: [[-79.3806, 43.6453], [-79.3797, 43.6478], [-79.3826, 43.6524]] as [number, number][] }] };
const ours = new Set<string>(Object.values(PATH_LAYERS));
const under = [PATH_LAYERS.buildings, PATH_LAYERS.casing, PATH_LAYERS.line];
const over = [PATH_LAYERS.start, PATH_LAYERS.label];

for (const host of Object.keys(BASEMAPS) as BasemapHost[]) {
  for (const mode of ["light", "dark"] as const) {
    test(`on ${host}'s basemap (${mode}), the route's line is under every street label and its marker and name over them`, () => {
      const style = basemapStyle(host, mode);
      const m = fakeMap(style);
      for (const view of ["3d", "2d"] as const) {
        // Twice: drawing again replaces the first drawing and must keep the same stack.
        for (let i = 0; i < 2; i++) {
          drawPaths(m.map, { ...walk, options: { view } }, { theme: theme(host, mode), frame: false });
          const stack = m.layers();
          const symbols = stack.flatMap((l, at) => (l.type === "symbol" && !ours.has(l.id) ? [at] : []));
          assert.ok(symbols.length > 0, "the basemap has labels");
          const index = (id: string) => {
            const at = stack.findIndex((l) => l.id === id);
            assert.ok(at >= 0, `${id} is drawn`);
            return at;
          };
          for (const id of under) assert.ok(index(id) < symbols[0]!, `${id} (at ${index(id)}) is under the first basemap label ${stack[symbols[0]!]!.id} (at ${symbols[0]})`);
          for (const id of over) assert.ok(index(id) > symbols.at(-1)!, `${id} (at ${index(id)}) is over the last basemap label ${stack[symbols.at(-1)!]!.id}`);
          // Back to front among ours, and the basemap's own order untouched.
          assert.deepEqual(m.ids().filter((id) => ours.has(id)), [...under, ...over]);
          assert.deepEqual(m.ids().filter((id) => !ours.has(id)), style.layers.map((l) => l.id));
        }
      }
    });
  }
}

test("on the plain ground (no tiles, no labels), every layer is drawn on top in order, as before", () => {
  const t = theme("ava", "light");
  const m = fakeMap(plainStyle(t));
  drawPaths(m.map, walk, { theme: t, frame: false });
  // No glyphs: the label is HTML (with a Marker), not a layer; buildings need the basemap source.
  assert.deepEqual(m.ids(), ["ground", PATH_LAYERS.casing, PATH_LAYERS.line, PATH_LAYERS.start]);
});
