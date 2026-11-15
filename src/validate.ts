// The one check every host runs before it draws anything: a view spec
// against its component's contract (schema), then what a schema can't say
// (the component's own semantic check). A spec that fails draws nothing; its
// errors go back to whoever wrote it (a model reads them and tries again).
import { check, closest, type Schema } from "./schema.ts";
import { CONTRACTS } from "./generated/contracts.ts";
import * as functionPlot from "./function-plot.ts";
import * as priceChart from "./price-chart.ts";
import * as pathOnMap from "./path-on-map/model.ts";
import type { Contract, ViewError, ViewSpec } from "./types.ts";

export type ComponentId = keyof typeof CONTRACTS;
export const COMPONENT_IDS = Object.keys(CONTRACTS) as ComponentId[];

export type View =
  | { component: "function-plot"; data: functionPlot.FunctionPlotData; options: functionPlot.FunctionPlotOptions }
  | { component: "price-chart"; data: priceChart.PriceChartData; options: priceChart.PriceChartOptions }
  | { component: "path-on-map"; data: pathOnMap.PathOnMapData; options: pathOnMap.PathOptions; paths: pathOnMap.Paths };

export type Validated = { ok: true; view: View } | { ok: false; errors: ViewError[] };

/** The most errors returned: enough to fix a spec in one go, few enough to read. */
export const MAX_ERRORS = 8;

const ENVELOPE: Schema = {
  type: "object",
  required: ["component", "data"],
  additionalProperties: false,
  properties: {
    format: { const: 2 },
    component: { type: "string", maxLength: 64, description: `one of ${COMPONENT_IDS.join(", ")}` },
    version: { type: "string", maxLength: 16, pattern: "^[0-9]{1,4}(\\.[0-9]{1,4}){0,2}$" },
    data: { type: "object", description: "the component's data, as its contract says" },
    options: { type: "object", description: "display options; omitted ones take their defaults" },
  },
};

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Check `spec` (anything: a model's JSON) against its component's contract. */
export function validate(spec: unknown): Validated {
  const fail = (errors: ViewError[]): Validated => ({ ok: false, errors: errors.slice(0, MAX_ERRORS) });
  if (!isRecord(spec)) return fail([{ code: "type", at: "(root)", message: "a view spec is an object", help: `give {"component": …, "data": {…}, "options": {…}}; components: ${COMPONENT_IDS.join(", ")}` }]);
  const envelope = check(spec, ENVELOPE);
  if (envelope.length) return fail(envelope);
  const s = spec as unknown as ViewSpec;
  if (!Object.hasOwn(CONTRACTS, s.component)) {
    const guess = closest(s.component, COMPONENT_IDS);
    return fail([{ code: "component", at: "component", message: `\`${s.component}\` is not a component`, help: guess ? `did you mean \`${guess}\`?` : `use one of ${COMPONENT_IDS.join(", ")}` }]);
  }
  const id = s.component as ComponentId;
  const contract: Contract = CONTRACTS[id];
  if (s.version !== undefined && s.version.split(".")[0] !== contract.version.split(".")[0]) {
    return fail([{ code: "version", at: "version", message: `version ${s.version} is not ${id}'s major ${contract.version.split(".")[0]}`, help: `write it for ${id} ${contract.version}, or leave version out` }]);
  }
  const errors = check(s.data, contract.data, "data", { $defs: contract.$defs ?? {} });
  const options: Record<string, unknown> = {};
  for (const [name, setting] of Object.entries(contract.options)) options[name] = setting.default;
  for (const [name, value] of Object.entries(s.options ?? {})) {
    if (!Object.hasOwn(contract.options, name)) {
      const guess = closest(name, Object.keys(contract.options));
      errors.push({ code: "unknown", at: `options.${name}`, message: `\`${name}\` is not an option of ${id}`, help: guess ? `did you mean \`${guess}\`?` : `the options are ${Object.keys(contract.options).join(", ")}` });
      continue;
    }
    const found = check(value, contract.options[name]!, `options.${name}`);
    if (found.length) errors.push(...found);
    else options[name] = value;
  }
  if (errors.length) return fail(errors);
  const view = typed(id, s.data, options);
  const more = semantic(view);
  if (more.length) return fail(more);
  return { ok: true, view };
}

function typed(id: ComponentId, data: unknown, options: Record<string, unknown>): View {
  switch (id) {
    case "function-plot": return { component: id, data: data as functionPlot.FunctionPlotData, options: options as unknown as functionPlot.FunctionPlotOptions };
    case "price-chart": return { component: id, data: data as priceChart.PriceChartData, options: options as unknown as priceChart.PriceChartOptions };
    case "path-on-map": {
      const d = data as pathOnMap.PathOnMapData, o = options as unknown as pathOnMap.PathOptions;
      return { component: id, data: d, options: o, paths: pathOnMap.paths(d, o) };
    }
  }
}

function semantic(view: View): ViewError[] {
  switch (view.component) {
    case "function-plot": return functionPlot.semantic(view.data, view.options);
    case "price-chart": return priceChart.semantic(view.data, view.options);
    case "path-on-map": return pathOnMap.semantic(view.data);
  }
}

/**
 * The errors as a model reads them: one line each, where, what, what to do.
 * This is what a host returns to the model when a spec fails; people never see it.
 */
export function explain(errors: readonly ViewError[]): string {
  return [
    "The picture was not drawn: the view spec does not meet its contract. Fix these and call again (or answer in words):",
    ...errors.map((e) => `- ${e.at}: ${e.message}${e.help ? ` (${e.help})` : ""}`),
  ].join("\n");
}
