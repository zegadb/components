// "@zegadb/components/weather": the weather card's own entry. Its contract, glyphs and table of
// ECCC's codes would add about a sixth to the main entry (11 KB of 68 KB minified), and a host that never shows the weather must not
// bundle them, so the main entry does not carry it. A host that does imports validate and render
// from here instead: the main entry's functions with the weather added, so every other component
// checks and draws exactly as it does there:
//
//   import { validate, render } from "@zegadb/components/weather";   // every main-entry component, and the weather
//   const checked = validate(spec);
//   const drawn = render(checked.view, { width, theme, locale });     // drawn.svg, as for any chart
//
// Or register it with the generic functions yourself: registry([WEATHER, ...BUILT_IN]).
import { CONTRACT } from "../generated/contracts/weather.ts";
import { BUILT_IN } from "../builtin.ts";
import { registry, type Component, type ContractsOf, type Validated as ValidatedOf, type ViewOf } from "../registry.ts";
import type { Rendered } from "../chart.ts";
import * as card from "./card.ts";

export interface WeatherView { component: "weather"; data: card.WeatherData; options: card.WeatherOptions }

/** The weather card, for registry(). */
export const WEATHER: Component<WeatherView, Rendered, typeof CONTRACT> = {
  contract: CONTRACT,
  view: (data, options) => ({ component: "weather", data: data as card.WeatherData, options: options as unknown as card.WeatherOptions }),
  semantic: (view) => card.semantic(view.data),
  render: (view, ctx) => card.render(view.data, view.options, ctx),
};

/** The main entry's components, and the weather. */
export const COMPONENTS = [WEATHER, ...BUILT_IN] as const;

const WITH_WEATHER = /* @__PURE__ */ registry(COMPONENTS);

export type View = ViewOf<typeof COMPONENTS>;
export type ComponentId = View["component"];
export type Validated = ValidatedOf<View>;
export const COMPONENT_IDS: ComponentId[] = WITH_WEATHER.ids;
export const CONTRACTS: ContractsOf<typeof COMPONENTS> = WITH_WEATHER.contracts;
export const { validate, render, toolDefinitions, componentOfTool, contractText } = WITH_WEATHER;

export { ICONS as WEATHER_ICONS, ECCC_ICONS, ECCC_TEXT, ecccGlyph, glyph as weatherGlyph, type Icon as WeatherIcon, type Glyph as WeatherGlyph, type GlyphColours as WeatherGlyphColours } from "./icons.ts";
export { nightBands, MAX_WIDTH as WEATHER_MAX_WIDTH, type WeatherData, type WeatherDay, type WeatherHour, type WeatherNow, type WeatherOptions, type WeatherSun, type WeatherWind } from "./card.ts";
