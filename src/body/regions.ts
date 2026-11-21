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
import type { CONTRACT } from "../generated/contracts/body.ts";

export type RegionId = (typeof CONTRACT)["$defs"]["region"]["enum"][number];
export type Layer = "skin" | "skeleton" | "organs" | "muscles" | "nerves";
/** The layers drawn from Z-Anatomy (CC BY-SA 4.0): they ship in their own package, @zegadb/components-body-za, and load only when asked for. */
export const ZA_LAYERS = ["muscles", "nerves"] as const;
export type ZaLayer = (typeof ZA_LAYERS)[number];
export const isZaLayer = (layer: Layer): layer is ZaLayer => (ZA_LAYERS as readonly string[]).includes(layer);
/** A region's name: one for an unpaired region; the person's right, left and both for a paired one. */
export type Names = readonly [name: string] | readonly [right: string, left: string, both: string];

export interface RegionDef {
  readonly layer: Layer;
  /** HRA source nodes (their whole subtrees): one list for an unpaired region; the person's right and left for a paired one. */
  readonly nodes?: readonly string[] | { readonly right: readonly string[]; readonly left: readonly string[] };
  /**
   * Z-Anatomy names (muscles and nerves): a structure belongs to the region when its own name or one of
   * its groups' is listed, without the side; a paired region takes the structures ending .r or .l.
   */
  readonly za?: readonly string[];
  readonly paired?: boolean;
  /** A muscle of the head: drawn only when a head muscle is lit (else the head is the skin's outline, never a flayed face). */
  readonly head?: boolean;
  readonly en: Names;
  readonly fr: Names;
}

const one = (layer: Layer, nodes: string[], en: string, fr: string): RegionDef => ({ layer, nodes, en: [en], fr: [fr] });
const pair = (layer: Layer, right: string, left: string, en: Names, fr: Names): RegionDef => ({ layer, nodes: { right: [right], left: [left] }, en, fr });
const za = (layer: ZaLayer, names: string[], en: Names, fr: Names): RegionDef => ({ layer, za: names, paired: en.length === 3, en, fr });

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
  // Muscles (Z-Anatomy).
  "deltoid": za("muscles", ["Deltoid muscle.g"], ["Right deltoid", "Left deltoid", "Both deltoids"], ["Deltoïde droit", "Deltoïde gauche", "Les deux deltoïdes"]),
  "biceps": za("muscles", ["Biceps brachii muscle.g"], ["Right biceps", "Left biceps", "Both biceps"], ["Biceps brachial droit", "Biceps brachial gauche", "Les deux biceps brachiaux"]),
  "triceps": za("muscles", ["Triceps brachii muscle.g"], ["Right triceps", "Left triceps", "Both triceps"], ["Triceps brachial droit", "Triceps brachial gauche", "Les deux triceps brachiaux"]),
  "pectoralis": za("muscles", ["Pectoralis major muscle.g"], ["Right pectoralis major", "Left pectoralis major", "Both pectorals"], ["Grand pectoral droit", "Grand pectoral gauche", "Les deux grands pectoraux"]),
  "rectus-abdominis": za("muscles", ["Rectus abdominis muscle"], ["Rectus abdominis, right side", "Rectus abdominis, left side", "Rectus abdominis (the abs)"], ["Grand droit de l’abdomen, côté droit", "Grand droit de l’abdomen, côté gauche", "Grand droit de l’abdomen"]),
  "obliques": za("muscles", ["External abdominal oblique muscle", "Internal abdominal oblique muscle"], ["Right obliques", "Left obliques", "Both obliques"], ["Obliques de l’abdomen, côté droit", "Obliques de l’abdomen, côté gauche", "Obliques de l’abdomen"]),
  "latissimus": za("muscles", ["Latissimus dorsi muscle"], ["Right latissimus dorsi", "Left latissimus dorsi", "Both latissimus dorsi"], ["Grand dorsal droit", "Grand dorsal gauche", "Les deux grands dorsaux"]),
  "trapezius": za("muscles", ["Trapezius muscle.g"], ["Right trapezius", "Left trapezius", "Trapezius"], ["Trapèze droit", "Trapèze gauche", "Trapèze"]),
  "gluteus-maximus": za("muscles", ["Gluteus maximus muscle"], ["Right gluteus maximus", "Left gluteus maximus", "Both gluteus maximus"], ["Grand fessier droit", "Grand fessier gauche", "Les deux grands fessiers"]),
  "quadriceps": za("muscles", ["Rectus femoris muscle", "Vastus lateralis muscle", "Vastus medialis muscle", "Vastus intermedius muscle"], ["Right quadriceps", "Left quadriceps", "Both quadriceps"], ["Quadriceps droit", "Quadriceps gauche", "Les deux quadriceps"]),
  "hamstrings": za("muscles", ["Long head of biceps femoris", "Short head of biceps femoris", "Semitendinosus muscle", "Semimembranosus muscle"], ["Right hamstrings", "Left hamstrings", "Both hamstrings"], ["Ischio-jambiers, côté droit", "Ischio-jambiers, côté gauche", "Ischio-jambiers des deux côtés"]),
  "gastrocnemius": za("muscles", ["Lateral head of gastrocnemius", "Medial head of gastrocnemius"], ["Right calf muscle (gastrocnemius)", "Left calf muscle (gastrocnemius)", "Both calf muscles (gastrocnemius)"], ["Gastrocnémien droit", "Gastrocnémien gauche", "Les deux gastrocnémiens"]),
  "rotator-cuff": za("muscles", ["Rotator cuff muscles.g"], ["Right rotator cuff", "Left rotator cuff", "Both rotator cuffs"], ["Coiffe des rotateurs droite", "Coiffe des rotateurs gauche", "Les deux coiffes des rotateurs"]),
  "masseter": { ...za("muscles", ["Superficial part of masseter", "Deep part of masseter"], ["Right masseter (jaw muscle)", "Left masseter (jaw muscle)", "Both masseters (jaw muscles)"], ["Masséter droit", "Masséter gauche", "Les deux masséters"]), head: true },
  // Nerves (Z-Anatomy; the brain stays the Allen atlas's). Listed before the plexus, so a plexus's named branches are their own regions.
  "spinal-cord": za("nerves", ["Spinal cord.g"], ["Spinal cord"], ["Moelle épinière"]),
  "vagus": za("nerves", ["Vagus nerve (X)"], ["Right vagus nerve", "Left vagus nerve", "Both vagus nerves"], ["Nerf vague droit", "Nerf vague gauche", "Les deux nerfs vagues"]),
  "cranial-nerves": za("nerves", ["Cranial nerves.g"], ["Cranial nerves"], ["Nerfs crâniens"]),
  "median-nerve": za("nerves", ["Median nerve"], ["Right median nerve", "Left median nerve", "Both median nerves"], ["Nerf médian droit", "Nerf médian gauche", "Les deux nerfs médians"]),
  "ulnar-nerve": za("nerves", ["Ulnar nerve"], ["Right ulnar nerve", "Left ulnar nerve", "Both ulnar nerves"], ["Nerf ulnaire droit", "Nerf ulnaire gauche", "Les deux nerfs ulnaires"]),
  "radial-nerve": za("nerves", ["Radial nerve"], ["Right radial nerve", "Left radial nerve", "Both radial nerves"], ["Nerf radial droit", "Nerf radial gauche", "Les deux nerfs radiaux"]),
  "brachial-plexus": za("nerves", ["Brachial plexus.g"], ["Right brachial plexus", "Left brachial plexus", "Both brachial plexuses"], ["Plexus brachial droit", "Plexus brachial gauche", "Les deux plexus brachiaux"]),
  "femoral-nerve": za("nerves", ["Femoral nerve"], ["Right femoral nerve", "Left femoral nerve", "Both femoral nerves"], ["Nerf fémoral droit", "Nerf fémoral gauche", "Les deux nerfs fémoraux"]),
  "sciatic-nerve": za("nerves", ["Sciatic nerve"], ["Right sciatic nerve", "Left sciatic nerve", "Both sciatic nerves"], ["Nerf sciatique droit", "Nerf sciatique gauche", "Les deux nerfs sciatiques"]),
};

/**
 * Each layer's context: everything of it that is not a region of its own, drawn as one mesh
 * (the skin; the knee's other bones and ligaments; the thymus, which is not a region but shows
 * how a child's differs).
 */
/** The muscles of the head that are no region: their own mesh, drawn with the head's regions (REGIONS[id].head). */
export const HEAD_MUSCLES = "muscles-head";
/** Is a mesh (a region's side, or a layer's rest) part of the head's muscles? */
export const isHeadMuscle = (name: string): boolean => name === HEAD_MUSCLES || (REGIONS[name.split("__")[0] as RegionId]?.head ?? false);

export const LAYER_NODES: Readonly<Record<Layer, readonly string[]>> = {
  skin: ["VH_M_skin"],
  skeleton: ["VH_M_skeletal_system"],
  organs: ["VH_M_thymus"],
  // The Z-Anatomy layers' context is everything of theirs that is no region (tools/body/za.mjs chooses it).
  muscles: [],
  nerves: [],
};

/** The four bodies. The man and the woman are the atlas's own; the boy and the girl are built from them (components/body/references.json). */
export const BODIES = ["man", "woman", "boy", "girl"] as const;
export type Body = (typeof BODIES)[number];

/** A node's name in the female atlas: the male name with VH_F_ for VH_M_, except where the atlas names it differently. */
export function femaleNode(male: string): string {
  const differs: Record<string, string> = { VH_M_lungs_L: "VH_F_left_lungs_L" };
  return differs[male] ?? male.replace(/^VH_M_/, "VH_F_");
}

/** The layers in the body's own mesh (assets/body/<body>.glb); the Z-Anatomy layers are in their own files. */
export const LAYERS: readonly Layer[] = ["skin", "skeleton", "organs"];
export const ALL_LAYERS: readonly Layer[] = ["skin", "skeleton", "organs", "muscles", "nerves"];

/** Is the region paired (it takes a side)? */
export const isPaired = (id: RegionId): boolean => REGIONS[id].paired ?? !Array.isArray(REGIONS[id].nodes);

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
