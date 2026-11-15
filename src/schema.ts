// A small JSON Schema (2020-12) interpreter: the subset the graph-component
// files use. One interpreter checks the files' own shapes (contracts,
// fixtures, tokens), a view spec's data against its contract's data schema,
// and its options against the contract's setting descriptors, so the
// published schemas, the repository checks and the chat's validation cannot
// disagree about what a schema means. (First copied from zegadb/zega
// browser/components/ at 11cff10; now this package's, and tools/lib/schema.js
// re-exports it.)
//
// Assertion keywords it interprets (SETTING_KEYWORDS is the subset a
// contract's settings may use; contract.schema.json closes `setting` to it):
//   type, enum, const, minimum, maximum, minLength, maxLength, pattern,
//   items, prefixItems, minItems, maxItems, format ("lonlat-bounds"),
//   and for data and the files' own schemas also properties, required,
//   additionalProperties, $ref ("#/$defs/…"), oneOf.
// Annotation keywords (title, description, default, $schema, $id, examples) are ignored.
//
// Keys are only ever looked up as own properties (Object.hasOwn), so a key
// named `constructor`, `toString` or `__proto__` is unknown, never inherited.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = { readonly [key: string]: unknown };

/** A JSON Patch operation, as a fix proposes it. */
export type PatchOp =
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "move"; from: string; path: string };

/**
 * A fix: a JSON Patch plus how far it can be trusted. `safe` fixes only
 * repair what the spec already means (a spelling, a clamp into range, an
 * unknown key removed); `guess` fixes choose something (a default). Only
 * `safe` fixes may be applied without a person or the model deciding.
 */
export type Fix = { kind: "safe" | "guess"; patch: PatchOp[] };

/** A teaching error: what is wrong, where (a dotted path), and what to do. */
export interface SchemaError {
  code: string;
  at: string;
  message: string;
  help: string;
  fix?: Fix;
}

export const SETTING_KEYWORDS = ["default", "description", "type", "enum", "const", "minimum", "maximum", "minLength", "maxLength",
  "pattern", "items", "prefixItems", "minItems", "maxItems", "format"] as const;

const own = (object: unknown, key: string): boolean => object !== null && typeof object === "object" && Object.hasOwn(object, key);
const get = (object: unknown, key: string): unknown => (own(object, key) ? (object as Record<string, unknown>)[key] : undefined);
const typeOf = (value: unknown): string => value === null ? "null" : Array.isArray(value) ? "array"
  : Number.isInteger(value) ? "integer" : typeof value;
const matchesType = (value: unknown, type: unknown) => type === typeOf(value) || (type === "number" && typeof value === "number" && Number.isFinite(value));

/** A value, as an error message names it. */
export const describe = (value: unknown): string => {
  const kind = typeOf(value);
  if (kind === "string") { const s = value as string; return `"${s.length > 40 ? `${s.slice(0, 37)}…` : s}"`; }
  if (kind === "array") return `a list of ${(value as unknown[]).length}`;
  if (kind === "object") return "an object";
  return String(value);
};
const list = (values: readonly unknown[]) => values.map((v) => JSON.stringify(v)).join(", ");

/** The closest of `candidates` to `word` by edit distance, for "did you mean"; null if none is close. Words over 64 characters are not compared. */
export function closest(word: unknown, candidates: Iterable<string>): string | null {
  if (typeof word !== "string" || word.length > 64) return null;
  let best: string | null = null, score = Infinity;
  for (const candidate of candidates) {
    const a = word.toLowerCase(), b = candidate.toLowerCase();
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    if (row[b.length]! < score) { score = row[b.length]!; best = candidate; }
  }
  return score <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

/** A JSON Pointer from path segments, each escaped (`~` → `~0`, `/` → `~1`). */
export const pointer = (...segments: (string | number)[]): string => segments.map((p) => `/${String(p).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
export const fixOf = (kind: Fix["kind"], patch: PatchOp[]): Fix => ({ kind, patch });

/**
 * Check `value` against `schema`. Returns a list of `{ code, at, message, help, fix? }`
 * problems (empty when it conforms). `at` is a dotted path from `where`.
 */
export function check(value: unknown, schema: Schema, where = "", root: Schema = schema, depth = 0, segments: (string | number)[] = where ? where.split(".") : []): SchemaError[] {
  const errors: SchemaError[] = [];
  const here = pointer(...segments);
  const at = where || "(root)";
  const push = (code: string, message: string, help = "", fix?: Fix) => errors.push({ code, at, message, help, ...(fix ? { fix } : {}) });
  const description = typeof schema.description === "string" ? schema.description : "";
  if (depth > 64) { push("depth", "is nested too deeply"); return errors; }
  if (own(schema, "$ref")) {
    const ref = String(schema.$ref);
    const target = ref.replace(/^#\//, "").split("/").reduce<unknown>((node, key) => get(node, key), root);
    if (!target || typeof target !== "object") throw new Error(`Unresolved $ref ${ref}`);
    return check(value, target as Schema, where, root, depth + 1, segments);
  }
  if (own(schema, "oneOf")) {
    const options = schema.oneOf as Schema[];
    const passing = options.filter((option) => check(value, option, where, root, depth + 1, segments).length === 0);
    if (passing.length !== 1) push("shape", `${describe(value)} matches ${passing.length ? "more than one" : "none"} of the allowed forms`, description);
    return errors;
  }
  if (typeof value === "number" && !Number.isFinite(value)) { push("type", `${value} is not a finite number`); return errors; }
  if (own(schema, "type")) {
    const types = [schema.type].flat();
    if (!types.some((type) => matchesType(value, type))) {
      push("type", `expected ${types.join(" or ")}, got ${typeOf(value) === "integer" ? "number" : typeOf(value)} ${describe(value)}`,
        description, own(schema, "default") && where ? fixOf("guess", [{ op: "replace", path: here, value: schema.default }]) : undefined);
      return errors;
    }
  }
  if (own(schema, "const") && value !== schema.const) push("const", `must be ${JSON.stringify(schema.const)}, got ${describe(value)}`, "", where ? fixOf("safe", [{ op: "replace", path: here, value: schema.const }]) : undefined);
  if (own(schema, "enum")) {
    const allowed = schema.enum as unknown[];
    if (!allowed.includes(value)) {
      const guess = typeof value === "string" ? closest(value, allowed.filter((v): v is string => typeof v === "string")) : null;
      const to = guess ?? (own(schema, "default") ? schema.default : undefined);
      push("enum", `${describe(value)} is not one of ${list(allowed)}`, guess ? `did you mean ${JSON.stringify(guess)}?` : `use one of ${list(allowed)}`,
        to !== undefined && where ? fixOf(guess ? "safe" : "guess", [{ op: "replace", path: here, value: to }]) : undefined);
    }
  }
  if (typeof value === "number") {
    const lo = own(schema, "minimum") ? (schema.minimum as number) : undefined, hi = own(schema, "maximum") ? (schema.maximum as number) : undefined;
    const fix = (to: number) => (where ? fixOf("safe", [{ op: "replace", path: here, value: to }]) : undefined);
    if (lo !== undefined && value < lo) push("range", `${value} is below the minimum ${lo}`, `use a value in [${lo}, ${hi ?? "∞"}]`, fix(lo));
    if (hi !== undefined && value > hi) push("range", `${value} is above the maximum ${hi}`, `use a value in [${lo ?? "-∞"}, ${hi}]`, fix(hi));
  }
  if (typeof value === "string") {
    if (own(schema, "maxLength") && value.length > (schema.maxLength as number)) { push("length", `is longer than ${schema.maxLength} characters`); return errors; }
    if (own(schema, "minLength") && value.length < (schema.minLength as number)) push("length", `must be at least ${schema.minLength} characters`);
    if (own(schema, "pattern") && !new RegExp(String(schema.pattern), "u").test(value)) push("pattern", `${describe(value)} is not well formed`, description || `it must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (own(schema, "minItems") && value.length < (schema.minItems as number)) push("length", `needs at least ${schema.minItems} items, got ${value.length}`, description);
    if (own(schema, "maxItems") && value.length > (schema.maxItems as number)) { push("length", `takes at most ${schema.maxItems} items, got ${value.length}`, description); return errors; }
    const prefix = own(schema, "prefixItems") ? (schema.prefixItems as Schema[]) : [];
    value.forEach((item, i) => {
      const itemSchema = i < prefix.length ? prefix[i] : own(schema, "items") ? (schema.items as Schema) : null;
      if (itemSchema) errors.push(...check(item, itemSchema, `${where}[${i}]`, root, depth + 1, [...segments, i]));
    });
    if (own(schema, "format") && schema.format === "lonlat-bounds" && !errors.length && value.length === 4) {
      const [w, s, e, n] = value as number[];
      if (!(w! < e!)) push("bounds", `west (${w}) must be less than east (${e})`, "bounds are [west, south, east, north]");
      if (!(s! < n!)) push("bounds", `south (${s}) must be less than north (${n})`, "bounds are [west, south, east, north]");
    }
  }
  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    const properties = (own(schema, "properties") ? schema.properties : {}) as Record<string, Schema>;
    for (const key of (own(schema, "required") ? schema.required : []) as string[]) {
      if (!own(obj, key)) push("required", `\`${key}\` is required`, own(properties, key) ? String(properties[key]!.description ?? "") : "");
    }
    const known = Object.keys(properties);
    for (const key of Object.keys(obj)) {
      const path = where ? `${where}.${key}` : key;
      if (own(properties, key)) errors.push(...check(obj[key], properties[key]!, path, root, depth + 1, [...segments, key]));
      else if (own(schema, "additionalProperties") && schema.additionalProperties === false) {
        const guess = closest(key, known);
        errors.push({ code: "unknown", at: path, message: `\`${key}\` is not a known field here`,
          help: guess ? `did you mean \`${guess}\`?` : known.length ? `known fields: ${known.map((k) => `\`${k}\``).join(", ")}` : "remove it",
          fix: guess ? fixOf("safe", [{ op: "move", from: pointer(...segments, key), path: pointer(...segments, guess) }]) : fixOf("safe", [{ op: "remove", path: pointer(...segments, key) }]) });
      } else if (own(schema, "additionalProperties") && typeof schema.additionalProperties === "object") errors.push(...check(obj[key], schema.additionalProperties as Schema, path, root, depth + 1, [...segments, key]));
    }
  }
  return errors;
}
