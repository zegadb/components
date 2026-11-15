// A host's theme (tokens/themes.json), one mode of it, ready to draw with.
import { THEMES } from "./generated/themes.ts";
import type { Mode, Theme, ThemeColours } from "./types.ts";

export type Host = keyof typeof THEMES;
export const HOSTS = Object.keys(THEMES) as Host[];

/**
 * The theme a chart is drawn with: `host`'s colours in `mode`, and its type.
 * `overrides` let a host match its page exactly, e.g. `ground` to the page's
 * own background so the rings around dots are that colour.
 */
export function theme(host: Host, mode: Mode, overrides: Partial<ThemeColours> = {}): Theme {
  const h = THEMES[host];
  return { ...h[mode], ...overrides, mode, font: h.font };
}

/** `colour` at `alpha` (0–1) as an rgba() colour, from a #RRGGBB one. */
export function withAlpha(colour: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!m) return colour;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}
