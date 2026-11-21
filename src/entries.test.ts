// The 3D body is its own entry ("@zegadb/components/body"): its contract, region table and mesh
// manifest are large, and a host that never draws a body must not bundle them. These bundle each
// other entry as a host's bundler would (esbuild: minified, tree-shaken, the peers left out) and
// look for the body's own strings in the output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { MANIFEST } from "./body/manifest.ts";
import { REGIONS } from "./body/regions.ts";

const BODY = JSON.parse(readFileSync(new URL("../components/body/body.contract.json", import.meta.url), "utf8")) as { description: string; $defs: { region: { enum: string[] } } };

const bundle = async (entry: string) => {
  const result = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, minify: true, treeShaking: true, format: "esm", platform: "browser", charset: "utf8", write: false, logLevel: "silent",
    external: ["maplibre-gl", "three", "three/*", "@protomaps/basemaps"],
  });
  return new TextDecoder().decode(result.outputFiles[0]!.contents);
};

/** Every string the body's data holds (mesh and Z-Anatomy names, HRA nodes, region names in both languages), and its contract's own words. */
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]) : []);
// Long enough to be the body's alone: "heart" or "left" could be any component's word.
const BODY_STRINGS = [...new Set([...strings(MANIFEST), ...strings(REGIONS), ...BODY.$defs.region.enum, BODY.description])].filter((s) => s.length >= 12);

test("the body's strings are distinctive enough to find", async () => {
  assert.ok(BODY_STRINGS.length > 100, `${BODY_STRINGS.length} strings`);
  const out = await bundle("./body/index.ts");
  const found = BODY_STRINGS.filter((s) => out.includes(JSON.stringify(s).slice(1, -1)));
  assert.ok(found.length > BODY_STRINGS.length * 0.9, `the body's own entry carries only ${found.length} of ${BODY_STRINGS.length}`);
});

// path-on-map/draw checks a path spec against path-on-map's contract alone: a host that only draws
// paths (avacanada/ava-web) must not bundle function-plot's or price-chart's contracts, their
// renderers, or the assistant's tools.
const contractOf = (id: string) => JSON.parse(readFileSync(new URL(`../components/${id}/${id}.contract.json`, import.meta.url), "utf8")) as unknown;
const PATH_STRINGS = new Set(strings(contractOf("path-on-map")));
const OTHER_STRINGS = [...new Set([...strings(contractOf("function-plot")), ...strings(contractOf("price-chart"))])].filter((s) => s.length >= 12 && !PATH_STRINGS.has(s) && !s.includes('"')); // a minifier may quote a string with " in it any way
// From the renderers (their semantic checks) and the tools (registry.ts toolDefinitions).
const OTHER_CODE = ["is not after", "candlesticks draw one series", "percent change needs a first close", "does not run bottom to top", "a line is either x = a or y = b", "The picture appears in your reply", "draw_"];

test("function-plot's and price-chart's strings are distinctive enough to find", async () => {
  assert.ok(OTHER_STRINGS.length > 20, `${OTHER_STRINGS.length} strings`);
  const out = await bundle("./index.ts");
  const found = OTHER_STRINGS.filter((s) => out.includes(JSON.stringify(s).slice(1, -1)));
  assert.ok(found.length > OTHER_STRINGS.length * 0.9, `the main entry carries only ${found.length} of ${OTHER_STRINGS.length}`);
  for (const word of OTHER_CODE) assert.ok(out.includes(word), `the main entry's bundle has no ${word}`);
});

test("path-on-map/draw.ts bundles only path-on-map: no other component's contract or renderer, no tools", async () => {
  const out = await bundle("./path-on-map/draw.ts");
  const found = OTHER_STRINGS.filter((s) => out.includes(JSON.stringify(s).slice(1, -1)));
  assert.deepEqual(found.slice(0, 10), [], `${found.length} of function-plot's and price-chart's strings are in the draw entry's bundle (${out.length} bytes)`);
  for (const word of [...OTHER_CODE, "function-plot", "price-chart"]) assert.ok(!out.includes(word), `the draw entry's bundle has ${word}`);
  // And it still carries path-on-map's own contract: it validates against it.
  assert.ok(out.includes("[longitude, latitude] per point"), "the draw entry's bundle has no path-on-map contract");
});

// The weather card is its own entry too ("@zegadb/components/weather"): its contract, glyphs and ECCC's table would add
// about a sixth to the main entry (11 KB of 68 KB minified), so a host that never shows the weather must not bundle them.
const MAIN_STRINGS = new Set(["function-plot", "path-on-map", "price-chart"].flatMap((id) => strings(contractOf(id))));
const WEATHER_STRINGS = [...new Set(strings(contractOf("weather")))].filter((s) => s.length >= 12 && !MAIN_STRINGS.has(s) && !s.includes('"'));
// From its renderer, its words and its table.
const WEATHER_CODE = ["a weather card needs now, hours or days", "Warmer tomorrow", "Plus froid demain", "verglacant", "blowing-snow", "data-sky"];

test("the weather's strings are distinctive enough to find, and its entry carries them", async () => {
  assert.ok(WEATHER_STRINGS.length > 15, `${WEATHER_STRINGS.length} strings`);
  const out = await bundle("./weather/index.ts");
  const found = WEATHER_STRINGS.filter((s) => out.includes(JSON.stringify(s).slice(1, -1)));
  assert.ok(found.length > WEATHER_STRINGS.length * 0.9, `the weather's own entry carries only ${found.length} of ${WEATHER_STRINGS.length}`);
  for (const word of WEATHER_CODE) assert.ok(out.includes(word), `the weather's entry has no ${word}`);
});

for (const entry of ["./index.ts", "./path-on-map/draw.ts", "./basemap.ts", "./body/index.ts", "./body/draw.ts"]) {
  test(`${entry.slice(2)} bundles no weather code: no contract, glyphs or ECCC table`, async () => {
    const out = await bundle(entry);
    const found = WEATHER_STRINGS.filter((s) => out.includes(JSON.stringify(s).slice(1, -1)));
    assert.deepEqual(found.slice(0, 10), [], `${found.length} of the weather's strings are in ${entry}'s bundle (${out.length} bytes)`);
    for (const word of WEATHER_CODE) assert.ok(!out.includes(word), `${entry}'s bundle has ${word}`);
  });
}

for (const entry of ["./index.ts", "./path-on-map/draw.ts", "./basemap.ts", "./weather/index.ts"]) {
  test(`${entry.slice(2)} bundles no body code: no contract, region table, manifest or drawing`, async () => {
    const out = await bundle(entry);
    const found = BODY_STRINGS.filter((s) => out.includes(JSON.stringify(s).slice(1, -1)));
    assert.deepEqual(found.slice(0, 10), [], `${found.length} of the body's strings are in ${entry}'s bundle (${out.length} bytes)`);
    for (const word of ["drawBody", "body: true", "body:!0", "GLTFLoader", "Z-Anatomy"]) assert.ok(!out.includes(word), `${entry}'s bundle has ${word}`);
  });
}
