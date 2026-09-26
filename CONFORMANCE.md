# Conformance

A platform's implementation of a component **conforms** when, for every
fixture of that component, in both themes, its render at the fixture's size
and scale matches the committed reference image within the tolerance below.
Nothing else counts: not a screenshot that "looks right", not a green unit
test, not a reviewer's eye. The spec says what to build; the fixtures prove
it was built.

## What is rendered

- **Input:** a fixture, `components/<id>/fixtures/<name>.json`: a view spec
  (APS 21 format 1), the result snapshot it binds (`fixtures/data/*.json`), a
  canvas size in points and a scale of 2.
- **Output:** a PNG of the component's canvas only (no page, window or
  navigation chrome), `size × scale` pixels, once with the light tokens and
  once with the dark.
- **Environment:** fully offline. Basemap tiles, glyphs and sprites come from
  zegadb/zega's committed test extract (`browser/tests/fixtures/`, plus
  `browser/data/monaco.pmtiles`); every platform's harness serves the same
  files. Animation is off: fixtures use static settings (`edges: static`,
  `spin: false`), and the harness waits until the surface is idle.

## How renders are compared

One comparator, `diffInPage` in [tools/render/render.mjs](tools/render/render.mjs),
judges every platform. For each pixel outside the fixture's masks it takes
pixelmatch's perceptual (YIQ) colour distance between the render and the
reference; a pixel **differs** when that distance exceeds `threshold`. A
render **fails** when either:

| limit | default | catches |
|---|---|---|
| `maxDiffRatio`: differing pixels / compared pixels | 0.5 % | diffuse wrongness: a wrong palette, a shifted basemap, wrong theme |
| `maxCluster`: the largest 8-connected region of differing pixels, in pt² | 16 pt² (64 pixels at scale 2) | a local deviation: a moved legend, a missing marker, a mark a point too wide |
| `threshold`: YIQ distance, 0–1 | 0.1 | (per pixel) anti-aliasing and rounding noise |

Why both limits: re-rendering every reference on the same renderer differs
by **0 pixels**, and a real design deviation, `lineWidth` 5 instead of 6 on
the default path-on-map fixture, differs by only **0.56 % (light) and 0.45 %
(dark)** of the frame. A ratio alone would pass the dark one. The largest
region was **125 pt² and 103 pt²**, eight times the limit, so the region
limit is what stops "close enough". A fixture may override the defaults only
with a reason in its spec's Conformance section.

These numbers are the starting point. When the first iOS render exists they
are recalibrated once on real cross-platform noise (anti-aliasing and font
hinting differ between GPUs and text engines), and the change goes through
the same review as a reference image.

**Masks** exclude only chrome a map SDK owns and draws itself: the navigation
control stack and the attribution. Their placement is still specified in the
spec; their look is not ours to set. Masks are rectangles in points, listed
in the fixture with a reason; nothing a component draws may be masked.

## Where the references come from

**Recommendation, taken here: the web implementation renders the canonical
references, and Sami approves every one.** Reasons:

1. It exists. Both seeded components are built on the web today
   (zegadb/zega `browser/`); a dedicated renderer would be a fourth
   implementation that itself needs proving against something.
2. It is two of the three platforms. The Tauri desktop app runs the same web
   build, so desktop conformance is a check of the webview, not of a second
   implementation.
3. It is deterministic. Headless Chromium draws WebGL on SwiftShader, a CPU
   rasteriser (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`,
   recorded in the lock), so a re-render is bit-identical: every reference
   re-rendered with 0 differing pixels.
4. The spec still leads. A reference is accepted because it matches the spec
   and Sami approves it, not because the web drew it. When the web is wrong,
   the spec wins: the web is fixed and the reference re-rendered, and the
   known gaps are listed in each spec so no other platform copies them.

The renderer is [tools/render/render.mjs](tools/render/render.mjs) with
[tools/render/harness.html](tools/render/harness.html): it serves a
zegadb/zega checkout's `browser/` beside this repository, draws each fixture
through the component's real entry point (the canvas runtime for
path-on-map, `renderGlobe` for globe-arcs), and screenshots the canvas.
[REFERENCES.lock.json](REFERENCES.lock.json) records the implementation
commit, the browser, the GL renderer, the host, and every image's SHA-256;
`tools/check.mjs` fails when any reference differs from the lock, so an image
cannot change except by re-rendering.

**Known limit:** chrome text uses `{type.family.ui}`, the operating system's
own face, so references are rendered on macOS (samis-imac) until one bundled
face replaces it (README, open question 3).

## Changing a reference

1. Change the spec (and tokens, contract, fixtures) first, in a PR.
2. Change the web implementation to match, in zegadb/zega.
3. Re-render: `node tools/render/render.mjs --zega <checkout at that commit>`.
   This rewrites the PNGs and the lock.
4. Open the PR with the before and after images in its body.
5. **Sami approves.** `.github/CODEOWNERS` makes him the owner of every
   `*.png` and of `REFERENCES.lock.json`; no one else approves a reference.

## Per platform

### Web (Next.js)

Playwright, headless Chromium, the harness above. Against a zegadb/zega
checkout:

```sh
node tools/render/render.mjs --zega ../zega --verify          # all components
node tools/render/render.mjs --zega ../zega --verify --only globe-arcs
```

It exits 1 when any fixture is over tolerance and leaves the failing renders
in `.tmp/`. zegadb/zega's CI should run it on every PR that touches
`browser/components/`, `browser/globe.js` or `browser/arcs.js`. When the
components move into a Next.js package, the harness imports that package
instead; nothing else changes.

### Desktop (Tauri)

The same web build, in the platform webview: WKWebView on macOS, WebView2
(Chromium) on Windows, WebKitGTK on Linux. The Tauri app's test build opens
the same harness page for each fixture and captures the canvas element
(WebDriver via `tauri-driver` on Windows and Linux; on macOS a test command
that calls `WKWebView.takeSnapshot` at scale 2). The renders go into a
directory at the references' paths and are judged by the shared comparator:

```sh
node tools/render/render.mjs --zega ../zega --compare <renders dir>
```

WebKit differs from Chromium in WebGL rasterisation and text, so the macOS
desktop is a real conformance run, not a formality.

### iOS (SwiftUI)

XCTest in the app's test target, one test per fixture and theme:

1. Decode the fixture and its result with the same view-spec types the app
   uses; set the trait collection's `displayScale` to 2 and the interface
   style to light or dark.
2. Host the component's SwiftUI view in a window at exactly
   `size.width × size.height` points, with tiles, glyphs and sprites served
   from the test bundle (the same files as the web harness) and animation off.
3. Wait for the map view's "fully rendered" callback plus one frame, then
   capture: the map's own snapshot API for the map layer (Metal content does
   not appear in `drawHierarchy`), composited under the SwiftUI chrome, or
   `ImageRenderer` for components without a map.
4. Write the PNG to the test's output directory at the reference's path.

The CI job then runs `render.mjs --compare` on that directory. The snapshot
library's own comparison (e.g. swift-snapshot-testing) is not used: its
recorded images would become a second set of references, and its precision
settings a second tolerance. There is one set of references and one
comparator.

## Who decides

- **The spec** decides what a component looks like and does.
- **Sami** approves every spec change that alters a reference, and every
  reference image.
- **A platform** decides nothing visual. When a platform cannot meet the spec
  (an SDK limit, a performance cost), the answer is a spec change first,
  approved like any other, and then every platform follows it.
