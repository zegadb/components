// The main entry's components: function-plot, path-on-map and price-chart, and the generic
// functions over them. The body is not here: it is "@zegadb/components/body" (body/index.ts),
// which registers itself with these, so a host that never draws a body never bundles one.
import * as functionPlot from "./function-plot.ts";
import * as priceChart from "./price-chart.ts";
import { PATH_ON_MAP, type PathOnMapView } from "./path-on-map/component.ts";
import { CONTRACT as FUNCTION_PLOT_CONTRACT } from "./generated/contracts/function-plot.ts";
import { CONTRACT as PRICE_CHART_CONTRACT } from "./generated/contracts/price-chart.ts";
import { registry, type Component, type ContractsOf, type ToolDefinition, type Validated as ValidatedOf, type ViewOf } from "./registry.ts";
import type { Rendered } from "./chart.ts";

export interface FunctionPlotView { component: "function-plot"; data: functionPlot.FunctionPlotData; options: functionPlot.FunctionPlotOptions }
export interface PriceChartView { component: "price-chart"; data: priceChart.PriceChartData; options: priceChart.PriceChartOptions }
// path-on-map is defined in its own module, so its draw entry can check paths without this registry.
export { PATH_ON_MAP, type PathOnMapView };

export const FUNCTION_PLOT: Component<FunctionPlotView, Rendered, typeof FUNCTION_PLOT_CONTRACT> = {
  contract: FUNCTION_PLOT_CONTRACT,
  view: (data, options) => ({ component: "function-plot", data: data as functionPlot.FunctionPlotData, options: options as unknown as functionPlot.FunctionPlotOptions }),
  semantic: (view) => functionPlot.semantic(view.data, view.options),
  render: (view, ctx) => functionPlot.render(view.data, view.options, ctx),
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
