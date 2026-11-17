// body (components/body/): measurements of a mesh, shared by the builder
// (tools/body/build.mjs, which sizes organs by them) and the tests (which
// check the built organs measure what components/body/references.json says).

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
