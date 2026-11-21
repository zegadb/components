// The package's shared types: a contract (format 2), a view spec, the errors
// a view spec can get, and a host's theme.
import type { Schema, SchemaError } from "./schema.ts";

/** A display option or setting: a JSON Schema in the setting subset, with its default. */
export type Setting = Schema & { readonly default: unknown; readonly description: string };

/** A component's contract (schemas/contract.schema.json, format 2), as the package compiles it in. */
export interface Contract {
  readonly format: 2;
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly surface: { readonly kind: string; readonly description: string; readonly art?: string };
  readonly marks: readonly string[];
  readonly size: { readonly aspect: number; readonly minHeight: number; readonly maxHeight: number };
  readonly data: Schema;
  readonly $defs?: Schema;
  readonly options: { readonly [name: string]: Setting };
  readonly examples: { readonly valid: readonly { readonly title: string; readonly spec: unknown }[]; readonly invalid: readonly { readonly title: string; readonly spec: unknown; readonly error: unknown }[] };
}

/** What an assistant emits: one component, its data inline, its options (schemas/view-spec.schema.json). */
export interface ViewSpec {
  component: string;
  data: unknown;
  options?: Record<string, unknown>;
  version?: string;
  format?: 2;
}

/** A teaching error, for whoever wrote the spec (a model reads these): what, where, what to do. */
export type ViewError = SchemaError;

export type Mode = "light" | "dark";

/** One mode of a host's theme: tokens/themes.json's roles. */
export interface ThemeColours {
  readonly ground: string;
  readonly panel: string;
  readonly ink: string;
  readonly soft: string;
  readonly rule: string;
  readonly axis: string;
  readonly accent: string;
  readonly series: readonly string[];
  readonly up: string;
  readonly down: string;
  readonly buildings: string;
  readonly cartilage: string;
  readonly muscle: string;
  readonly nerve: string;
  readonly sequential: readonly string[];
  readonly diverging: readonly string[];
  readonly weather: WeatherColours;
}

/** The weather card's skies, by condition and day or night (src/weather). */
export type SkyName = "clear-day" | "partly-day" | "overcast-day" | "rain-day" | "snow-day" | "storm" | "clear-night" | "cloudy-night";

/** The weather card's own colours: its skies (top, bottom), the white text on them, and the glyphs'. */
export interface WeatherColours {
  readonly skies: { readonly [S in SkyName]: readonly string[] };
  readonly ink: string;
  readonly pop: string;
  readonly sun: string;
  readonly moon: string;
  readonly cloud: string;
  readonly drop: string;
  readonly bolt: string;
  readonly edge: string;
}

export interface HostTheme {
  readonly font: { readonly ui: string; readonly mono: string; readonly map: string };
  readonly light: ThemeColours;
  readonly dark: ThemeColours;
}

/** What a chart is drawn with: one mode of a host's theme, and its type. */
export interface Theme extends ThemeColours {
  readonly mode: Mode;
  readonly font: HostTheme["font"];
}
