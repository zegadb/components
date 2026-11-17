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
import * as functionPlot from "./function-plot.ts";
import * as priceChart from "./price-chart.ts";
import { CONTRACTS } from "./generated/contracts.ts";
import { heightFor, type RenderContext, type Rendered } from "./chart.ts";
import type { View } from "./validate.ts";

export { validate, explain, COMPONENT_IDS, MAX_ERRORS, type ComponentId, type View, type Validated } from "./validate.ts";
export { theme, withAlpha, HOSTS, type Host } from "./theme.ts";
export { toSvgString, toDom, toElements, type SvgNode } from "./svg.ts";
export { attachHover } from "./hover.ts";
export { heightFor, type RenderContext, type Rendered, type Hover, type HoverColumn } from "./chart.ts";
export { parse as parseExpression } from "./expr.ts";
export { THEMES } from "./generated/themes.ts";
export * as pathOnMap from "./path-on-map/model.ts";
export * as body from "./body/model.ts";
export { REGIONS as BODY_REGIONS, nameOf as bodyRegionName } from "./body/regions.ts";
export type { Contract, ViewSpec, ViewError, Theme, HostTheme, ThemeColours, Mode } from "./types.ts";
export type { FunctionPlotData, FunctionPlotOptions } from "./function-plot.ts";
export type { PriceChartData, PriceChartOptions } from "./price-chart.ts";
export { CONTRACTS };

/**
 * A validated view, drawn as SVG; or, for a map component, `{ map: true }`: the host draws it on its map;
 * or, for the 3D body, `{ body: true }`: the host draws it with drawBody() from "@zegadb/components/body/draw".
 */
export function render(view: View, ctx: RenderContext): Rendered | { map: true; height: number } | { body: true; height: number } {
  switch (view.component) {
    case "function-plot": return functionPlot.render(view.data, view.options, ctx);
    case "price-chart": return priceChart.render(view.data, view.options, ctx);
    case "path-on-map": return { map: true, height: Math.round(Math.max(CONTRACTS["path-on-map"].size.minHeight, Math.min(CONTRACTS["path-on-map"].size.maxHeight, ctx.width * CONTRACTS["path-on-map"].size.aspect))) };
    case "body": return { body: true, height: heightFor(CONTRACTS["body"].size, ctx.width, ctx.height) };
  }
}

/** A tool an assistant is given to draw one component. */
export interface ToolDefinition {
  /** `draw_function_plot`, …: the component's id with `_` for `-`. */
  name: string;
  component: keyof typeof CONTRACTS;
  description: string;
  /** JSON Schema for the call's arguments: `{ data, options }`, straight from the contract ($refs inlined). */
  inputSchema: Record<string, unknown>;
}

/** The tool name for a component, and back. */
export const toolName = (id: string) => `draw_${id.replace(/-/g, "_")}`;
export const componentOfTool = (name: string): keyof typeof CONTRACTS | null => {
  const id = name.replace(/^draw_/, "").replace(/_/g, "-");
  return name.startsWith("draw_") && Object.hasOwn(CONTRACTS, id) ? (id as keyof typeof CONTRACTS) : null;
};

/**
 * One tool per component, for an assistant that draws in its answers. Each
 * takes `{ data, options }`: the host adds the component (from the tool's
 * name), validates the view spec and answers the model with the errors, or
 * with "drawn". The schemas are the contracts' own, so a model sees exactly
 * what will be checked. One tool each rather than one with every schema in a
 * oneOf: a small model fills a concrete schema far more reliably.
 */
export function toolDefinitions(): ToolDefinition[] {
  return (Object.keys(CONTRACTS) as (keyof typeof CONTRACTS)[]).map((id) => {
    const c: { description: string; data: unknown; $defs?: unknown; options: Record<string, { description: string; default: unknown } & Record<string, unknown>> } = CONTRACTS[id];
    const defs = (c.$defs ?? {}) as Record<string, unknown>;
    const options = Object.fromEntries(Object.entries(c.options).map(([k, s]) => [k, { ...s, description: `${s.description} Default: ${JSON.stringify(s.default)}.` }]));
    return {
      name: toolName(id),
      component: id,
      description: `${c.description} The picture appears in your reply where you call this. If the data is wrong you get the errors back: fix them and call again, or answer in words.`,
      inputSchema: { type: "object", required: ["data"], additionalProperties: false, properties: { data: inline(c.data, defs), options: { type: "object", additionalProperties: false, properties: inline(options, defs) } } },
    };
  });
}

function inline(node: unknown, defs: Record<string, unknown>, depth = 0): any {
  if (depth > 32 || node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => inline(n, defs, depth + 1));
  const o = node as Record<string, unknown>;
  if (typeof o.$ref === "string" && o.$ref.startsWith("#/$defs/")) return inline(defs[o.$ref.slice(8)], defs, depth + 1);
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, inline(v, defs, depth + 1)]));
}

/** One component's contract, as a model reads it to write a spec: its data schema, options and examples. */
export function contractText(id: keyof typeof CONTRACTS): string {
  const c = CONTRACTS[id];
  return JSON.stringify({ id: c.id, description: c.description, data: c.data, $defs: "$defs" in c ? c.$defs : undefined, options: c.options, examples: c.examples.valid }, null, 1);
}
