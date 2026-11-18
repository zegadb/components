// body (components/body/): measurements of a mesh, shared by the builder
// (tools/body/build.mjs, which sizes organs by them) and the tests (which
// check the built organs measure what components/body/references.json says).

/**
 * Where a label points on a region: a vertex of the region itself, on the side facing the camera,
 * near its middle. (The middle of its box is not enough: for a hollow region, the pelvis round
 * the bladder, it lies inside something else.) Among the vertices near the line from the camera
 * through the middle, the one nearest the camera; if none, the vertex nearest the middle.
 */
export function anchorPoint(positions: ArrayLike<number>, camera: readonly [number, number, number]): [number, number, number] {
  const n = positions.length / 3;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = positions[i * 3 + k]!; lo[k] = Math.min(lo[k]!, v); hi[k] = Math.max(hi[k]!, v); }
  const c = [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2);
  const radius = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2;
  const d = [0, 1, 2].map((k) => c[k]! - camera[k]!), dl = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
  const dir = d.map((v) => v / dl);
  let best = -1, bestDepth = Infinity, nearest = 0, nearestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map((k) => positions[i * 3 + k]! - camera[k]!);
    const depth = p[0]! * dir[0]! + p[1]! * dir[1]! + p[2]! * dir[2]!;
    const off = Math.hypot(p[0]! - depth * dir[0]!, p[1]! - depth * dir[1]!, p[2]! - depth * dir[2]!);
    // Nearer the camera is better, and so is nearer the middle: depth plus half the distance off the line.
    const score = depth + 0.5 * off;
    if (off < 0.7 * radius && score < bestDepth) { bestDepth = score; best = i; }
    const dc = Math.hypot(positions[i * 3]! - c[0]!, positions[i * 3 + 1]! - c[1]!, positions[i * 3 + 2]! - c[2]!);
    if (dc < nearestDist) { nearestDist = dc; nearest = i; }
  }
  const i = best >= 0 ? best : nearest;
  return [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
}

/**
 * A test of whether a point lies inside a closed mesh (the skin): rays cast three ways (+x, −x, −z)
 * count the surfaces they cross, and the majority of the three parities decides, so a small hole
 * (an eye socket, a nostril) cannot flip the answer on its own. Triangles are bucketed on a grid
 * across each ray's direction, so a query checks only the few under its ray.
 */
export function insideTest(positions: ArrayLike<number>, indices: ArrayLike<number>, cell = 0.01): (p: readonly [number, number, number]) => boolean {
  const P = (i: number, k: number) => positions[i * 3 + k]!;
  // Two grids: on (y, z) for the x rays, on (x, y) for the z ray.
  const grid = (a: number, b: number) => {
    const map = new Map<string, number[]>();
    for (let t = 0; t < indices.length; t += 3) {
      const vs = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
      const as = vs.map((v) => P(v, a)), bs = vs.map((v) => P(v, b));
      for (let i = Math.floor(Math.min(...as) / cell); i <= Math.floor(Math.max(...as) / cell); i++)
        for (let j = Math.floor(Math.min(...bs) / cell); j <= Math.floor(Math.max(...bs) / cell); j++) {
          const key = `${i},${j}`;
          let list = map.get(key);
          if (!list) map.set(key, (list = []));
          list.push(t);
        }
    }
    return (u: number, v: number) => map.get(`${Math.floor(u / cell)},${Math.floor(v / cell)}`) ?? [];
  };
  const yz = grid(1, 2), xy = grid(0, 1);
  // Möller–Trumbore: the distance along the ray to the triangle, or null.
  const hit = (o: readonly number[], d: readonly number[], t: number): number | null => {
    const a = [0, 1, 2].map((k) => P(indices[t]!, k)), b = [0, 1, 2].map((k) => P(indices[t + 1]!, k)), c = [0, 1, 2].map((k) => P(indices[t + 2]!, k));
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const h = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
    const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
    if (Math.abs(det) < 1e-12) return null;
    const s = [o[0]! - a[0]!, o[1]! - a[1]!, o[2]! - a[2]!];
    const u = (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!) / det;
    if (u < 0 || u > 1) return null;
    const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!) / det;
    if (v < 0 || u + v > 1) return null;
    const dist = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det;
    return dist > 1e-9 ? dist : null;
  };
  const parity = (o: readonly number[], d: readonly number[], candidates: number[]) => {
    const seen = new Set<number>();
    for (const t of candidates) { const dist = hit(o, d, t); if (dist !== null) seen.add(Math.round(dist * 1e6)); }
    return seen.size % 2 === 1;
  };
  return (p) => {
    const votes = [parity(p, [1, 0, 0], yz(p[1], p[2])), parity(p, [-1, 0, 0], yz(p[1], p[2])), parity(p, [0, 0, -1], xy(p[0], p[1]))];
    return votes.filter(Boolean).length >= 2;
  };
}

/**
 * What hangs between the thighs of an outline (a welded, indexed mesh): the crotch (the lowest height
 * where one wide loop, both thighs joined into the trunk, spans the midline) and every vertex of a
 * section loop of its own, narrow and near the midline, below it. The builder folds those away for
 * the neutral form; the tests hold every built body to none.
 */
export function hanging(positions: ArrayLike<number>, indices: ArrayLike<number>): { crotch: number; vertices: Set<number> } {
  const P = (i: number, k: number) => positions[i * 3 + k]!;
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < positions.length / 3; i++) { y0 = Math.min(y0, P(i, 1)); y1 = Math.max(y1, P(i, 1)); x0 = Math.min(x0, P(i, 0)); x1 = Math.max(x1, P(i, 0)); }
  const H = y1 - y0, cx = (x0 + x1) / 2;
  const loopsAt = (y: number) => {
    const parent = new Map<string, string>(), xs = new Map<string, number>(), tris = new Map<number, string>();
    const find = (a: string): string => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a)!)!); a = parent.get(a)!; } return a; };
    const edgePoint = (a: number, c: number) => {
      const key = a < c ? `${a}_${c}` : `${c}_${a}`;
      if (!xs.has(key)) { const t = (y - P(a, 1)) / (P(c, 1) - P(a, 1)); xs.set(key, P(a, 0) + t * (P(c, 0) - P(a, 0))); parent.set(key, key); }
      return key;
    };
    for (let i = 0; i < indices.length; i += 3) {
      const t = [indices[i]!, indices[i + 1]!, indices[i + 2]!], crossing: string[] = [];
      for (let e = 0; e < 3; e++) { const a = t[e]!, c = t[(e + 1) % 3]!; if ((P(a, 1) - y) * (P(c, 1) - y) < 0) crossing.push(edgePoint(a, c)); }
      if (crossing.length === 2) { const ra = find(crossing[0]!), rc = find(crossing[1]!); if (ra !== rc) parent.set(ra, rc); tris.set(i, crossing[0]!); }
    }
    const loops = new Map<string, { lo: number; hi: number; tris: number[] }>();
    for (const [key, x] of xs) { const r = find(key); const l = loops.get(r) ?? { lo: Infinity, hi: -Infinity, tris: [] }; l.lo = Math.min(l.lo, x); l.hi = Math.max(l.hi, x); loops.set(r, l); }
    for (const [i, key] of tris) loops.get(find(key))!.tris.push(i);
    return [...loops.values()];
  };
  let crotch = y0 + 0.3 * H;
  while (crotch < y0 + 0.65 * H && !loopsAt(crotch).some((l) => l.lo < cx && l.hi > cx && l.hi - l.lo > 0.12 * H)) crotch += 0.0015;
  const vertices = new Set<number>();
  for (let y = crotch - 0.15 * H; y < crotch; y += 0.0015) {
    for (const l of loopsAt(y)) if (Math.abs((l.lo + l.hi) / 2 - cx) < 0.025 * H && l.hi - l.lo < 0.07 * H) for (const i of l.tris) for (let k = 0; k < 3; k++) vertices.add(indices[i + k]!);
  }
  // Something hangs only if it reaches 1 % of the height below the crotch: the fold of the perineum
  // just under it (a few vertices on a neutral outline) is the body's own surface, not a protrusion.
  let lowest = Infinity;
  for (const v of vertices) lowest = Math.min(lowest, P(v, 1));
  return { crotch, vertices: crotch - lowest > 0.01 * H ? vertices : new Set<number>() };
}

/** The extent of the points along their principal axis: an organ's pole-to-pole length. */
export function principalLength(positions: ArrayLike<number>): number {
  const n = positions.length / 3, c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k]! += positions[i * 3 + k]! / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const d = [0, 1, 2].map((k) => positions[i * 3 + k]! - c[k]!);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a]![b]! += d[a]! * d[b]!;
  }
  // Power iteration for the covariance's largest eigenvector.
  let v = [0.3, 0.9, 0.2];
  for (let it = 0; it < 50; it++) {
    const w = C.map((row) => row[0]! * v[0]! + row[1]! * v[1]! + row[2]! * v[2]!);
    const l = Math.hypot(...w);
    v = w.map((x) => x / l);
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = positions[i * 3]! * v[0]! + positions[i * 3 + 1]! * v[1]! + positions[i * 3 + 2]! * v[2]!;
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  return hi - lo;
}
