---
id: body
status: draft
version: 0.2.0
implementation: this repository's web package, src/body/ (draw.ts with three.js; camera.ts, model.ts, regions.ts, geometry.ts, manifest.ts), and its meshes assets/body/{man,woman,boy,girl}.glb (tools/body/build.mjs, from components/body/references.json)
---

# Body

## Purpose

A 3D human body with its organs and skeleton, for showing where something is
in the body while explaining it: "where the liver is", "the kidneys", "the
right kneecap". It is the body's counterpart of our globe: regions light up,
the rest dims, and the camera frames the focus, either as one still picture
(the chat default) or as a body the reader can orbit and zoom, the camera
flying to the focus. It is not for diagnosis, injuries or anything graphic,
and not for data over the body (a heat map of the body is a later surface).

Phases 1 and 2 of zegadb/components#5: four bodies (a man, a woman, a boy
and a girl of 8), three layers (skin, skeleton, organs). The muscles layer,
surface regions on the skin and streamed levels of detail are later phases
(the issue's plan).

## Contract

[body.contract.json](body.contract.json) is the authority (format 2).

| field | type | required | meaning |
|---|---|---|---|
| `highlight[]` | `{ region, side?, role?, note? }`, 1–12 | yes | `region` from the fixed vocabulary; `side` for paired regions only; `role` focus (default), related or pain |

Options: `body` (`man` by default, `woman`, `boy`, `girl`), `focus` (the
highlighted region the camera frames), `mode` (`still` or `interactive`),
`frame` (`focus`, or `body` for the whole body with the regions lit),
`view` (`auto`, `front`, `back`, `left`, `right`), `labels`, `title`.

A region the chosen body does not have is an error back to the model, never
a blank picture: the validator checks each highlight against the body's
built meshes (src/body/manifest.ts, written by the builder). Today every
region exists in all four bodies.

**Vocabulary.** Organs: brain, heart, lung\*, liver, gallbladder, pancreas,
spleen, kidney\*, small-intestine, large-intestine, appendix, bladder.
Bones: spine, pelvis, femur\*, patella\*, tibia\*. (\* paired: `side` is the
person's own left or right, or both.) Each region names the source meshes it
lights in [src/body/regions.ts](../../src/body/regions.ts), the one place a
mesh id appears; its key type is the contract's enum, so the two cannot
drift. English and French names, with the French gender of each side.

## Anatomy

Back to front.

| # | part | what it is | drawn with |
|---|---|---|---|
| 1 | **ground** | the component's background | the renderer's clear colour |
| 2 | **lit regions** | the highlighted meshes, opaque, in their role's colour | three.js meshes |
| 3 | **dimmed layer** | the rest of each layer a highlight lives on: a veil over the lit regions | translucent meshes that hide their own far side |
| 4 | **faint skeleton** | the skeleton, barely there, when only organs are lit (for orientation) | translucent mesh |
| 5 | **skin** | the body's outline, a veil over everything | translucent mesh, front faces |
| 6 | **leaders** | a line and dot from each label to each side of its region | SVG over the canvas |
| 7 | **labels** | the region's name with its role's mark, the role in words and the note under it; pointing at a point of the region that faces the camera (not its box's middle). When they do not fit the height (a phone, many regions): names alone, then numbered markers with a key | HTML text over the canvas, in a column either side |
| 8 | **title** | `title`, when given | HTML text |
| 9 | **controls** | interactive only: zoom in, zoom out, whole body, top-right as on the globe | HTML buttons |
| 10 | **credit** | the sources' credit, once, in its own band under the picture (never over the body), plain text, no links | HTML text |

**The meshes.** There are four files. Each is loaded only when its body is drawn, and all are meshopt-compressed and quantised:

| body | size |
|---|---|
| man | 434 KB |
| woman | 439 KB |
| boy | 437 KB |
| girl | 440 KB |
| all four | 1.75 MB |

The tests hold each under 480 KB and all four under 1.8 MB. tools/body/build.mjs makes them all.

**The man and the woman** are cut from the Human Reference Atlas's 3D reference objects, the Visible Human male and female (HuBMAP CCF release v2.0, CC BY 4.0). The brain in every body is the Allen Human Reference Atlas – 3D, 2020 (© 2019 Allen Institute for Brain Science, CC BY 4.0). Those licences ask for credit, which the component shows once; neither is share-alike, so the code stays MIT. `assets/body/LICENSE` and each file's glTF `asset.copyright` carry the full credit.

**The boy and the girl (8 years)** are the man and the woman morphed organ by organ into a MakeHuman outline (CC0) at age 8, never a uniform scale. Every number comes from [references.json](references.json), with its citation, value and age.
- **Outline.** MakeHuman's own child, scaled to the CDC 2000 median stature.
- **Placement.** A map from the adult's outline to the child's places everything. It runs through the sole, knee, crotch, neck and crown, and the leg through ankle, shin and thigh sections. Each band has its own width and depth.
  - Bones follow the outline.
  - Organs follow the room inside the child's body wall across the trunk (1.5 cm a side, a modelling value), since an adult's organs sit inside a thicker wall.
- **Measured organs.**
  - The liver, spleen and kidneys take their measured paediatric sizes (Dhingra 2010, Obrycki 2022). The thymus takes its CT size (Francis 1985). The brain takes about 95 % of adult volume (Lenroot 2007), kept inside the head.
  - Each organ is then kept inside the trunk's room. The liver keeps its measured span and narrows only across.
- **Bladder.** Scaled with the pelvis, not to a full capacity: the atlas adults' bladders are near empty. Then raised out of the pelvis (our paraphrase of Moore).
- **Heart.** Follows the chest; no separate value.
- **Skeleton.**
  - Cartilage bands at the distal femoral and the proximal and distal tibial growth plates.
  - Cartilage only where ilium, ischium and pubis meet (the triradiate cartilage, the ischiopubic seam).
  - The kneecap is its smaller ossified part.
- **Inside the outline.** A piece still poking through the outline is nudged by the smallest move or shrink that brings it inside (reported by the builder). A point-in-mesh test holds every organ and bone of every body inside its skin.

The child's head is the outline's own and is checked, not set. Crown to neck, it is 1.20 to 1.29 times the adults' share. Medawar 1944 gives about 1.26; that series is reproduced widely, but we have not checked it against the paper, so it is marked unconfirmed.

Known limits:
- the atlas has no ribs, so a child's more horizontal ribs are not shown;
- the proximal femoral growth plate is not cut;
- the arms stay about 45° from the body (relaxing them needs a rig and skin weights). Whole-body frames fit the height, so the arms cost no height;
- the atlas's adult "thymus" is the fat-replaced thymic region (the woman's is 8.6 cm across), so the child's CT-sized gland is not visibly larger than it;
- **the neutral form (Sami, 17 Nov):** every outline is drawn without external genitalia, as in a medical illustration app. The builder folds anything hanging between the thighs into the crotch (`neutralise` in tools/body/build.mjs, using `hanging` in src/body/geometry.ts) and brings a pubic protrusion back to the line of the skin beside it. This moves 423 vertices on the man; the woman's, boy's and girl's outlines are already neutral (0 moved, recorded per body as `neutralForm` in the manifest). A test holds every built outline to nothing hanging (before: 252 points on the man).

The sources (about 500 MB) are downloaded by the builder and checked against
their SHA-256; they are never committed.

## Measurements

Inline in a column: the width is the column's, the height is width × 1.0
within 380–600 pt. The fixtures are 640 pt (a desktop chat column) and 358 pt
(a 390 pt phone's column).

| part | property | value | scales with |
|---|---|---|---|
| camera | field of view | 30° vertical, lifted 8° above the horizontal | fixed |
| framing | margin around the focus | 45 % of the view, 68 % under 480 pt (room for the labels) | the column |
| label | width | at most 30 % of the column, 31 % under 480 pt | the column |
| label | type | {type.size.label}, the name semibold; the note 11 pt | fixed |
| leader | width, dot | 1 pt; a 3.5 pt dot with a 1.5 pt ring | fixed |
| controls | button | 29 pt square, like the globe's | fixed |
| credit | type | 10.5 pt | fixed |
| flight | duration | MapLibre's flyTo timing (speed 1.2), 0.6 to 2 s | the distance |

## Colour and type

The focus is {theme.accent}, solid; pain is {theme.down}, solid; related is
{theme.soft} at 45 %, translucent so it never hides the focus. The role is
never colour alone: a filled disc, a ring or a square beside the name, the
role in words ("related", "pain"; French "en rapport", "douleur", which agree
with any region), and a dashed leader for related. A child's cartilage (open growth plates, the
pelvis's seams) is {theme.cartilage}, a pale blue-grey apart from every
bone and organ colour, solid whenever the skeleton is shown. Dimmed layers and the faint skeleton are
{theme.axis}, at 30 % (22 % on a dark ground); the skin is {theme.soft} at
10 %. Labels: {theme.ink} on {theme.panel} at 90 % with a {theme.rule}
border; notes and the credit {theme.soft}; leaders {theme.soft}. The face is
the host's UI face.

## States

| state | when | what shows |
|---|---|---|
| empty | never: a spec needs a highlight | — |
| loading | the body's mesh is loading (about 430 KB) | a faint standing figure in {theme.rule} and a small ring turning in {theme.accent} (still under reduced motion); if the mesh cannot load, a plain sentence in {theme.soft}, never a raw error |
| error | the spec fails validation | nothing; the errors go back to whoever wrote the spec |
| selected | — | None. |
| hover / press | interactive: dragging | the body orbits; labels follow their regions |

## Interaction

Interactive mode only; a still takes no input.

| action | touch | pointer | result |
|---|---|---|---|
| orbit | drag one finger | drag | the camera turns round the body, with inertia; tilt stops short of straight up or down |
| zoom | pinch | wheel, toward the pointer | closer or further, within limits |
| pan | drag two fingers | right-drag | the look-at point moves |
| zoom buttons | tap + or − | click | flies 40 % closer or further |
| whole body | tap ⤢ | click | flies back to the whole body |

Once the reader touches the camera it is theirs: no flight starts on its own
(zega#101's rule for the globe).

## Animation

An interactive body starts on the whole body and flies to the focus along
MapLibre's flyTo curve (van Wijk and Nuij, ρ = 1.42) with its default easing;
the direction turns round the body, never over the head. Reduced motion: the
camera jumps. A still never moves.

## Accessibility

Labels are text in the page, so a screen reader reads each region's name and
note; the controls are buttons with names. The role is never colour alone:
pain and related are said in words under the name when there is no note.
Text is {theme.ink} or {theme.soft} on {theme.panel} (above 4.5:1 in every
theme).

## Parameters (gear)

None yet: inline answers have no gear. The options are the model's to set.

| section | name | control | range / values | default |
|---|---|---|---|---|

## Platform notes

- **Web:** three.js (an optional peer dependency, like maplibre-gl):
  `drawBody(container, data, options, { theme, asset })` from
  `@zegadb/components/body/draw`; `render()` says `{ body: true, height }`.
  Labels are HTML text set with textContent, never markup.
  - **Contexts:** a still borrows a WebGL context only while it paints, then copies the frame into a 2D canvas and releases the context (`forceContextLoss`), so a chat full of stills never loses a picture. An interactive body keeps one context, renders only on the controls' changes and during a flight, handles `webglcontextlost`, and releases the context on `dispose()`.
  - **Mounting:** a `ResizeObserver` follows the column, re-framing until the reader touches the camera. A body mounted while hidden waits for a size. An `AbortSignal` cancels a mount; nothing is left behind.
  - **Theme:** `theme` may be a function; the body re-reads it when the system's or the page's light and dark switch.
  - **Failure:** a load that fails shows a plain sentence (its accessible name too) and no canvas.
  - **Accessible name:** the picture has one, saying what is lit.
- **Desktop (Tauri):** the same web build (Ava's app).
- **iOS:** paused (Sami, 15 Nov).

## Conformance

Draft: no references yet. The fixtures render with `npm run screens -- --only
body` for review; references come when Sami approves the look. Until then
`tools/render/web.mjs --verify` (CI's web-conformance job) still draws every
fixture in both modes and fails when one throws, lights nothing or puts a
label off the picture. It also runs the body's runtime checks:
- twenty stills keep no WebGL context;
- a hidden mount, a resize, an idle interactive body, a cancelled mount and
  a failed load each behave.

| fixture | what it proves | tolerance |
|---|---|---|
| [web/default.json](web/default.json) | a still on the liver from the front, a related organ with a note (Ava) | default |
| [web/kidneys-interactive.json](web/kidneys-interactive.json) | interactive, after the flight: both kidneys from the back, one label with a leader to each, the controls | default |
| [web/heart-phone.json](web/heart-phone.json) | a still on the heart with both lungs related, a phone column | default |
| [web/knee-pain-zega-fr.json](web/knee-pain-zega-fr.json) | the skeleton layer, pain and related, French, zega, a phone column | default |
| [web/whole-man-phone.json](web/whole-man-phone.json), [woman](web/whole-woman-phone.json), [boy](web/whole-boy-phone.json), [girl](web/whole-girl-phone.json) | each whole body with the liver lit (`frame: body`): the four bodies' proportions side by side | default |
| [web/girl-liver.json](web/girl-liver.json), [phone](web/girl-liver-phone.json) | a child's liver (relatively larger), the bladder risen, the child's credit | default |
| [web/girl-bones-front.json](web/girl-bones-front.json), [side](web/girl-bones-side.json) | the girl's skeleton inside her outline, front and side; cartilage at the seams and plates | default |
| [web/twelve-phone.json](web/twelve-phone.json) | twelve highlights on a phone: the labels fall back instead of overflowing | default |
| [web/boy-knee.json](web/boy-knee.json), [phone](web/boy-knee-phone.json) | a child's knee: open growth plates in the femur and tibia, the smaller ossified kneecap | default |

## Tokens

{type.size.label} 12 · {theme.accent}, {theme.down}, {theme.ground},
{theme.axis}, {theme.soft}, {theme.ink}, {theme.panel}, {theme.rule}: per
host and mode in tokens/themes.json.
