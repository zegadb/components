---
id: body
status: draft
version: 0.1.0
implementation: this repository's web package, src/body/ (draw.ts with three.js; camera.ts, model.ts, regions.ts), and its mesh assets/body/adult.glb (tools/body/build.mjs)
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

Phase 1 of zegadb/components#5: one adult body, three layers (skin,
skeleton, organs). The woman, boy and girl, the muscles layer, surface
regions on the skin and streamed levels of detail are later phases (the
issue's plan).

## Contract

[body.contract.json](body.contract.json) is the authority (format 2).

| field | type | required | meaning |
|---|---|---|---|
| `highlight[]` | `{ region, side?, role?, note? }`, 1–12 | yes | `region` from the fixed vocabulary; `side` for paired regions only; `role` focus (default), related or pain |

Options: `body` (`adult` only for now), `focus` (the highlighted region the
camera frames), `mode` (`still` or `interactive`), `view` (`auto`, `front`,
`back`, `left`, `right`), `labels`, `title`.

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
| 7 | **labels** | the region's name with a swatch, the note (or the role in words) under it | HTML text over the canvas, in a column either side |
| 8 | **title** | `title`, when given | HTML text |
| 9 | **controls** | interactive only: zoom in, zoom out, whole body, top-right as on the globe | HTML buttons |
| 10 | **credit** | the source's credit, once, bottom-right, plain text, no links | HTML text |

**The mesh.** assets/body/adult.glb (545 KB, meshopt-compressed and
quantised) is cut by tools/body/build.mjs from the Human Reference Atlas's 3D
reference objects, the Visible Human male (HuBMAP CCF release v2.0,
`3d-vh-m-united.glb`), licensed CC BY 4.0. That licence asks for credit,
which the component shows once; it is not share-alike, so the drawing code
stays MIT. The source (154 MB) is downloaded by the builder and checked
against its SHA-256; it is never committed.

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

The focus is {theme.accent}; pain is {theme.down}; related is the accent
halfway to {theme.ground}. Dimmed layers and the faint skeleton are
{theme.axis}, at 30 % (22 % on a dark ground); the skin is {theme.soft} at
10 %. Labels: {theme.ink} on {theme.panel} at 90 % with a {theme.rule}
border; notes and the credit {theme.soft}; leaders {theme.soft}. The face is
the host's UI face.

## States

| state | when | what shows |
|---|---|---|
| empty | never: a spec needs a highlight | — |
| loading | the mesh is loading (545 KB) | the ground; the host may show a still poster (phase 2) |
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
- **Desktop (Tauri):** the same web build (Ava's app).
- **iOS:** paused (Sami, 15 Nov).

## Conformance

Draft: no references yet. The fixtures render with `npm run screens -- --only
body` for review; references come when Sami approves the look.

| fixture | what it proves | tolerance |
|---|---|---|
| [web/default.json](web/default.json) | a still on the liver from the front, a related organ with a note (Ava) | default |
| [web/kidneys-interactive.json](web/kidneys-interactive.json) | interactive, after the flight: both kidneys from the back, one label with a leader to each, the controls | default |
| [web/heart-phone.json](web/heart-phone.json) | a still on the heart with both lungs related, a phone column | default |
| [web/knee-pain-zega-fr.json](web/knee-pain-zega-fr.json) | the skeleton layer, pain and related, French, zega, a phone column | default |

## Tokens

{type.size.label} 12 · {theme.accent}, {theme.down}, {theme.ground},
{theme.axis}, {theme.soft}, {theme.ink}, {theme.panel}, {theme.rule}: per
host and mode in tokens/themes.json.
