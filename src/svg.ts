// Charts are drawn as a small tree of SVG elements, never as markup strings:
// a host turns the tree into its own elements (React's createElement, the
// DOM's createElementNS), so text a model wrote is always text, never markup
// or script. toSvgString exists for tests, files and server rendering, and
// escapes every value.

/** The elements a chart may contain: nothing that loads, links or runs. */
export const TAGS = ["svg", "g", "path", "line", "rect", "circle", "text", "tspan", "title", "desc", "defs", "clipPath", "linearGradient", "stop"] as const;
export type Tag = (typeof TAGS)[number];

export type Attrs = Readonly<Record<string, string | number>>;
export interface SvgNode {
  readonly tag: Tag;
  readonly attrs: Attrs;
  readonly children: readonly (SvgNode | string)[];
}

const ATTR = /^(?:[a-z][a-z0-9-]*|viewBox|clipPathUnits|gradientUnits|preserveAspectRatio|textLength|lengthAdjust|aria-[a-z]+|data-[a-z-]+)$/;

/** An element. Attributes with an undefined, null, false or NaN value are left out. */
export function el(tag: Tag, attrs: Record<string, string | number | undefined | null | false> = {}, ...children: (SvgNode | string | null | undefined | false | readonly (SvgNode | string | null | undefined | false)[])[]): SvgNode {
  const clean: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false || (typeof v === "number" && !Number.isFinite(v))) continue;
    if (!ATTR.test(k) || k.startsWith("on") || k === "href" || k === "style") throw new Error(`attribute ${k} is not allowed in a chart`);
    clean[k] = typeof v === "number" ? round(v) : v;
  }
  const kids = children.flat().filter((c): c is SvgNode | string => c !== null && c !== undefined && c !== false);
  return { tag, attrs: clean, children: kids };
}

/** Numbers in attributes: two decimals is a hundredth of a point, below what a screen shows. */
export const round = (v: number) => Math.round(v * 100) / 100;

/** A path's `d` from points, as one or more runs (a run breaks where a point is null). */
export function pathData(points: readonly ([number, number] | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${round(p[0])} ${round(p[1])}`;
    pen = true;
  }
  return d;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** The tree as SVG markup, every value escaped. */
export function toSvgString(node: SvgNode): string {
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escape(String(v))}"`).join("");
  const open = node.tag === "svg" && !("xmlns" in node.attrs) ? `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>` : `<${node.tag}${attrs}>`;
  return `${open}${node.children.map((c) => (typeof c === "string" ? escape(c) : toSvgString(c))).join("")}</${node.tag}>`;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The tree as DOM elements (setAttribute and text nodes only). */
export function toDom(node: SvgNode, doc: Document): SVGElement {
  const out = doc.createElementNS(SVG_NS, node.tag);
  for (const [k, v] of Object.entries(node.attrs)) out.setAttribute(k, String(v));
  for (const c of node.children) out.appendChild(typeof c === "string" ? doc.createTextNode(c) : toDom(c, doc));
  return out;
}

/** React's names for SVG attributes: stroke-width → strokeWidth; aria-* and data-* stay. */
const camel = (k: string) => (k.startsWith("aria-") || k.startsWith("data-") ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

/**
 * The tree as a host framework's elements: `h` is React.createElement (or
 * any function with its signature). Keys are the children's positions.
 */
export function toElements<E>(node: SvgNode, h: (type: string, props: Record<string, unknown> | null, ...children: (E | string)[]) => E, key?: number): E {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.attrs)) props[camel(k)] = v;
  if (key !== undefined) props.key = key;
  return h(node.tag, props, ...node.children.map((c, i) => (typeof c === "string" ? c : toElements(c, h, i))));
}

/**
 * About how wide `text` is at `size` points in a UI sans (DM Sans, Space
 * Grotesk, the system face): for placing labels and sizing the gutters, never
 * for anything that must be exact. Digits and capitals are wider than lower case.
 */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) w += 0.58;
    else if (/[ilj.,:;'|!]/.test(ch)) w += 0.28;
    else if (/[mwMW]/.test(ch)) w += 0.86;
    else if (/[A-Z]/.test(ch)) w += 0.66;
    else if (ch === " ") w += 0.27;
    else if (/[−+=×<>]/.test(ch)) w += 0.6;
    else w += 0.53;
  }
  return w * size;
}
