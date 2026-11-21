// The checks must fail on each kind of drift they exist to catch. Each test
// copies the repository into .tmp/, breaks one thing, and runs the same
// checkRepo() that CI runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepo, lintSpec } from '../check.mjs';
import { render } from '../tokens.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TOKENS = JSON.parse(await readFile(join(ROOT, 'tokens/tokens.json'), 'utf8'));

async function copy() {
  await mkdir(join(ROOT, '.tmp'), { recursive: true });
  const dir = await mkdtemp(join(ROOT, '.tmp', 'check-'));
  for (const part of ['components', 'generated', 'schemas', 'src', 'tokens', 'tools', 'TEMPLATE.spec.md', 'REFERENCES.lock.json']) {
    await cp(join(ROOT, part), join(dir, part), { recursive: true });
  }
  return dir;
}
async function edit(path, change) {
  await writeFile(path, change(await readFile(path, 'utf8')));
}
async function broken(breakIt) {
  const dir = await copy();
  try {
    await breakIt(dir);
    return await checkRepo(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const SPEC = 'components/path-on-map/path-on-map.spec.md';

test('the repository as committed passes', async () => {
  assert.deepEqual(await checkRepo(ROOT), []);
});

test('a token changed without regenerating is stale in every generated file', async () => {
  const found = await broken((dir) => edit(join(dir, 'tokens/tokens.json'), (t) => t.replace('"#AC542E"', '"#AC542F"')));
  for (const file of ['tokens.css', 'tokens.js', 'Tokens.swift', 'tokens.rs']) {
    assert.ok(found.some((m) => m.startsWith(`generated/${file}: stale`)), `${file} reported stale: ${found.join('\n')}`);
  }
});

test('a hand edit to a generated file is caught', async () => {
  const found = await broken((dir) => edit(join(dir, 'generated/tokens.rs'), (t) => t.replace('pub const XXS: f64 = 2.0;', 'pub const XXS: f64 = 3.0;')));
  assert.deepEqual(found, ['generated/tokens.rs: stale; run `npm run tokens` and commit the result']);
});

test('ramps whose themes differ in length are refused', () => {
  const tokens = structuredClone(TOKENS);
  tokens.ramp.sequential.dark.pop();
  assert.throws(() => render(tokens), /ramp\.sequential: light has 5 stops, dark 4/);
});

test('a raw hex colour in a spec is refused outside the Tokens section only', () => {
  const text = '## Colour and type\n\nThe path is #AC542E.\n\n## Tokens\n\n{color.accent} is #AC542E.\n';
  assert.deepEqual(lintSpec(text, TOKENS, 's.md'), ['s.md:3: raw colour #AC542E; name a {color.…}, {ramp.…} or {theme.…} token']);
});

test('a px length in a spec is refused, and a points length is not', () => {
  const found = lintSpec('## Measurements\n\nwidth 6 pt, inset 12px, gap 4 px\n', TOKENS, 's.md');
  assert.deepEqual(found, ['s.md:3: px length "12px"; lengths are points (pt) or a {space.…}/{size.…} token', 's.md:3: px length "4 px"; lengths are points (pt) or a {space.…}/{size.…} token']);
});

test('a reference to a token that does not exist is refused', () => {
  assert.deepEqual(lintSpec('uses {color.accnt} and {space.xl}\n', TOKENS, 's.md'), ['s.md:1: {color.accnt} is not a token in tokens/tokens.json']);
});

test('a spec with a section missing or out of order is refused', async () => {
  const found = await broken((dir) => edit(join(dir, SPEC), (t) => t.replace('## Animation\n', '## Motion\n')));
  assert.ok(found.some((m) => m.includes("sections must be the template's, in order; missing: Animation; not in the template: Motion")), found.join('\n'));
});

test('a missing dark reference is refused', async () => {
  const found = await broken((dir) => unlink(join(dir, 'components/globe-arcs/globe-arcs.reference.dark.png')));
  assert.ok(found.includes('components/globe-arcs/globe-arcs.reference.dark.png: missing reference render'), found.join('\n'));
});

test('a reference image replaced outside the renderer is refused', async () => {
  const found = await broken(async (dir) => {
    const light = join(dir, 'components/path-on-map/path-on-map.reference.png');
    await cp(join(dir, 'components/path-on-map/fixtures/solid-no-buildings.reference.png'), light);
  });
  assert.ok(found.some((m) => m.startsWith('components/path-on-map/path-on-map.reference.png: not the image REFERENCES.lock.json records')), found.join('\n'));
});

test('a component without its contract is refused', async () => {
  const found = await broken((dir) => unlink(join(dir, 'components/globe-arcs/globe-arcs.contract.json')));
  assert.ok(found.includes('components/globe-arcs/globe-arcs.contract.json: missing'), found.join('\n'));
});

test('a fixture option outside its contract range is refused', async () => {
  const found = await broken((dir) => edit(join(dir, 'components/path-on-map/fixtures/default.json'), (t) => t.replace('"bearing": -30', '"bearing": -300')));
  assert.ok(found.some((m) => m.startsWith('components/path-on-map/fixtures/default.json: options.bearing: -300 is below the minimum -180')), found.join('\n'));
});

test('a fixture that leaves a required role unbound is refused', async () => {
  const found = await broken((dir) => edit(join(dir, 'components/globe-arcs/fixtures/default.json'), (t) => t.replace(/,\s*"to": "at"/, '')));
  assert.ok(found.includes('components/globe-arcs/fixtures/default.json: required role `to` is not bound'), found.join('\n'));
});

test('an invalid contract example must give exactly the error it states', async () => {
  const found = await broken((dir) => edit(join(dir, 'components/globe-arcs/globe-arcs.contract.json'), (t) => t.replace('"help": "use a value in [0, 85]"', '"help": "tilt less"')));
  assert.ok(found.some((m) => m.startsWith('components/globe-arcs/globe-arcs.contract.json examples.invalid[0]: the error is')), found.join('\n'));
});

test('a draft needs no references, but a review component does', async () => {
  const found = await broken((dir) => edit(join(dir, 'components/hockey3darena/hockey3darena.spec.md'), (t) => t.replace('status: draft', 'status: review')));
  assert.ok(found.includes('components/hockey3darena/fixtures/default.json: missing (a review component needs its default fixture)'), found.join('\n'));
});

// Format 2 (plain data) and the web package.

test('a theme role a spec names must exist in every host', () => {
  const themes = { roles: { accent: '' } };
  assert.deepEqual(lintSpec('uses {theme.accent} and {theme.acent}\n', TOKENS, 's.md', themes), ['s.md:1: {theme.acent} is not a theme role in tokens/themes.json']);
});

test('a theme changed without regenerating leaves the package stale', async () => {
  const found = await broken((dir) => edit(join(dir, 'tokens/themes.json'), (t) => t.replace('"accent": "#6646EE"', '"accent": "#6646EF"')));
  for (const file of ['src/generated/themes.ts', 'generated/themes.css']) assert.ok(found.includes(`${file}: stale; run \`npm run generate\` and commit the result`), found.join('\n'));
});

test('a contract changed without regenerating leaves the package stale', async () => {
  const found = await broken((dir) => edit(join(dir, 'components/function-plot/function-plot.contract.json'), (t) => t.replace('"maxItems": 6,\n        "description": "The curves', '"maxItems": 5,\n        "description": "The curves')));
  assert.ok(found.includes('src/generated/contracts/function-plot.ts: stale; run `npm run generate` and commit the result'), found.join('\n'));
});

test('a generated contract that no contract makes any more is stale', async () => {
  const found = await broken((dir) => writeFile(join(dir, 'src/generated/contracts/gone.ts'), 'export const CONTRACT = {};\n'));
  assert.ok(found.includes('src/generated/contracts/gone.ts: stale; run `npm run generate` and commit the result'), found.join('\n'));
});

test('a format-2 invalid example must give exactly the error validate() gives', async () => {
  const found = await broken((dir) => edit(join(dir, 'components/price-chart/price-chart.contract.json'), (t) => t.replace('"help": "give the points oldest first, one per period"', '"help": "sort them"')));
  assert.ok(found.some((m) => m.startsWith('components/price-chart/price-chart.contract.json examples.invalid[1]: the first error is')), found.join('\n'));
});

test('a web fixture whose spec fails validation is refused', async () => {
  const found = await broken((dir) => edit(join(dir, 'components/function-plot/web/default.json'), (t) => t.replace('"fn": "4 - x^2"', '"fn": "4 - x^"')));
  assert.ok(found.some((m) => m.startsWith('components/function-plot/web/default.json: data.functions[0].fn: the expression ends too soon')), found.join('\n'));
});

test('a web fixture needs both references, locked', async () => {
  const missing = await broken((dir) => unlink(join(dir, 'components/price-chart/web/candles-zega.reference.dark.png')));
  assert.ok(missing.includes('components/price-chart/web/candles-zega.reference.dark.png: missing reference render'), missing.join('\n'));
  const swapped = await broken((dir) => cp(join(dir, 'components/price-chart/web/default.reference.png'), join(dir, 'components/price-chart/web/candles-zega.reference.png')));
  assert.ok(swapped.some((m) => m.startsWith('components/price-chart/web/candles-zega.reference.png: not the image REFERENCES.lock.json records')), swapped.join('\n'));
});

test('a format-2 component in review needs its default web fixture', async () => {
  const found = await broken(async (dir) => {
    for (const f of ['default.json', 'default.reference.png', 'default.reference.dark.png']) await unlink(join(dir, 'components/function-plot/web', f));
  });
  assert.ok(found.includes('components/function-plot/web/default.json: missing (a review component needs its default web fixture)'), found.join('\n'));
  assert.ok(found.includes('REFERENCES.lock.json: components/function-plot/web/default.reference.png is recorded but is no component\'s reference'), found.join('\n'));
});

test('the zql adapter is checked like a format-1 contract', async () => {
  const found = await broken((dir) => edit(join(dir, 'components/path-on-map/fixtures/default.json'), (t) => t.replace('"path": "at"', '"pathx": "at"')));
  assert.ok(found.includes('components/path-on-map/fixtures/default.json: required role `path` is not bound'), found.join('\n'));
});
