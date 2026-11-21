// @zegadb/components: graph components (APS 21) for the web.
//
//   const checked = validate(spec)            // {component, data, options} from a model, a tool, anywhere
//   if (!checked.ok) return explain(checked.errors)   // to the model; people see nothing, or a plain sentence
//   const drawn = render(checked.view, { width, theme: theme("ava", "dark") })
//   drawn.svg → toElements(drawn.svg, React.createElement) or toDom(drawn.svg, document)
//   drawn.hover → attachHover(svgElement, drawn.hover, theme)
//
// path-on-map draws on a MapLibre map: render() says so (`map: true`), and the
// host calls drawChecked() from "@zegadb/components/path-on-map/draw".
//
// The 3D body is not in this entry (its region table and mesh manifest are large):
// a host that draws one imports validate, render and the tools from
// "@zegadb/components/body" instead, the same functions with the body added.
export { validate, render, toolDefinitions, componentOfTool, contractText, COMPONENT_IDS, CONTRACTS, BUILT_IN, type ComponentId, type View, type Validated, type ToolDefinition, type FunctionPlotView, type PathOnMapView, type PriceChartView } from "./builtin.ts";
export { registry, explain, toolName, MAX_ERRORS, type Component, type Registry, type AnyView, type ViewOf, type DrawnOf, type ContractsOf } from "./registry.ts";
export { theme, withAlpha, HOSTS, type Host } from "./theme.ts";
export { toSvgString, toDom, toElements, type SvgNode } from "./svg.ts";
export { attachHover } from "./hover.ts";
export { heightFor, type RenderContext, type Rendered, type Hover, type HoverColumn } from "./chart.ts";
export { parse as parseExpression } from "./expr.ts";
export { THEMES } from "./generated/themes.ts";
export * as pathOnMap from "./path-on-map/model.ts";
export { AVA_BASEMAP, BASEMAPS, creditHtml, type Basemap, type BasemapHost, type BasemapLang, type BasemapPalette, type CreditPart } from "./basemaps.ts";
export type { Contract, ViewSpec, ViewError, Theme, HostTheme, ThemeColours, Mode } from "./types.ts";
export type { FunctionPlotData, FunctionPlotOptions } from "./function-plot.ts";
export type { PriceChartData, PriceChartOptions } from "./price-chart.ts";
