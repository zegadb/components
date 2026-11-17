// body (components/body/): the region vocabulary, and the one place a mesh id
// is named. Every region id in the contract ($defs.region) has exactly one
// entry here (the record's key type is the contract's own enum, so a region
// added to one and not the other does not type-check). The asset builder
// (tools/body/build.mjs) reads this table to cut the body into one named mesh
// per region and side, so the drawing, the labels and the validator cannot
// disagree about what a region is.
//
// Mesh ids are node names in the Human Reference Atlas's 3D reference
// objects, the Visible Human male (HuBMAP CCF, `3d-vh-m-united.glb`, release
// v2.0), licensed under CC BY 4.0; the female's are femaleNode() of them.
import type { CONTRACTS } from "../generated/contracts.ts";

export type RegionId = (typeof CONTRACTS)["body"]["$defs"]["region"]["enum"][number];
export type Layer = "skin" | "skeleton" | "organs";
/** A region's name: one for an unpaired region; the person's right, left and both for a paired one. */
export type Names = readonly [name: string] | readonly [right: string, left: string, both: string];

export interface RegionDef {
  readonly layer: Layer;
  /** Source nodes (their whole subtrees): one list for an unpaired region; the person's right and left for a paired one. */
  readonly nodes: readonly string[] | { readonly right: readonly string[]; readonly left: readonly string[] };
  readonly en: Names;
  readonly fr: Names;
}

const one = (layer: Layer, nodes: string[], en: string, fr: string): RegionDef => ({ layer, nodes, en: [en], fr: [fr] });
const pair = (layer: Layer, right: string, left: string, en: Names, fr: Names): RegionDef => ({ layer, nodes: { right: [right], left: [left] }, en, fr });

export const REGIONS: Readonly<Record<RegionId, RegionDef>> = {
  // Organs.
  "brain": one("organs", ["Allen_brain"], "Brain", "Cerveau"),
  "heart": one("organs", ["VH_M_heart"], "Heart", "Cœur"),
  "lung": pair("organs", "VH_M_lungs_R", "VH_M_lungs_L", ["Right lung", "Left lung", "Both lungs"], ["Poumon droit", "Poumon gauche", "Les deux poumons"]),
  "liver": one("organs", ["VH_M_liver"], "Liver", "Foie"),
  "gallbladder": one("organs", ["VH_M_gallbladder_"], "Gallbladder", "Vésicule biliaire"),
  "pancreas": one("organs", ["VH_M_pancreas"], "Pancreas", "Pancréas"),
  "spleen": one("organs", ["VH_M_spleen"], "Spleen", "Rate"),
  "kidney": pair("organs", "VH_M_right_kidney", "VH_M_left_kidney", ["Right kidney", "Left kidney", "Both kidneys"], ["Rein droit", "Rein gauche", "Les deux reins"]),
  "small-intestine": one("organs", ["VH_M_small_intestine"], "Small intestine", "Intestin grêle"),
  "large-intestine": one("organs", ["VH_M_colon"], "Large intestine", "Gros intestin"),
  "appendix": one("organs", ["VH_M_vermiform_appendix"], "Appendix", "Appendice"),
  "bladder": one("organs", ["VH_M_urinary_bladder"], "Bladder", "Vessie"),
  // Skeleton.
  "spine": one("skeleton", ["VH_M_vertebrae"], "Spine", "Colonne vertébrale"),
  "pelvis": one("skeleton", ["VH_M_pelvis"], "Pelvis", "Bassin"),
  "femur": pair("skeleton", "VH_M_femur_R", "VH_M_femur_L", ["Right thigh bone", "Left thigh bone", "Both thigh bones"], ["Fémur droit", "Fémur gauche", "Les deux fémurs"]),
  "patella": pair("skeleton", "VH_M_patella_R", "VH_M_patella_L", ["Right kneecap", "Left kneecap", "Both kneecaps"], ["Rotule droite", "Rotule gauche", "Les deux rotules"]),
  "tibia": pair("skeleton", "VH_M_tibia_R", "VH_M_tibia_L", ["Right shin bone", "Left shin bone", "Both shin bones"], ["Tibia droit", "Tibia gauche", "Les deux tibias"]),
};

/**
 * Each layer's context: everything of it that is not a region of its own, drawn as one mesh
 * (the skin; the knee's other bones and ligaments; the thymus, which is not a region but shows
 * how a child's differs).
 */
export const LAYER_NODES: Readonly<Record<Layer, readonly string[]>> = {
  skin: ["VH_M_skin"],
  skeleton: ["VH_M_skeletal_system"],
  organs: ["VH_M_thymus"],
};

/** The four bodies. The man and the woman are the atlas's own; the boy and the girl are built from them (components/body/references.json). */
export const BODIES = ["man", "woman", "boy", "girl"] as const;
export type Body = (typeof BODIES)[number];

/** A node's name in the female atlas: the male name with VH_F_ for VH_M_, except where the atlas names it differently. */
export function femaleNode(male: string): string {
  const differs: Record<string, string> = { VH_M_lungs_L: "VH_F_left_lungs_L" };
  return differs[male] ?? male.replace(/^VH_M_/, "VH_F_");
}

export const LAYERS: readonly Layer[] = ["skin", "skeleton", "organs"];

/** Is the region paired (it takes a side)? */
export const isPaired = (id: RegionId): boolean => !Array.isArray(REGIONS[id].nodes);

/**
 * The mesh a region's side is cut into in the asset: `liver`, `kidney__right`. (Not `kidney.right`:
 * three.js's loader rewrites `.` and `:` in node names, which are its animation-path separators.)
 */
export const meshName = (id: RegionId, side: "left" | "right" | null): string => (side ? `${id}__${side}` : id);

/** A region's name for a side, in a language. */
export function nameOf(id: RegionId, side: "left" | "right" | "both" | undefined, locale: "en" | "fr"): string {
  const names = REGIONS[id][locale];
  if (names.length === 1) return names[0];
  return side === "right" ? names[0] : side === "left" ? names[1] : names[2];
}
