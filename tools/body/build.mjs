#!/usr/bin/env node
// Builds the body component's mesh, assets/body/adult.glb, from its source:
// the Human Reference Atlas's 3D reference objects, the Visible Human male
// (HuBMAP CCF, ccf-releases v2.0 models/3d-vh-m-united.glb.zip), licensed CC BY 4.0.
//
//   node tools/body/build.mjs --source <dir>    (the zip is downloaded there and checked against SOURCE.sha256)
//
// The source is never committed (154 MB); the output is. What goes in comes
// from src/body/regions.ts and nowhere else: one mesh per region and side
// (`liver`, `kidney.right`), named so, each carrying its layer in extras, and
// one context mesh per layer for what is not a region (`skin`, `skeleton`).
// Every mesh is welded, simplified to a triangle budget, quantised and
// meshopt-compressed. The coordinate frame is the source's: metres, y up,
// the body facing +z, its right at −x.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, reorder, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { REGIONS, LAYER_NODES, LAYERS, meshName } from '../../src/body/regions.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const OUTPUT = 'assets/body/adult.glb';
export const SOURCE = {
  url: 'https://github.com/hubmapconsortium/ccf-releases/raw/main/v2.0/models/3d-vh-m-united.glb.zip',
  zip: '3d-vh-m-united.glb.zip',
  glb: '3d-vh-m-united.glb',
  sha256: '8e7e941afaf685b13b614586ae078444fdbbdd1ca4ded8cf62b7d766e3fd41d5',
  licence: 'CC BY 4.0',
  credit: 'Human Reference Atlas 3D reference objects (HuBMAP), Visible Human male, CC BY 4.0',
};
/** Triangles per mesh after simplification: enough to read at a phone's width, small enough to load fast. */
const BUDGET = { skin: 36000, skeleton: 14000, organs: 5000, brain: 9000, 'small-intestine': 9000, 'large-intestine': 7000, spine: 14000, pelvis: 8000, femur: 2500, tibia: 2000, patella: 600 };

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const exists = (p) => access(p).then(() => true, () => false);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function source(dir) {
  const zip = join(dir, SOURCE.zip);
  if (!(await exists(zip))) {
    console.log(`downloading ${SOURCE.url}`);
    const response = await fetch(SOURCE.url);
    if (!response.ok) throw new Error(`${SOURCE.url}: ${response.status}`);
    await writeFile(zip, Buffer.from(await response.arrayBuffer()));
  }
  const got = sha(await readFile(zip));
  if (got !== SOURCE.sha256) throw new Error(`${zip}: sha256 ${got}, expected ${SOURCE.sha256}`);
  const glb = join(dir, SOURCE.glb);
  if (!(await exists(glb))) execFileSync('unzip', ['-oq', zip, SOURCE.glb, '-d', dir]);
  return glb;
}

/** Every mesh primitive under `node`, as world-space positions and indices; nodes in `skip` (and their subtrees) are left out. */
function collect(node, skip, out = { positions: [], indices: [] }) {
  if (skip.has(node)) return out;
  const mesh = node.getMesh();
  if (mesh) {
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      const base = out.positions.length / 3;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        out.positions.push(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
      }
      const idx = prim.getIndices();
      if (idx) for (let i = 0; i < idx.getCount(); i++) out.indices.push(base + idx.getScalar(i));
      else for (let i = 0; i < pos.getCount(); i++) out.indices.push(base + i);
    }
  }
  for (const child of node.listChildren()) collect(child, skip, out);
  return out;
}

async function main() {
  const dir = resolve(arg('--source') ?? join(REPO, '.tmp/body-source'));
  await mkdir(dir, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const input = await io.read(await source(dir));
  const byName = new Map(input.getRoot().listNodes().map((n) => [n.getName(), n]));
  const find = (name) => { const n = byName.get(name); if (!n) throw new Error(`source has no node ${name}`); return n; };

  // What to cut: each region's side, then each layer's rest.
  const pieces = [];
  for (const [id, def] of Object.entries(REGIONS)) {
    const sides = Array.isArray(def.nodes) ? [[null, def.nodes]] : [['right', def.nodes.right], ['left', def.nodes.left]];
    for (const [side, names] of sides) pieces.push({ name: meshName(id, side), layer: def.layer, region: id, roots: names.map(find), budget: BUDGET[id] ?? BUDGET[def.layer] });
  }
  // A node is drawn once: a region inside another (the appendix inside the colon) is cut out of it, and every region out of its layer's rest.
  const claimed = new Set(pieces.flatMap((p) => p.roots));
  for (const p of pieces) p.skip = new Set([...claimed].filter((n) => !p.roots.includes(n)));
  for (const layer of LAYERS) for (const name of LAYER_NODES[layer]) pieces.push({ name: layer, layer, region: null, roots: [find(name)], budget: BUDGET[layer], skip: claimed });

  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const doc = new Document();
  doc.getRoot().getAsset().extras = { source: SOURCE.credit, url: SOURCE.url, built: 'tools/body/build.mjs' };
  const buffer = doc.createBuffer();
  const scene = doc.createScene('body');
  const root = doc.createNode('body');
  scene.addChild(root);
  const report = [];
  for (const piece of pieces) {
    const geo = { positions: [], indices: [] };
    for (const r of piece.roots) collect(r, piece.skip ?? new Set(), geo);
    if (!geo.indices.length) throw new Error(`${piece.name}: no triangles`);
    const { positions, indices } = reduce(weldPositions(geo), piece.budget);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
    const mesh = doc.createMesh(piece.name).addPrimitive(prim);
    root.addChild(doc.createNode(piece.name).setMesh(mesh).setExtras({ layer: piece.layer, region: piece.region }));
    report.push(`${piece.name.padEnd(18)} ${String(geo.indices.length / 3).padStart(7)} → ${String(indices.length / 3).padStart(6)} triangles`);
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14 }), prune());
  const bytes = await io.writeBinary(doc);
  await mkdir(join(REPO, 'assets/body'), { recursive: true });
  await writeFile(join(REPO, OUTPUT), bytes);
  console.log(report.join('\n'));
  console.log(`wrote ${OUTPUT}: ${(bytes.length / 1024).toFixed(0)} KB, sha256 ${sha(bytes)}`);
}

/** One vertex per position (the source repeats them at every face's corner), to 0.1 mm. */
function weldPositions({ positions, indices }) {
  const map = new Map(), out = [], remap = new Uint32Array(positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const key = `${Math.round(positions[i * 3] * 1e4)},${Math.round(positions[i * 3 + 1] * 1e4)},${Math.round(positions[i * 3 + 2] * 1e4)}`;
    let j = map.get(key);
    if (j === undefined) { j = out.length / 3; map.set(key, j); out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
    remap[i] = j;
  }
  const tri = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  return { positions: new Float32Array(out), indices: new Uint32Array(tri) };
}

/** Simplified to at most `budget` triangles (meshoptimizer), and compacted to the vertices still used. */
function reduce({ positions, indices }, budget) {
  let out = indices;
  if (indices.length / 3 > budget) [out] = MeshoptSimplifier.simplify(indices, positions, 3, budget * 3, 0.05);
  const [remap, count] = MeshoptSimplifier.compactMesh(out);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) pos.set(positions.subarray(i * 3, i * 3 + 3), remap[i] * 3);
  return { positions: pos, indices: out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
