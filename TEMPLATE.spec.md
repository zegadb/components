---
id: <component-id>
status: draft
version: 0.1.0
implementation: <where the reference implementation lives, e.g. zegadb/zega browser/components/<id>/>
---

<!--
Copy to components/<id>/<id>.spec.md. Keep every `## ` section, in this
order (tools/check.mjs enforces it); write "None." where a section has
nothing to say, never delete it. Rules for the text:

- Lengths are points (pt). 1 pt = 1 CSS px = 1 iOS point. Never write px.
- Colours, type, spacing, radii, strokes, opacity and motion come from
  tokens only, written {group.name}, e.g. {color.accent}, {type.size.label}.
  No raw hex anywhere outside `## Tokens`. A value that is not a token yet
  becomes one (tokens/tokens.json) in the same change.
- Say *what*, never *how*: a platform section may say which API draws a
  part, never a different size, colour, timing or behaviour.
- Refer to issues as repo#N (zegadb/zega#109), not #N.
-->

# <Title>

## Purpose

One paragraph: what question this component answers, and when an agent or a
person should pick it over another. One sentence on what it is not for.

## Contract

The typed contract is [<id>.contract.json](<id>.contract.json): data shape,
roles (types, units, frames), surface parameters and display options with
types, ranges and defaults. This section only summarises it; the JSON is the
authority.

| role | per | type | required | meaning |
|---|---|---|---|---|

## Anatomy

Every visual part, named. These names are used everywhere else in this spec,
in code and in reviews. Draw order is back to front.

| # | part | what it is | drawn with |
|---|---|---|---|

## Measurements

Reference size: 640 × 400 pt at scale 2 (1280 × 800 pixels), the size of
every fixture unless it says otherwise.

| part | property | value | scales with |
|---|---|---|---|

Scaling rules: which parts keep a fixed size in points at any canvas size
(chrome: legend, gear, badges), which follow the data (marks), and which fill
the canvas (surfaces).

## Colour and type

Which token colours and type styles each part uses, per theme when they
differ. Only token references.

## States

| state | when | what shows |
|---|---|---|
| empty | | |
| loading | | |
| error | | |
| selected | | |
| hover / press | | |

## Interaction

Each gesture, touch and pointer side by side, with one behaviour.

| action | touch | pointer | result |
|---|---|---|---|

## Animation

Every motion: what moves, duration and easing (tokens), and what reduced
motion does instead.

## Accessibility

Accessible name and description, what a screen reader announces, contrast of
text and marks against their ground in both themes, focus order of the chrome,
and reduced motion.

## Parameters (gear)

The gear shows exactly the contract's `surfaceParams` and `options`, in
contract order, surface first; each control follows from its schema. List
them with the control each gets and any grouping.

| section | name | control | range / values | default |
|---|---|---|---|---|

## Platform notes

*How* each platform draws this, never *what*. Web (Next.js, and the Tauri
desktop shell, which runs the same web build), iOS (SwiftUI).

- **Web:**
- **Desktop (Tauri):**
- **iOS:**

## Conformance

| fixture | what it proves | tolerance |
|---|---|---|

Default tolerance unless a row says otherwise (CONFORMANCE.md). Masks, if
any, with their reason.

## Tokens

Every token this spec uses. This is the one section where resolved values may
be written, for reading convenience; tokens/tokens.json stays the authority.
