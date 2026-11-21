// "@zegadb/components/body": the 3D body's own entry. Its contract, region table and mesh
// manifest (the Z-Anatomy names and the children's fitting numbers among them) are large, so
// the main entry does not carry them; a host that draws a body imports validate, render and
// the tools from here instead. They are the main entry's functions with the body added,
// so every other component checks and draws exactly as it does there:
//
//   import { validate, render } from "@zegadb/components/body";   // every component, and the body
//   const checked = validate(spec);
//   const drawn = render(checked.view, ctx);   // { body: true, height } → drawBody() from "@zegadb/components/body/draw"
//
// Or register it with the generic functions yourself: registry([BODY, ...BUILT_IN]).
// No three.js here: the validator and the chat never load it.
import { CONTRACT } from "../generated/contracts/body.ts";
import { heightFor } from "../chart.ts";
import { BUILT_IN } from "../builtin.ts";
import { registry, type Component, type ContractsOf, type Validated as ValidatedOf, type ViewOf } from "../registry.ts";
import { semantic, type BodyData, type BodyOptions } from "./model.ts";

export interface BodyView { component: "body"; data: BodyData; options: BodyOptions }

/** The body, for registry(): render() says `{ body: true, height }`, and the host draws it with drawBody() from "@zegadb/components/body/draw". */
export const BODY: Component<BodyView, { body: true; height: number }, typeof CONTRACT> = {
  contract: CONTRACT,
  view: (data, options) => ({ component: "body", data: data as BodyData, options: options as unknown as BodyOptions }),
  semantic: (view) => semantic(view.data, view.options),
  render: (_view, ctx) => ({ body: true, height: heightFor(CONTRACT.size, ctx.width, ctx.height) }),
};

/** Every component the package draws: the body, then the main entry's. */
export const COMPONENTS = [BODY, ...BUILT_IN] as const;

const WITH_BODY = /* @__PURE__ */ registry(COMPONENTS);

export type View = ViewOf<typeof COMPONENTS>;
export type ComponentId = View["component"];
export type Validated = ValidatedOf<View>;
export const COMPONENT_IDS: ComponentId[] = WITH_BODY.ids;
export const CONTRACTS: ContractsOf<typeof COMPONENTS> = WITH_BODY.contracts;
export const { validate, render, toolDefinitions, componentOfTool, contractText } = WITH_BODY;

export * as body from "./model.ts";
export { REGIONS as BODY_REGIONS, nameOf as bodyRegionName } from "./regions.ts";
export type { BodyData, BodyOptions, Highlight, Role, Side, ViewName } from "./model.ts";
export type { Body, Layer, RegionId } from "./regions.ts";
