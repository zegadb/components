// Draws body (components/body/) with three.js in the browser: the mesh
// (assets/body/<body>.glb, built by tools/body/build.mjs), the highlighted
// regions lit, everything else dimmed, a label for each, and either one
// framed still or a body the reader can orbit and zoom, the camera flying to
// the focus the way our globe flies (camera.ts).
//
// WebGL contexts are scarce (a browser keeps about 16 and drops the oldest):
// a still borrows one only while it paints, copies the frame into a plain 2D
// canvas and gives the context back; an interactive body keeps one, renders
// only when something moved, and gives it back on dispose.
//
// three.js is the host's (an optional peer dependency): only a host that
// draws a body loads it. Text a model wrote is always set as text.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { autoView, direction, duration, ease, flight, frame, frameStanding, position, type Box, type Shot, type Vec3 } from "./camera.ts";
import { anchorPoint } from "./geometry.ts";
import { layout, KEY_LINE, type LabelIn } from "./labels.ts";
import { focusOf, layersOf, sidesOf, type BodyData, type BodyOptions, type Highlight, type Role } from "./model.ts";
import { ALL_LAYERS, REGIONS, isPaired, isZaLayer, meshName, nameOf, type Body, type Layer, type RegionId, type ZaLayer } from "./regions.ts";
import type { Locale } from "../scale.ts";
import type { Theme } from "../types.ts";

/** The credit the sources' licences ask for: shown once, in its own band under the body, as text (no links). */
export const CREDIT: Record<"adult" | "child", Record<Locale, string>> = {
  adult: {
    en: "3D body: Human Reference Atlas (HuBMAP, CC BY 4.0); brain: Allen Institute (CC BY 4.0)",
    fr: "Corps 3D : Human Reference Atlas (HuBMAP, CC BY 4.0) ; cerveau : Allen Institute (CC BY 4.0)",
  },
  child: {
    en: "Adapted from the adult Human Reference Atlas (HuBMAP, CC BY 4.0) using paediatric reference measurements · brain: Allen Institute · outline MakeHuman, CC0",
    fr: "Adapté du Human Reference Atlas adulte (HuBMAP, CC BY 4.0) d’après des mesures pédiatriques de référence · cerveau : Allen Institute · silhouette MakeHuman, CC0",
  },
};
/** Added to the credit only when a Z-Anatomy layer is drawn: the words its notice asks for. */
export const ZA_CREDIT: Record<ZaLayer, Record<Locale, string>> = {
  muscles: {
    en: "muscles: Z-Anatomy (CC BY-SA 4.0), from BodyParts3D (DBCLS, CC BY-SA 2.1 JP)",
    fr: "muscles : Z-Anatomy (CC BY-SA 4.0), d’après BodyParts3D (DBCLS, CC BY-SA 2.1 JP)",
  },
  nerves: {
    en: "nerves: Z-Anatomy (CC BY-SA 4.0), from BodyParts3D (DBCLS, CC BY-SA 2.1 JP); cranial nerves after University of Dundee, CAHID (CC BY 4.0)",
    fr: "nerfs : Z-Anatomy (CC BY-SA 4.0), d’après BodyParts3D (DBCLS, CC BY-SA 2.1 JP) ; nerfs crâniens d’après University of Dundee, CAHID (CC BY 4.0)",
  },
};
export const creditOf = (body: Body, locale: Locale, layers: readonly Layer[] = []) =>
  [CREDIT[body === "boy" || body === "girl" ? "child" : "adult"][locale], ...layers.filter(isZaLayer).map((l) => ZA_CREDIT[l][locale])].join(" · ");
const FOV = 30;
/** The role in words, always beside a related or painful region (never colour alone). Invariant in French: "en rapport", "douleur". */
const ROLE_NAMES: Record<Locale, Record<Role, string>> = { en: { focus: "", related: "related", pain: "pain" }, fr: { focus: "", related: "en rapport", pain: "douleur" } };
const SENTENCE = {
  failed: { en: "The body could not be shown.", fr: "Le corps n’a pas pu être affiché." },
  loading: { en: "Loading the body", fr: "Chargement du corps" },
} as const;

export interface DrawBodyContext {
  /** The host's theme, or a function returning the current one: re-read when the page switches light and dark. */
  theme: Theme | (() => Theme);
  /** Where a body's mesh is: the package's assets/body/<body>.glb, served by the host (load only the one drawn). */
  asset: (body: Body, layer?: ZaLayer) => string;
  locale?: Locale;
  /** Jump instead of flying (prefers-reduced-motion); the default asks the browser. */
  reducedMotion?: boolean;
  /** Cancels the mount: before the mesh arrives nothing is left behind, and drawBody rejects with an AbortError. */
  signal?: AbortSignal;
}

export interface BodyHandle {
  /** Fly the camera to a highlighted region (one side of a paired one), or frame it (still). */
  flyTo(region: RegionId, side?: "left" | "right"): void;
  /** Back to the whole body. */
  reset(): void;
  /** Redraw in this theme (or the theme function's current one). */
  setTheme(theme?: Theme): void;
  dispose(): void;
}

/**
 * The loading state: a faint standing figure and a small ring turning beside it (still, under
 * reduced motion), in the host's tokens (components.css). Returns what takes it off, or swaps it
 * for a plain sentence when the body could not be shown.
 */
export function showLoading(container: HTMLElement, locale: Locale): (failed?: string) => void {
  const doc = container.ownerDocument;
  const box = doc.createElement("div");
  box.className = "zc-body-loading";
  box.setAttribute("role", "status");
  box.setAttribute("aria-label", SENTENCE.loading[locale]);
  const figure = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  figure.setAttribute("class", "zc-body-loading-figure");
  figure.setAttribute("viewBox", "0 0 60 150");
  figure.setAttribute("aria-hidden", "true");
  // A plain standing figure: head, trunk, arms, legs, as rounded strokes.
  for (const [tag, attrs] of [
    ["circle", { cx: "30", cy: "14", r: "10" }],
    ["path", { d: "M30 28 L30 80 M30 34 L12 72 M30 34 L48 72 M30 80 L20 140 M30 80 L40 140" }],
  ] as const) {
    const el = doc.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    figure.appendChild(el);
  }
  const ring = doc.createElement("div");
  ring.className = "zc-body-loading-ring";
  box.append(figure, ring);
  container.appendChild(box);
  return (failed) => {
    if (!failed) { box.remove(); return; }
    box.replaceChildren();
    box.className = "zc-body-loading zc-body-failed";
    box.setAttribute("aria-label", failed);
    box.textContent = failed;
  };
}

/**
 * A region's colour and how solid it is: the focus in the accent and pain in the theme's red, both
 * solid; a related region in the soft ink, translucent, so it neither looks like the focus nor hides it.
 */
export const roleLook = (role: Role, theme: Theme) =>
  role === "pain" ? { colour: theme.down, opacity: 1 } : role === "related" ? { colour: theme.soft, opacity: 0.45 } : { colour: theme.accent, opacity: 1 };
export const roleColour = (role: Role, theme: Theme) => roleLook(role, theme).colour;

/** A dimmed mesh of a layer that is shown: a veil in the axis colour, fainter on a dark ground. */
const DIM = (theme: Theme) => ({ colour: theme.axis, opacity: theme.mode === "dark" ? 0.22 : 0.3, lit: false });

/** What each mesh is drawn as, for these highlights: a region lit, its layer dimmed, the skin a veil, other layers hidden. */
export function looks(data: BodyData, theme: Theme, options?: Pick<BodyOptions, "layers">): Map<string, { colour: string; opacity: number; lit: boolean } | null> {
  const solid = new Set<Layer>(layersOf(data, options));
  const lit = new Map<string, Highlight>();
  for (const h of data.highlight) for (const side of sidesOf(h)) lit.set(meshName(h.region, side), h);
  const out = new Map<string, { colour: string; opacity: number; lit: boolean } | null>();
  // A shown layer that is not lit: dimmed organs and bones; muscles in muscle red (see-through over the
  // bones when both are shown); nerves in their pale yellow.
  const context = (layer: Layer) => {
    if (!solid.has(layer)) return layer === "skeleton" && !solid.has("muscles") ? { colour: theme.axis, opacity: 0.1, lit: false } : null;
    if (layer === "muscles") return { colour: theme.muscle, opacity: solid.has("skeleton") || solid.has("nerves") || solid.has("organs") ? 0.5 : 0.9, lit: false };
    if (layer === "nerves") return { colour: theme.nerve, opacity: 1, lit: false };
    return DIM(theme);
  };
  for (const [id, def] of Object.entries(REGIONS) as [RegionId, (typeof REGIONS)[RegionId]][]) {
    for (const side of isPaired(id) ? (["right", "left"] as const) : [null]) {
      const name = meshName(id, side);
      const h = lit.get(name);
      // A region of a layer that is not shown is not drawn at all (only the layer's rest may be, faintly).
      out.set(name, h ? { ...roleLook(h.role ?? "focus", theme), lit: true } : solid.has(def.layer) ? context(def.layer) : null);
    }
  }
  for (const layer of ALL_LAYERS) out.set(layer, layer === "skin" ? { colour: theme.soft, opacity: 0.1, lit: false } : context(layer));
  // A child's cartilage (growth plates, the pelvis's seams): solid in its own colour when the skeleton is; else not drawn (it would be noise round organs).
  out.set("cartilage", solid.has("skeleton") ? { colour: theme.cartilage, opacity: 1, lit: false } : null);
  return out;
}

const boxOf = (objects: THREE.Object3D[]): Box => {
  const b = new THREE.Box3();
  for (const o of objects) b.expandByObject(o);
  return { min: b.min.toArray() as Vec3, max: b.max.toArray() as Vec3 };
};

/** What the picture shows, for its accessible name. */
function summaryOf(data: BodyData, body: Body, locale: Locale): string {
  const items = data.highlight.map((h) => `${nameOf(h.region, h.side, locale)}${h.role && h.role !== "focus" ? ` (${ROLE_NAMES[locale][h.role]})` : ""}${h.note ? `: ${h.note}` : ""}`);
  const who = { en: { man: "a man", woman: "a woman", boy: "a boy of 8", girl: "a girl of 8" }, fr: { man: "un homme", woman: "une femme", boy: "un garçon de 8 ans", girl: "une fille de 8 ans" } }[locale][body];
  return locale === "fr" ? `Corps en 3D d’${who} : ${items.join(" ; ")}` : `3D body of ${who}: ${items.join("; ")}`;
}

/** Resolves once the element has a size above zero (a mount while hidden waits to be shown). */
function sized(el: HTMLElement, signal?: AbortSignal): Promise<void> {
  if (el.clientWidth > 0 && el.clientHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ro = new ResizeObserver(() => { if (el.clientWidth > 0 && el.clientHeight > 0) { ro.disconnect(); resolve(); } });
    ro.observe(el);
    signal?.addEventListener("abort", () => { ro.disconnect(); reject(signal.reason); }, { once: true });
  });
}

const abortError = () => new DOMException("The body's mount was cancelled.", "AbortError");

export async function drawBody(container: HTMLElement, data: BodyData, options: BodyOptions, ctx: DrawBodyContext): Promise<BodyHandle> {
  const locale: Locale = ctx.locale ?? "en";
  const doc = container.ownerDocument, win = doc.defaultView!;
  const currentTheme = () => (typeof ctx.theme === "function" ? ctx.theme() : ctx.theme);
  let theme = currentTheme();
  const reduced = ctx.reducedMotion ?? win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const interactive = options.mode === "interactive";
  const { signal } = ctx;
  if (signal?.aborted) throw abortError();
  container.classList.add("zc-body");
  container.dataset.mode = options.mode;

  // The stage (picture, labels, controls) and, below it in its own band, the credit.
  const stage = doc.createElement("div");
  stage.className = "zc-body-stage";
  const credit = doc.createElement("div");
  credit.className = "zc-body-credit";
  credit.textContent = creditOf(options.body, locale, layersOf(data, options));
  container.append(stage, credit);
  // The stage ends where the credit's band begins (the band's height depends on the width: it can wrap).
  const fitBand = () => { stage.style.bottom = `${credit.offsetHeight}px`; };
  fitBand();
  const bandWatch = new ResizeObserver(fitBand);
  bandWatch.observe(credit);
  const undo = () => { bandWatch.disconnect(); stage.remove(); credit.remove(); container.classList.remove("zc-body"); delete container.dataset.mode; delete container.dataset.ready; };

  // Loading: a quiet state while the mesh comes; a plain sentence (never a raw error) if it does not.
  const hideLoading = showLoading(stage, locale);
  let gltf: GLTF;
  // The body's own mesh, and only the Z-Anatomy layers this picture shows (each its own file, loaded on demand).
  const extra = layersOf(data, options).filter(isZaLayer);
  try {
    const load = async (url: string) => {
      const response = await win.fetch(url, { signal });
      if (!response.ok) throw new Error(`${response.status} ${response.url}`);
      return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(await response.arrayBuffer(), "");
    };
    const [base, ...layers] = await Promise.all([load(ctx.asset(options.body)), ...extra.map((layer) => load(ctx.asset(options.body, layer)))]);
    gltf = base!;
    for (const l of layers) gltf.scene.add(l.scene);
    if (signal?.aborted) throw abortError();
  } catch (error) {
    if (signal?.aborted) { undo(); throw abortError(); }
    hideLoading(SENTENCE.failed[locale]);
    container.dataset.ready = "failed";
    throw error;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.set(0.4, 0.8, 1);
  camera.add(key);
  scene.add(hemi, camera, gltf.scene);
  const meshes = new Map<string, THREE.Mesh>();
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.set(o.name, o as THREE.Mesh); });
  for (const mesh of meshes.values()) mesh.geometry.computeVertexNormals();
  gltf.scene.updateMatrixWorld(true);

  // Materials from the theme; re-run when it changes.
  const applyTheme = () => {
    const look = looks(data, theme, options);
    hemi.color.set(0xffffff); hemi.groundColor.set(theme.ground); hemi.intensity = theme.mode === "dark" ? 1.3 : 1.4;
    key.intensity = theme.mode === "dark" ? 1.9 : 1.7;
    for (const [name, mesh] of meshes) {
      const l = look.get(name);
      (mesh.material as THREE.Material).dispose();
      if (!l) { mesh.visible = false; continue; }
      mesh.visible = true;
      const colour = new THREE.Color(l.colour);
      // Opaque things draw first; the veils over them still hide their own far side (depthWrite),
      // so a dimmed organ reads as one surface. A translucent lit region (related) writes no depth.
      mesh.material = new THREE.MeshStandardMaterial({
        color: colour, roughness: l.lit ? 0.6 : 0.9, metalness: 0,
        emissive: l.lit ? colour : new THREE.Color(0), emissiveIntensity: l.lit ? 0.06 : 0,
        transparent: l.opacity < 1, opacity: l.opacity, depthWrite: name !== "skin" && !(l.lit && l.opacity < 1),
        side: name === "skin" ? THREE.FrontSide : THREE.DoubleSide,
      });
      mesh.renderOrder = l.opacity >= 1 ? 0 : l.lit ? 1 : name === "skin" ? 3 : 2;
    }
  };
  applyTheme();
  hideLoading();

  // A mount while hidden waits for a size, so nothing is computed at 0×0.
  try { await sized(stage, signal); } catch {
    for (const m of meshes.values()) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    undo();
    throw abortError();
  }

  // Framing.
  let width = stage.clientWidth, height = stage.clientHeight;
  const skin = meshes.get("skin")!;
  const bodyBox = boxOf([skin]);
  const meshesOf = (h: Highlight, side?: "left" | "right") => sidesOf(h).filter((s) => !side || s === side).map((s) => meshes.get(meshName(h.region, s))).filter((m): m is THREE.Mesh => Boolean(m));
  // The body's depth at a region's height (the feet and face reach further forward than the trunk): what auto measures "behind" against.
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
  const fov = (FOV * Math.PI) / 180;
  const shotOf = (h: Highlight, side?: "left" | "right"): Shot => {
    const box = boxOf(meshesOf(h, side));
    // Room for the labels either side, more on a narrow column; at least 6 cm round the focus.
    return frame(box, direction(viewOf(box)), fov, width / height, options.labels ? (width < 480 ? 0.68 : 0.45) : 0.3, 0.06);
  };
  const focus = focusOf(data, options);
  const wholeBodyShot = () => frameStanding(bodyBox, direction(viewOf(boxOf(meshesOf(focus)))), fov, width / height, 0.05);
  const restingShot = () => (options.frame === "body" ? wholeBodyShot() : shotOf(focus));
  let shot = restingShot();
  let userMoved = false;
  let controls: OrbitControls | null = null;
  const place = (s: Shot) => {
    camera.position.fromArray(position(s));
    camera.lookAt(new THREE.Vector3(...s.target));
    controls?.target.set(...s.target);
  };

  // The overlay: leaders (SVG), labels (text), the title, the controls.
  const overlay = doc.createElement("div");
  overlay.className = "zc-body-overlay";
  const lines = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  lines.setAttribute("class", "zc-body-lines");
  lines.setAttribute("aria-hidden", "true");
  overlay.appendChild(lines);
  stage.appendChild(overlay);
  let titleEl: HTMLElement | null = null;
  if (options.title) {
    titleEl = doc.createElement("div");
    titleEl.className = "zc-body-title";
    titleEl.textContent = options.title;
    overlay.appendChild(titleEl);
  }
  const key_ = doc.createElement("ol");
  key_.className = "zc-body-key";
  key_.hidden = true;
  overlay.appendChild(key_);
  const labels = options.labels ? data.highlight.map((h, index) => {
    const role = h.role ?? "focus";
    const el = doc.createElement("div");
    el.className = "zc-body-label";
    el.dataset.region = h.region;
    el.dataset.role = role;
    const name = doc.createElement("div");
    name.className = "zc-body-label-name";
    const swatch = doc.createElement("span");
    swatch.className = "zc-body-swatch";
    swatch.dataset.role = role;
    const number = doc.createElement("span");
    number.className = "zc-body-number";
    number.textContent = String(index + 1);
    const text = doc.createElement("span");
    text.textContent = nameOf(h.region, h.side, locale);
    name.append(swatch, number, text);
    el.appendChild(name);
    // The role in words beside a related or painful region, with the note: never colour alone.
    const words = [ROLE_NAMES[locale][role], h.note].filter(Boolean).join(" · ");
    if (words) {
      const note = doc.createElement("div");
      note.className = "zc-body-label-note";
      note.textContent = words;
      el.appendChild(note);
    }
    overlay.appendChild(el);
    const keyLine = doc.createElement("li");
    keyLine.textContent = [nameOf(h.region, h.side, locale), ROLE_NAMES[locale][role]].filter(Boolean).join(" · ");
    key_.appendChild(keyLine);
    const leaders = meshesOf(h).map((mesh) => {
      const line = doc.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("stroke-width", "1");
      if (role === "related") line.setAttribute("stroke-dasharray", "3 3");
      const dot = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("r", "3.5");
      dot.setAttribute("stroke-width", "1.5");
      const tag = doc.createElementNS("http://www.w3.org/2000/svg", "text");
      tag.setAttribute("text-anchor", "middle");
      tag.setAttribute("font-size", "10");
      tag.setAttribute("font-weight", "600");
      tag.textContent = String(index + 1);
      lines.append(line, dot, tag);
      // Its vertices in world space (at most 1500), for the anchor.
      const pos = mesh.geometry.getAttribute("position"), step = Math.max(1, Math.floor(pos.count / 1500)), v = new THREE.Vector3(), world: number[] = [];
      for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); world.push(v.x, v.y, v.z); }
      return { line, dot, tag, world, anchor: new THREE.Vector3() };
    });
    return { h, role, el, leaders, size: { full: 0, name: 0, width: 0 } };
  }) : [];

  /** Label sizes: measured once, and again only after a resize. */
  const measure = () => {
    for (const l of labels) {
      l.el.style.maxWidth = `${Math.round(width * (width < 480 ? 0.31 : 0.3))}px`;
      l.el.classList.remove("zc-body-label-short", "zc-body-label-numbered");
      l.size.full = l.el.offsetHeight; l.size.width = l.el.offsetWidth;
      l.el.classList.add("zc-body-label-short");
      l.size.name = l.el.offsetHeight;
      l.el.classList.remove("zc-body-label-short");
    }
  };
  /** Anchors: a vertex of each region facing the camera, near its middle; again when the camera has settled. */
  const anchor = () => { for (const l of labels) for (const ld of l.leaders) ld.anchor.fromArray(anchorPoint(ld.world, camera.position.toArray() as Vec3)); };
  const placeLabels = () => {
    if (!labels.length) return;
    const edge = 10, titleH = titleEl ? titleEl.offsetHeight + 8 : 0;
    const items: LabelIn[] = labels.map((l) => ({
      anchors: l.leaders.map((ld) => { const p = ld.anchor.clone().project(camera); return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height }; }),
      full: l.size.full, name: l.size.name, width: l.size.width,
    }));
    const { tier, placed } = layout(items, { width, top: edge + titleH, bottom: height - edge, gap: 8 });
    stage.dataset.labels = tier;
    key_.hidden = tier !== "numbers";
    if (tier === "numbers") { key_.style.top = `${edge + titleH}px`; }
    labels.forEach((l, i) => {
      const p = placed[i]!, it = items[i]!;
      l.el.classList.toggle("zc-body-label-short", tier === "names");
      l.el.hidden = tier === "numbers";
      const w = tier === "names" ? Math.min(l.size.width, l.el.offsetWidth) : l.size.width;
      const left = p.column === "left" ? edge : width - edge - w;
      l.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(p.top)}px)`;
      l.el.dataset.column = p.column;
      const colour = roleColour(l.role, theme);
      l.leaders.forEach((ld, k) => {
        const a = it.anchors[k]!;
        const numbered = tier === "numbers";
        ld.line.setAttribute("visibility", numbered ? "hidden" : "visible");
        ld.line.setAttribute("stroke", theme.soft);
        ld.line.setAttribute("x1", String(p.column === "left" ? left + w : left)); ld.line.setAttribute("y1", String(p.top + 13));
        ld.line.setAttribute("x2", String(a.x)); ld.line.setAttribute("y2", String(a.y));
        ld.dot.setAttribute("cx", String(a.x)); ld.dot.setAttribute("cy", String(a.y));
        ld.dot.setAttribute("r", numbered ? "7.5" : "3.5");
        ld.dot.setAttribute("fill", l.role === "related" ? theme.panel : colour);
        ld.dot.setAttribute("stroke", l.role === "related" ? colour : theme.panel);
        ld.tag.setAttribute("visibility", numbered ? "visible" : "hidden");
        ld.tag.setAttribute("x", String(a.x)); ld.tag.setAttribute("y", String(a.y + 3.5));
        ld.tag.setAttribute("fill", l.role === "related" ? theme.ink : theme.panel);
      });
    });
    if (tier === "numbers") key_.style.maxHeight = `${labels.length * KEY_LINE + 8}px`;
  };

  // Rendering. A still: borrow a context, paint, copy, give it back. Interactive: one context, on demand.
  const picture = doc.createElement("canvas");
  picture.className = "zc-body-canvas";
  picture.setAttribute("role", "img");
  picture.setAttribute("aria-label", summaryOf(data, options.body, locale));
  let renderer: THREE.WebGLRenderer | null = null;
  const dpr = () => win.devicePixelRatio || 1;
  const newRenderer = (canvas?: HTMLCanvasElement) => {
    const r = new THREE.WebGLRenderer({ antialias: true, ...(canvas ? { canvas } : {}) });
    r.setPixelRatio(dpr());
    r.setSize(width, height);
    r.setClearColor(theme.ground);
    return r;
  };
  const sizeCamera = () => { camera.aspect = width / height; camera.updateProjectionMatrix(); lines.setAttribute("width", String(width)); lines.setAttribute("height", String(height)); };
  const paintStill = () => {
    const r = newRenderer();
    r.render(scene, camera);
    picture.width = Math.round(width * dpr()); picture.height = Math.round(height * dpr());
    picture.style.width = `${width}px`; picture.style.height = `${height}px`;
    picture.getContext("2d")!.drawImage(r.domElement, 0, 0, picture.width, picture.height);
    r.forceContextLoss();
    r.dispose();
  };
  let frameId = 0, disposed = false, lost = false;
  type Flight = { path: ReturnType<typeof flight>; start: number; ms: number; to: Shot };
  let flying: Flight | null = null;
  const draw = () => {
    if (disposed) return;
    if (!interactive) { paintStill(); placeLabels(); return; }
    if (!renderer || lost) return;
    renderer.render(scene, camera);
    placeLabels();
  };
  const requestRender = () => { if (!frameId && !disposed && interactive) frameId = win.requestAnimationFrame(tick); };
  const tick = (now: number) => {
    frameId = 0;
    let moving = false;
    if (flying) {
      const t = Math.min(1, (now - flying.start) / flying.ms);
      place(flying.path.at(ease(t)));
      if (t >= 1) { shot = flying.to; flying = null; anchor(); } else moving = true;
    }
    if (controls?.update()) moving = true;
    draw();
    if (moving) requestRender();
  };
  const fly = (to: Shot) => {
    if (reduced || !interactive) { flying = null; shot = to; place(to); anchor(); draw(); return; }
    const from: Shot = { target: controls!.target.toArray() as Vec3, distance: camera.position.distanceTo(controls!.target), dir: camera.position.clone().sub(controls!.target).normalize().toArray() as Vec3 };
    const path = flight(from, to);
    flying = { path, start: win.performance.now(), ms: duration(path.S), to };
    requestRender();
  };

  sizeCamera();
  if (interactive) {
    renderer = newRenderer();
    const canvas = renderer.domElement;
    canvas.className = "zc-body-canvas";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", summaryOf(data, options.body, locale));
    canvas.style.touchAction = "none";
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lost = true; }, false);
    canvas.addEventListener("webglcontextrestored", () => { lost = false; applyTheme(); requestRender(); }, false);
    stage.insertBefore(canvas, overlay);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.zoomToCursor = true;
    controls.minDistance = 0.12;
    controls.maxDistance = wholeBodyShot().distance * 1.6;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI - 0.15;
    // The camera is the reader's once touched: no refit after that (the globe's rule).
    controls.addEventListener("start", () => { flying = null; userMoved = true; requestRender(); });
    controls.addEventListener("change", requestRender);
    controls.addEventListener("end", () => { anchor(); requestRender(); });
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
    const zoom = (k: number) => { userMoved = true; fly({ target: controls!.target.toArray() as Vec3, distance: Math.min(controls!.maxDistance, Math.max(controls!.minDistance, camera.position.distanceTo(controls!.target) * k)), dir: camera.position.clone().sub(controls!.target).normalize().toArray() as Vec3 }); };
    button(locale === "fr" ? "Zoom avant" : "Zoom in", "+", () => zoom(0.6));
    button(locale === "fr" ? "Zoom arrière" : "Zoom out", "−", () => zoom(1 / 0.6));
    button(locale === "fr" ? "Tout le corps" : "Whole body", "⤢", () => { userMoved = true; fly(wholeBodyShot()); });
    overlay.appendChild(group);
  } else {
    stage.insertBefore(picture, overlay);
  }

  measure();
  // First frame: a still is framed on the focus at once; an interactive body starts whole and flies in.
  if (interactive && !reduced) { place(wholeBodyShot()); anchor(); draw(); fly(shot); }
  else { place(shot); anchor(); draw(); }

  // Resizes: the picture, the camera, the leaders follow; the framing too until the reader has moved the camera.
  let resizeQueued = false;
  const ro = new ResizeObserver(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    win.requestAnimationFrame(() => {
      resizeQueued = false;
      const w = stage.clientWidth, h = stage.clientHeight;
      if (disposed || !w || !h || (w === width && h === height)) return;
      width = w; height = h;
      sizeCamera();
      renderer?.setSize(width, height);
      if (!userMoved && !flying) { shot = restingShot(); place(shot); anchor(); }
      measure();
      if (interactive) requestRender(); else draw();
    });
  });
  ro.observe(stage);

  // Light and dark: re-read the theme when the system's or the page's switch.
  const media = win.matchMedia("(prefers-color-scheme: dark)");
  const rethemed = () => { if (typeof ctx.theme === "function") setTheme(); };
  media.addEventListener("change", rethemed);
  const themeAttr = new MutationObserver(rethemed);
  themeAttr.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  function setTheme(next?: Theme) {
    theme = next ?? currentTheme();
    applyTheme();
    renderer?.setClearColor(theme.ground);
    if (interactive) requestRender(); else draw();
  }

  function dispose() {
    disposed = true;
    if (frameId) win.cancelAnimationFrame(frameId);
    ro?.disconnect();
    media?.removeEventListener("change", rethemed);
    themeAttr?.disconnect();
    controls?.dispose();
    if (renderer) { renderer.forceContextLoss(); renderer.dispose(); renderer = null; }
    for (const m of meshes.values()) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    undo();
  }

  container.dataset.ready = "1";
  return {
    flyTo(region, side) {
      const h = data.highlight.find((x) => x.region === region);
      if (!h) return;
      userMoved = true;
      fly(shotOf(h, side));
    },
    reset() { userMoved = false; fly(restingShot()); },
    setTheme,
    dispose,
  };
}
