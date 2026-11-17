import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, explain } from "../validate.ts";
import { theme } from "../theme.ts";
import { looks, roleColour } from "./draw.ts";
import { REGIONS, LAYERS, BODIES, isPaired, meshName, nameOf, type Body, type RegionId } from "./regions.ts";
import { autoView, flight, frame, direction, position, type Box } from "./camera.ts";
import { semantic, type BodyData, type BodyOptions } from "./model.ts";
import { MANIFEST } from "./manifest.ts";
import { creditOf } from "./draw.ts";
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const REFERENCES = JSON.parse(readFileSync(new URL("../../components/body/references.json", import.meta.url), "utf8"));
const valueOf = (body: "boy" | "girl", what: string) => REFERENCES.bodies[body].values.find((v: { what: string }) => v.what === what).value;

/** A shipped body's meshes, decoded: world positions and triangle indices per mesh name. */
async function decoded(body: Body): Promise<Map<string, { positions: number[]; indices: number[] }>> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.readBinary(readFileSync(new URL(`../../assets/body/${body}.glb`, import.meta.url)));
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
function asset(body: Body = "man"): Map<string, Box> {
  const bytes = readFileSync(new URL(`../../assets/body/${body}.glb`, import.meta.url));
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
  const expected = [...IDS.flatMap((id) => (isPaired(id) ? [meshName(id, "right"), meshName(id, "left")] : [meshName(id, null)])), ...LAYERS].sort();
  for (const body of BODIES) {
    assert.deepEqual([...asset(body).keys()].sort(), expected, body);
    assert.deepEqual([...MANIFEST[body].meshes], expected, `${body}: the manifest is the built mesh's (run npm run body:asset)`);
    assert.equal(MANIFEST[body].bytes, readFileSync(new URL(`../../assets/body/${body}.glb`, import.meta.url)).length, `${body}: the manifest's size is the file's`);
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
    for (const [name, box] of m) {
      if (name === "skin") continue;
      for (let i = 0; i < 3; i++) assert.ok(box.min[i]! >= skin.min[i]! - 0.01 && box.max[i]! <= skin.max[i]! + 0.01, `${body}: ${name} lies inside the body`);
    }
    for (const id of IDS.filter(isPaired)) {
      assert.ok(mid(m.get(meshName(id, "right"))!)[0]! < mid(skin)[0]!, `${body} ${id}: right at −x`);
      assert.ok(mid(m.get(meshName(id, "left"))!)[0]! > mid(skin)[0]!, `${body} ${id}: left at +x`);
    }
    const y = (n: string) => mid(m.get(n)!)[1]!;
    assert.ok(y("brain") > y("heart") && y("heart") > y("liver") && y("liver") > y("bladder") && y("pelvis") > y("patella__right") && y("patella__right") > y("tibia__right"), body);
    assert.ok(mid(m.get("liver")!)[0]! < 0 && mid(m.get("spleen")!)[0]! > 0, `${body}: the liver on the right, the spleen on the left`);
    assert.ok(mid(m.get("spine")!)[2]! < mid(m.get("heart")!)[2]!, `${body}: the spine is behind the heart`);
  }
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

test("body: the credit is the atlas's for adults, the adaptation's for children", () => {
  assert.match(creditOf("man", "en"), /Human Reference Atlas \(HuBMAP\), CC BY 4\.0/);
  assert.match(creditOf("girl", "en"), /adapted from the adult Human Reference Atlas .* using paediatric reference measurements/i);
  assert.match(creditOf("boy", "fr"), /mesures pédiatriques de référence/);
});

test("body: every region has its names, and a side reads in both languages", () => {
  for (const id of IDS) for (const locale of ["en", "fr"] as const) assert.ok(nameOf(id, undefined, locale).length > 1);
  assert.equal(nameOf("kidney", "left", "fr"), "Rein gauche");
  assert.equal(nameOf("patella", "right", "fr"), "Rotule droite");
  assert.equal(nameOf("lung", undefined, "en"), "Both lungs");
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
