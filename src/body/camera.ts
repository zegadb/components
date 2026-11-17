// body (components/body/): the camera, as plain maths (no three.js), so it is
// tested without a GPU: where it looks from for a view, how far back it
// stands to frame a box, and the flight between two cameras, which is
// MapLibre's own flyTo curve (van Wijk and Nuij, "Smooth and efficient zooming
// and panning", ρ = 1.42) so the body moves the way our globe does.
export type Vec3 = [number, number, number];
export interface Box { min: Vec3; max: Vec3 }
/** A camera: the point it looks at, how far back it stands, and the direction from the point to it (unit). */
export interface Shot { target: Vec3; distance: number; dir: Vec3 }

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
export const centre = (b: Box): Vec3 => scale(add(b.min, b.max), 0.5);
export const position = (s: Shot): Vec3 => add(s.target, scale(s.dir, s.distance));

/** The side a view looks from (the body faces +z, its right at −x), lifted a little so the body is seen from slightly above. */
export function direction(view: "front" | "back" | "left" | "right"): Vec3 {
  const lift = 0.14;
  const flat: Vec3 = view === "front" ? [0, 0, 1] : view === "back" ? [0, 0, -1] : view === "right" ? [-1, 0, 0] : [1, 0, 0];
  return norm([flat[0], lift, flat[2]]);
}

/**
 * The view for `auto`: the back when the focus lies behind the body's midline (the kidneys,
 * the spine), the front otherwise. `body` is the whole body's box.
 */
export function autoView(focus: Box, body: Box): "front" | "back" {
  const depth = body.max[2] - body.min[2];
  const mid = (body.min[2] + body.max[2]) / 2;
  return centre(focus)[2] < mid - depth * 0.08 ? "back" : "front";
}

/**
 * The shot that frames `box` from `dir` in a view `aspect` wide (width / height) with a vertical
 * field of view `fov` (radians), leaving `margin` of the view around it (0.25: a quarter each side).
 */
export function frame(box: Box, dir: Vec3, fov: number, aspect: number, margin = 0.25): Shot {
  const size = sub(box.max, box.min);
  const radius = Math.max(len(size) / 2, 0.02);
  const half = Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * aspect));
  const distance = radius / Math.sin(half) / (1 - margin);
  return { target: centre(box), distance, dir: norm(dir) };
}

/**
 * The flight from `a` to `b`: a function from time (0–1, already eased) to a shot. The look-at point
 * travels while the camera pulls back and comes in again, as far as the distance between the
 * points calls for; the direction turns along the way. Also its length `S`, for the duration.
 */
export function flight(a: Shot, b: Shot, rho = 1.42): { at: (t: number) => Shot; S: number } {
  const w0 = a.distance, w1 = b.distance;
  const u1 = len(sub(b.target, a.target));
  const along = (u: number): Vec3 => (u1 ? add(a.target, scale(sub(b.target, a.target), u / u1)) : a.target);
  // The direction turns round the body's vertical axis (the shorter way) and tilts separately, as a
  // globe turns under the camera: front to back walks round the side, never over the head.
  const azimuth = (d: Vec3) => Math.atan2(d[0], d[2]);
  const tilt = (d: Vec3) => Math.asin(Math.max(-1, Math.min(1, d[1])));
  const az0 = azimuth(a.dir), el0 = tilt(a.dir), el1 = tilt(b.dir);
  let daz = azimuth(b.dir) - az0;
  if (daz > Math.PI) daz -= 2 * Math.PI;
  if (daz <= -Math.PI) daz += 2 * Math.PI;
  const turn = (t: number): Vec3 => {
    const az = az0 + daz * t, el = el0 + (el1 - el0) * t;
    return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  };
  if (u1 < 1e-6) {
    const S = Math.abs(Math.log(w1 / w0)) / rho || 0;
    return { S, at: (t) => ({ target: b.target, distance: w0 * Math.pow(w1 / w0, t), dir: turn(t) }) };
  }
  const rho2 = rho * rho;
  const r = (i: 0 | 1) => {
    const w = i ? w1 : w0;
    const b = (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * w * rho2 * u1);
    return Math.log(Math.sqrt(b * b + 1) - b);
  };
  const r0 = r(0), r1 = r(1);
  const S = (r1 - r0) / rho;
  const w = (s: number) => w0 * (Math.cosh(r0) / Math.cosh(r0 + rho * s));
  const u = (s: number) => (w0 * (Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0))) / rho2;
  return { S, at: (t) => (t >= 1 ? { ...b } : { target: along(u(t * S)), distance: w(t * S), dir: turn(t) }) };
}

/** MapLibre's default easing, cubic-bezier(0.25, 0.1, 0.25, 1). */
export function ease(t: number): number {
  const x1 = 0.25, y1 = 0.1, x2 = 0.25, y2 = 1;
  // Solve the bezier's x(s) = t for s by Newton's method, then return y(s).
  const bx = (s: number) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = (s: number) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const d = (bx(s + 1e-5) - bx(s - 1e-5)) / 2e-5;
    if (!d) break;
    s = Math.max(0, Math.min(1, s - (bx(s) - t) / d));
  }
  return by(s);
}

/** How long a flight takes, as MapLibre times flyTo (speed 1.2), kept between 0.6 and 2 s. */
export const duration = (S: number) => Math.max(600, Math.min(2000, (1000 * S) / 1.2));
