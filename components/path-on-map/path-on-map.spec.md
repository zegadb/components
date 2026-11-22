---
id: path-on-map
status: review
version: 2.1.0
implementation: this repository's web package, src/path-on-map/ (moved from avacanada/ava-web lib/path-on-map.ts); zega's explorer (zegadb/zega browser/components/path-on-map/ at 11cff10) renders the format-1 fixtures through the `zql` adapter
---

# Path on map

![Speed around the Monaco lap, light theme](path-on-map.reference.png)
![The same fixture, dark theme](path-on-map.reference.dark.png)

## Purpose

Draws ordered paths (a race lap, a delivery route, a run) on the street map,
tilted with 3D buildings unless the view says otherwise (the reader switches
2D | 3D in the map's controls), each segment coloured by an optional value
at its start point, with a labelled start marker. Pick it when the answer is *where
something went, in order*, and optionally *how a number changed along the
way* (speed, distance, sector). It is not for unordered points (a place map)
or for routes between distant places, where the earth's curvature matters
(use globe-arcs).

## Contract

[path-on-map.contract.json](path-on-map.contract.json) is the authority.
Since 2.0.0 (format 2) the data is plain and inline: `paths[]`, each
`{ label?, points: [[lon, lat], …], values? }` (at least 2 points, one value
per point or none), and `valueName` for the legend; `bounds` moved from the
surface parameters into the options. Ava's maps and chat draw it with the web
package ([web/default.json](web/default.json) on a host without a basemap).

ZQL is one source among several: the contract's `zql` section keeps the
format-1 binding below for zega's explorer, whose fixtures and references
(below) are unchanged. Rows are the points of a path in path order (select
them with `order by`); ungrouped, all rows are one path; grouped, each group
is one path. At least 2 rows per path.

| role | per | type | required | meaning |
|---|---|---|---|---|
| `path` | row | Point | yes | the point's position; the first row is the start |
| `value` | row | Float | no | a number per point; a segment takes its start point's colour |
| `label` | group | String | no | the path's name, drawn at its start |

Surface parameters: `bounds` (`[w, s, e, n]` or null: frame the paths),
`basemap` (`auto`, `cities`, `monaco`). Display options: `colorScale`,
`valueUnit`, `lineWidth` (1–16 pt, default 6), `view` (`3d`, `2d`, `auto`;
default `3d`), `mapType` (`map`, `satellite`; default `map`; since 2.1.0),
`bearing` (−180–180°), `showBuildings`.

`mapType` is what is under the paths, the roads and the names: `map`, the
street map, or `satellite`, imagery where the host's basemap has some (Ava's:
the ESA WorldCover 2021 Sentinel-2 composite, 10 m, Canada to tile zoom 13
and the world to 10, from tiles.addis.gg). On a map the reader can move whose
basemap has imagery, the **Map | Satellite switch** beside the 2D | 3D one
changes it. Over the imagery the roads are drawn white over a dark casing and
the names white on a dark halo; the street map's water, buildings and other
fills above the land are cleared, and where there is no imagery (open sea) the
ground is a deep sea (the imagery's own, `OVER_IMAGERY.ground` in
src/basemap.ts, not a theme colour: the photograph is the same in both themes),
not the street map's light ground. 10 m shows fields, forests, lakes and the
shape of a town, not streets: past its deepest tiles (z13 in Canada) the
imagery is overzoomed, softer the closer you go, with the roads and names
over it at every zoom, as other maps' satellite views do. (A cut or a fade
back to the street map was tried on 22 Nov and dropped: "Satellite" stayed
pressed over a street map, which read as broken.) On a basemap without imagery `satellite` draws the
street map, and there is no switch.

`view` is how the map opens. `3d` (the default; Sami, 21 Nov) tilts the
camera so the buildings stand up; `2d` looks straight down with the buildings
laid flat. On a map the reader can move, the **2D | 3D switch** in the map's
controls changes it (Interaction): every map opens in 3D and the reader
flattens it when the street names matter more than the buildings.

`view: auto` is still accepted (it was the default from components#11, 21 Nov,
until the switch replaced it the same day): it looks straight down when what
is framed (every point of every path, or `bounds`) spans `FLAT_MAX_KM`
(5 km) or less from its south-west to its north-east corner, a great-circle
distance, and tilts (`3d`) when it spans more. An explicit `2d` or `3d` always
wins. One function decides (`resolveView` in src/path-on-map/model.ts), and
the validated view carries its answer (its `options.view` is `2d` or `3d`,
never `auto`), so the camera, the buildings and the switch read that one
value. The format-1 binding (zega's explorer) has no `auto`; its default is
`3d` too.

## Anatomy

Back to front.

| # | part | what it is | drawn with |
|---|---|---|---|
| 1 | **basemap** | the street map: land, water, parks, roads | the surface's vector tiles and style (APS 9 basemap flavour of the theme) |
| 1a | **imagery** | with `mapType: satellite`: the satellite imagery over the land, under the roads and names | the surface's raster tiles, overzoomed past their deepest zoom |
| 2 | **buildings** | building footprints extruded to their mapped heights | the surface; standing in `3d` when `showBuildings`, laid flat (hidden) in `2d` |
| 3 | **casing** | a halo under the whole path so it reads over any map | one line per segment |
| 4 | **path** | the coloured line, one segment per consecutive pair of rows | one line per segment, round caps and joins |
| 5 | **basemap labels** | the street map's text and POI icons: street, place and building names | the surface's style (its symbol layers) |
| 6 | **start marker** | a ring at each path's first point | circle |
| 7 | **path label** | the group's `label`, right of the start marker | map text |
| 8 | **legend** | the value's name and unit, the colour ramp, its low and high ends | canvas overlay, bottom-left |
| 9 | **gear** | button and panel with the contract's parameters | canvas chrome, top-left |
| 10 | **map controls** | zoom in, zoom out, compass (the host's); the Map \| Satellite switch (when the basemap has imagery) and the 2D \| 3D switch (the component's, on a map the reader can move; none on a still) | map SDK, top-right (masked); the switches DOM over the map's top-right corner, side by side, Map \| Satellite first |
| 11 | **attribution** | the basemap's required credit; while the imagery shows, the imagery's credit ("© ESA WorldCover project 2021 / contains modified Copernicus Sentinel data") | map SDK, bottom-right (masked); the imagery's credit DOM over the map's bottom-right corner, drawn with the switch (a host that places the switch says it) |

The path and its casing go under the basemap's labels, so the names of the
streets the path follows and crosses stay readable (each label keeps its own
halo); the start marker and the path label go over them. A platform inserts
the buildings, casing and path before the style's first label layer (in
MapLibre, the first `symbol` layer) and adds the start marker and path label
on top. With no basemap (the plain ground) there are no labels to go under,
and the parts stack in the order above.

## Measurements

Reference size: 640 × 400 pt at scale 2 (1280 × 800 pixels).

| part | property | value | scales with |
|---|---|---|---|
| casing | width | `lineWidth` + {stroke.casing} | option |
| path | width | `lineWidth` (default 6 pt) | option |
| path | caps, joins | round, round | — |
| start marker | radius | the larger of {size.markerMin} and `lineWidth` | option |
| start marker | outline | {stroke.marker} | — |
| path label | size | {type.size.mapLabel}, {type.family.map} | — |
| path label | position | anchored at its left edge, 1.1 em (15.4 pt) right of the start point, vertically centred on it | — |
| path label | halo | {stroke.labelHalo} | — |
| legend | inset | {space.xxl} from the left and bottom edges | fixed |
| legend | box | at least {size.legendMin} wide; padding {space.lg} top and bottom, {space.xl} left and right; corner {radius.md}; border {stroke.hairline} | fixed |
| legend | title to bar | 5 pt | fixed |
| legend | bar | {size.legendBar} high, full box width, corner {radius.sm} | fixed |
| legend | bar to ends | {space.xs} | fixed |
| gear | inset | {space.xl} from the top and left edges | fixed |
| gear | button | {size.gearButton} square, corner {radius.md}, border {stroke.hairline}, glyph ⚙ at {type.size.gearGlyph} | fixed |
| gear | panel | {space.md} below the button, {size.gearPanel} wide, padding {space.lg} × {space.xl}, corner {radius.md}, border {stroke.hairline} | fixed |
| gear | row | three columns: name {size.gearLabel}, control (the rest), value {size.gearValue}; gap {space.md}; {space.sm} above and below | fixed |
| gear | section title | {space.md} above, {space.xxs} below | fixed |
| camera | pitch | `view: 3d` 60°, `view: 2d` 0°; `view: auto` is `2d` when what is framed spans 5 km or less corner to corner, else `3d`; the switch changes it after (centre, zoom and bearing kept) | option |
| buildings | opacity | `3d`: {opacity.buildings} when `showBuildings`, else 0; `2d`: 0 | option |
| camera | framing | every point of every path (or `bounds`) fitted in the view as rotated by `bearing`, with padding the smallest of {space.frame}, a sixth of the width and a sixth of the height; `3d` then zooms out by 0.3 levels; never past zoom 17 | canvas |
| map controls | placement | top-right, {space.xl} inset | fixed |
| 2D \| 3D switch | box | {space.xl} from the top and right edges; two buttons side by side, each 29 pt high and at least 34 pt wide, {space.lg} either side of its word; corner {radius.md}, border {stroke.hairline}, a {stroke.hairline} rule between the two | fixed |
| Map \| Satellite switch | box | the 2D \| 3D switch's box and buttons, {space.md} to its left | fixed |
| imagery credit | box | {space.xs} from the bottom and right edges; padding {space.xxs} × {space.md}; corner {radius.sm}; at most the map's width less {space.xl}; on a map narrower than 560 pt, compact: an "ⓘ" button 20 pt round in a box with a 12 pt corner, opening the full line beside it | fixed |

Scaling rules: the legend, gear and map controls keep their size in points at
every canvas size and stay in their corners. The path, marker and label keep
their size in points; the camera, not the marks, changes with the canvas: a
larger canvas frames the same paths at a higher zoom. The basemap fills the
canvas.

## Colour and type

| part | light and dark (each theme's value of the token) |
|---|---|
| canvas ground | {color.ground} |
| buildings | {color.rule} at {opacity.buildings}; a building with no height is 9 m |
| casing | {color.panel} at {opacity.casing} |
| path, `colorScale: sequential` | {ramp.sequential}, the value's minimum at the first stop and maximum at the last, linear in RGB between stops |
| path, `colorScale: diverging` | {ramp.diverging}; the middle stop is 0 when the values span 0, else their midpoint; each half is linear from its end to the middle |
| path, `colorScale: solid` or no `value` | {color.accent} |
| path, a point with no value | {color.accent} |
| start marker | fill {color.panel}, outline {color.ink} |
| path label | {color.ink}, halo {color.ground}, {type.family.map} |
| legend | background {color.panel} at {opacity.legend}; border {color.rule}; title {color.ink} {type.size.label} {type.weight.semibold}; ends {color.soft} {type.size.label} with tabular numerals; line height {type.lineHeight.tight}; family {type.family.ui} |
| imagery credit | {color.panel} at {opacity.legend}; {color.soft} {type.size.caption} {type.family.ui}; links {color.soft}, underlined |
| roads and names over imagery | the same in both themes (it is a photograph): highways and major roads white at 78%, other roads white at 45%, casings black at 28%, rail white at 35%, borders white at 60%; names white on a halo of near-black at 78%; at every zoom |
| 2D \| 3D switch and Map \| Satellite switch | {color.panel} fill, {color.rule} border and rule; words {color.soft} {type.size.label} {type.weight.semibold} {type.family.ui}; the view shown: {color.accent} fill, {color.panel} word; hover: {color.rule} fill, {color.ink} word; focus ring {color.accent} (on the view shown, {color.ink}) |
| gear | button: {color.panel} fill, {color.rule} border, {color.ink} glyph. Panel: {color.panel} at {opacity.gearPanel}, {color.rule} border, text {color.ink} {type.size.label}. Section titles: {color.soft}, {type.size.caption}, upper case, tracking {type.tracking.caption}. Values: {color.soft} {type.weight.medium}, right-aligned, tabular. Inputs: {color.ground} fill, {color.rule} border, {radius.sm}; slider and checkbox tint {color.accent}. Error: {color.accent} {type.family.mono} {type.size.gearError}, line height {type.lineHeight.code} |

Legend text: the title is the last segment of the `value` binding's field path
(`speed` for `speed`, `speed` for `lap.speed`), followed by ` (unit)` when
`valueUnit` is set. The ends are the data's minimum and maximum: whole
numbers when the range is 10 or more, else 3 significant digits.

## States

| state | when | what shows |
|---|---|---|
| empty | the canvas has no entry yet | {color.ground} only: no basemap, legend, gear or controls |
| loading | a load or restore is drawing | the previous entry stays on screen until the new one's first complete frame; no spinner. A swap has {motion.duration.swapBudget} as its target |
| error: spec or data | the view spec does not bind (a path with fewer than 2 rows, a misspelt field, an option out of range) | nothing changes on the canvas; the teaching error (code, at, message, help, fix) goes to the caller, and to the gear's error line when the change came from the gear |
| error: draw | the basemap or a source fails to load | the previous entry is drawn again; the error goes to the caller |
| error: no GPU | the platform cannot draw the map | the canvas shows "This device cannot draw the map." in {color.ink} {type.size.label} at the bottom-left inset |
| selected | — | None: path-on-map has no selection |
| hover / press | pointer over the gear button or a map control | the platform's standard pressed feedback on those controls only; marks do not react |

## Interaction

| action | touch | pointer | result |
|---|---|---|---|
| pan | one-finger drag | drag | moves the camera |
| zoom | pinch | scroll wheel or trackpad pinch; double-click zooms in | changes zoom about the gesture's centre |
| rotate | two-finger twist | right-drag or ctrl-drag sideways | changes bearing |
| tilt | two-finger vertical drag | right-drag or ctrl-drag vertically | changes pitch, up to 70° |
| zoom buttons, compass | tap | click | zoom by one level; compass resets bearing and pitch to north-up |
| 2D \| 3D switch | tap the other half | click it, or Enter/Space when focused | `2d`: pitch 0, buildings laid flat; `3d`: pitch 60°, buildings standing. Centre, zoom and bearing stay; nothing is fetched again; no history entry (like moving the camera). A redraw that keeps the camera (a theme change, the plain fallback) keeps the view switched to |
| imagery credit, compact | tap ⓘ | click it, or Enter/Space when focused | opens the full credit line beside the button; again closes it |
| Map \| Satellite switch | tap the other half | click it, or Enter/Space when focused | `satellite`: the imagery under the roads and names, its credit shown; `map`: the street map, the credit gone. At once, no easing; the camera stays; the street map's tiles are not fetched again (only the imagery's, the first time). No history entry. A redraw that keeps the camera keeps the map type switched to |
| open or close the gear | tap the gear | click the gear, or Enter/Space when focused | shows or hides the panel |
| change a parameter | the control | the control | creates a new history entry with that value; the canvas redraws; invalid input shows the gear error and changes nothing |

Moving the camera by hand is not a parameter change: it creates no entry, and
a restore puts the entry's own camera back.

## Animation

Loads, restores, theme changes and parameter changes jump straight to
the new frame ({motion.duration.instant}): the camera does not fly and paths
do not draw on. Map gestures follow the platform map's own inertia. The one
animation is the 2D | 3D switch: the pitch eases over
{motion.duration.viewSwitch} ({motion.easing.standard} or the map's own
ease), the buildings fading with it. With reduced motion it jumps.

## Accessibility

- The canvas is one labelled region, "Graph component canvas", whose
  description is the drawn view: "<label, or 'Path'> on the map, <n> points,
  coloured by <value field> from <low> to <high> <unit>" (no colour clause
  when solid).
- The gear button's accessible name is "view settings", with its expanded
  state; each control is named `<section>.<name>` (`options.lineWidth`) and
  carries the contract's description as its hint. The gear error line is a
  live status region.
- The 2D | 3D switch is a group named "Map view" ("Vue de la carte" in
  French) of two native buttons, "2D" and "3D" in both languages, each with
  a hint ("2D: flat, from above", "3D: tilted, buildings standing"; in
  French "2D : à plat, vue du dessus", "3D : inclinée, bâtiments en
  relief"); the view shown is `aria-pressed="true"`, the other `false`.
  Both are in the tab order; Enter or Space presses one.
- The Map | Satellite switch is a group named "Map type" ("Type de carte")
  of two native buttons, "Map" and "Satellite" ("Carte", "Satellite"), with
  hints ("Map: streets and places", "Satellite: imagery, with the streets
  and names over it"; "Carte : rues et lieux", "Satellite : imagerie, avec
  les rues et les noms par-dessus"); the type shown is `aria-pressed="true"`.
- The compact imagery credit (a map narrower than 560 pt) is a native
  button "ⓘ" named "Imagery credit" ("Crédit de l’imagerie"), with
  `aria-expanded` and `aria-controls` naming the credit's line; Enter or
  Space opens and closes it. On a wider map the line is always shown.
- Focus order: gear button, gear controls (when open), map controls (Map,
  Satellite, then 2D, 3D), then the compact credit's button.
- Contrast: text on the legend and gear passes 4.5:1 in both themes
  ({color.ink} on {color.panel} 14:1; {color.soft} on {color.panel} 4.7:1
  light, 7.2:1 dark). The solid path, {color.accent} on {color.ground}, is
  4.49:1 light and 7.7:1 dark, above the 3:1 that graphics need. The low
  end of {ramp.sequential} and the middle
  of {ramp.diverging} fall under 3:1 against the ground (1.4:1 and 1.6:1,
  light); the casing separates the line from the map but not its colour from
  the ground. Colour is never the only carrier: the legend's numbers state the
  range.
- Reduced motion: nothing animates, the switch included (see Animation).

## Parameters (gear)

Exactly the contract's settings, surface first, in contract order. The
control follows from each setting's schema: an `enum` is a menu, a boolean a
checkbox, a number with both bounds a slider with its value shown, anything
else a JSON text field checked on commit.

| section | name | control | range / values | default |
|---|---|---|---|---|
| surface | `bounds` | JSON text field | `[w, s, e, n]` with w < e, s < n, or null | null |
| surface | `basemap` | menu | auto, cities, monaco | auto |
| options | `colorScale` | menu | sequential, diverging, solid | sequential |
| options | `valueUnit` | menu | ft, m, deg, pct, fraction, km/h, yd, s, null | null |
| options | `lineWidth` | slider, step 0.1 | 1–16 | 6 |
| options | `view` | menu | 3d, 2d, auto | 3d |
| options | `mapType` | menu | map, satellite | map |
| options | `bearing` | slider, step 1 | −180–180 | 0 |
| options | `showBuildings` | checkbox | — | true |

## Platform notes

- **Web:** MapLibre GL JS with the surface's PMTiles archives; paths are line
  layers fed by GeoJSON, legend and gear are DOM over the map. Colours come
  from generated/tokens.js (paint properties) and generated/tokens.css
  (chrome).
- **Desktop (Tauri):** the web build in the Tauri webview, unchanged. Same
  fixtures, same references.
- **iOS:** a native map view on the same style JSON and the same tile
  archives (see the README's open question on MapLibre Native vs Mapbox);
  paths as line layers with the same paint expressions; legend and gear in
  SwiftUI over the map, from generated/Tokens.swift. The gear panel is the
  same overlay, not a sheet.

## Conformance

| fixture | what it proves | tolerance |
|---|---|---|
| [default](fixtures/default.json) | sequential ramp, 3D camera with bearing, buildings, start marker and label, legend with unit | default |
| [dist-2d-diverging](fixtures/dist-2d-diverging.json) | diverging ramp around the midpoint, straight-down camera, wider line, legend without a label binding | default |
| [solid-no-buildings](fixtures/solid-no-buildings.json) | accent line, buildings off, no legend | default |

Each fixture renders in both themes against its two reference images.

The web package's fixtures (format 2, rendered by tools/render/web.mjs on a
host without a basemap: the plain ground, labels as HTML in the host's face):

| fixture | what it proves | tolerance |
|---|---|---|
| [web/default](web/default.json) | sequential ramp in Ava's theme, 3D camera with bearing (`view: 3d`, the default, written out), start marker and HTML label, legend with unit, no basemap | default |
| [web/diverging-zega-phone](web/diverging-zega-phone.json) | diverging ramp in zega's theme, 2D, a phone column, the framing kept clear of the legend | default |

Known gaps in the reference implementation (zegadb/zega at 11cff10), which
the web must close and other platforms must not copy: the no-GPU text reads
"WebGL2 unavailable. This browser cannot draw the map."; the canvas has no
view description (the demo page labels its host "Graph component canvas");
{type.family.ui} resolves to each operating system's own face. Masks
(every fixture): the map controls (top-right, 52 × 116 pt) and the
attribution (bottom-right, 280 × 24 pt), whose look each map SDK owns. The
basemap in every reference is zegadb/zega's committed test extract (tiles,
fonts, sprites under browser/tests/fixtures/) plus data/monaco.pmtiles; a
platform renders fixtures from the same files.

## Tokens

{color.ground}, {color.panel}, {color.rule}, {color.ink}, {color.soft},
{color.accent}, {ramp.sequential}, {ramp.diverging}, {space.xxs},
{space.xs}, {space.sm}, {space.md}, {space.lg}, {space.xl}, {space.xxl},
{space.frame}, {radius.sm}, {radius.md}, {stroke.hairline},
{stroke.marker}, {stroke.casing}, {stroke.labelHalo}, {opacity.buildings},
{opacity.casing}, {opacity.legend}, {opacity.gearPanel}, {size.gearButton},
{size.gearPanel}, {size.gearLabel}, {size.gearValue}, {size.legendMin},
{size.legendBar}, {size.markerMin}, {type.family.ui}, {type.family.mono},
{type.family.map}, {type.size.caption}, {type.size.gearError},
{type.size.label}, {type.size.gearGlyph}, {type.size.mapLabel},
{type.weight.medium}, {type.weight.semibold}, {type.lineHeight.tight},
{type.lineHeight.code}, {type.tracking.caption}, {motion.duration.instant},
{motion.duration.swapBudget}, {motion.duration.viewSwitch},
{motion.easing.standard}.
