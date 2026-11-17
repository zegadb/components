#!/usr/bin/env node
// Builds the body component's four meshes, assets/body/<body>.glb, and their
// manifest (src/body/manifest.ts):
//
//   man, woman   the Human Reference Atlas's 3D reference objects, the Visible
//                Human male and female (HuBMAP CCF release v2.0), CC BY 4.0
//   boy, girl    the man and the woman, morphed organ by organ into a CC0
//                MakeHuman child outline at age 8, from published paediatric
//                measurements (components/body/references.json, the only
//                place their numbers live). Not a uniform scale: the outline
//                sets the head, trunk and legs apart; the liver, spleen,
//                kidneys, thymus and bladder each take their own measured size;
//                the bladder rises; growth plates are cut in the femur and
//                tibia, and the pelvis shows its three bones.
//
//   node tools/body/build.mjs [--source <dir>]   (sources downloaded there and checked by SHA-256)
//
// The sources are never committed (about 500 MB); the outputs are. What goes
// in comes from src/body/regions.ts: one mesh per region and side
// (`liver`, `kidney__right`), each with its layer in extras, and one context
// mesh per layer (`skin`, `skeleton`, `organs`). Every mesh is welded,
// simplified to a triangle budget, quantised and meshopt-compressed. The frame
// is the atlas's: metres, y up, the body facing +z, its right at −x.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, reorder, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { REGIONS, LAYER_NODES, LAYERS, BODIES, meshName, femaleNode } from '../../src/body/regions.ts';
import { principalLength, insideTest, hanging } from '../../src/body/geometry.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const REFERENCES = JSON.parse(await readFile(join(REPO, 'components/body/references.json'), 'utf8'));
export const output = (body) => `assets/body/${body}.glb`;
const MH = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data';
export const SOURCES = {
  man: { url: 'https://github.com/hubmapconsortium/ccf-releases/raw/main/v2.0/models/3d-vh-m-united.glb.zip', archive: '3d-vh-m-united.glb.zip', glb: '3d-vh-m-united.glb', sha256: '8e7e941afaf685b13b614586ae078444fdbbdd1ca4ded8cf62b7d766e3fd41d5', node: (n) => n },
  woman: { url: 'https://github.com/hubmapconsortium/ccf-releases/raw/main/v2.0/models/3d-vh-f-united.glb.7z', archive: '3d-vh-f-united.glb.7z', glb: '3d-vh-f-united.glb', sha256: 'b84f820009075c154edcf1491539516ef475e788528cdc0cd670c04ee151b99d', node: femaleNode },
  makehuman: {
    'base.obj': '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c',
    'african-male-baby.target': '32ce877fa330805971ca636a78aa736bc486b37118e91d2e4bfb9f1ad2cd48a1', 'african-male-child.target': '5b89c85ed7ba9984b5e57a5844b10eb74ab7fcfa79f77a5a3ec697dd860969ed',
    'asian-male-baby.target': '296f9dd9c9716a0e43afb9dadfb35e11be0ecc1f15d2efae6e903b0e91bc07a5', 'asian-male-child.target': 'c1b56e9cc549cd7c463f407557d7adceaa217b528c600d34c19df98bc3d6472e',
    'caucasian-male-baby.target': 'f970a2e354b70f8438508a884cd40a9b2ea5cbd24fa6b89a99071a30720c7417', 'caucasian-male-child.target': '401b9b0349c88dc7aacb81e71f67daf747fecde0f7fd7f3f6e10fb2ce5586d1e',
    'african-female-baby.target': 'b1d4b5c76c73107b8f433bba6e224addf9da542287612868a02109d0f5a1c235', 'african-female-child.target': 'f88b8f252df8a9a3f35f78e1664983e9a30756bca1e454afce39438296eb7b41',
    'asian-female-baby.target': '43c2a05ac425c4084f9dc30687a294cc5b61699d7c075985536f7e9c3b23f78d', 'asian-female-child.target': 'a4fffea45a475a24a0a7332dac28a07dfd60a9af9eb50b61ed5abd1178197f75',
    'caucasian-female-baby.target': '2ae0b8f760a3608b8e628b9af80054592d0fd0ac4b7867f81d8fc86b5a75c170', 'caucasian-female-child.target': '17fc408839c0a407bf4efd96d9af7eebcdf20d74698659f3597b0647ed6b147e',
  },
};
/** Triangles per mesh after simplification: enough to read at a phone's width, small enough to load fast. */
const BUDGET = { skin: 30000, skeleton: 9000, organs: 1500, brain: 7000, heart: 4000, 'small-intestine': 7000, 'large-intestine': 5000, spine: 10000, pelvis: 6000, femur: 2200, tibia: 1800, patella: 500, lung: 4000, cartilage: 5000 };
const BUDGET_ORGAN = 3500;

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const exists = (p) => access(p).then(() => true, () => false);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fetchChecked(path, url, sha256) {
  if (!(await exists(path))) {
    console.log(`downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  const got = sha(await readFile(path));
  if (got !== sha256) throw new Error(`${path}: sha256 ${got}, expected ${sha256}`);
}

async function atlas(dir, body) {
  const s = SOURCES[body];
  await fetchChecked(join(dir, s.archive), s.url, s.sha256);
  const glb = join(dir, s.glb);
  if (!(await exists(glb))) execFileSync(s.archive.endsWith('.zip') ? 'unzip' : 'bsdtar', s.archive.endsWith('.zip') ? ['-oq', join(dir, s.archive), s.glb, '-d', dir] : ['-xf', join(dir, s.archive), '-C', dir]);
  return glb;
}

// ---------------------------------------------------------------- geometry

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

const bounds = (positions) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  return { min, max, centre: min.map((v, k) => (v + max[k]) / 2), size: min.map((v, k) => max[k] - v) };
};


// --------------------------------------------------------------- the outline

/** A MakeHuman outline: the base mesh's body, the macro targets for sex and age 8 applied, in metres. */
async function makehumanChild(dir, sex) {
  const mh = join(dir, 'makehuman');
  await mkdir(mh, { recursive: true });
  for (const [file, sum] of Object.entries(SOURCES.makehuman)) {
    if (file.endsWith('.target') && !file.includes(`-${sex}-`)) continue;
    await fetchChecked(join(mh, file), `${MH}/${file === 'base.obj' ? '3dobjs' : 'targets/macrodetails'}/${file}`, sum);
  }
  const obj = await readFile(join(mh, 'base.obj'), 'utf8');
  const verts = [], faces = [];
  let group = '';
  for (const line of obj.split('\n')) {
    if (line.startsWith('v ')) verts.push(line.slice(2).trim().split(/\s+/).map(Number));
    else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ') && group === 'body') {
      const f = line.slice(2).trim().split(/\s+/).map((t) => Number(t.split('/')[0]) - 1);
      for (let k = 1; k + 1 < f.length; k++) faces.push(f[0], f[k], f[k + 1]);
    }
  }
  // MakeHuman's age macro: 1 year at 0, 11 at 0.1875; age 8 weighs the baby target 0.3 and the child target 0.7.
  const age = REFERENCES.age, child = (age - 1) / 10, weights = { baby: 1 - child, child };
  for (const ethnic of ['african', 'asian', 'caucasian']) {
    for (const [stage, w] of Object.entries(weights)) {
      const text = await readFile(join(mh, `${ethnic}-${sex}-${stage}.target`), 'utf8');
      for (const line of text.split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const [i, dx, dy, dz] = line.trim().split(/\s+/).map(Number);
        const v = verts[i];
        v[0] += (dx * w) / 3; v[1] += (dy * w) / 3; v[2] += (dz * w) / 3;
      }
    }
  }
  // Only the body's vertices, renumbered; decimetres to metres.
  const used = new Map(), positions = [], indices = [];
  for (const i of faces) {
    if (!used.has(i)) { used.set(i, positions.length / 3); positions.push(verts[i][0] / 10, verts[i][1] / 10, verts[i][2] / 10); }
    indices.push(used.get(i));
  }
  return { positions, indices };
}

/**
 * A neutral form (Sami, 17 Nov): the outline with no external genitalia, as in a medical illustration.
 * Below the crotch, anything hanging between the thighs near the midline (a section loop of its own,
 * narrow, apart from both legs) is folded flat into the crotch; above it, the front of the pubic
 * region is brought back to the line of the skin beside it. Works on a welded mesh, in place; returns
 * how many vertices it moved. On an outline with nothing there it moves nothing.
 */
export function neutralise(positions, indices) {
  const b = bounds(positions), H = b.size[1], cx = b.centre[0];
  const P = (i, k) => positions[i * 3 + k];
  // The crotch, and what hangs below it: the same test the tests hold the built bodies to (src/body/geometry.ts).
  const { crotch, vertices: moved } = hanging(positions, indices);
  // The front and back of the trunk at the crotch, near the midline: where folded vertices go.
  let zf = -Infinity, zb = Infinity;
  for (let i = 0; i < positions.length / 3; i++) if (Math.abs(P(i, 1) - crotch - 0.01) < 0.006 && Math.abs(P(i, 0) - cx) < 0.04 && !moved.has(i)) { zf = Math.max(zf, P(i, 2)); zb = Math.min(zb, P(i, 2)); }
  for (const i of moved) { positions[i * 3 + 1] = crotch + 0.002; positions[i * 3 + 2] = Math.max(zb, Math.min(zf, P(i, 2))); }
  // An outline with nothing hanging is already neutral: leave it as it is.
  if (!moved.size) return 0;
  // Above it, up to 5 % of the height: the front near the midline no further forward than the skin 5-8 % of the height either side.
  const bins = new Map();
  for (let i = 0; i < positions.length / 3; i++) {
    const y = P(i, 1), dx = Math.abs(P(i, 0) - cx);
    if (y < crotch || y > crotch + 0.05 * H || dx < 0.028 * H || dx > 0.045 * H) continue;
    const k = Math.floor((y - crotch) / 0.005);
    bins.set(k, Math.max(bins.get(k) ?? -Infinity, P(i, 2)));
  }
  let flattened = 0;
  for (let i = 0; i < positions.length / 3; i++) {
    const y = P(i, 1);
    if (y < crotch || y > crotch + 0.05 * H || Math.abs(P(i, 0) - cx) >= 0.028 * H) continue;
    const front = bins.get(Math.floor((y - crotch) / 0.005));
    // Only a real protrusion (over 1.2 cm proud of the skin beside it): an ordinary mons stays as it is.
    if (front !== undefined && P(i, 2) > front + 0.012) { positions[i * 3 + 2] = front + 0.004; flattened++; }
  }
  // The folded part stays as a flat sheet in the crotch (seen edge-on from any ordinary view): dropping
  // its faces would open a hole in the outline, and the outline must stay closed (organs are tested inside it).
  return moved.size + flattened;
}

/** Landmarks and widths of an outline: the sole, knee, crotch, neck and crown heights, and slices of the trunk, head and leg. */
export function measure(positions, indices) {
  const b = bounds(positions), H = b.size[1], cx = b.centre[0];
  const P = (i, k) => positions[i * 3 + k];
  // A cross-section at height y: the outline's loops (the trunk, each arm, each leg), from the triangles the plane cuts.
  const section = (y) => {
    const parent = new Map(), points = new Map();
    const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
    const edgePoint = (a, c) => {
      const key = a < c ? `${a}_${c}` : `${c}_${a}`;
      if (!points.has(key)) { const t = (y - P(a, 1)) / (P(c, 1) - P(a, 1)); points.set(key, [P(a, 0) + t * (P(c, 0) - P(a, 0)), P(a, 2) + t * (P(c, 2) - P(a, 2))]); parent.set(key, key); }
      return key;
    };
    for (let i = 0; i < indices.length; i += 3) {
      const t = [indices[i], indices[i + 1], indices[i + 2]];
      const crossing = [];
      for (let e = 0; e < 3; e++) { const a = t[e], c = t[(e + 1) % 3]; if ((P(a, 1) - y) * (P(c, 1) - y) < 0) crossing.push(edgePoint(a, c)); }
      if (crossing.length === 2) { const ra = find(crossing[0]), rc = find(crossing[1]); if (ra !== rc) parent.set(ra, rc); }
    }
    const loops = new Map();
    for (const [key, p] of points) { const r = find(key); if (!loops.has(r)) loops.set(r, []); loops.get(r).push(p); }
    return [...loops.values()].filter((l) => l.length > 4).map((l) => {
      const xs = l.map((p) => p[0]), zs = l.map((p) => p[1]);
      const lo = Math.min(...xs), hi = Math.max(...xs), zlo = Math.min(...zs), zhi = Math.max(...zs);
      return { lo, hi, width: hi - lo, xc: (lo + hi) / 2, depth: zhi - zlo, zc: (zlo + zhi) / 2 };
    });
  };
  // The trunk (or head): the loop across the midline. The right leg: the loop nearest the midline on the right (the hands hang outside it).
  const central = (y) => section(y).filter((l) => l.lo < cx && l.hi > cx).sort((a, c) => c.width - a.width)[0] ?? null;
  const leg = (y) => section(y).filter((l) => l.hi < cx).sort((a, c) => c.hi - a.hi)[0];
  let crotch = b.min[1] + 0.3 * H;
  while (!central(crotch) && crotch < b.min[1] + 0.65 * H) crotch += 0.002 * H;
  let neck = 0, best = Infinity;
  for (let y = crotch + 0.62 * (b.max[1] - crotch); y < b.max[1] - 0.06 * H; y += 0.002 * H) { const w = central(y)?.width ?? Infinity; if (w < best) { best = w; neck = y; } }
  let knee = 0; best = Infinity;
  for (let f = 0.35; f <= 0.7; f += 0.005) { const y = b.min[1] + f * (crotch - b.min[1]); const w = leg(y).width; if (w < best) { best = w; knee = y; } }
  return {
    H, cx, sole: b.min[1], knee, crotch, neck, crown: b.max[1],
    // The waist and the lower chest: both below where the arms meet the trunk (from 0.64 of the way up in the atlas woman).
    trunk: central(crotch + TRUNK_AT.abdomen * (neck - crotch)),
    chest: central(crotch + TRUNK_AT.chest * (neck - crotch)),
    head: central(neck + 0.5 * (b.max[1] - neck)),
    thigh: leg(b.min[1] + 0.75 * (crotch - b.min[1])),
    shin: leg(b.min[1] + 0.3 * (crotch - b.min[1])),
    ankle: leg(b.min[1] + 0.08 * (crotch - b.min[1])),
    /** The trunk's width a fraction `f` of the way from crotch to neck. */
    trunkWidthAt: (f) => central(crotch + f * (neck - crotch))?.width ?? null,
    // Across the shoulders (arms and all): the midclavicular line is a quarter of this from the midline.
    shoulders: central(crotch + 0.8 * (neck - crotch)),
    // The trunk's width from crotch (0) to neck (1): where an arm touches the trunk the loop jumps wide.
    profile: Array.from({ length: 15 }, (_, i) => { const f = 0.1 + i * 0.06; const l = central(crotch + f * (neck - crotch)); return [+f.toFixed(2), l ? +l.width.toFixed(3) : null]; }),
  };
}

/** Where, from crotch (0) to neck (1), the trunk's abdomen and chest are measured. */
const TRUNK_AT = { abdomen: 0.4, chest: 0.58 };
/** Where the trunk's room for the organs is measured, crotch (0) to neck (1). */
const CAVITY_AT = [0.25, 0.32, 0.39, 0.46, 0.53, 0.6];

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The map from the adult's body to the child's: piecewise in height through the landmarks, each band its own width and depth. */
export function bodyMap(A, C, cavity = null) {
  const ys = ['sole', 'knee', 'crotch', 'neck', 'crown'];
  const y = (v) => {
    let k = 0;
    while (k < ys.length - 2 && v > A[ys[k + 1]]) k++;
    const a0 = A[ys[k]], a1 = A[ys[k + 1]], c0 = C[ys[k]], c1 = C[ys[k + 1]];
    return c0 + ((v - a0) * (c1 - c0)) / (a1 - a0);
  };
  const dy = (v) => { const e = 1e-4; return (y(v + e) - y(v - e)) / (2 * e); };
  const band = (v) => {
    const legLength = A.crotch - A.sole;
    const toTrunk = smooth(A.crotch - 0.25 * legLength, A.crotch, v), toHead = smooth(A.neck - 0.01, A.neck + 0.02, v);
    return { trunk: toTrunk * (1 - toHead), head: toHead, leg: 1 - toTrunk };
  };
  const sx = { head: C.head.width / A.head.width };
  const sz = { head: C.head.depth / A.head.depth };
  // The leg through three sections, ankle, shin and thigh: its middle, width and depth at each, in between by height.
  const STATIONS = [['ankle', 0.08], ['shin', 0.3], ['thigh', 0.75]];
  const legAt = (v) => {
    const f = (v - A.sole) / (A.crotch - A.sole);
    let k = 0;
    while (k < STATIONS.length - 2 && f > STATIONS[k + 1][1]) k++;
    const [n0, f0] = STATIONS[k], [n1, f1] = STATIONS[k + 1];
    const t = Math.max(0, Math.min(1, (f - f0) / (f1 - f0)));
    const mix = (key, src) => src[n0][key] + t * (src[n1][key] - src[n0][key]);
    return { xA: mix('xc', A), xC: mix('xc', C), sx: mix('width', C) / mix('width', A), zA: mix('zc', A), zC: mix('zc', C), sz: mix('depth', C) / mix('depth', A) };
  };
  // The trunk's width, depth and middle run from the abdomen's to the chest's (a child's chest is relatively broader).
  const yAbdomen = A.crotch + TRUNK_AT.abdomen * (A.neck - A.crotch), yChest = A.crotch + TRUNK_AT.chest * (A.neck - A.crotch);
  // Across the trunk, what is inside it scales with the cavity, not the outline: an adult's organs sit
  // inside a thicker wall of muscle and fat than a child's (cavity: the child's room across over the adult's organs' width).
  const outline = (v) => { const t = Math.max(0, Math.min(1, (v - yAbdomen) / (yChest - yAbdomen))); return C.trunk.width / A.trunk.width + t * (C.chest.width / A.chest.width - C.trunk.width / A.trunk.width); };
  const across = (v) => {
    if (!cavity) return outline(v);
    const f = (v - A.crotch) / (A.neck - A.crotch);
    if (f <= cavity[0][0]) return cavity[0][1];
    for (let k = 1; k < cavity.length; k++) if (f <= cavity[k][0]) { const [f0, r0] = cavity[k - 1], [f1, r1] = cavity[k]; return r0 + ((f - f0) * (r1 - r0)) / (f1 - f0); }
    return cavity[cavity.length - 1][1];
  };
  const trunk = (v) => {
    const t = Math.max(0, Math.min(1, (v - yAbdomen) / (yChest - yAbdomen)));
    const mix = (a, b) => a + t * (b - a);
    return { sx: across(v), sz: mix(C.trunk.depth / A.trunk.depth, C.chest.depth / A.chest.depth), zA: mix(A.trunk.zc, A.chest.zc), zC: mix(C.trunk.zc, C.chest.zc) };
  };
  // Two maps: organs scale across the trunk with the cavity; bones (and everything else) with the outline.
  const make = (inner) => {
    const trunkX = (v) => (inner ? across(v) : outline(v));
    const map = ([x, v, z]) => {
      const w = band(v), tr = trunk(v), lg = legAt(v);
      const side = x < A.cx ? 1 : -1;
      const legX = (C.cx + side * (lg.xC - C.cx)) + (x - (A.cx + side * (lg.xA - A.cx))) * lg.sx;
      const nx = w.leg * legX + w.trunk * (C.cx + (x - A.cx) * trunkX(v)) + w.head * (C.cx + (x - A.cx) * sx.head);
      const nz = w.leg * (lg.zC + (z - lg.zA) * lg.sz) + w.trunk * (tr.zC + (z - tr.zA) * tr.sz) + w.head * (C.head.zc + (z - A.head.zc) * sz.head);
      return [nx, y(v), nz];
    };
    const scale = ([, v]) => { const w = band(v), tr = trunk(v), lg = legAt(v); return [w.leg * lg.sx + w.trunk * trunkX(v) + w.head * sx.head, dy(v), w.leg * lg.sz + w.trunk * tr.sz + w.head * sz.head]; };
    return { map, scale };
  };
  return { organs: make(true), bones: make(false) };
}

/** Move a piece: its centre by the body map, its shape by `S` (three axis scales) about that centre. */
function place(piece, map, S) {
  const b = bounds(piece.positions), c = b.centre, nc = map(c), p = piece.positions;
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) p[i + k] = nc[k] + (p[i + k] - c[k]) * S[k];
}

/**
 * Cut a growth plate: remove the slab of bone `gap` thick at height `y`, clipping every triangle that
 * crosses it (so the gap is clean however large the triangles are).
 */
function cutAt(piece, y, gap) {
  const lo = y - gap / 2, hi = y + gap / 2;
  const src = piece.positions, positions = [], indices = [];
  const vert = (i) => [src[i * 3], src[i * 3 + 1], src[i * 3 + 2]];
  // Sutherland–Hodgman against one horizontal plane: keep the side where sign * (y - level) >= 0.
  const clip = (poly, level, sign) => {
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const da = sign * (a[1] - level), db = sign * (b[1] - level);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), level, a[2] + t * (b[2] - a[2])]); }
    }
    return out;
  };
  const emit = (poly) => {
    if (poly.length < 3) return;
    const base = positions.length / 3;
    for (const v of poly) positions.push(...v);
    for (let k = 1; k + 1 < poly.length; k++) indices.push(base, base + k, base + k + 1);
  };
  // What is cut out is kept apart: the growth plate itself, drawn as cartilage.
  const plate = { positions: [], indices: [] };
  const emitTo = (poly, out) => {
    if (poly.length < 3) return;
    const base = out.positions.length / 3;
    for (const v of poly) out.positions.push(...v);
    for (let k = 1; k + 1 < poly.length; k++) out.indices.push(base, base + k, base + k + 1);
  };
  for (let i = 0; i < piece.indices.length; i += 3) {
    const tri = [vert(piece.indices[i]), vert(piece.indices[i + 1]), vert(piece.indices[i + 2])];
    emit(clip(tri, lo, -1));
    emit(clip(tri, hi, 1));
    emitTo(clip(clip(tri, lo, 1), hi, -1), plate);
  }
  piece.positions = positions;
  piece.indices = indices;
  return plate;
}

/** A mesh's extent across (x) and front to back (z) at height y, and its middle front to back. */
function sectionBox({ positions }, y, h = 0.006) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) if (Math.abs(positions[i + 1] - y) < h) { x0 = Math.min(x0, positions[i]); x1 = Math.max(x1, positions[i]); z0 = Math.min(z0, positions[i + 2]); z1 = Math.max(z1, positions[i + 2]); }
  return { width: x1 - x0, depth: z1 - z0, zc: (z0 + z1) / 2 };
}

/** Append one mesh to another. */
const append = (into, { positions, indices }) => { const base = into.positions.length / 3; for (const v of positions) into.positions.push(v); for (const i of indices) into.indices.push(i + base); };

// ------------------------------------------------------------------ bodies

/** The atlas's pieces for a body: one per region and side, one per layer's rest. */
async function atlasPieces(dir, body) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const input = await io.read(await atlas(dir, body));
  const byName = new Map(input.getRoot().listNodes().map((n) => [n.getName(), n]));
  const find = (male) => { const name = SOURCES[body].node(male); const n = byName.get(name); if (!n) throw new Error(`${body}: source has no node ${name}`); return n; };
  const pieces = [];
  for (const [id, def] of Object.entries(REGIONS)) {
    const sides = Array.isArray(def.nodes) ? [[null, def.nodes]] : [['right', def.nodes.right], ['left', def.nodes.left]];
    for (const [side, names] of sides) pieces.push({ name: meshName(id, side), layer: def.layer, region: id, side, roots: names.map(find) });
  }
  const claimed = new Set(pieces.flatMap((p) => p.roots));
  for (const p of pieces) p.skip = new Set([...claimed].filter((n) => !p.roots.includes(n)));
  for (const layer of LAYERS) for (const name of LAYER_NODES[layer]) pieces.push({ name: layer, layer, region: null, roots: [find(name)], skip: claimed });
  for (const p of pieces) {
    const geo = { positions: [], indices: [] };
    for (const r of p.roots) collect(r, p.skip, geo);
    if (!geo.indices.length) throw new Error(`${body} ${p.name}: no triangles`);
    Object.assign(p, geo);
    // The outline in its neutral form: welded (so its sections join up), then the genitalia smoothed away.
    if (p.name === 'skin') {
      const w = weldPositions(p);
      const positions = Array.from(w.positions), indices = Array.from(w.indices);
      p.neutralised = neutralise(positions, indices);
      Object.assign(p, { positions, indices });
    }
    // What the child needs from the atlas's finer parts: the pelvis's three bones, the femur's condyles.
    if (p.region === 'pelvis') p.parts = ['VH_M_ilium', 'VH_M_ischium', 'VH_M_pubis', 'VH_M_sacrum', 'VH_M_coccyx'].map((n) => ({ name: n, ...collect(find(n), new Set()) }));
    if (p.region === 'femur') {
      const tag = p.side === 'right' ? 'R' : 'L';
      const condyles = input.getRoot().listNodes().filter((n) => /condyle.*sup/.test(n.getName()) && (n.getName().endsWith(`_${tag}`) || n.getName().includes(p.side === 'right' ? 'right_femur' : 'left_femur')));
      p.condyleTop = Math.max(...condyles.map((n) => bounds(collect(n, new Set()).positions).max[1]));
    }
  }
  return pieces;
}

const VALUE = (body, what) => { const v = REFERENCES.bodies[body].values.find((x) => x.what === what); if (!v) throw new Error(`references.json: ${body} has no ${what}`); return v.value; };

/** A child: the adult's pieces morphed into the MakeHuman outline, organ by organ (references.json). */
async function childPieces(dir, body, adult) {
  const ref = REFERENCES.bodies[body];
  const skin = await makehumanChild(dir, ref.sex);
  const sb = bounds(skin.positions);
  const k = VALUE(body, 'stature') / 100 / sb.size[1];
  for (let i = 0; i < skin.positions.length; i += 3) {
    skin.positions[i] = (skin.positions[i] - sb.centre[0]) * k;
    skin.positions[i + 1] = (skin.positions[i + 1] - sb.min[1]) * k - VALUE(body, 'stature') / 200;
    skin.positions[i + 2] = (skin.positions[i + 2] - sb.centre[2]) * k;
  }
  // The neutral form, as for the adults (MakeHuman's body is already neutral, so this should move nothing).
  skin.neutralised = neutralise(skin.positions, skin.indices);
  const adultSkin = adult.find((p) => p.name === 'skin');
  // Measured on welded copies: the sections follow shared edges.
  const welded = (m) => { const w = weldPositions(m); return [w.positions, w.indices]; };
  const A = measure(...welded(adultSkin)), C = measure(...welded(skin));
  // The adult's organs' width at the waist and the lower chest, and the child's room there: its outline less its body wall.
  const organsWide = (y) => {
    let lo = Infinity, hi = -Infinity;
    for (const p of adult) if (p.layer === 'organs' && p.name !== 'organs') for (let i = 0; i < p.positions.length; i += 3) if (Math.abs(p.positions[i + 1] - y) < 0.02) { lo = Math.min(lo, p.positions[i]); hi = Math.max(hi, p.positions[i]); }
    return hi - lo;
  };
  const wall = VALUE(body, 'body wall');
  // Up the trunk, from the pelvis to the lower chest (above it the arms meet the trunk): the child's room over the adult's organs.
  const cavity = CAVITY_AT.map((f) => [f, (C.trunkWidthAt(f) - 2 * wall) / organsWide(A.crotch + f * (A.neck - A.crotch))]);
  console.log(`${body}: across the trunk ${JSON.stringify(cavity.map(([f, r]) => [f, +r.toFixed(3)]))} (outline ratio ${(C.trunk.width / A.trunk.width).toFixed(3)})`);
  // Bones follow the outline (they must stay inside it); organs follow the cavity across the trunk.
  const { organs: O, bones: { map, scale } } = bodyMap(A, C, cavity);
  /** The child's room across the trunk at height y: the outline less its body wall (below where the arms meet it). */
  const roomAt = (y) => { const f = Math.max(0.1, Math.min(0.6, (y - C.crotch) / (C.neck - C.crotch))); return (C.trunkWidthAt(f) ?? C.trunk.width) - 2 * wall; };
  const round = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
  console.log(`${body}: adult landmarks ${JSON.stringify(round(A))}\n${body}: child landmarks ${JSON.stringify(round(C))}`);
  const report = { stature:C.crown - C.sole, headShare: (C.crown - C.neck) / (C.crown - C.sole), adultHeadShare: (A.crown - A.neck) / (A.crown - A.sole), legShare: (C.crotch - C.sole) / (C.crown - C.sole), adultLegShare: (A.crotch - A.sole) / (A.crown - A.sole), organs: {} };
  const uniform = (s) => [s, s, s];
  const out = [];
  const cartilage = { name: 'cartilage', layer: 'skeleton', region: null, positions: [], indices: [] };
  // Everything must end inside the outline. Where a piece still pokes through it (the outline's own
  // shape differs from the atlas's), it is nudged: the smallest move (a few mm front-back or across) or
  // shrink (to 91 %) that brings it inside, taken with its growth plates. Each nudge is reported.
  const ws = weldPositions(skin), insideSkin = insideTest(ws.positions, ws.indices);
  const outside = (positions, dx = 0, dz = 0, k = 1, c = [0, 0, 0]) => {
    const n = positions.length / 3, step = Math.max(1, Math.floor(n / 300));
    let o = 0, t = 0;
    for (let i = 0; i < n; i += step) { t++; const p = [0, 1, 2].map((j) => c[j] + (positions[i * 3 + j] - c[j]) * k + (j === 0 ? dx : j === 2 ? dz : 0)); if (!insideSkin(p)) o++; }
    return o / t;
  };
  const settle = (p, extras = []) => {
    const before = outside(p.positions);
    if (before <= 0.002) return;
    const c = bounds(p.positions).centre;
    const moves = [];
    for (const k of [1, 0.97, 0.94, 0.91]) for (const dz of [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15]) for (const dx of [0, 3, -3, 6, -6]) moves.push({ k, dz: dz / 1000, dx: dx / 1000, cost: (1 - k) * 100 + Math.abs(dz) + Math.abs(dx) });
    moves.sort((a, b) => a.cost - b.cost);
    let best = { k: 1, dx: 0, dz: 0, f: before };
    for (const m of moves) { const f = outside(p.positions, m.dx, m.dz, m.k, c); if (f < best.f - 1e-9) best = { ...m, f }; if (f <= 0.002) { best = { ...m, f }; break; } }
    for (const g of [p, ...extras]) for (let i = 0; i < g.positions.length; i += 3) for (let j = 0; j < 3; j++) g.positions[i + j] = c[j] + (g.positions[i + j] - c[j]) * best.k + (j === 0 ? best.dx : j === 2 ? best.dz : 0);
    report.nudged[p.name] = { outsideBefore: +before.toFixed(3), outsideAfter: +best.f.toFixed(3), shrink: best.k, dxMm: best.dx * 1000, dzMm: best.dz * 1000 };
  };
  report.nudged = {};
  for (const a of adult) {
    const p = { ...a, positions: [...a.positions], indices: [...a.indices] };
    if (p.name === 'skin') { out.push({ ...p, positions: skin.positions, indices: skin.indices, neutralised: skin.neutralised }); continue; }
    const c = bounds(p.positions).centre;
    if (p.layer === 'skeleton') {
      // Bones follow the body point by point; then the child's own skeleton: growth plates, the pelvis's three bones, a smaller ossified patella.
      const follow = (positions) => { for (let i = 0; i < positions.length; i += 3) { const m = map([positions[i], positions[i + 1], positions[i + 2]]); positions[i] = m[0]; positions[i + 1] = m[1]; positions[i + 2] = m[2]; } };
      if (p.parts) {
        // The pelvis as its separate bones, each a little smaller about its own middle, and cartilage where
        // two of ilium, ischium and pubis meet (the triradiate cartilage in the acetabulum, the ischiopubic
        // seam): those faces of each bone at full size, so they fill exactly the seams the shrinking opens.
        const hip = p.parts.filter((part) => /ilium|ischium|pubis/.test(part.name));
        const near = (part) => {
          const cell = 0.005, grid = new Set();
          for (const other of hip) if (other !== part) for (let i = 0; i < other.positions.length; i += 3) grid.add(`${Math.floor(other.positions[i] / cell)},${Math.floor(other.positions[i + 1] / cell)},${Math.floor(other.positions[i + 2] / cell)}`);
          const close = (j) => { const x = Math.floor(part.positions[j * 3] / cell), y = Math.floor(part.positions[j * 3 + 1] / cell), z = Math.floor(part.positions[j * 3 + 2] / cell); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (grid.has(`${x + dx},${y + dy},${z + dz}`)) return true; return false; };
          const out = [];
          for (let t = 0; t < part.indices.length; t += 3) if ([0, 1, 2].every((k) => close(part.indices[t + k]))) out.push(part.indices[t], part.indices[t + 1], part.indices[t + 2]);
          return out;
        };
        p.positions = []; p.indices = [];
        for (const part of p.parts) {
          const q = [...part.positions];
          follow(q);
          const qc = bounds(q).centre;
          append(p, { positions: q.map((v, i) => qc[i % 3] + (v - qc[i % 3]) * 0.97), indices: part.indices });
          if (hip.includes(part)) append(cartilage, { positions: q, indices: near(part) });
        }
      } else if (p.region === 'femur' || p.region === 'tibia') {
        // The growth plates are cut in the adult bone, at the adult's proportions, the plate's width
        // scaled up so it comes out as wide in the child.
        const b = bounds(p.positions), levels = VALUE(body, 'physis levels');
        const gapAdult = VALUE(body, 'growth plates') / scale(b.centre)[1];
        const plates = p.region === 'femur' ? [cutAt(p, a.condyleTop, gapAdult)]
          : [cutAt(p, b.max[1] - levels.tibiaProximal * b.size[1], gapAdult), cutAt(p, b.min[1] + levels.tibiaDistal * b.size[1], gapAdult)];
        // A long bone stays straight: its two ends follow the body map, and every point in between moves
        // along the line joining them (following point by point bends it where the leg meets the trunk).
        const q = p.positions, ends = [b.min[1] + 0.05 * b.size[1], b.max[1] - 0.05 * b.size[1]];
        const middleAt = (y0) => { let sx = 0, sz = 0, n = 0; for (let i = 0; i < q.length; i += 3) if (Math.abs(q[i + 1] - y0) < 0.02 * b.size[1] + 0.003) { sx += q[i]; sz += q[i + 2]; n++; } return [sx / n, y0, sz / n]; };
        const [a0, a1] = ends.map(middleAt), [c0, c1] = [map(a0), map(a1)];
        const s = scale(b.centre);
        const straight = (r) => {
          for (let i = 0; i < r.length; i += 3) {
            const t = (r[i + 1] - a0[1]) / (a1[1] - a0[1]);
            r[i] = c0[0] + t * (c1[0] - c0[0]) + (r[i] - (a0[0] + t * (a1[0] - a0[0]))) * s[0];
            r[i + 2] = c0[2] + t * (c1[2] - c0[2]) + (r[i + 2] - (a0[2] + t * (a1[2] - a0[2]))) * s[2];
            r[i + 1] = c0[1] + t * (c1[1] - c0[1]);
          }
        };
        straight(p.positions);
        for (const plate of plates) straight(plate.positions);
        settle(p, plates);
        for (const plate of plates) append(cartilage, plate);
      } else follow(p.positions);
      if (p.region === 'patella') place(p, (v) => v, uniform(VALUE(body, 'patella')));
      if (p.region !== 'femur' && p.region !== 'tibia') settle(p);
      out.push(p);
      continue;
    }
    // Organs: each moves with the body (across the trunk, with the cavity); its size is the measured one
    // where there is a reference, else the body's own scale where it sits; then it is kept inside the cavity.
    const S = O.scale(c);
    let measured = null;
    if (p.region === 'liver') {
      const mcl = A.cx - A.shoulders.width / 4;
      const ysAt = []; for (let i = 0; i < p.positions.length; i += 3) if (Math.abs(p.positions[i] - mcl) < 0.015) ysAt.push(p.positions[i + 1]);
      measured = { target: VALUE(body, 'liver') / 100, adult: Math.max(...ysAt) - Math.min(...ysAt) };
    } else if (p.region === 'spleen') measured = { target: VALUE(body, 'spleen') / 100, adult: principalLength(p.positions) };
    else if (p.region === 'kidney') measured = { target: VALUE(body, 'kidney') / 100, adult: principalLength(p.positions) };
    if (measured) place(p, O.map, uniform(measured.target / measured.adult));
    else if (p.name === 'organs') { const t = VALUE(body, 'thymus'), s = bounds(p.positions).size; place(p, O.map, [t[0] / 100 / s[0], t[1] / 100 / s[1], t[2] / 100 / s[2]]); }
    else if (p.region === 'brain') {
      // The brain at 8 is near its adult volume (references.json), so it takes its own scale, not the head's;
      // kept inside the child's head with room for the skull.
      place(p, O.map, uniform(Math.cbrt(VALUE(body, 'brain'))));
    } else if (p.region === 'bladder') {
      // The atlas adults' bladders are near empty, so the child's is scaled with the pelvis around it (not
      // to a full capacity), then raised out of the pelvis.
      place(p, O.map, scale(c));
      const pelvis = bounds(adult.find((q) => q.region === 'pelvis').positions);
      const lift = VALUE(body, 'bladder position') * (map([0, pelvis.max[1], 0])[1] - map([0, pelvis.min[1], 0])[1]);
      for (let i = 1; i < p.positions.length; i += 3) p.positions[i] += lift;
    } else place(p, O.map, S);
    // Inside the cavity: no wider than the room at its height (less a margin), and not past either side of it.
    const pb = bounds(p.positions), room = roomAt(pb.centre[1]) * 0.95;
    let clamp = 1;
    // The liver keeps its measured span (craniocaudal) and narrows only across; others shrink evenly.
    if (p.name !== 'brain' && pb.size[0] > room) { clamp = room / pb.size[0]; place(p, (v) => v, p.region === 'liver' ? [clamp, 1, 1] : uniform(clamp)); }
    const qb = bounds(p.positions), shift = Math.max(0, (C.cx - room / 2) - qb.min[0]) - Math.max(0, qb.max[0] - (C.cx + room / 2));
    if (p.region !== 'brain' && shift) for (let i = 0; i < p.positions.length; i += 3) p.positions[i] += shift;
    if (p.region === 'brain') {
      // The skull: the brain no larger than 90 % of the head's outline at its height.
      const head = sectionBox(skin, pb.centre[1]), fit = Math.min(1, (0.9 * head.width) / pb.size[0], (0.9 * head.depth) / pb.size[2]);
      if (fit < 1) { clamp = fit; place(p, (v) => v, uniform(fit)); }
      const nb = bounds(p.positions), dz = head.zc - nb.centre[2];
      for (let i = 2; i < p.positions.length; i += 3) p.positions[i] += dz;
      const top = C.crown - 0.012 - bounds(p.positions).max[1];
      if (top < 0) for (let i = 1; i < p.positions.length; i += 3) p.positions[i] += top;
    }
    settle(p);
    report.organs[p.name] = { ...(measured ? { adult: +(measured.adult * 100).toFixed(1), child: +(measured.target * 100).toFixed(1), scale: +(measured.target / measured.adult).toFixed(3) } : {}), ...(clamp < 1 ? { clampedTo: +clamp.toFixed(3) } : {}) };
    out.push(p);
  }
  out.push(cartilage);
  return { pieces: out, report };
}

// ------------------------------------------------------------------- write

/** One vertex per position (the sources repeat them at every face's corner), to 0.1 mm. */
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

async function write(body, pieces, credit) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = new Document();
  doc.getRoot().getAsset().extras = { body, built: 'tools/body/build.mjs', licence: 'CC-BY-4.0' };
  // The credit the licences ask for travels with the file (assets/body/LICENSE has it in full).
  doc.getRoot().getAsset().copyright = [
    'Human Reference Atlas 3D reference objects (HuBMAP CCF v2.0; Herr et al., Sci Data 2023;10:171), CC BY 4.0; Visible Human data courtesy of the U.S. National Library of Medicine',
    'brain: Allen Human Reference Atlas - 3D, 2020 (RRID:SCR_017764), © 2019 Allen Institute for Brain Science, CC BY 4.0',
    ...(credit === 'adapted' ? ['adapted using paediatric reference measurements (components/body/references.json); outline from MakeHuman, CC0 1.0'] : []),
  ].join('; ');
  const buffer = doc.createBuffer();
  const root = doc.createNode('body');
  doc.createScene('body').addChild(root);
  const lines = [];
  for (const p of pieces) {
    const { positions, indices } = reduce(weldPositions(p), BUDGET[p.region ?? p.name] ?? BUDGET[p.name] ?? BUDGET_ORGAN);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
    root.addChild(doc.createNode(p.name).setMesh(doc.createMesh(p.name).addPrimitive(prim)).setExtras({ layer: p.layer, region: p.region }));
    lines.push(`${body.padEnd(6)} ${p.name.padEnd(18)} ${String(p.indices.length / 3).padStart(7)} → ${String(indices.length / 3).padStart(6)} triangles`);
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14 }), prune());
  const bytes = await io.writeBinary(doc);
  await writeFile(join(REPO, output(body)), bytes);
  console.log(lines.join('\n'));
  console.log(`wrote ${output(body)}: ${(bytes.length / 1024).toFixed(0)} KB, sha256 ${sha(bytes)}`);
  // The neutral form is recorded: how many outline vertices the builder moved to make it (Sami, 17 Nov).
  return { bytes: bytes.length, meshes: pieces.map((p) => p.name).sort(), neutralForm: { verticesMoved: pieces.find((p) => p.name === 'skin').neutralised ?? 0 } };
}

async function main() {
  const dir = resolve(arg('--source') ?? join(REPO, '.tmp/body-source'));
  await mkdir(dir, { recursive: true });
  await mkdir(join(REPO, 'assets/body'), { recursive: true });
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const manifest = {}, reports = {};
  const adult = {};
  for (const body of ['man', 'woman']) {
    adult[body] = await atlasPieces(dir, body);
    manifest[body] = await write(body, adult[body], 'atlas');
  }
  for (const body of ['boy', 'girl']) {
    const { pieces, report } = await childPieces(dir, body, adult[REFERENCES.bodies[body].from]);
    reports[body] = report;
    manifest[body] = await write(body, pieces, 'adapted');
  }
  for (const b of BODIES) if (!manifest[b]) throw new Error(`no ${b}`);
  const ts = `// Generated by tools/body/build.mjs from the built meshes. Do not edit: run \`npm run body:asset\`.\n` +
    `// Which meshes each body has (a region missing from a body is an error for the model, not a blank render),\n` +
    `// each mesh file's size, and what the child bodies measured out to (components/body/references.json).\n` +
    `export const MANIFEST = ${JSON.stringify(Object.fromEntries(BODIES.map((b) => [b, manifest[b]])), null, 2)} as const;\n\n` +
    `export const CHILD_REPORT = ${JSON.stringify(reports, null, 2)} as const;\n`;
  await writeFile(join(REPO, 'src/body/manifest.ts'), ts);
  console.log(JSON.stringify(reports, null, 1));
  console.log(`total ${(Object.values(manifest).reduce((s, m) => s + m.bytes, 0) / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
