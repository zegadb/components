// What every chart shares: how big it is in a column, its title and legend,
// and the hover model a host turns into a crosshair and tooltip.
import { el, textWidth, type SvgNode } from "./svg.ts";
import type { Locale } from "./scale.ts";
import type { Contract, Theme } from "./types.ts";

export interface RenderContext {
  /** The column's width in points (CSS px): the chart is this wide. */
  width: number;
  /** A fixed height; otherwise the contract's size rule (width × aspect, within its bounds). */
  height?: number;
  theme: Theme;
  locale?: Locale;
  /** Makes clip and gradient ids unique when one page shows several charts. */
  id?: string;
}

/** One column of the hover model: what the tooltip says when the pointer is nearest `x`. */
export interface HoverColumn {
  /** Where, in points from the chart's left. */
  x: number;
  title: string;
  rows: { colour: string; label: string; value: string; y?: number }[];
}

export interface Hover {
  /** The plot's rectangle, in points: where the crosshair runs. */
  plot: { x: number; y: number; width: number; height: number };
  /** Sorted by x. */
  columns: HoverColumn[];
}

export interface Rendered {
  svg: SvgNode;
  width: number;
  height: number;
  /** What the chart shows, in a sentence or two: its accessible description. */
  summary: string;
  hover: Hover | null;
}

/** The chart's height in a column of `width` points, as the contract's size says. */
export function heightFor(size: Contract["size"], width: number, fixed?: number): number {
  if (fixed !== undefined) return Math.round(fixed);
  return Math.round(Math.max(size.minHeight, Math.min(size.maxHeight, width * size.aspect)));
}

export const TYPE = { title: 14, label: 12, tick: 11, small: 10.5 } as const;

/** The title row, if there is one: its node and how much height it takes. */
export function titleRow(title: string | null, theme: Theme, x: number, width: number): { node: SvgNode | null; height: number } {
  if (!title) return { node: null, height: 0 };
  return { node: el("text", { x: x + 1, y: 15, "font-size": TYPE.title, "font-weight": 600, fill: theme.ink, "font-family": theme.font.ui, textLength: textWidth(title, TYPE.title) > width ? width : undefined, lengthAdjust: textWidth(title, TYPE.title) > width ? "spacingAndGlyphs" : undefined }, title), height: 26 };
}

/**
 * The legend: a short line in each series' colour and its name, left to right,
 * wrapping to more rows when the column is narrow. Text in the text colour, never the series'.
 */
export function legendRows(entries: { label: string; colour: string }[], theme: Theme, x: number, y: number, width: number): { node: SvgNode | null; height: number } {
  if (entries.length < 2) return { node: null, height: 0 };
  const rowHeight = 18, key = 16, gap = 6, between = 16;
  const items: SvgNode[] = [];
  // Round caps reach 1.25 pt past a line's end: start the keys inside the edge.
  x += 2;
  width -= 2;
  let cx = x, cy = y;
  for (const e of entries) {
    const w = key + gap + textWidth(e.label, TYPE.label);
    if (cx > x && cx + w > x + width) { cx = x; cy += rowHeight; }
    items.push(el("g", {},
      el("line", { x1: cx, x2: cx + key, y1: cy + 9, y2: cy + 9, stroke: e.colour, "stroke-width": 2.5, "stroke-linecap": "round" }),
      el("text", { x: cx + key + gap, y: cy + 13, "font-size": TYPE.label, fill: theme.soft, "font-family": theme.font.ui }, e.label)));
    cx += w + between;
  }
  return { node: el("g", { "data-part": "legend" }, items), height: cy - y + rowHeight + 4 };
}

/** A label with a halo in the ground colour, so it reads over lines and grid. */
export function haloText(text: string, attrs: Record<string, string | number | undefined>, theme: Theme): SvgNode {
  const base = { "font-size": TYPE.label, "font-family": theme.font.ui, ...attrs };
  return el("g", {},
    el("text", { ...base, fill: "none", stroke: theme.ground, "stroke-width": 4, "stroke-linejoin": "round", "aria-hidden": "true" }, text),
    el("text", { ...base, fill: attrs.fill ?? theme.ink }, text));
}
