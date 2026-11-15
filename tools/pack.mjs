#!/usr/bin/env node
// Packs the web package exactly as npm would publish it, for hosts to vendor
// until @zegadb/components is on the registry (APS 10: dependencies come from
// registries by version; a vendored copy of the publishable tarball is the
// interim, never a git pin).
//
//   node tools/pack.mjs <dest dir>
//
// Builds, runs `npm pack` (which writes a reproducible tarball), and prints
// the manifest a host keeps beside it: the file, its sha256, npm's integrity
// and the commit it was packed from. A host's drift check compares its copy
// with that manifest; packing the same commit again gives the same bytes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const dest = resolve(process.argv[2] ?? join(REPO, '.tmp', 'pack'));
await mkdir(dest, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
run('npm', ['run', '--silent', 'build']);
const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', dest]));
const bytes = await readFile(join(dest, packed.filename));
const dirty = run('git', ['status', '--porcelain', '--', 'src', 'components', 'tokens', 'css', 'generated', 'package.json']).trim();
const manifest = {
  package: packed.name,
  version: packed.version,
  file: packed.filename,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  integrity: packed.integrity,
  source: `zegadb/components@${run('git', ['rev-parse', 'HEAD']).trim()}${dirty ? ' (uncommitted changes)' : ''}`,
  files: packed.files.length,
};
console.log(JSON.stringify(manifest, null, 2));
