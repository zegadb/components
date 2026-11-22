---
id: weather
status: review
version: 1.0.0
implementation: this repository's web package, src/weather/ (its own entry, "@zegadb/components/weather")
---

# Weather

![Toronto, compact, Ava's light theme](web/default.reference.png)
![Toronto, full, dark](web/full.reference.dark.png)

## Purpose

One place's weather at a glance, as a card in the chart family's own style (function-plot,
price-chart): the temperature now, the sky, tonight's low, the next hours as a chart and the days
ahead (`compact`: the next 12 hours and up to four days as tiles; `full`: the next 24 hours, every
day on one scale for the week, and wind, sunrise, sunset and daylight). When the source gives a wind
chill or humidex, what it feels like leads, and the chart draws it beside the air's temperature. A
host shows it when someone asks only about the weather (Ava: "what's it like in Toronto?"); the
reply's words stay one short sentence beside it. It is drawn from a forecast the host read itself
(Ava: Environment and Climate Change Canada), never from numbers a model wrote. It shows no
warnings: a host shows the source's alerts as the source wrote them, above the card.

## Contract

[weather.contract.json](weather.contract.json). Temperatures are °C; times carry the place's
UTC offset, so the card shows the place's own clock wherever it is drawn.

| role | per | type | required | meaning |
|---|---|---|---|---|
| place | card | string | yes | the place's name, as the source names it |
| today | card | date | yes | the place's own date: "Tonight" and the days' names follow from it |
| now | card | temp_c, condition, icon, night, feels_c, wind, observed | no | the latest observation |
| now.wind | card | speed_kmh, gust_kmh, dir | no | the wind now: km/h, gusts when given, the direction in the source's letters |
| hours | card | at, temp_c, feels_c, icon, night, pop | no | the next hours, in order, at most 24 |
| days | card | date, high_c, low_c, icon, night, condition, pop | no | one per day from today: the day's sky, high and chance, the night's low |
| sun | card | rise, set, next_rise | no | today's sunrise and sunset; tomorrow's sunrise when the source gives it |
| stale | card | as_of (words), offline | no | the card isn't the latest reading |

At least one of `now`, `hours`, `days`. `pop` is the source's chance of precipitation: given or
absent, never 0 for unknown. `feels_c` is the source's wind chill or humidex: given or absent,
never worked out by the card. Options: `size` (`compact`, `full`) and `lang` (`en`, `fr`; the
host's language when null).

**Night after today.** The chart shades night from `sun`. ECCC gives today's sunrise and sunset
only, so the night after today ends at today's sunrise a day later (the next day's is within
minutes of it), and tomorrow's daylight on a 24-hour chart is today's a day later. A source that
gives tomorrow's sunrise sends it as `next_rise`, and the night ends there instead.

**Glyphs.** `icon` is one of our own fourteen kinds; `night` swaps the sun for the moon. ECCC's
codes map to them in one table, `ECCC_ICONS` (with `ECCC_TEXT` for a period with only words),
exported by the entry; a host reading ECCC reads that table rather than copying it:

| kind | ECCC codes |
|---|---|
| clear | 00 (day), 30 (night) |
| mainly-clear | 01, 05 (day); 31, 35 (night) |
| partly-cloudy | 02, 03, 04 (day); 32, 33, 34 (night); 22 |
| cloudy | 10 |
| showers | 06 (day), 36 (night) |
| rain | 11, 12, 13, 28 |
| freezing-rain | 14, 27 |
| mix (rain and snow) | 07 (day), 37 (night), 15 |
| flurries | 08 (day), 38 (night), 26 |
| snow | 16, 17, 18 |
| thunderstorm | 09 (day), 39 (night), 19, 46, 47 |
| fog | 23, 24, 44, 45 |
| wind | 41, 42, 43, 48 |
| blowing-snow | 25, 40 |

## Anatomy

| # | part | what it is | drawn with |
|---|---|---|---|
| 1 | panel | the card: the theme's panel, a hairline edge in the rule colour, 12 pt radius | rect |
| 2 | now | the temperature now, large and light, top left | text, light |
| 3 | feels (when given) | "Feels like" over the number, which is then the wind chill or humidex, and "Air −9°" under it | text |
| 4 | place, condition | the place's name; the sky's line glyph and its words | text, glyph |
| 5 | sub | "Tonight low 5°" once only tonight is left, else today's "High 8° · Low −1°" | text, soft |
| 6 | stale | when not the latest: a small clock and "Offline · as of …" (or "As of …") under the sub line | circle, path, text |
| 7 | chart label (full) | "NEXT 24 HOURS" (the hours given), small caps in soft | text |
| 8 | sun times | sunset and sunrise over their edges, each with a small arrow; one label with both over a short day | path, text (mono) |
| 9 | night | a band from each sunset to the next sunrise, behind the plot, its edges in nightEdge | rect, line |
| 10 | grid | hairlines at round temperatures, labelled at the right (as price-chart) | line, text (mono) |
| 11 | line | the temperature, a monotone curve (never overshoots a lowest or highest), over a wash of the accent from 18 % to 0 | path, linearGradient |
| 12 | feels line (when given) | with feels-like hours: the air in ink (1.5 pt), what it feels like in the accent (2.5 pt), the gap between them filled with the accent at 14 %, each named once | path, text |
| 13 | lowest, highest | dots on the line, ringed in the panel, with halo labels above the highest and below the lowest | circle, text |
| 14 | chance bars | a 3 pt bar under the plot for each hour the source gave a chance of 10 % or more, its height the chance; the highest once, beside them | rect, text (mono) |
| 15 | hours | the axis, a tick and the hour every 3 hours (6 under 380 pt) | line, text (mono) |
| 16 | days (full) | one row per day: its name, glyph and chance, then a dotted track for the week's lowest to highest with the night's low as a hollow ring (label left, soft) and the day's high as a filled dot (label right, ink), joined | text, glyph, line, circle |
| 17 | tiles (compact) | the next days after today as outlined tiles in one row (up to four; two by two in a narrow column): the day, its glyph, high and low, the chance under them | rect, text, glyph |
| 18 | footer (full) | wind and gusts, sunrise, sunset and daylight ("Daylight 1 h 38 min"), the ones given, in mono, wrapping | line, text (mono) |

## Measurements

The card is the column's width up to 480 pt (compact) or 520 pt (full), left in the column;
its height follows what it holds. Radius 12 pt. Padding 17 pt at the sides (14 pt under 380 pt),
14 pt above, 12 pt below.

| part | property | value | scales with |
|---|---|---|---|
| now | size | 54 pt, 48 pt under 380 pt | fixed |
| place | size | 16 pt, semibold | fixed |
| condition, sub | size | 13.5 pt; 12.5 pt | fixed |
| chart | plot height | 96 pt full (84 under 380 pt), 46 pt compact; chance bars 26 pt (18 compact) under it | fixed |
| chart | right gutter | the widest grid label plus 12 pt | content |
| chart | hours | 24 full, 12 compact; ticks every 3 h (6 under 380 pt, and in compact) | width |
| day row (full) | height | 31 pt; name 76 pt (64 under 380), glyph 28, chance 40, a low's label 34 pt each side of the track | fixed |
| tiles (compact) | width | at least 84 pt, 6 pt apart; as many as fit up to four, else two by two | width |
| glyph | size | 18 pt (header, tiles), 20 pt (day rows); stroke 1.6 on a 24 grid, a little heavier when small | fixed |
| labels | size | mono 10.5 to 11.5 pt; halo labels 12.5 pt | fixed |

## Colour and type

The card is the theme's panel with a rule-coloured hairline; text is ink, or soft for what is
secondary (the sub line, tick and grid labels, sun times, the footer, lows). Marks are the
accent: the line, its wash, the dots, the chance bars and the week's spans. From
{theme.weather}: `night` and `nightEdge` (the band and its edges), `pop` (the chance's words,
an accent that holds as text) and `sun` (the sun in a glyph, a shape colour only). No colour
ramp, no gradient sky, no white text on colour. The glyphs are our own line drawings: shapes in
ink, what falls (rain, snow, ice, a bolt) in the accent, the sun in `sun`, a cloud filled with the
panel so it hides the sun behind it. Type is the theme's: its UI face (DM Sans for Ava) for words
and numbers, the temperature now at weight 300, the place and highs at 600; its mono face (IBM
Plex Mono for Ava) for times, the grid, the chance and the footer. The card loads no font: the
host self-hosts its faces.

## States

| state | when | what shows |
|---|---|---|
| empty | no now, hours or days | nothing: validate() refuses it |
| loading | | the host's own; the card is drawn whole or not at all |
| error | a spec that fails validate() | nothing; the host says one plain sentence |
| stale | `stale` given | the clock and "Offline · as of …" under the sub line, small: the only "as of" (the host leaves it off its source line when the card shows it) |
| missing values | a day without a high, no gusts, no sunrise, fewer than two hours | that value (or the chart) is left out; nothing is made up |
| no feels-like | the source gave no wind chill or humidex | the air leads; one line over its wash |
| selected | | none |
| hover / press | | none |

## Interaction

None: the card is a still picture.

| action | touch | pointer | result |
|---|---|---|---|
| none | | | |

## Animation

None.

## Accessibility

The SVG is `role="img"` with an accessible name of a few sentences: the place and now (with what it
feels like when given), each day's words, high, low and chance, and the "as of" when stale. Every
piece of text holds 4.5:1 (3:1 for large text: 24 pt, or 18.66 pt semibold) against the panel and
against the night band, for every host and mode (the tests draw every size, width and recorded
place and check each text on both), so it reads the same wherever it sits on the chart. Labels
over the plot have a halo in the panel's colour. Glyphs are `aria-hidden`; their words are in the
name.

## Parameters (gear)

None: the card has no gear. `size` and `lang` are the host's choice.

| section | name | control | range / values | default |
|---|---|---|---|---|
| | | | | |

## Platform notes

- **Web:** SVG through `render()` from "@zegadb/components/weather", which also checks and
  draws every main-entry component; the main entry doesn't carry the weather. No credit is drawn:
  the host shows its source's credit once, under the card, as Ava does with ECCC's line, and
  never as an "edit" link (as with the basemap's credit).
- **Desktop (Tauri):** the same web build; the host self-hosts its UI face at 300, 400 and 600 and
  its mono face at 400.
- **iOS:** paused.

## Conformance

| fixture | what it proves | tolerance |
|---|---|---|
| [web/default.json](web/default.json) | compact: now, the place, tonight's low, the next 12 hours with sunset, four day tiles with ECCC's chances (Toronto, recorded) | default |
| [web/compact-phone.json](web/compact-phone.json) | compact at a phone's column: three tiles | default |
| [web/compact-narrow.json](web/compact-narrow.json) | compact under 320 pt (a phone's chat bubble): feels-like leading, chance bars under a night-long chart (Clyde River) | default |
| [web/full.json](web/full.json) | full: 24 hours with night from sunset to sunrise (0 % shown as nothing), six days on one scale, wind with gusts, sunrise, sunset, daylight | default |
| [web/full-phone.json](web/full-phone.json) | full at a phone's column: hours every 6, the footer wrapping | default |
| [web/montreal-fr.json](web/montreal-fr.json) | every word in French around ECCC's French | default |
| [web/clyde-river-phone.json](web/clyde-river-phone.json) | a blizzard: feels like −21° leading, air and wind chill as two lines with the gap filled, the chance bars, a 1 h 38 min day | default |
| [web/offline.json](web/offline.json) | the stale state: the clock and "Offline · as of" | default |

## Tokens

{theme.weather} per host and mode in tokens/themes.json. Ava light: sun #D98E00, night #EEEAF6,
nightEdge #D9D2EA, pop #5434D6; dark: sun #FFC94D, night #18142B, nightEdge #2C2648, pop
#B9A6FF. Everything else is the theme's panel, ink, soft, rule, axis and accent.
