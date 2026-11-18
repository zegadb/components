import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, explain } from "../validate.ts";
import { theme } from "../theme.ts";
import { looks, roleColour } from "./draw.ts";
import { REGIONS, LAYERS, BODIES, ZA_LAYERS, isPaired, meshName, type Body, type RegionId, type ZaLayer } from "./regions.ts";
import { autoView, flight, frame, direction, position, type Box } from "./camera.ts";
import { semantic, type BodyData, type BodyOptions } from "./model.ts";
import { MANIFEST } from "./manifest.ts";
import { layout, KEY_LINE } from "./labels.ts";
import { anchorPoint, insideTest, hanging } from "./geometry.ts";
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const REFERENCES = JSON.parse(readFileSync(new URL("../../components/body/references.json", import.meta.url), "utf8"));
const valueOf = (body: "boy" | "girl", what: string) => REFERENCES.bodies[body].values.find((v: { what: string }) => v.what === what).value;

/** A shipped body's meshes, decoded: world positions and triangle indices per mesh name. */
/** Where a body's file is: its own mesh in this package, a Z-Anatomy layer in packages/body-za. */
const fileOf = (body: Body, layer?: ZaLayer) => new URL(layer ? `../../packages/body-za/assets/${layer}/${body}.glb` : `../../assets/body/${body}.glb`, import.meta.url);
async function decoded(body: Body, layer?: ZaLayer): Promise<Map<string, { positions: number[]; indices: number[] }>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.readBinary(readFileSync(fileOf(body, layer)));
  const out = new Map<string, { positions: number[]; indices: number[] }>();
  for (const node of doc.getRoot().listNodes()) {
    const prim = node.getMesh()?.listPrimitives()[0];
    if (!prim) continue;
    const m = node.getWorldMatrix(), pos = prim.getAttribute("POSITION")!, idx = prim.getIndices()!, v = [0, 0, 0], positions: number[] = [];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); positions.push(m[0] * v[0]! + m[4] * v[1]! + m[8] * v[2]! + m[12], m[1] * v[0]! + m[5] * v[1]! + m[9] * v[2]! + m[13], m[2] * v[0]! + m[6] * v[1]! + m[10] * v[2]! + m[14]); }
    out.set(node.getName(), { positions, indices: Array.from(idx.getArray()!) });
  }
  return out;
}
const extent = (positions: number[], axis: number) => { let lo = Infinity, hi = -Infinity; for (let i = axis; i < positions.length; i += 3) { lo = Math.min(lo, positions[i]!); hi = Math.max(hi, positions[i]!); } return hi - lo; };
import { principalLength } from "./geometry.ts";

const ava = theme("ava", "light");
const first = (spec: unknown) => {
  const v = validate(spec);
  assert.equal(v.ok, false, `expected ${JSON.stringify(spec)} to be refused`);
  return (v as { ok: false; errors: { code: string; at: string; message: string; help: string }[] }).errors[0]!;
};
const IDS = Object.keys(REGIONS) as RegionId[];

/** The mesh names in a shipped body, and each one's box in metres (from its accessor bounds and node transform). */
function asset(body: Body = "man", layer?: ZaLayer): Map<string, Box> {
  const bytes = readFileSync(fileOf(body, layer));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
  const out = new Map<string, Box>();
  for (const node of json.nodes as { name: string; mesh?: number; translation?: number[]; scale?: number[] }[]) {
    if (node.mesh === undefined) continue;
    const acc = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
    const s = node.scale ?? [1, 1, 1], t = node.translation ?? [0, 0, 0];
    // KHR_mesh_quantization: normalized integers, so the bounds are in [-1, 1] (or [0, 1]) of the node's scale.
    const k = acc.normalized ? (acc.componentType === 5122 ? 32767 : acc.componentType === 5123 ? 65535 : 1) : 1;
    const at = (v: number[]) => v.map((x, i) => (x / k) * s[i]! + t[i]!) as [number, number, number];
    out.set(node.name, { min: at(acc.min), max: at(acc.max) });
  }
  return out;
}
const mid = (b: Box) => b.min.map((v, i) => (v + b.max[i]!) / 2);

test("body: an unknown region is a teaching error back to the model, and nothing is drawn", () => {
  const e = first({ component: "body", data: { highlight: [{ region: "livers" }] } });
  assert.equal(e.code, "enum");
  assert.equal(e.at, "data.highlight[0].region");
  assert.equal(e.help, 'did you mean "liver"?');
  assert.match(explain([e as never]), /^The picture was not drawn/);
  assert.equal(first({ component: "body", data: { highlight: [{ region: "stomach" }] } }).code, "enum");
});

test("body: sides only on paired regions, no region twice, a focus that is highlighted", () => {
  assert.equal(first({ component: "body", data: { highlight: [{ region: "heart", side: "left" }] } }).code, "side");
  assert.equal(first({ component: "body", data: { highlight: [{ region: "kidney" }, { region: "kidney", side: "left" }] } }).code, "duplicate");
  assert.equal(validate({ component: "body", data: { highlight: [{ region: "kidney", side: "right" }, { region: "kidney", side: "left", role: "pain" }] } }).ok, true);
  assert.equal(first({ component: "body", data: { highlight: [{ region: "heart" }] }, options: { focus: "liver" } }).code, "focus");
  assert.equal(first({ component: "body", data: { highlight: [{ region: "heart" }] }, options: { mode: "spin" } }).code, "enum");
});

test("body: the lit meshes are exactly the highlighted regions and sides, coloured by role", () => {
  const data: BodyData = { highlight: [{ region: "liver" }, { region: "kidney", side: "left", role: "pain" }, { region: "gallbladder", role: "related" }] };
  const l = looks(data, ava);
  const lit = [...l].filter(([, v]) => v?.lit).map(([k]) => k).sort();
  assert.deepEqual(lit, ["gallbladder", "kidney__left", "liver"]);
  assert.equal(l.get("liver")!.colour, ava.accent);
  assert.equal(l.get("kidney__left")!.colour, ava.down);
  assert.equal(l.get("gallbladder")!.colour, roleColour("related", ava));
  assert.notEqual(roleColour("related", ava), ava.accent);
  assert.ok(l.get("gallbladder")!.opacity < 1 && l.get("liver")!.opacity === 1, "a related region is translucent, so it never hides the focus");
  // The other kidney and the other organs are dimmed, not lit; the skin is a veil; the skeleton is all but hidden.
  assert.equal(l.get("kidney__right")!.lit, false);
  assert.ok(l.get("heart")!.opacity < 1);
  assert.ok(l.get("skin")!.opacity <= 0.12);
  assert.equal(l.get("femur__right"), null, "bones of a layer with no highlight are not drawn");
  // A bone highlight shows the skeleton and hides the organs.
  const bones = looks({ highlight: [{ region: "femur", side: "right" }] }, ava);
  assert.equal(bones.get("femur__right")!.lit, true);
  assert.equal(bones.get("femur__left")!.lit, false);
  assert.equal(bones.get("liver"), null);
});

test("body: every body has one mesh per region and side and each layer's rest, as its manifest says", () => {
  const meshesOf = (ids: RegionId[]) => ids.flatMap((id) => (isPaired(id) ? [meshName(id, "right"), meshName(id, "left")] : [meshName(id, null)]));
  const base = [...meshesOf(IDS.filter((id) => !REGIONS[id].za)), ...LAYERS].sort();
  for (const body of BODIES) {
    const want = body === "boy" || body === "girl" ? [...base, "cartilage"].sort() : base;
    assert.deepEqual([...asset(body).keys()].sort(), want, body);
    assert.equal(MANIFEST[body].bytes, readFileSync(fileOf(body)).length, `${body}: the manifest's size is the file's`);
    const all = [...want];
    for (const layer of ZA_LAYERS) {
      const layerWant = [...meshesOf(IDS.filter((id) => REGIONS[id].layer === layer)), layer].sort();
      assert.deepEqual([...asset(body, layer).keys()].sort(), layerWant, `${body} ${layer}`);
      assert.equal(MANIFEST[body].layers[layer].bytes, readFileSync(fileOf(body, layer)).length, `${body} ${layer}: the manifest's size is the file's`);
      all.push(...layerWant);
    }
    assert.deepEqual([...MANIFEST[body].meshes], all.sort(), `${body}: the manifest is the built meshes' (run npm run body:asset)`);
  }
});

test("body: the four bodies stay inside the package's size budget", () => {
  // R2 is off, so the meshes ship in the npm package: each under 480 KB, all four under 1.8 MB.
  let total = 0;
  for (const body of BODIES) { const n = readFileSync(new URL(`../../assets/body/${body}.glb`, import.meta.url)).length; assert.ok(n < 480 * 1024, `${body}: ${n} bytes`); total += n; }
  assert.ok(total < 1.8 * 1024 * 1024, `all four: ${total} bytes`);
});

test("body: in every body, right is the person's right (−x), and the organs sit where they do in a body", () => {
  for (const body of BODIES) {
    const m = asset(body);
    const skin = m.get("skin")!;
    for (const id of IDS.filter((i) => isPaired(i) && !REGIONS[i].za)) {
      assert.ok(mid(m.get(meshName(id, "right"))!)[0]! < mid(skin)[0]!, `${body} ${id}: right at −x`);
      assert.ok(mid(m.get(meshName(id, "left"))!)[0]! > mid(skin)[0]!, `${body} ${id}: left at +x`);
    }
    const y = (n: string) => mid(m.get(n)!)[1]!;
    assert.ok(y("brain") > y("heart") && y("heart") > y("liver") && y("liver") > y("bladder") && y("pelvis") > y("patella__right") && y("patella__right") > y("tibia__right"), body);
    assert.ok(m.get("liver")!.min[0] < m.get("spleen")!.min[0] - 0.05 && mid(m.get("spleen")!)[0]! > 0, `${body}: the liver reaches furthest right, the spleen sits left`);
    assert.ok(mid(m.get("spine")!)[2]! < mid(m.get("heart")!)[2]!, `${body}: the spine is behind the heart`);
  }
});

test("body: every organ and bone lies inside its body's skin (point in mesh, not a box)", async () => {
  // Before the fix the girl's tibias were half outside her shins (49 % and 57 % of their points).
  for (const body of BODIES) {
    const m = await decoded(body), skin = m.get("skin")!, inside = insideTest(skin.positions, skin.indices);
    for (const [name, g] of m) {
      if (name === "skin") continue;
      const n = g.positions.length / 3, step = Math.max(1, Math.floor(n / 300));
      let out = 0, total = 0;
      for (let i = 0; i < n; i += step) { total++; if (!inside([g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!])) out++; }
      assert.ok(out / total <= 0.01, `${body}: ${(100 * out / total).toFixed(1)} % of ${name} is outside the skin`);
    }
  }
});

test("body: every body's outline is the neutral form: nothing hangs between the thighs (Sami, 17 Nov)", async () => {
  // Before the fix the man's outline had 252 points hanging below his crotch near the midline.
  for (const body of BODIES) {
    const skin = (await decoded(body)).get("skin")!;
    const found = hanging(skin.positions, skin.indices).vertices.size;
    assert.equal(found, 0, `${body}: ${found} outline points hang between the thighs`);
  }
});

test("body: a child's bladder is no larger than the adult's, its liver fits its trunk, its brain is near adult size", async () => {
  for (const [child, adult] of [["boy", "man"], ["girl", "woman"]] as const) {
    const c = await decoded(child), a = await decoded(adult);
    const box = (m: Map<string, { positions: number[] }>, n: string) => [0, 1, 2].map((k) => extent(m.get(n)!.positions, k));
    const vol = (b: number[]) => b[0]! * b[1]! * b[2]!;
    assert.ok(vol(box(c, "bladder")) <= vol(box(a, "bladder")), `${child}: bladder ${(vol(box(c, "bladder")) / vol(box(a, "bladder"))).toFixed(2)}× the ${adult}'s`);
    // About 95 % of adult volume at 8 (Lenroot 2007), less whatever the skull's room takes off.
    const brain = vol(box(c, "brain")) / vol(box(a, "brain"));
    assert.ok(brain > 0.75 && brain <= 1, `${child}: brain ${(brain * 100).toFixed(0)} % of the ${adult}'s`);
    // The liver no wider than the trunk where it sits.
    const liver = c.get("liver")!.positions, skin = c.get("skin")!.positions;
    let ly0 = Infinity, ly1 = -Infinity; for (let i = 1; i < liver.length; i += 3) { ly0 = Math.min(ly0, liver[i]!); ly1 = Math.max(ly1, liver[i]!); }
    const y = (ly0 + ly1) / 2, xs: number[] = [];
    for (let i = 0; i < skin.length; i += 3) if (Math.abs(skin[i + 1]! - y) < 0.01) xs.push(skin[i]!);
    xs.sort((p, q) => p - q);
    let k = xs.findIndex((x) => x >= 0), lo = k, hi = k;
    while (lo > 0 && xs[lo]! - xs[lo - 1]! < 0.02) lo--;
    while (hi < xs.length - 1 && xs[hi + 1]! - xs[hi]! < 0.02) hi++;
    assert.ok(extent(liver, 0) < 0.92 * (xs[hi]! - xs[lo]!), `${child}: liver ${(extent(liver, 0) * 100).toFixed(1)} cm across a ${((xs[hi]! - xs[lo]!) * 100).toFixed(1)} cm trunk`);
  }
});

test("body: a child's pelvic cartilage is only at the seams (acetabulum, ischiopubic), not over the iliac wings", async () => {
  for (const child of ["boy", "girl"] as const) {
    const m = await decoded(child), pelvis = m.get("pelvis")!.positions, cart = m.get("cartilage")!.positions;
    let p0 = Infinity, p1 = -Infinity; for (let i = 1; i < pelvis.length; i += 3) { p0 = Math.min(p0, pelvis[i]!); p1 = Math.max(p1, pelvis[i]!); }
    // The upper third of the pelvis is the iliac wings (fossae and crests): no cartilage there.
    let high = 0; for (let i = 1; i < cart.length; i += 3) if (cart[i]! > p1 - 0.33 * (p1 - p0)) high++;
    assert.equal(high, 0, `${child}: ${high} cartilage points over the iliac wings`);
  }
});

test("body: twelve labels on a phone fall back to names or numbers, all inside the picture", () => {
  const space = { width: 358, top: 10, bottom: 342, gap: 8 };
  const labels = Array.from({ length: 12 }, (_, i) => ({ anchors: [{ x: i % 2 ? 220 : 140, y: 60 + i * 22 }], full: 58, name: 26, width: 110 }));
  const { tier, placed } = layout(labels, space);
  assert.notEqual(tier, "full", "twelve labels with notes cannot fit 332 px");
  const h = tier === "names" ? 26 : KEY_LINE;
  for (const p of placed) assert.ok(p.top >= space.top && p.top + h <= space.bottom, `a label at ${p.top}`);
  // Twelve all on one side: even names do not fit one column, so numbered markers and a key.
  assert.equal(layout(labels.map((l) => ({ ...l, anchors: [{ x: 100, y: l.anchors[0]!.y }] })), space).tier, "numbers");
  assert.equal(layout(labels.slice(0, 3), space).tier, "full");
});

test("body: a label points at its own region, not at what its box surrounds (the pelvis, not the bladder)", async () => {
  const m = await decoded("man"), pelvis = m.get("pelvis")!.positions, bladder = m.get("bladder")!.positions;
  const b = [0, 1, 2].map((k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < bladder.length; i += 3) { lo = Math.min(lo, bladder[i]!); hi = Math.max(hi, bladder[i]!); } return [lo, hi] as const; });
  const centre = [0, 1, 2].map((k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < pelvis.length; i += 3) { lo = Math.min(lo, pelvis[i]!); hi = Math.max(hi, pelvis[i]!); } return (lo + hi) / 2; });
  const p = anchorPoint(pelvis, [centre[0]!, centre[1]! + 0.1, centre[2]! + 3]);
  // The box's own centre is at the bladder (the bug this guards) ...
  assert.ok(b.every(([lo, hi], k) => centre[k]! >= lo - 0.03 && centre[k]! <= hi + 0.03), "the pelvis's box centre is at the bladder");
  // ... the anchor is a point of the pelvis itself, in front of the bladder as the camera sees it.
  let isVertex = false;
  for (let i = 0; i < pelvis.length; i += 3) if (pelvis[i] === p[0] && pelvis[i + 1] === p[1] && pelvis[i + 2] === p[2]) isVertex = true;
  assert.ok(isVertex, "the anchor is one of the pelvis's own points");
  assert.ok(p[2] > b[2]![1] - 0.01, `the anchor (z ${p[2].toFixed(3)}) is at the front of the bladder (z up to ${b[2]![1].toFixed(3)}), not inside it`);
});

test("body: a child is not a scaled adult: a larger head, a relatively larger liver, a higher bladder", () => {
  for (const [child, adult] of [["boy", "man"], ["girl", "woman"]] as const) {
    const c = asset(child), a = asset(adult);
    const H = (m: Map<string, Box>) => m.get("skin")!.max[1] - m.get("skin")!.min[1];
    const share = (m: Map<string, Box>, n: string, axis = 1) => (m.get(n)!.max[axis]! - m.get(n)!.min[axis]!) / H(m);
    assert.ok(Math.abs(H(c) - valueOf(child, "stature") / 100) < 0.005, `${child}: the CDC stature`);
    assert.ok(share(c, "brain") > share(a, "brain") * 1.15, `${child}: the head (brain) is proportionally larger`);
    // The liver against the trunk it sits in (the spine's length), where a child's is relatively larger.
    const inTrunk = (m: Map<string, Box>) => share(m, "liver") / share(m, "spine");
    // (The boy's is 1.2× the man's; the girl's only about 1.05× the woman's: the atlas woman's own liver is large, see the spec.)
    assert.ok(inTrunk(c) > inTrunk(a) * 1.03, `${child}: the liver is relatively larger (${inTrunk(c).toFixed(3)} vs ${inTrunk(a).toFixed(3)} of the spine)`);
    // The thymus is not compared with the adults': the atlas's adult "thymus" is the fat-replaced thymic
    // region (the woman's is 8.6 cm across), not a gland; the child's is held to its CT size in the next test.
    // The bladder against the pelvis: a child's sits higher.
    const rise = (m: Map<string, Box>) => (mid(m.get("bladder")!)[1]! - m.get("pelvis")!.min[1]) / (m.get("pelvis")!.max[1] - m.get("pelvis")!.min[1]);
    assert.ok(rise(c) > rise(a) + 0.1, `${child}: the bladder sits higher (${rise(c).toFixed(2)} vs ${rise(a).toFixed(2)} of the pelvis)`);
  }
});

test("body: the children's organs measure what the references say", async () => {
  for (const child of ["boy", "girl"] as const) {
    const m = await decoded(child);
    for (const side of ["right", "left"] as const) {
      const got = principalLength(m.get(meshName("kidney", side))!.positions) * 100;
      assert.ok(Math.abs(got - valueOf(child, "kidney")) < 0.4, `${child} ${side} kidney: ${got.toFixed(2)} cm, reference ${valueOf(child, "kidney")} cm`);
    }
    const spleen = principalLength(m.get("spleen")!.positions) * 100;
    assert.ok(Math.abs(spleen - valueOf(child, "spleen")) < 0.4, `${child} spleen: ${spleen.toFixed(2)} cm`);
    const thymus = m.get("organs")!.positions, t = valueOf(child, "thymus");
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(extent(thymus, k) * 100 - t[k]) < 0.25, `${child} thymus axis ${k}: ${(extent(thymus, k) * 100).toFixed(2)} cm`);
  }
});

test("body: a child's femur and tibia have open growth plates; an adult's do not", async () => {
  /** The largest band of height with no triangle in it, inside the bone's own extent. */
  const widestGap = ({ positions, indices }: { positions: number[]; indices: number[] }) => {
    const spans: [number, number][] = [];
    for (let i = 0; i < indices.length; i += 3) { const ys = [0, 1, 2].map((k) => positions[indices[i + k]! * 3 + 1]!); spans.push([Math.min(...ys), Math.max(...ys)]); }
    spans.sort((a, b) => a[0] - b[0]);
    let reach = spans[0]![1], gap = 0;
    for (const [lo, hi] of spans) { gap = Math.max(gap, lo - reach); reach = Math.max(reach, hi); }
    return gap;
  };
  const plate = valueOf("boy", "growth plates");
  for (const child of ["boy", "girl"] as const) {
    const m = await decoded(child);
    for (const bone of ["femur__right", "tibia__left"]) assert.ok(widestGap(m.get(bone)!) > plate * 0.8, `${child} ${bone}: a growth plate ${(widestGap(m.get(bone)!) * 1000).toFixed(1)} mm`);
  }
  const man = await decoded("man");
  for (const bone of ["femur__right", "tibia__left"]) assert.equal(widestGap(man.get(bone)!), 0, `man ${bone}: no gap`);
});

test("body: a child's growth plates are cartilage, filling the gaps in the bone, in the cartilage colour", async () => {
  const boy = await decoded("boy");
  const cart = boy.get("cartilage")!, femur = boy.get("femur__right")!;
  // The femur's gap: the widest band of height no triangle of it crosses.
  const spans: [number, number][] = [];
  for (let i = 0; i < femur.indices.length; i += 3) { const t = [0, 1, 2].map((k) => femur.positions[femur.indices[i + k]! * 3 + 1]!); spans.push([Math.min(...t), Math.max(...t)]); }
  spans.sort((a, b) => a[0] - b[0]);
  let reach = spans[0]![1], gapLo = 0, gapHi = 0;
  for (const [lo, hi] of spans) { if (lo - reach > gapHi - gapLo) { gapLo = reach; gapHi = lo; } reach = Math.max(reach, hi); }
  // Cartilage at both edges of the gap, within the femur's own width: the plate fills it.
  let fx0 = Infinity, fx1 = -Infinity;
  for (let i = 0; i < femur.positions.length; i += 3) if (Math.abs(femur.positions[i + 1]! - gapLo) < 0.01) { fx0 = Math.min(fx0, femur.positions[i]!); fx1 = Math.max(fx1, femur.positions[i]!); }
  const at = (y: number) => { let n = 0; for (let i = 0; i < cart.positions.length; i += 3) if (Math.abs(cart.positions[i + 1]! - y) < 0.0012 && cart.positions[i]! >= fx0 - 0.002 && cart.positions[i]! <= fx1 + 0.002) n++; return n; };
  assert.ok(at(gapLo) >= 3 && at(gapHi) >= 3, `cartilage fills the femur's growth plate (${at(gapLo)} and ${at(gapHi)} cartilage points at its edges ${gapLo.toFixed(3)}, ${gapHi.toFixed(3)})`);
  const l = looks({ highlight: [{ region: "femur", side: "right" }] }, ava);
  assert.deepEqual(l.get("cartilage"), { colour: ava.cartilage, opacity: 1, lit: false });
  assert.notEqual(ava.cartilage, l.get("femur__right")!.colour);
});

test("body: a child's organs fill the trunk as an adult's do, the boy's as the girl's", async () => {
  /** The organs' width across the upper abdomen (liver to spleen) over the trunk's own width there (arms left out). */
  const fill = async (body: Body) => {
    const m = await decoded(body);
    const box = (n: string) => { const p = m.get(n)!.positions; let lo = Infinity, hi = -Infinity, ylo = Infinity, yhi = -Infinity; for (let i = 0; i < p.length; i += 3) { lo = Math.min(lo, p[i]!); hi = Math.max(hi, p[i]!); ylo = Math.min(ylo, p[i + 1]!); yhi = Math.max(yhi, p[i + 1]!); } return { lo, hi, y: (ylo + yhi) / 2 }; };
    const liver = box("liver"), spleen = box("spleen");
    const y = (liver.y + spleen.y) / 2, skin = m.get("skin")!.positions;
    const xs: number[] = [];
    for (let i = 0; i < skin.length; i += 3) if (Math.abs(skin[i + 1]! - y) < 0.01) xs.push(skin[i]!);
    xs.sort((a, b) => a - b);
    let k = xs.findIndex((x) => x >= 0), lo = k, hi = k;
    while (lo > 0 && xs[lo]! - xs[lo - 1]! < 0.02) lo--;
    while (hi < xs.length - 1 && xs[hi + 1]! - xs[hi]! < 0.02) hi++;
    return (spleen.hi - liver.lo) / (xs[hi]! - xs[lo]!);
  };
  const [boy, girl] = [await fill("boy"), await fill("girl")];
  // Scaled with the outline instead of the room inside the body wall, the boy's fill 80 %: this catches it.
  assert.ok(boy > girl * 0.88, `the boy's organs fill ${(boy * 100).toFixed(0)} % of his trunk, the girl's ${(girl * 100).toFixed(0)} %`);
});

test("body: a region the chosen body does not have is an error for the model, not a blank picture", () => {
  const options = validate({ component: "body", data: { highlight: [{ region: "patella" }] }, options: { body: "boy" } });
  assert.ok(options.ok, "every region exists in all four bodies today");
  const withoutPatella = { ...MANIFEST, boy: { meshes: MANIFEST.boy.meshes.filter((n) => !n.startsWith("patella")) } };
  const opts = (options.ok ? options.view.options : null) as BodyOptions;
  const [e] = semantic({ highlight: [{ region: "patella", side: "right" }] }, opts, withoutPatella);
  assert.equal(e?.code, "body");
  assert.equal(e?.message, "the boy's body has no patella (right side)");
  assert.equal(e?.help, "leave it out, or draw it on man or woman or girl");
});

test("body camera: framing fits the box, auto looks from the back for what lies behind, the flight starts and ends on its shots", () => {
  const box: Box = { min: [-0.1, 0.2, -0.05], max: [0.1, 0.4, 0.05] };
  const s = frame(box, direction("front"), Math.PI / 6, 1, 0.25);
  const radius = Math.hypot(0.2, 0.2, 0.1) / 2;
  assert.ok(Math.abs(radius / s.distance - Math.sin(Math.PI / 12) * 0.75) < 1e-9);
  assert.ok(position(s)[2] > 0.3, "the front view stands at +z");
  const body: Box = { min: [-0.5, -0.9, -0.16], max: [0.5, 0.9, 0.16] };
  assert.equal(autoView({ min: [-0.05, 0.15, -0.12], max: [0.06, 0.76, 0.02] }, body), "back");
  assert.equal(autoView({ min: [-0.13, 0.28, -0.09], max: [0.06, 0.45, 0.11] }, body), "front");
  const a = { target: [0, 0, 0] as [number, number, number], distance: 4, dir: direction("front") };
  const b = { target: [0.1, 0.3, -0.02] as [number, number, number], distance: 0.6, dir: direction("back") };
  const f = flight(a, b);
  assert.ok(f.at(0).target.every((v, i) => Math.abs(v - a.target[i]!) < 1e-9));
  assert.ok(Math.abs(f.at(0).distance - 4) < 1e-9 && Math.abs(f.at(1).distance - 0.6) < 1e-9);
  assert.deepEqual(f.at(1).target, b.target);
  // Front to back walks round the body: halfway, the camera looks from a side.
  assert.ok(Math.abs(f.at(0.5).dir[0]) > 0.9);
  // A long way between near shots zooms out on the way, as the globe does.
  const near = flight({ target: [0, 0.5, 0], distance: 0.3, dir: direction("front") }, { target: [0, -0.5, 0], distance: 0.3, dir: direction("front") });
  assert.ok(near.at(0.5).distance > 0.4);
});

// The Z-Anatomy layers (muscles, nerves): share-alike, apart, fitted to every body.

test("body layers: the share-alike files are only in packages/body-za, each crediting Z-Anatomy; this package's are not", async () => {
  const copyright = (url: URL) => { const bytes = readFileSync(url); const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8")); return String(json.asset.copyright ?? ""); };
  for (const body of BODIES) {
    assert.doesNotMatch(copyright(fileOf(body)), /Z-Anatomy/, `${body}: this package's mesh has no share-alike content`);
    for (const layer of ZA_LAYERS) {
      const c = copyright(fileOf(body, layer));
      assert.match(c, /Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4\.0/, `${body} ${layer}`);
      assert.match(c, /BodyParts3D - The Database Center for Life Science - CC-BY-SA 2\.1 Japan/, `${body} ${layer}`);
      if (layer === "nerves") assert.match(c, /University of Dundee, CAHID - CC-BY 4\.0/, `${body} nerves`);
    }
  }
  const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const za = JSON.parse(readFileSync(new URL("../../packages/body-za/package.json", import.meta.url), "utf8"));
  assert.ok(!root.files.some((f: string) => f.startsWith("packages")), "the MIT package does not ship the share-alike one");
  assert.equal(root.license, "MIT AND CC-BY-4.0 AND CC0-1.0");
  assert.equal(za.license, "CC-BY-SA-4.0 AND CC-BY-SA-2.1-JP AND CC-BY-4.0");
});

test("body layers: each layer stays inside its budget (loaded only when it is drawn)", () => {
  // Per body: muscles under 300 KB, nerves under 120 KB (about 250 and 95 today).
  const budget = { muscles: 300 * 1024, nerves: 120 * 1024 };
  for (const body of BODIES) for (const layer of ZA_LAYERS) {
    const n = readFileSync(fileOf(body, layer)).length;
    assert.ok(n < budget[layer], `${body} ${layer}: ${(n / 1024).toFixed(0)} KB`);
  }
});

test("body layers: every muscle and nerve lies inside its body's skin, in all four bodies", async () => {
  for (const body of BODIES) {
    const skin = (await decoded(body)).get("skin")!, inside = insideTest(skin.positions, skin.indices);
    for (const layer of ZA_LAYERS) {
      for (const [name, g] of await decoded(body, layer)) {
        const n = g.positions.length / 3, step = Math.max(1, Math.floor(n / 300));
        let out = 0, total = 0;
        for (let i = 0; i < n; i += step) { total++; if (!inside([g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!])) out++; }
        assert.ok(out / total <= 0.02, `${body} ${layer}: ${(100 * out / total).toFixed(1)} % of ${name} is outside the skin`);
      }
    }
  }
});

test("body layers: muscles and nerves sit where they do against the bones, in all four bodies", () => {
  for (const body of BODIES) {
    const b = asset(body), m = asset(body, "muscles"), n = asset(body, "nerves");
    const at = (map: Map<string, Box>, name: string) => { const box = map.get(name); assert.ok(box, `${body}: no ${name}`); return mid(box!); };
    for (const side of ["right", "left"] as const) {
      const femur = at(b, meshName("femur", side)), tibia = at(b, meshName("tibia", side)), patella = at(b, meshName("patella", side));
      // The quadriceps in front of the thigh bone, the hamstrings and the sciatic nerve behind it; the calf behind the shin bone, below the knee.
      assert.ok(at(m, meshName("quadriceps", side))[2]! > femur[2]!, `${body} ${side}: quadriceps in front of the femur`);
      assert.ok(at(m, meshName("hamstrings", side))[2]! < femur[2]!, `${body} ${side}: hamstrings behind the femur`);
      // The sciatic nerve runs behind the thigh bone (its back reaches further back than the bone's; its branches wind forward below the knee).
      assert.ok(n.get(meshName("sciatic-nerve", side))!.min[2] < b.get(meshName("femur", side))!.min[2], `${body} ${side}: sciatic nerve behind the femur`);
      const calf = at(m, meshName("gastrocnemius", side));
      assert.ok(calf[2]! < tibia[2]! && calf[1]! < patella[1]!, `${body} ${side}: calf behind the shin bone, below the knee`);
      // The deltoid at the shoulder: on its side, above the heart.
      const deltoid = at(m, meshName("deltoid", side));
      assert.ok(side === "right" ? deltoid[0]! < 0 : deltoid[0]! > 0, `${body} ${side}: deltoid on its own side`);
      assert.ok(deltoid[1]! > at(b, "heart")[1]!, `${body} ${side}: deltoid above the heart`);
    }
    assert.ok(at(n, "spinal-cord")[2]! < at(b, "heart")[2]!, `${body}: the spinal cord behind the heart`);
  }
});
