#!/usr/bin/env node
// Every repository rule a machine can check, in one pass (CI runs this):
//
//   tokens      tokens.json against its schema; generated/ not stale
//   contracts   each <id>.contract.json against the contract schema; its examples against the view-spec schema and itself
//   fixtures    each fixture against the fixture schema; its view spec against the contract; its result file readable
//   files       spec + contract for every component; for non-drafts, a default fixture and light + dark references
//               for every fixture, at the fixture's pixel size, each recorded in REFERENCES.lock.json by SHA-256
//   specs       the template's sections in order; no raw hex colours or px values outside `## Tokens`;
//               every {token.reference} names a token; every relative link resolves
//
//   node tools/check.mjs            exit 1 with every problem listed
import { createHash } from 'node:crypto';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './lib/schema.js';
import { components, fixtures, frontMatter, referencePaths, STATUSES, ID_PATTERN } from './lib/repo.mjs';
import { problems as tokenProblems, render } from './tokens.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const exists = (path) => access(path).then(() => true, () => false);
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const fmt = (errors) => errors.map((e) => `${e.at}: ${e.message}${e.help ? ` (${e.help})` : ''}`);

/** A PNG's pixel width and height, from its IHDR chunk. */
export function pngSize(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== signature || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The `## ` headings of a markdown file, in order, outside fenced code. */
export function headings(text) {
  let fenced = false;
  const out = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    else if (!fenced && line.startsWith('## ')) out.push(line.slice(3).trim());
  }
  return out;
}

const HEX = /(^|[^&\w])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1,5})?\b/g;
const PX = /\b\d+(?:\.\d+)?\s?px\b/gi;
const TOKEN_REF = /\{((?:color|ramp|space|radius|stroke|opacity|size|type|motion)\.[A-Za-z0-9.]+)\}/g;
export const EXEMPT_SECTION = 'Tokens';

/** Lint one spec's text: raw colours and px lengths outside `## Tokens`, unknown token references. Returns messages. */
export function lintSpec(text, tokens, where) {
  const out = [];
  let section = '', fenced = false;
  text.split('\n').forEach((line, i) => {
    if (line.startsWith('```')) fenced = !fenced;
    if (!fenced && line.startsWith('## ')) section = line.slice(3).trim();
    const at = `${where}:${i + 1}`;
    if (section !== EXEMPT_SECTION) {
      for (const m of line.matchAll(HEX)) out.push(`${at}: raw colour ${m[0].trim()}; name a {color.…} or {ramp.…} token`);
      for (const m of line.matchAll(PX)) out.push(`${at}: px length "${m[0]}"; lengths are points (pt) or a {space.…}/{size.…} token`);
    }
    for (const m of line.matchAll(TOKEN_REF)) {
      const node = m[1].split('.').reduce((n, key) => (n && typeof n === 'object' && Object.hasOwn(n, key) ? n[key] : undefined), tokens);
      const leaf = node && typeof node === 'object' && (Object.hasOwn(node, 'value') || Object.hasOwn(node, 'light'));
      if (!leaf) out.push(`${at}: {${m[1]}} is not a token in tokens/tokens.json`);
    }
  });
  return out;
}

/** Check a view spec (from a fixture or a contract example) against the view-spec schema and its contract. */
function checkSpec(spec, contract, viewSchema, where) {
  const out = fmt(check(spec, viewSchema)).map((m) => `${where}: ${m}`);
  if (out.length) return out;
  if (spec.component !== contract.id) out.push(`${where}: component "${spec.component}" is not ${contract.id}`);
  if (spec.version.split('.')[0] !== contract.version.split('.')[0]) out.push(`${where}: version ${spec.version} is not major ${contract.version.split('.')[0]}`);
  for (const [field, declared] of [['surface', contract.surfaceParams], ['options', contract.options]]) {
    for (const [key, value] of Object.entries(spec[field] || {})) {
      if (!Object.hasOwn(declared, key)) out.push(`${where}: ${field}.${key} is not declared by the contract`);
      else out.push(...fmt(check(value, declared[key], `${field}.${key}`)).map((m) => `${where}: ${m}`));
    }
  }
  for (const [role, def] of Object.entries(contract.roles)) {
    if (def.required && !Object.hasOwn(spec.binding, role)) out.push(`${where}: required role \`${role}\` is not bound`);
  }
  for (const key of Object.keys(spec.binding)) {
    if (key !== 'rows' && key !== 'groups' && !Object.hasOwn(contract.roles, key)) out.push(`${where}: binding.${key} is not a role of ${contract.id}`);
  }
  if (contract.data.groups === 'required' && !Object.hasOwn(spec.binding, 'groups')) out.push(`${where}: ${contract.id} needs binding.groups`);
  if (contract.data.groups === 'none' && Object.hasOwn(spec.binding, 'groups')) out.push(`${where}: ${contract.id} takes no groups`);
  return out;
}

export async function checkRepo(root = ROOT) {
  const out = [];
  const schemas = {
    tokens: await json(join(root, 'schemas/tokens.schema.json')),
    contract: await json(join(root, 'schemas/contract.schema.json')),
    view: await json(join(root, 'schemas/view-spec.schema.json')),
    fixture: await json(join(root, 'schemas/fixture.schema.json')),
  };

  // tokens
  const tokens = await json(join(root, 'tokens/tokens.json'));
  const tokenErrors = fmt(check(tokens, schemas.tokens)).map((m) => `tokens/tokens.json: ${m}`);
  out.push(...tokenErrors);
  if (!tokenErrors.length) {
    const found = tokenProblems(tokens);
    out.push(...found.map((m) => `tokens/tokens.json: ${m}`));
    if (!found.length) {
      for (const [path, text] of Object.entries(render(tokens))) {
        const current = await readFile(join(root, path), 'utf8').catch(() => null);
        if (current !== text) out.push(`${path}: stale; run \`npm run tokens\` and commit the result`);
      }
    }
  }

  // the template, and each component's files
  const template = await readFile(join(root, 'TEMPLATE.spec.md'), 'utf8');
  const sections = headings(template);
  out.push(...lintSpec(template, tokens, 'TEMPLATE.spec.md'));
  const lock = await json(join(root, 'REFERENCES.lock.json')).catch(() => ({ images: {} }));
  const locked = new Set();

  for (const c of await components(root)) {
    const base = join(root, c.dir, c.id);
    const where = (suffix) => `${c.dir}/${c.id}${suffix}`;
    if (!ID_PATTERN.test(c.id)) out.push(`${c.dir}: "${c.id}" is not a component id (${ID_PATTERN})`);
    const specText = await readFile(`${base}.spec.md`, 'utf8').catch(() => null);
    if (specText === null) { out.push(`${where('.spec.md')}: missing`); continue; }
    const meta = frontMatter(specText);
    if (!meta) out.push(`${where('.spec.md')}: no front matter (id, status, version)`);
    else {
      if (meta.id !== c.id) out.push(`${where('.spec.md')}: front matter id "${meta.id}" is not the directory name`);
      if (!STATUSES.includes(meta.status)) out.push(`${where('.spec.md')}: status "${meta.status}" is not one of ${STATUSES.join(', ')}`);
    }
    const found = headings(specText);
    if (found.join('\n') !== sections.join('\n')) {
      const missing = sections.filter((s) => !found.includes(s)), extra = found.filter((s) => !sections.includes(s));
      out.push(`${where('.spec.md')}: sections must be the template's, in order${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; not in the template: ${extra.join(', ')}` : ''}${!missing.length && !extra.length ? '; order differs' : ''}`);
    }
    out.push(...lintSpec(specText, tokens, where('.spec.md')));
    for (const m of specText.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (!(await exists(normalize(join(dirname(base), m[1]))))) out.push(`${where('.spec.md')}: link to ${m[1]} does not resolve`);
    }

    const contract = await json(`${base}.contract.json`).catch((error) => (error.code === 'ENOENT' ? null : { parseError: error.message }));
    if (!contract) { out.push(`${where('.contract.json')}: missing`); continue; }
    if (contract.parseError) { out.push(`${where('.contract.json')}: ${contract.parseError}`); continue; }
    const contractErrors = fmt(check(contract, schemas.contract)).map((m) => `${where('.contract.json')}: ${m}`);
    out.push(...contractErrors);
    if (contractErrors.length) continue;
    if (contract.id !== c.id) out.push(`${where('.contract.json')}: id "${contract.id}" is not the directory name`);
    if (meta && meta.version !== contract.version) out.push(`${where('.spec.md')}: version ${meta.version} is not the contract's ${contract.version}`);
    for (const [field, declared] of [['surfaceParams', contract.surfaceParams], ['options', contract.options]]) {
      for (const [key, setting] of Object.entries(declared)) out.push(...fmt(check(setting.default, setting, `${field}.${key}.default`)).map((m) => `${where('.contract.json')}: ${m}`));
    }
    contract.examples.valid.forEach((example, i) => out.push(...checkSpec(example.spec, contract, schemas.view, `${where('.contract.json')} examples.valid[${i}]`)));
    // An invalid example whose error is a setting's must be exactly the error the shared interpreter gives.
    contract.examples.invalid.forEach((example, i) => {
      const [field] = String(example.error.at).split('.');
      const declared = field === 'surface' ? contract.surfaceParams : field === 'options' ? contract.options : null;
      if (!declared) return;
      const got = Object.entries(example.spec[field] || {}).flatMap(([key, value]) => (Object.hasOwn(declared, key) ? check(value, declared[key], `${field}.${key}`) : []))[0];
      if (JSON.stringify(got) !== JSON.stringify(example.error)) out.push(`${where('.contract.json')} examples.invalid[${i}]: the error is ${JSON.stringify(got)}, not the one written`);
    });

    const draft = meta?.status === 'draft';
    const own = (await fixtures(root)).filter((f) => f.component === c.id);
    if (!draft && !own.some((f) => f.name === 'default')) out.push(`${c.dir}/fixtures/default.json: missing (a ${meta?.status} component needs its default fixture)`);
    for (const f of own) {
      const fixture = await json(join(root, f.path)).catch((error) => ({ parseError: error.message }));
      if (fixture.parseError) { out.push(`${f.path}: ${fixture.parseError}`); continue; }
      const errors = fmt(check(fixture, schemas.fixture)).map((m) => `${f.path}: ${m}`);
      out.push(...errors);
      if (errors.length) continue;
      if (fixture.component !== c.id) out.push(`${f.path}: component "${fixture.component}" is not ${c.id}`);
      out.push(...checkSpec(fixture.spec, contract, schemas.view, f.path));
      const resultPath = join(root, dirname(f.path), fixture.resultFile);
      await json(resultPath).catch((error) => out.push(`${f.path}: resultFile ${fixture.resultFile}: ${error.code === 'ENOENT' ? 'missing' : error.message}`));
      for (const m of fixture.masks || []) {
        if (m.x + m.width > fixture.size.width || m.y + m.height > fixture.size.height) out.push(`${f.path}: mask at (${m.x}, ${m.y}) runs off the ${fixture.size.width}×${fixture.size.height} canvas`);
      }
      if (draft) continue;
      for (const path of Object.values(referencePaths(f))) {
        const bytes = await readFile(join(root, path)).catch(() => null);
        if (!bytes) { out.push(`${path}: missing reference render`); continue; }
        const size = pngSize(bytes);
        const want = { width: fixture.size.width * fixture.scale, height: fixture.size.height * fixture.scale };
        if (!size) out.push(`${path}: not a PNG`);
        else if (size.width !== want.width || size.height !== want.height) out.push(`${path}: ${size.width}×${size.height} px, the fixture needs ${want.width}×${want.height}`);
        const sha = createHash('sha256').update(bytes).digest('hex');
        locked.add(path);
        if (lock.images?.[path] !== sha) out.push(`${path}: not the image REFERENCES.lock.json records; references change only through tools/render/render.mjs and Sami's approval`);
      }
    }
    // Reference images with no fixture behind them.
    const loose = [
      ...(await readdir(join(root, c.dir))).filter((n) => n.endsWith('.png')).map((n) => `${c.dir}/${n}`),
      ...(await readdir(join(root, c.dir, 'fixtures')).catch(() => [])).filter((n) => n.endsWith('.png')).map((n) => `${c.dir}/fixtures/${n}`),
    ];
    const expected = new Set(own.flatMap((f) => Object.values(referencePaths(f))));
    for (const path of loose) if (!expected.has(path)) out.push(`${path}: no fixture renders to this image`);
  }
  for (const path of Object.keys(lock.images || {})) if (!locked.has(path)) out.push(`REFERENCES.lock.json: ${path} is recorded but is no component's reference`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = await checkRepo();
  if (found.length) {
    for (const line of found) console.error(line);
    console.error(`\n${found.length} problem(s)`);
    process.exit(1);
  }
  const all = await components(ROOT);
  console.log(`ok: tokens, ${all.length} components (${all.map((c) => `${c.id} [${c.status}]`).join(', ')}), ${(await fixtures(ROOT)).length} fixtures`);
}
