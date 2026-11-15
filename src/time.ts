// Time for price-chart: ISO 8601 parsing (UTC unless an offset is given) and
// axis ticks that land on calendar boundaries.
import type { Locale } from "./scale.ts";

/** Milliseconds since the epoch, or NaN. "2026-11-13" is midnight UTC; a date-time without an offset is UTC. */
export function parseTime(t: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(t);
  if (!m) return NaN;
  const [, y, mo, d, h = "0", mi = "0", s = "0", ms = "0", off] = m;
  const month = Number(mo), day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return NaN;
  let v = Date.UTC(Number(y), month - 1, day, Number(h), Number(mi), Number(s), Number(ms.padEnd(3, "0")));
  if (new Date(v).getUTCDate() !== day) return NaN; // 2026-02-30
  if (off && off !== "Z") {
    const sign = off[0] === "-" ? -1 : 1;
    v -= sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4, 6))) * 60_000;
  }
  return v;
}

const DAY = 86_400_000;
const TAG: Record<Locale, string> = { en: "en-CA", fr: "fr-CA" };
type Unit = "hour" | "day" | "month" | "year";
interface Plan { unit: Unit; every: number }

const PLANS: Plan[] = [
  { unit: "hour", every: 1 }, { unit: "hour", every: 3 }, { unit: "hour", every: 6 }, { unit: "hour", every: 12 },
  { unit: "day", every: 1 }, { unit: "day", every: 2 }, { unit: "day", every: 7 }, { unit: "day", every: 14 },
  { unit: "month", every: 1 }, { unit: "month", every: 2 }, { unit: "month", every: 3 }, { unit: "month", every: 6 },
  { unit: "year", every: 1 }, { unit: "year", every: 2 }, { unit: "year", every: 5 }, { unit: "year", every: 10 },
];
const approx: Record<Unit, number> = { hour: 3_600_000, day: DAY, month: 30.44 * DAY, year: 365.25 * DAY };

/** Ticks between t0 and t1 (ms), at most about `count`, on calendar boundaries, each with its label. */
export function timeTicks(t0: number, t1: number, count: number, locale: Locale): { t: number; label: string; lead: string }[] {
  const span = Math.max(1, t1 - t0);
  const plan = PLANS.find((p) => span / (approx[p.unit] * p.every) <= count) ?? PLANS[PLANS.length - 1]!;
  const out: number[] = [];
  const d = new Date(t0);
  let cur: number;
  if (plan.unit === "hour") cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.ceil((d.getUTCHours() + d.getUTCMinutes() / 60) / plan.every) * plan.every);
  else if (plan.unit === "day") cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (t0 % DAY ? 1 : 0));
  else if (plan.unit === "month") cur = Date.UTC(d.getUTCFullYear(), Math.ceil((d.getUTCMonth() + (d.getUTCDate() > 1 || t0 % DAY ? 1 : 0)) / plan.every) * plan.every, 1);
  else cur = Date.UTC(Math.ceil((d.getUTCFullYear() + (t0 > Date.UTC(d.getUTCFullYear(), 0, 1) ? 1 : 0)) / plan.every) * plan.every, 0, 1);
  while (cur <= t1 && out.length < 60) {
    if (cur >= t0) out.push(cur);
    const c = new Date(cur);
    if (plan.unit === "hour") cur += plan.every * 3_600_000;
    else if (plan.unit === "day") cur = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate() + plan.every);
    else if (plan.unit === "month") cur = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + plan.every, 1);
    else cur = Date.UTC(c.getUTCFullYear() + plan.every, 0, 1);
  }
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(TAG[locale], { timeZone: "UTC", ...o });
  const label = (t: number, i: number): string => {
    const date = new Date(t);
    const prev = i > 0 ? new Date(out[i - 1]!) : null;
    if (plan.unit === "year") return String(date.getUTCFullYear());
    if (plan.unit === "month") return date.getUTCMonth() === 0 || !prev ? fmt({ month: "short", year: "numeric" }).format(date) : fmt({ month: "short" }).format(date);
    if (plan.unit === "day") return !prev || prev.getUTCMonth() !== date.getUTCMonth() ? fmt({ month: "short", day: "numeric" }).format(date) : fmt({ day: "numeric" }).format(date);
    return !prev || prev.getUTCDate() !== date.getUTCDate() ? fmt({ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date) : fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  };
  // `lead`: the label with its context (the month, the year), for whichever tick ends up first on the axis.
  return out.map((t, i) => ({ t, label: label(t, i).replace(/\.$/, ""), lead: label(t, 0).replace(/\.$/, "") }));
}

/** A point's time as the tooltip says it: the date, with the time when the data has one. */
export function timeText(t: number, withTime: boolean, locale: Locale): string {
  return new Intl.DateTimeFormat(TAG[locale], { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" } : {}) }).format(new Date(t));
}
