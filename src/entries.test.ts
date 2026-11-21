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

for (const entry of ["./index.ts", "./path-on-map/draw.ts", "./basemap.ts"]) {
  test(`${entry.slice(2)} bundles no body code: no contract, region table, manifest or drawing`, async () => {
    const out = await bundle(entry);
    const found = BODY_STRINGS.filter((s) => out.includes(JSON.stringify(s).slice(1, -1)));
    assert.deepEqual(found.slice(0, 10), [], `${found.length} of the body's strings are in ${entry}'s bundle (${out.length} bytes)`);
    for (const word of ["drawBody", "body: true", "body:!0", "GLTFLoader", "Z-Anatomy"]) assert.ok(!out.includes(word), `${entry}'s bundle has ${word}`);
  });
}
