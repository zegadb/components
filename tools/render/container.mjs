#!/usr/bin/env node
// Runs a web render command inside the pinned Playwright image, the same
// image CI's conformance job uses, so references render and verify with the
// same Chromium, fonts and software GL everywhere.
//
//   node tools/render/container.mjs tools/render/web.mjs [--verify] [--only <id>]
//   node tools/render/container.mjs tools/render/screens.mjs
//
// The repository goes in as a tar on stdin (no bind mount: Docker on a Mac
// often can't see the volume a checkout lives on), and what the command wrote
// (references, the lock, screenshots, failed renders) comes back as a tar on
// stdout. Needs `npm install` and `npm run build` first (node_modules and dist
// travel with it; everything in them is plain files).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const IMAGE = 'mcr.microsoft.com/playwright:v1.63.0-noble';
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (!args.length) { console.error('usage: node tools/render/container.mjs <script> [args…]'); process.exit(2); }

const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const inside = [
  'set -e',
  'mkdir -p /repo && tar -x -C /repo && cd /repo',
  `node ${args.map(quote).join(' ')} >&2 || code=$?`,
  'tar -c components REFERENCES.lock.json $(ls -d .tmp screens 2>/dev/null)',
  'exit ${code:-0}',
].join('\n');

// macOS's tar adds AppleDouble (._*) files and extended attributes unless told not to.
const mac = process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs'] : [];
const pack = spawn('tar', ['-c', ...mac, '--exclude=./.git', '--exclude=./.tmp', '--exclude=./screens', '-C', REPO, '.'], { stdio: ['ignore', 'pipe', 'inherit'] });
const docker = spawn('docker', ['run', '--rm', '-i', '-e', 'HOME=/tmp', IMAGE, 'bash', '-c', inside], { stdio: ['pipe', 'pipe', 'inherit'] });
const unpack = spawn('tar', ['-x', '-C', REPO], { stdio: ['pipe', 'inherit', 'inherit'] });
pack.stdout.pipe(docker.stdin);
docker.stdout.pipe(unpack.stdin);
const done = (p) => new Promise((ok) => p.on('close', (code) => ok(code ?? 1)));
const [, run, out] = await Promise.all([done(pack), done(docker), done(unpack)]);
process.exit(run || out);
