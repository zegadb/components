// Scales and ticks shared by the charts.

export interface Linear {
  (v: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  invert(px: number): number;
}

export function linear(domain: readonly [number, number], range: readonly [number, number]): Linear {
  const [d0, d1] = domain, [r0, r1] = range;
  const k = (r1 - r0) / (d1 - d0 || 1);
  const f = ((v: number) => r0 + (v - d0) * k) as Linear;
  return Object.assign(f, { domain, range, invert: (px: number) => d0 + (px - r0) / (k || 1) });
}

/** A step of 1, 2 or 5 × 10ⁿ that splits `span` into about `count` parts. */
export function niceStep(span: number, count: number): number {
  const raw = Math.abs(span) / Math.max(1, count);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

/** Ticks at multiples of the nice step inside [lo, hi]. */
export function ticks(lo: number, hi: number, count: number): number[] {
  const step = niceStep(hi - lo, count);
  const out: number[] = [];
  const first = Math.ceil(lo / step - 1e-9);
  for (let i = first; i * step <= hi + step * 1e-9 && out.length < 50; i++) out.push(cleanZero(i * step));
  return out;
}

/** [lo, hi] widened outward to the nice step. */
export function niceDomain(lo: number, hi: number, count: number): [number, number] {
  if (lo === hi) { const pad = Math.abs(lo) * 0.1 || 1; lo -= pad; hi += pad; }
  const step = niceStep(hi - lo, count);
  return [cleanZero(Math.floor(lo / step + 1e-9) * step), cleanZero(Math.ceil(hi / step - 1e-9) * step)];
}

const cleanZero = (v: number) => (Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(12)));

/** How many decimals a step needs to tell its ticks apart. */
export const decimalsFor = (step: number) => Math.max(0, Math.min(10, -Math.floor(Math.log10(Math.abs(step) || 1) + 1e-9)));

export type Locale = "en" | "fr";
const TAG: Record<Locale, string> = { en: "en-CA", fr: "fr-CA" };

/** A number as an axis or label shows it, in the locale; compact (12K, 3.4M) from 10,000 when asked. True minus sign. */
export function formatNumber(v: number, locale: Locale, opts: { decimals?: number; compact?: boolean; currency?: string | null; sign?: boolean } = {}): string {
  const abs = Math.abs(v);
  const compact = opts.compact && abs >= 10_000;
  const f = new Intl.NumberFormat(TAG[locale], {
    ...(opts.currency ? { style: "currency", currency: opts.currency, currencyDisplay: "narrowSymbol" } : {}),
    ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: opts.decimals ?? 0, maximumFractionDigits: opts.decimals ?? 2 }),
    signDisplay: opts.sign ? "exceptZero" : "auto",
  });
  return f.format(cleanZero(v)).replace(/-/g, "−").replace(/ /g, " ");
}

/** A multiple of π as a tick says it: 0, π/2, π, 3π/2, −π… */
export function piLabel(v: number): string {
  const halves = Math.round((v / Math.PI) * 2);
  if (halves === 0) return "0";
  const sign = halves < 0 ? "−" : "";
  const n = Math.abs(halves);
  if (n % 2 === 0) return `${sign}${n / 2 === 1 ? "" : n / 2}π`;
  return `${sign}${n === 1 ? "" : n}π/2`;
}

/** Ticks at multiples of π/2 (or π, 2π… when that is too many). */
export function piTicks(lo: number, hi: number, count: number): number[] {
  let step = Math.PI / 2;
  while ((hi - lo) / step > count * 1.5) step *= 2;
  const out: number[] = [];
  for (let i = Math.ceil(lo / step - 1e-9); i * step <= hi + 1e-9 && out.length < 50; i++) out.push(i * step);
  return out;
}

/** The q-quantile (0–1) of sorted finite values. */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
