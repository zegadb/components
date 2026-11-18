// body (components/body/): where the labels go. Pure layout, no DOM, so the
// tests can hold it to the space it has: a column either side of the body,
// each label level with its region where it can be, and when the labels do
// not fit the height (a phone, twelve regions) a fallback, never an overflow:
// first the names alone (notes dropped), then numbered markers with a key.

/** One label to place: where its region is on screen, and how tall it is in each form. */
export interface LabelIn {
  /** Its regions' anchors on screen (one per side), in px. */
  anchors: readonly { x: number; y: number }[];
  /** Height in px with its note, and with its name alone. */
  full: number;
  name: number;
  width: number;
}

export type Tier = "full" | "names" | "numbers";

export interface LabelOut {
  column: "left" | "right";
  /** Top of the label in px (for numbers: of its marker's key line). */
  top: number;
}

export interface Space {
  width: number;
  /** The band labels may use, top to bottom, in px (below the title, above the bottom edge). */
  top: number;
  bottom: number;
  gap: number;
}

/** The side a label goes to: where its anchors are (both sides of the midline: the emptier column). */
function columns(labels: readonly LabelIn[], width: number): ("left" | "right")[] {
  const counts = { left: 0, right: 0 };
  return labels.map((l) => {
    const xs = l.anchors.map((a) => a.x), mid = width / 2;
    const c: "left" | "right" = xs.every((x) => x < mid - 4) ? "left" : xs.every((x) => x > mid + 4) ? "right" : counts.left <= counts.right ? "left" : "right";
    counts[c]++;
    return c;
  });
}

const centreY = (l: LabelIn) => l.anchors.reduce((s, a) => s + a.y, 0) / l.anchors.length;

/** Place labels of the given heights in their columns: level with their anchors, pushed apart, kept inside [top, bottom]. */
function stack(labels: readonly LabelIn[], cols: readonly ("left" | "right")[], heights: readonly number[], space: Space): LabelOut[] {
  const out: LabelOut[] = labels.map((_, i) => ({ column: cols[i]!, top: 0 }));
  for (const column of ["left", "right"] as const) {
    const idx = labels.map((_, i) => i).filter((i) => cols[i] === column).sort((a, b) => centreY(labels[a]!) - centreY(labels[b]!));
    let next = space.top;
    for (const i of idx) { out[i]!.top = Math.max(next, centreY(labels[i]!) - heights[i]! / 2); next = out[i]!.top + heights[i]! + space.gap; }
    let limit = space.bottom;
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]!; out[i]!.top = Math.min(out[i]!.top, limit - heights[i]!); limit = out[i]!.top - space.gap; }
  }
  return out;
}

/** Does every column's stack fit between top and bottom? */
function fits(cols: readonly ("left" | "right")[], heights: readonly number[], space: Space): boolean {
  for (const column of ["left", "right"] as const) {
    const hs = heights.filter((_, i) => cols[i] === column);
    if (hs.reduce((s, h) => s + h, 0) + Math.max(0, hs.length - 1) * space.gap > space.bottom - space.top) return false;
  }
  return true;
}

/** The numbered key's line height, in px: what each region costs when even names do not fit. */
export const KEY_LINE = 16;

/**
 * Lay the labels out: in full if they fit, else names alone, else numbered markers (the key then
 * lists them, one line each, in the left column from the top).
 */
export function layout(labels: readonly LabelIn[], space: Space): { tier: Tier; placed: LabelOut[] } {
  const cols = columns(labels, space.width);
  for (const tier of ["full", "names"] as const) {
    const heights = labels.map((l) => (tier === "full" ? l.full : l.name));
    if (fits(cols, heights, space)) return { tier, placed: stack(labels, cols, heights, space) };
  }
  return { tier: "numbers", placed: labels.map((_, i) => ({ column: "left", top: space.top + i * KEY_LINE })) };
}
