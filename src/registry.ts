// The generic functions every host calls (validate, render, the assistant's tools) over a set of
// components. They know no component themselves: a component brings its contract, what a checked
// spec resolves to, what a schema can't say, and what render() gives. The main entry makes them over
// function-plot, path-on-map and price-chart (builtin.ts); "@zegadb/components/body" over those and
// the body (body/index.ts). So a host that never draws a body never bundles one: not its contract,
// its region table, its mesh manifest or its drawing.
//
// validate() is the one check every host runs before it draws anything: a view spec against its
// component's contract (schema), then what a schema can't say (the component's own semantic check).
// A spec that fails draws nothing; its errors go back to whoever wrote it (a model reads them and
// tries again).
import { check, closest, type Schema } from "./schema.ts";
import type { RenderContext } from "./chart.ts";
import type { Contract, ViewError, ViewSpec } from "./types.ts";

/** A checked view: one component's id, its data and its options (the defaults filled in). */
export interface AnyView { component: string; data: unknown; options: unknown }

/** One component, as the generic functions see it. */
export interface Component<V extends AnyView = AnyView, D = unknown, C extends Contract = Contract> {
  /** Its contract, generated from components/<id>/<id>.contract.json (src/generated/contracts/<id>.ts). */
  readonly contract: C & { readonly id: V["component"] };
  /** The view a spec that met the schema resolves to (path-on-map adds the paths it draws). */
  view(data: unknown, options: Record<string, unknown>): V;
  /** What the schema can't say. */
  semantic(view: V): ViewError[];
  /** An SVG chart, or what the host draws itself: `{ map: true, height }`, `{ body: true, height }`. */
  render(view: V, ctx: RenderContext): D;
}

type List = readonly Component<any, any, any>[];
/** The views a set of components checks to. */
export type ViewOf<L extends List> = L[number] extends infer C ? (C extends Component<infer V, any, any> ? V : never) : never;
/** What render() gives for a set of components. */
export type DrawnOf<L extends List> = L[number] extends infer C ? (C extends Component<any, infer D, any> ? D : never) : never;
/** A set of components' contracts, by id. */
export type ContractsOf<L extends List> = { readonly [C in L[number] as C["contract"]["id"]]: C["contract"] };

export type Validated<V extends AnyView = AnyView> = { ok: true; view: V } | { ok: false; errors: ViewError[] };

/** A tool an assistant is given to draw one component. */
export interface ToolDefinition<Id extends string = string> {
  /** `draw_function_plot`, …: the component's id with `_` for `-`. */
  name: string;
  component: Id;
  description: string;
  /** JSON Schema for the call's arguments: `{ data, options }`, straight from the contract ($refs inlined). */
  inputSchema: Record<string, unknown>;
}

/** validate, render and the assistant's tools, over one set of components. */
export interface Registry<L extends List> {
  /** The components' ids, in the order given. */
  readonly ids: ViewOf<L>["component"][];
  readonly contracts: ContractsOf<L>;
  /** Check `spec` (anything: a model's JSON) against its component's contract. */
  validate(spec: unknown): Validated<ViewOf<L>>;
  /** A validated view, drawn as SVG; or what the host draws itself (a map, a body). */
  render(view: ViewOf<L>, ctx: RenderContext): DrawnOf<L>;
  /**
   * One tool per component, for an assistant that draws in its answers. Each takes `{ data, options }`:
   * the host adds the component (from the tool's name), validates the view spec and answers the model
   * with the errors, or with "drawn". The schemas are the contracts' own, so a model sees exactly what
   * will be checked. One tool each rather than one with every schema in a oneOf: a small model fills a
   * concrete schema far more reliably.
   */
  toolDefinitions(): ToolDefinition<ViewOf<L>["component"]>[];
  /** The component a tool name draws, or null. */
  componentOfTool(name: string): ViewOf<L>["component"] | null;
  /** One component's contract, as a model reads it to write a spec: its data schema, options and examples. */
  contractText(id: ViewOf<L>["component"]): string;
}

/** The most errors returned: enough to fix a spec in one go, few enough to read. */
export const MAX_ERRORS = 8;

/** The tool name for a component. */
export const toolName = (id: string) => `draw_${id.replace(/-/g, "_")}`;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** validate, render and the tools over `list`: the main entry's components, or those and the body. */
export function registry<const L extends List>(list: L): Registry<L> {
  type V = ViewOf<L>;
  type Id = V["component"];
  const byId = new Map<string, Component<any, any, any>>(list.map((c) => [c.contract.id, c]));
  const ids = list.map((c) => c.contract.id) as Id[];
  const contracts = Object.fromEntries(list.map((c) => [c.contract.id, c.contract])) as ContractsOf<L>;
  const envelope: Schema = {
    type: "object",
    required: ["component", "data"],
    additionalProperties: false,
    properties: {
      format: { const: 2 },
      component: { type: "string", maxLength: 64, description: `one of ${ids.join(", ")}` },
      version: { type: "string", maxLength: 16, pattern: "^[0-9]{1,4}(\\.[0-9]{1,4}){0,2}$" },
      data: { type: "object", description: "the component's data, as its contract says" },
      options: { type: "object", description: "display options; omitted ones take their defaults" },
    },
  };

  function validate(spec: unknown): Validated<V> {
    const fail = (errors: ViewError[]): Validated<V> => ({ ok: false, errors: errors.slice(0, MAX_ERRORS) });
    if (!isRecord(spec)) return fail([{ code: "type", at: "(root)", message: "a view spec is an object", help: `give {"component": …, "data": {…}, "options": {…}}; components: ${ids.join(", ")}` }]);
    const malformed = check(spec, envelope);
    if (malformed.length) return fail(malformed);
    const s = spec as unknown as ViewSpec;
    const component = byId.get(s.component);
    if (!component) {
      const guess = closest(s.component, ids);
      return fail([{ code: "component", at: "component", message: `\`${s.component}\` is not a component`, help: guess ? `did you mean \`${guess}\`?` : `use one of ${ids.join(", ")}` }]);
    }
    const id = s.component;
    const contract: Contract = component.contract;
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
    const view = component.view(s.data, options) as V;
    const more = component.semantic(view);
    if (more.length) return fail(more);
    return { ok: true, view };
  }

  function render(view: V, ctx: RenderContext): DrawnOf<L> {
    const id = (view as AnyView).component;
    const component = byId.get(id);
    if (!component) throw new Error(`render: ${id} is not one of this entry's components (${ids.join(", ")}); validate and render with the same entry`);
    return component.render(view, ctx);
  }

  function toolDefinitions(): ToolDefinition<Id>[] {
    return list.map((component) => {
      const c: { id: Id; description: string; data: unknown; $defs?: unknown; options: Record<string, { description: string; default: unknown } & Record<string, unknown>> } = component.contract;
      const defs = (c.$defs ?? {}) as Record<string, unknown>;
      const options = Object.fromEntries(Object.entries(c.options).map(([k, s]) => [k, { ...s, description: `${s.description} Default: ${JSON.stringify(s.default)}.` }]));
      return {
        name: toolName(c.id),
        component: c.id,
        description: `${c.description} The picture appears in your reply where you call this. If the data is wrong you get the errors back: fix them and call again, or answer in words.`,
        inputSchema: { type: "object", required: ["data"], additionalProperties: false, properties: { data: inline(c.data, defs), options: { type: "object", additionalProperties: false, properties: inline(options, defs) } } },
      };
    });
  }

  function componentOfTool(name: string): Id | null {
    const id = name.replace(/^draw_/, "").replace(/_/g, "-");
    return name.startsWith("draw_") && byId.has(id) ? (id as Id) : null;
  }

  function contractText(id: Id): string {
    const c: Contract | undefined = byId.get(id)?.contract;
    if (!c) throw new Error(`contractText: ${id} is not one of this entry's components (${ids.join(", ")})`);
    return JSON.stringify({ id: c.id, description: c.description, data: c.data, $defs: "$defs" in c ? c.$defs : undefined, options: c.options, examples: c.examples.valid }, null, 1);
  }

  return { ids, contracts, validate, render, toolDefinitions, componentOfTool, contractText };
}

function inline(node: unknown, defs: Record<string, unknown>, depth = 0): any {
  if (depth > 32 || node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => inline(n, defs, depth + 1));
  const o = node as Record<string, unknown>;
  if (typeof o.$ref === "string" && o.$ref.startsWith("#/$defs/")) return inline(defs[o.$ref.slice(8)], defs, depth + 1);
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, inline(v, defs, depth + 1)]));
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
