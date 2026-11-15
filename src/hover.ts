// The hover layer, from a chart's hover model: a crosshair at the nearest
// column, a dot where each series crosses it, and a tooltip with the values.
// Pointer (mouse, pen, touch) and keyboard (focus the chart, then ← →).
// The tooltip is text nodes only; its look comes from the theme.
import type { Hover } from "./chart.ts";
import type { Theme } from "./types.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Attach the hover layer to `svg` (a chart drawn from `hover`'s render). The
 * tooltip goes in the svg's parent, which the host keeps `position: relative`.
 * Returns what takes it off again.
 */
export function attachHover(svg: SVGSVGElement, hover: Hover, theme: Theme, locale: "en" | "fr" = "en"): () => void {
  if (!hover.columns.length) return () => {};
  const doc = svg.ownerDocument;
  const host = svg.parentElement;
  if (!host) return () => {};
  const layer = doc.createElementNS(SVG_NS, "g");
  layer.setAttribute("pointer-events", "none");
  layer.setAttribute("visibility", "hidden");
  const rule = doc.createElementNS(SVG_NS, "line");
  rule.setAttribute("y1", String(hover.plot.y));
  rule.setAttribute("y2", String(hover.plot.y + hover.plot.height));
  rule.setAttribute("stroke", theme.soft);
  rule.setAttribute("stroke-width", "1");
  layer.appendChild(rule);
  svg.appendChild(layer);
  const tip = doc.createElement("div");
  tip.setAttribute("role", "status");
  tip.setAttribute("aria-live", "polite");
  Object.assign(tip.style, {
    position: "absolute", top: "0", left: "0", pointerEvents: "none", visibility: "hidden", zIndex: "3",
    background: theme.panel, color: theme.ink, border: `1px solid ${theme.rule}`, borderRadius: "8px",
    padding: "6px 9px", font: `12px/1.35 ${theme.font.ui}`, whiteSpace: "nowrap", boxShadow: theme.mode === "dark" ? "0 2px 10px rgba(0,0,0,.4)" : "0 2px 10px rgba(20,15,50,.12)",
    fontVariantNumeric: "tabular-nums",
  });
  host.appendChild(tip);
  let dots: SVGCircleElement[] = [];
  let at = -1;

  const show = (i: number) => {
    const col = hover.columns[i];
    if (!col) return;
    at = i;
    rule.setAttribute("x1", String(col.x));
    rule.setAttribute("x2", String(col.x));
    for (const d of dots) d.remove();
    dots = col.rows.filter((r) => r.y !== undefined).map((r) => {
      const c = doc.createElementNS(SVG_NS, "circle");
      c.setAttribute("cx", String(col.x));
      c.setAttribute("cy", String(r.y));
      c.setAttribute("r", "4.5");
      c.setAttribute("fill", r.colour);
      c.setAttribute("stroke", theme.ground);
      c.setAttribute("stroke-width", "2");
      layer.appendChild(c);
      return c;
    });
    layer.setAttribute("visibility", "visible");
    tip.replaceChildren();
    const head = doc.createElement("div");
    head.textContent = col.title;
    head.style.color = theme.soft;
    tip.appendChild(head);
    for (const r of col.rows) {
      const line = doc.createElement("div");
      line.style.display = "flex";
      line.style.alignItems = "center";
      line.style.gap = "6px";
      const key = doc.createElement("span");
      Object.assign(key.style, { width: "10px", height: "3px", borderRadius: "2px", background: r.colour, flex: "none" });
      const label = doc.createElement("span");
      label.textContent = r.label;
      label.style.color = theme.soft;
      const value = doc.createElement("span");
      value.textContent = r.value;
      value.style.fontWeight = "600";
      value.style.marginLeft = "auto";
      value.style.paddingLeft = "10px";
      line.append(key, label, value);
      tip.appendChild(line);
    }
    tip.style.visibility = "visible";
    // Beside the crosshair, on whichever side has room; clamped inside the chart.
    const box = svg.getBoundingClientRect(), hostBox = host.getBoundingClientRect();
    const scale = box.width / (svg.viewBox.baseVal?.width || box.width || 1) || 1;
    const offsetLeft = box.left - hostBox.left, offsetTop = box.top - hostBox.top;
    const w = tip.offsetWidth;
    const width = host.clientWidth;
    const x = col.x * scale + offsetLeft;
    let left = x + 12;
    if (left + w > width) left = x - 12 - w;
    left = Math.max(0, Math.min(width - w, left));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(hover.plot.y * scale + offsetTop)}px)`;
  };
  const hide = () => { at = -1; layer.setAttribute("visibility", "hidden"); tip.style.visibility = "hidden"; };
  const nearest = (clientX: number) => {
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = ((clientX - box.left) / (box.width || 1)) * (vb?.width || box.width);
    let lo = 0, hi = hover.columns.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (hover.columns[mid]!.x < x) lo = mid + 1; else hi = mid; }
    const prev = hover.columns[lo - 1];
    return prev && Math.abs(prev.x - x) < Math.abs(hover.columns[lo]!.x - x) ? lo - 1 : lo;
  };
  const move = (e: PointerEvent) => show(nearest(e.clientX));
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = Math.max(1, Math.round(hover.columns.length / 40));
      show(Math.max(0, Math.min(hover.columns.length - 1, (at < 0 ? 0 : at) + (e.key === "ArrowRight" ? step : -step))));
    } else if (e.key === "Escape") hide();
  };
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-roledescription", locale === "fr" ? "graphique" : "chart");
  svg.style.touchAction = "pan-y";
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("keydown", key);
  svg.addEventListener("blur", hide);
  return () => {
    svg.removeEventListener("pointermove", move);
    svg.removeEventListener("pointerdown", move);
    svg.removeEventListener("pointerleave", hide);
    svg.removeEventListener("keydown", key);
    svg.removeEventListener("blur", hide);
    layer.remove();
    tip.remove();
  };
}
