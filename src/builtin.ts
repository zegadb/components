// The main entry's components: function-plot, path-on-map and price-chart, and the generic
// functions over them. The body is not here: it is "@zegadb/components/body" (body/index.ts),
// which registers itself with these, so a host that never draws a body never bundles one.
import * as functionPlot from "./function-plot.ts";
import * as priceChart from "./price-chart.ts";
import * as pathOnMap from "./path-on-map/model.ts";
import { CONTRACT as FUNCTION_PLOT_CONTRACT } from "./generated/contracts/function-plot.ts";
import { CONTRACT as PATH_ON_MAP_CONTRACT } from "./generated/contracts/path-on-map.ts";
import { CONTRACT as PRICE_CHART_CONTRACT } from "./generated/contracts/price-chart.ts";
import { registry, type Component, type ContractsOf, type ToolDefinition, type Validated as ValidatedOf, type ViewOf } from "./registry.ts";
import type { Rendered } from "./chart.ts";

export interface FunctionPlotView { component: "function-plot"; data: functionPlot.FunctionPlotData; options: functionPlot.FunctionPlotOptions }
export interface PriceChartView { component: "price-chart"; data: priceChart.PriceChartData; options: priceChart.PriceChartOptions }
export interface PathOnMapView { component: "path-on-map"; data: pathOnMap.PathOnMapData; options: pathOnMap.PathOptions; paths: pathOnMap.Paths }

export const FUNCTION_PLOT: Component<FunctionPlotView, Rendered, typeof FUNCTION_PLOT_CONTRACT> = {
  contract: FUNCTION_PLOT_CONTRACT,
  view: (data, options) => ({ component: "function-plot", data: data as functionPlot.FunctionPlotData, options: options as unknown as functionPlot.FunctionPlotOptions }),
  semantic: (view) => functionPlot.semantic(view.data, view.options),
  render: (view, ctx) => functionPlot.render(view.data, view.options, ctx),
};

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

export const PRICE_CHART: Component<PriceChartView, Rendered, typeof PRICE_CHART_CONTRACT> = {
  contract: PRICE_CHART_CONTRACT,
  view: (data, options) => ({ component: "price-chart", data: data as priceChart.PriceChartData, options: options as unknown as priceChart.PriceChartOptions }),
  semantic: (view) => priceChart.semantic(view.data, view.options),
  render: (view, ctx) => priceChart.render(view.data, view.options, ctx),
};

/** The main entry's components, in id order: the list another entry (the body) adds itself to. */
export const BUILT_IN = [FUNCTION_PLOT, PATH_ON_MAP, PRICE_CHART] as const;

const MAIN = /* @__PURE__ */ registry(BUILT_IN);

export type View = ViewOf<typeof BUILT_IN>;
export type ComponentId = View["component"];
export type Validated = ValidatedOf<View>;
export const COMPONENT_IDS: ComponentId[] = MAIN.ids;
export const CONTRACTS: ContractsOf<typeof BUILT_IN> = MAIN.contracts;
export const { validate, render, toolDefinitions, componentOfTool, contractText } = MAIN;
export type { ToolDefinition };
