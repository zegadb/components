---
id: hockey3darena
status: draft
version: 0.1.0
implementation: none yet
---

# Hockey arena (3D)

**Draft.** Nothing here is built or approved. This file exists to show the
layout for Sami's example name and to hold what APS 21 already decided (the
rink frame, rink heat roles, half or full rink). It has no reference images
and no fixtures, and no platform may implement it until it reaches `review`.

## Purpose

Where on the ice things happen: shots, goals, rebounds as a heat density over
an NHL rink, flat or as a tilted 3D arena (APS 21 catalogue rows 1 and 2:
shot and rebound heat maps, zone shooting percentages).

## Contract

[hockey3darena.contract.json](hockey3darena.contract.json), draft 0.1.0.

| role | per | type | required | meaning |
|---|---|---|---|---|
| `at` | row | XY in the `rink` frame | yes | where the event happened (ft, x ±100, y ±42.5) |
| `weight` | row | Float ≥ 0 | no | how much the event counts; 1 when unbound |

## Anatomy

TODO. Ice, boards, lines (goal, blue, centre), creases, faceoff circles and
dots, nets, the heat layer, legend, gear.

## Measurements

TODO. Rink geometry from the NHL rulebook in feet, mapped to points at the
reference size; line widths; the 3D camera (pitch, field of view).

## Colour and type

TODO. Ice and line colours need new tokens (ice, red line, blue line); the
heat uses {ramp.sequential}.

## States

TODO.

## Interaction

TODO. Whether the 3D arena orbits under a drag.

## Animation

TODO. The 2D to 3D transition, if any.

## Accessibility

TODO.

## Parameters (gear)

Draft settings: `extent` (full, offensive, defensive), `colorScale`
(sequential, solid), `view` (2d, 3d).

## Platform notes

None until review.

## Conformance

TODO. Fixtures once a reference implementation exists.

To reach `review`, in this order:

1. Sami picks the name (`hockey3darena`, or `rink-heat` as APS 21 calls it)
   and whether 3D is an option of one component or a second component.
2. Draw the rink surface from the NHL rulebook; add its tokens.
3. Decide the heat method (kernel density or hex bins) and its bandwidth.
4. Build the web implementation on the component canvas.
5. Write the fixtures, render the references, fill every section above.

## Tokens

{ramp.sequential}.
