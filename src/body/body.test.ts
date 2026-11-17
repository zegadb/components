import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, explain } from "../validate.ts";
import { theme } from "../theme.ts";
import { looks, roleColour } from "./draw.ts";
import { REGIONS, LAYERS, isPaired, meshName, nameOf, type RegionId } from "./regions.ts";
import { autoView, flight, frame, direction, position, type Box } from "./camera.ts";
import type { BodyData } from "./model.ts";

const ava = theme("ava", "light");
const first = (spec: unknown) => {
  const v = validate(spec);
  assert.equal(v.ok, false, `expected ${JSON.stringify(spec)} to be refused`);
  return (v as { ok: false; errors: { code: string; at: string; message: string; help: string }[] }).errors[0]!;
};
const IDS = Object.keys(REGIONS) as RegionId[];

/** The mesh names in the shipped asset, and each one's box in metres (from its accessor bounds and node transform). */
function asset(): Map<string, Box> {
  const bytes = readFileSync(new URL("../../assets/body/adult.glb", import.meta.url));
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

test("body: the asset has one mesh per region and side, and each layer's rest", () => {
  const meshes = asset();
  const expected = [...IDS.flatMap((id) => (isPaired(id) ? [meshName(id, "right"), meshName(id, "left")] : [meshName(id, null)])), ...LAYERS.filter((l) => l !== "organs")].sort();
  assert.deepEqual([...meshes.keys()].sort(), expected);
});

test("body: right is the person's right (−x), and the organs sit where they do in a body", () => {
  const m = asset();
  const skin = m.get("skin")!;
  for (const [name, box] of m) {
    if (name === "skin") continue;
    for (let i = 0; i < 3; i++) assert.ok(box.min[i]! >= skin.min[i]! - 0.01 && box.max[i]! <= skin.max[i]! + 0.01, `${name} lies inside the body`);
  }
  for (const id of IDS.filter(isPaired)) {
    assert.ok(mid(m.get(meshName(id, "right"))!)[0]! < 0, `${id}: right at −x`);
    assert.ok(mid(m.get(meshName(id, "left"))!)[0]! > 0, `${id}: left at +x`);
  }
  const y = (n: string) => mid(m.get(n)!)[1]!;
  assert.ok(y("brain") > y("heart") && y("heart") > y("liver") && y("liver") > y("bladder") && y("pelvis") > y("patella__right") && y("patella__right") > y("tibia__right"));
  assert.ok(mid(m.get("liver")!)[0]! < 0 && mid(m.get("spleen")!)[0]! > 0, "the liver on the right, the spleen on the left");
  assert.ok(y("kidney__right") < y("kidney__left"), "the right kidney sits lower");
  assert.ok(mid(m.get("spine")!)[2]! < mid(m.get("heart")!)[2]!, "the spine is behind the heart");
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
