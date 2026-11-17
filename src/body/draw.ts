// Draws body (components/body/) with three.js in the browser: the mesh
// (assets/body/<body>.glb, built by tools/body/build.mjs), the highlighted
// regions lit, everything else dimmed, a label for each, and either one
// framed still or a body the reader can orbit and zoom, the camera flying to
// the focus the way our globe flies (camera.ts).
//
// three.js is the host's (an optional peer dependency): only a host that
// draws a body loads it. Text a model wrote is always set as text.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { autoView, direction, duration, ease, flight, frame, position, type Box, type Shot, type Vec3 } from "./camera.ts";
import { focusOf, layersOf, sidesOf, type BodyData, type BodyOptions, type Highlight, type Role } from "./model.ts";
import { LAYERS, REGIONS, meshName, nameOf, type Body, type Layer } from "./regions.ts";
import type { Locale } from "../scale.ts";
import type { Theme } from "../types.ts";

/** The credit the sources' licences ask for: shown once, under the body, as text (no links). */
export const CREDIT: Record<"adult" | "child", Record<Locale, string>> = {
  adult: {
    en: "3D body: Human Reference Atlas (HuBMAP), CC BY 4.0",
    fr: "Corps 3D : Human Reference Atlas (HuBMAP), CC BY 4.0",
  },
  child: {
    en: "Adapted from the adult Human Reference Atlas (HuBMAP, CC BY 4.0) using paediatric reference measurements · outline MakeHuman, CC0",
    fr: "Adapté du Human Reference Atlas adulte (HuBMAP, CC BY 4.0) d’après des mesures pédiatriques de référence · silhouette MakeHuman, CC0",
  },
};
export const creditOf = (body: Body, locale: Locale) => CREDIT[body === "boy" || body === "girl" ? "child" : "adult"][locale];
const FOV = 30;
const ROLE_NAMES: Record<Locale, Record<Role, string>> = { en: { focus: "", related: "related", pain: "pain" }, fr: { focus: "", related: "associé", pain: "douleur" } };

export interface DrawBodyContext {
  theme: Theme;
  /** Where a body's mesh is: the package's assets/body/<body>.glb, served by the host (load only the one drawn). */
  asset: (body: Body) => string;
  locale?: Locale;
  /** Jump instead of flying (prefers-reduced-motion); the default asks the browser. */
  reducedMotion?: boolean;
}

export interface BodyHandle {
  /** Fly the camera to a highlighted region (interactive), or frame it (still). */
  flyTo(region: string): void;
  /** Back to the whole body. */
  reset(): void;
  dispose(): void;
}

/** A region's colour: the accent for the one explained, the soft ink for a related one, the theme's red for pain. */
export const roleColour = (role: Role, theme: Theme) => (role === "pain" ? theme.down : role === "related" ? mix(theme.accent, theme.ground, 0.5) : theme.accent);

/** `a` moved `t` of the way to `b` (#RRGGBB). */
function mix(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return `#${ca.lerp(cb, t).getHexString()}`;
}

/** A dimmed mesh of a layer that is shown: a veil in the axis colour, fainter on a dark ground. */
const DIM = (theme: Theme) => ({ colour: theme.axis, opacity: theme.mode === "dark" ? 0.22 : 0.3, lit: false });

/** What each mesh is drawn as, for these highlights: a region lit, its layer dimmed, the skin a veil, other layers hidden. */
export function looks(data: BodyData, theme: Theme): Map<string, { colour: string; opacity: number; lit: boolean } | null> {
  const solid = new Set<Layer>(layersOf(data));
  const lit = new Map<string, Highlight>();
  for (const h of data.highlight) for (const side of sidesOf(h)) lit.set(meshName(h.region, side), h);
  const out = new Map<string, { colour: string; opacity: number; lit: boolean } | null>();
  for (const [id, def] of Object.entries(REGIONS) as [keyof typeof REGIONS, (typeof REGIONS)[keyof typeof REGIONS]][]) {
    for (const side of Array.isArray(def.nodes) ? [null] : (["right", "left"] as const)) {
      const name = meshName(id, side);
      const h = lit.get(name);
      out.set(name, h ? { colour: roleColour(h.role ?? "focus", theme), opacity: 1, lit: true } : solid.has(def.layer) ? DIM(theme) : null);
    }
  }
  for (const layer of LAYERS) out.set(layer, layer === "skin" ? { colour: theme.soft, opacity: 0.1, lit: false } : solid.has(layer) ? DIM(theme) : layer === "skeleton" ? { colour: theme.axis, opacity: 0.1, lit: false } : null);
  return out;
}

const boxOf = (objects: THREE.Object3D[]): Box => {
  const b = new THREE.Box3();
  for (const o of objects) b.expandByObject(o);
  return { min: b.min.toArray() as Vec3, max: b.max.toArray() as Vec3 };
};

export async function drawBody(container: HTMLElement, data: BodyData, options: BodyOptions, ctx: DrawBodyContext): Promise<BodyHandle> {
  const { theme } = ctx;
  const locale: Locale = ctx.locale ?? "en";
  const doc = container.ownerDocument;
  const reduced = ctx.reducedMotion ?? doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;
  const interactive = options.mode === "interactive";
  container.classList.add("zc-body");
  container.dataset.mode = options.mode;
  const width = container.clientWidth, height = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(doc.defaultView?.devicePixelRatio ?? 1);
  renderer.setSize(width, height);
  renderer.setClearColor(theme.ground);
  renderer.domElement.className = "zc-body-canvas";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.01, 20);
  scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(theme.ground), theme.mode === "dark" ? 1.3 : 1.4));
  const key = new THREE.DirectionalLight(0xffffff, theme.mode === "dark" ? 1.9 : 1.7);
  key.position.set(0.4, 0.8, 1);
  camera.add(key);
  scene.add(camera);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(ctx.asset(options.body));
  const meshes = new Map<string, THREE.Mesh>();
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.set(o.name, o as THREE.Mesh); });
  const look = looks(data, theme);
  for (const [name, mesh] of meshes) {
    const l = look.get(name);
    if (!l) { mesh.visible = false; continue; }
    mesh.geometry.computeVertexNormals();
    const colour = new THREE.Color(l.colour);
    // The lit regions are opaque, so they draw first; the dimmed ones are a veil over them that still
    // hides its own far side (depthWrite), so a dimmed organ reads as one surface, not a tangle.
    mesh.material = new THREE.MeshStandardMaterial({
      color: colour, roughness: l.lit ? 0.6 : 0.9, metalness: 0,
      emissive: l.lit ? colour : new THREE.Color(0), emissiveIntensity: l.lit ? 0.06 : 0,
      transparent: l.opacity < 1, opacity: l.opacity, depthWrite: name !== "skin", side: name === "skin" ? THREE.FrontSide : THREE.DoubleSide,
    });
    mesh.renderOrder = l.lit ? 0 : name === "skin" ? 2 : 1;
    mesh.userData.lit = l.lit;
  }
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);

  // Framing: the whole body, or the focus (all its sides), from the view asked for or the one auto chooses.
  const bodyBox = boxOf([meshes.get("skin")!]);
  const meshesOf = (h: Highlight) => sidesOf(h).map((side) => meshes.get(meshName(h.region, side))).filter((m): m is THREE.Mesh => Boolean(m));
  const aspect = width / height;
  // The body's depth at a region's height (the feet and the face reach further forward than the trunk):
  // what auto measures "behind the midline" against.
  const skin = meshes.get("skin")!;
  const depthAt = (box: Box): Box => {
    const pos = skin.geometry.getAttribute("position"), v = new THREE.Vector3();
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(skin.matrixWorld);
      if (v.y >= box.min[1] && v.y <= box.max[1]) { lo = Math.min(lo, v.z); hi = Math.max(hi, v.z); }
    }
    return lo < hi ? { min: [bodyBox.min[0], box.min[1], lo], max: [bodyBox.max[0], box.max[1], hi] } : bodyBox;
  };
  const viewOf = (box: Box) => (options.view === "auto" ? autoView(box, depthAt(box)) : options.view);
  const shotOf = (h: Highlight): Shot => {
    const box = boxOf(meshesOf(h));
    const view = viewOf(box);
    // Room for the labels either side; more of it on a narrow column.
    return frame(box, direction(view), (FOV * Math.PI) / 180, aspect, options.labels ? (width < 480 ? 0.68 : 0.45) : 0.3);
  };
  const focus = focusOf(data, options);
  const wholeBody = frame(bodyBox, direction(viewOf(boxOf(meshesOf(focus)))), (FOV * Math.PI) / 180, aspect, 0.06);
  let shot: Shot = options.frame === "body" ? wholeBody : shotOf(focus);
  const place = (s: Shot) => {
    camera.position.fromArray(position(s));
    camera.lookAt(new THREE.Vector3(...s.target));
    controls?.target.set(...s.target);
  };

  // Labels: HTML over the canvas, one per highlight, in a column on the side its region is on, with a leader line.
  const overlay = doc.createElement("div");
  overlay.className = "zc-body-overlay";
  const lines = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  lines.setAttribute("class", "zc-body-lines");
  lines.setAttribute("width", String(width));
  lines.setAttribute("height", String(height));
  overlay.appendChild(lines);
  container.appendChild(overlay);
  const labels = options.labels ? data.highlight.map((h) => {
    const el = doc.createElement("div");
    el.className = "zc-body-label";
    el.dataset.region = h.region;
    const name = doc.createElement("div");
    name.className = "zc-body-label-name";
    const swatch = doc.createElement("span");
    swatch.className = "zc-body-swatch";
    swatch.style.background = roleColour(h.role ?? "focus", theme);
    name.append(swatch, doc.createTextNode(nameOf(h.region, h.side, locale)));
    el.appendChild(name);
    // The role in words when there is no note (the swatch's colour alone never carries it).
    const role = ROLE_NAMES[locale][h.role ?? "focus"];
    if (h.note || role) {
      const note = doc.createElement("div");
      note.className = "zc-body-label-note";
      note.textContent = h.note ?? role;
      el.appendChild(note);
    }
    el.style.maxWidth = `${Math.round(width * (width < 480 ? 0.31 : 0.3))}px`;
    overlay.appendChild(el);
    // One leader and dot per side: "both kidneys" points at each kidney.
    const anchors = meshesOf(h).map((m) => { const b = boxOf([m]); return new THREE.Vector3(...b.min).add(new THREE.Vector3(...b.max)).multiplyScalar(0.5); });
    const leaders = anchors.map(() => {
      const line = doc.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("stroke", theme.soft);
      line.setAttribute("stroke-width", "1");
      const dot = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("r", "3.5");
      dot.setAttribute("fill", roleColour(h.role ?? "focus", theme));
      dot.setAttribute("stroke", theme.panel);
      dot.setAttribute("stroke-width", "1.5");
      lines.append(line, dot);
      return { line, dot };
    });
    return { h, el, anchors, leaders };
  }) : [];
  const placeLabels = () => {
    const gap = 8, edge = 10;
    const items = labels.map((l) => {
      const points = l.anchors.map((a) => { const p = a.clone().project(camera); return { x: (p.x + 1) / 2 * width, y: (1 - p.y) / 2 * height, behind: p.z > 1 }; });
      const x = points.reduce((s, p) => s + p.x, 0) / points.length, y = points.reduce((s, p) => s + p.y, 0) / points.length;
      return { l, points, x, y, h: l.el.offsetHeight, w: l.el.offsetWidth, top: 0 };
    });
    for (const column of ["left", "right"] as const) {
      const list = items.filter((i) => (i.x < width / 2) === (column === "left")).sort((a, b) => a.y - b.y);
      // Each label level with its region where it can be: pushed down past the one above, then up from the bottom.
      let next = edge + (options.title ? 24 : 0);
      for (const i of list) { i.top = Math.max(next, i.y - i.h / 2); next = i.top + i.h + gap; }
      let limit = height - credit.offsetHeight - 10;
      for (let k = list.length - 1; k >= 0; k--) { const i = list[k]!; i.top = Math.min(i.top, limit - i.h); limit = i.top - gap; }
      for (const i of list) {
        const left = column === "left" ? edge : width - edge - i.w;
        i.l.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(i.top)}px)`;
        i.l.el.dataset.column = column;
        const ex = column === "left" ? left + i.w : left, ey = i.top + 13;
        i.points.forEach((p, k) => {
          const { line, dot } = i.l.leaders[k]!;
          line.setAttribute("x1", String(ex)); line.setAttribute("y1", String(ey));
          line.setAttribute("x2", String(p.x)); line.setAttribute("y2", String(p.y));
          dot.setAttribute("cx", String(p.x)); dot.setAttribute("cy", String(p.y));
          line.setAttribute("visibility", p.behind ? "hidden" : "visible");
          dot.setAttribute("visibility", p.behind ? "hidden" : "visible");
        });
      }
    }
  };

  if (options.title) {
    const title = doc.createElement("div");
    title.className = "zc-body-title";
    title.textContent = options.title;
    overlay.appendChild(title);
  }
  const credit = doc.createElement("div");
  credit.className = "zc-body-credit";
  credit.textContent = creditOf(options.body, locale);
  overlay.appendChild(credit);

  // Interactive: orbit, zoom toward the pointer, with inertia; + and − and "whole body" as the globe's controls are placed.
  let controls: OrbitControls | null = null;
  let flying: { from: Shot; to: Shot; path: ReturnType<typeof flight>; start: number; ms: number } | null = null;
  const fly = (to: Shot) => {
    if (reduced || !interactive) { flying = null; shot = to; place(to); return; }
    const from: Shot = { target: controls!.target.toArray() as Vec3, distance: camera.position.distanceTo(controls!.target), dir: camera.position.clone().sub(controls!.target).normalize().toArray() as Vec3 };
    const path = flight(from, to);
    flying = { from, to, path, start: performance.now(), ms: duration(path.S) };
  };
  if (interactive) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.zoomToCursor = true;
    controls.minDistance = 0.12;
    controls.maxDistance = wholeBody.distance * 1.6;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI - 0.15;
    controls.addEventListener("start", () => { flying = null; });
    renderer.domElement.style.touchAction = "none";
    const group = doc.createElement("div");
    group.className = "zc-body-controls";
    const button = (label: string, text: string, act: () => void) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.textContent = text;
      b.addEventListener("click", act);
      group.appendChild(b);
    };
    const zoom = (k: number) => fly({ target: controls!.target.toArray() as Vec3, distance: Math.min(controls!.maxDistance, Math.max(controls!.minDistance, camera.position.distanceTo(controls!.target) * k)), dir: camera.position.clone().sub(controls!.target).normalize().toArray() as Vec3 });
    button(locale === "fr" ? "Zoom avant" : "Zoom in", "+", () => zoom(0.6));
    button(locale === "fr" ? "Zoom arrière" : "Zoom out", "−", () => zoom(1 / 0.6));
    button(locale === "fr" ? "Tout le corps" : "Whole body", "⤢", () => fly(wholeBody));
    overlay.appendChild(group);
  }

  // First frame: a still is framed on the focus at once; an interactive body starts whole and flies in.
  place(interactive && !reduced ? wholeBody : shot);
  if (interactive && !reduced) fly(shot);

  let frameId = 0, disposed = false;
  const tick = (now: number) => {
    if (disposed) return;
    if (flying) {
      const t = Math.min(1, (now - flying.start) / flying.ms);
      place(flying.path.at(ease(t)));
      if (t >= 1) flying = null;
    }
    controls?.update();
    renderer.render(scene, camera);
    placeLabels();
    if (interactive) frameId = requestAnimationFrame(tick);
  };
  tick(performance.now());
  container.dataset.ready = "1";

  return {
    flyTo(region: string) {
      const h = data.highlight.find((x) => x.region === region);
      if (!h) return;
      fly(shotOf(h));
      if (!interactive) tick(performance.now());
    },
    reset() { fly(wholeBody); if (!interactive) tick(performance.now()); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      controls?.dispose();
      renderer.dispose();
      for (const m of meshes.values()) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      container.replaceChildren();
    },
  };
}
