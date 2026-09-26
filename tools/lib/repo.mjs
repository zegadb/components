// The repository's layout, in one place: every tool (checks, generator,
// reference renderer) finds components, fixtures and reference images
// through these functions, so the layout cannot drift between them.
//
//   components/<id>/<id>.spec.md
//   components/<id>/<id>.contract.json
//   components/<id>/<id>.reference.png, <id>.reference.dark.png   the render of fixtures/default.json
//   components/<id>/fixtures/<name>.json                          one input: a view spec, its result, a size
//   components/<id>/fixtures/<name>.reference.png, .dark.png      its render (every fixture but default)
//   components/<id>/fixtures/data/*.json                          result data shared by fixtures
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The per-fixture tolerance unless a fixture overrides it (CONFORMANCE.md). */
export const DEFAULT_TOLERANCE = Object.freeze({ threshold: 0.1, maxDiffRatio: 0.005, maxCluster: 16 });
export const STATUSES = Object.freeze(['draft', 'review', 'stable']);
export const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** A spec's front matter (`key: value` lines between `---` fences), or null. */
export function frontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return null;
  return Object.fromEntries(match[1].split('\n').filter(Boolean).map((line) => {
    const at = line.indexOf(':');
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }));
}

/** Every component directory: `{ id, dir, status }`, sorted by id. */
export async function components(root) {
  const entries = await readdir(join(root, 'components'), { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = `components/${entry.name}`;
    const spec = await readFile(join(root, dir, `${entry.name}.spec.md`), 'utf8').catch(() => null);
    out.push({ id: entry.name, dir, status: spec ? frontMatter(spec)?.status ?? null : null });
  }
  return out;
}

/** Every fixture of every component: `{ component, name, path, draft }`, `path` relative to the root. */
export async function fixtures(root) {
  const out = [];
  for (const c of await components(root)) {
    const names = await readdir(join(root, c.dir, 'fixtures')).catch(() => []);
    for (const file of names.filter((n) => n.endsWith('.json')).sort()) {
      out.push({ component: c.id, name: file.slice(0, -'.json'.length), path: `${c.dir}/fixtures/${file}`, draft: c.status === 'draft' });
    }
  }
  return out;
}

/** Where a fixture's reference renders live: `{ light, dark }`, relative to the root. */
export function referencePaths({ component, name }) {
  const base = name === 'default' ? `components/${component}/${component}` : `components/${component}/fixtures/${name}`;
  return { light: `${base}.reference.png`, dark: `${base}.reference.dark.png` };
}
