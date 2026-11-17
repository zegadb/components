// body (components/body/): the data, what a schema can't say about it, and
// what a spec resolves to before anything is drawn (no three.js here: the
// validator and the chat never load it).
import { REGIONS, isPaired, type Layer, type RegionId } from "./regions.ts";
import type { ViewError } from "../types.ts";

export type Side = "left" | "right" | "both";
export type Role = "focus" | "related" | "pain";
export type ViewName = "auto" | "front" | "back" | "left" | "right";
export interface Highlight { region: RegionId; side?: Side; role?: Role; note?: string }
export interface BodyData { highlight: Highlight[] }
export interface BodyOptions {
  body: "adult";
  focus: string | null;
  mode: "still" | "interactive";
  view: ViewName;
  labels: boolean;
  title: string | null;
}

const PAIRED = (Object.keys(REGIONS) as RegionId[]).filter(isPaired);

/** The sides a highlight is drawn on; [null] for an unpaired region. */
export const sidesOf = (h: Highlight): ("left" | "right" | null)[] => (!isPaired(h.region) ? [null] : h.side === "left" ? ["left"] : h.side === "right" ? ["right"] : ["right", "left"]);

/** The highlight the camera frames: options.focus, else the first with role focus, else the first. */
export const focusOf = (data: BodyData, options: BodyOptions): Highlight =>
  data.highlight.find((h) => h.region === options.focus) ?? data.highlight.find((h) => (h.role ?? "focus") === "focus") ?? data.highlight[0]!;

/** The layers drawn solid: the ones the highlights live on. The skin is always drawn, translucent over them. */
export const layersOf = (data: BodyData): Layer[] => [...new Set(data.highlight.map((h) => REGIONS[h.region].layer))];

/** What the schema can't say: sides only on paired regions, no region twice, a focus that is highlighted. */
export function semantic(data: BodyData, options: BodyOptions): ViewError[] {
  const errors: ViewError[] = [];
  data.highlight.forEach((h, i) => {
    if (h.side !== undefined && !isPaired(h.region)) errors.push({ code: "side", at: `data.highlight[${i}].side`, message: `${h.region} is not a paired region, so it takes no side`, help: `remove side; only ${PAIRED.join(", ")} take one` });
  });
  const taken = new Map<string, number>();
  data.highlight.forEach((h, i) => {
    for (const side of sidesOf(h)) {
      const key = `${h.region}/${side}`;
      const before = taken.get(key);
      if (before !== undefined) {
        errors.push({ code: "duplicate", at: `data.highlight[${i}]`, message: `${h.region}${side ? ` (${side})` : ""} is already data.highlight[${before}]`, help: "name each region once, with one role and one note" });
        break;
      }
      taken.set(key, i);
    }
  });
  if (options.focus !== null && !data.highlight.some((h) => h.region === options.focus)) {
    errors.push({ code: "focus", at: "options.focus", message: `${options.focus} is not one of the highlighted regions`, help: `use one of ${[...new Set(data.highlight.map((h) => h.region))].join(", ")}, or leave focus out` });
  }
  return errors;
}
