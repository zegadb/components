import { test } from "node:test";
import assert from "node:assert/strict";
import { AERIAL_CANADA, AVA_IMAGERY, creditHtml, ESA_WORLDCOVER_2021 } from "./basemaps.ts";
import { CREDIT_SEPARATOR, hasTile, imageryCapAt, imageryCredit, imageryCreditsIn, rows, tileAt, type ImageryView } from "./coverage.ts";

// Places, and what the aerial build covers there (its plan of 25 Nov 2026).
const CN_TOWER = [-79.3871, 43.6426] as const;
const PARLIAMENT = [-75.7003, 45.4253] as const;
const CHATEAU_FRONTENAC = [-71.2045, 46.8118] as const;
const OLD_PORT = [-73.5545, 45.5038] as const;
const LEGISLATURE_EDMONTON = [-113.5065, 53.534] as const;
const FORKS = [-97.1305, 49.8878] as const;
const STANLEY_PARK = [-123.1375, 49.2948] as const;
const CALGARY = [-114.0719, 51.0447] as const;
const HALIFAX = [-63.5752, 44.6488] as const;
const GATINEAU = [-75.7245, 45.4862] as const;
/** Midtown Toronto, inland: its z13 tile is wholly inside the photographs. */
const MIDTOWN = [-79.3872, 43.6917] as const;

/** A view about 1.5 x 1 km around a point, at a zoom. */
const around = ([lon, lat]: readonly [number, number], zoom: number, half = 0.008): ImageryView => ({ bounds: [lon - half, lat - half / 1.5, lon + half, lat + half / 1.5], zoom });

test("coverage runs: rows of x runs per y, decoded once", () => {
  const r = rows("5:1+3,7+1;9:0+1");
  assert.deepEqual([...r.entries()], [[5, [[1, 3], [7, 7]]], [9, [[0, 0]]]]);
  assert.equal(rows("5:1+3,7+1;9:0+1"), r, "decoded once");
  assert.ok(hasTile("5:1+3,7+1", 3, 5) && hasTile("5:1+3,7+1", 7, 5));
  assert.ok(!hasTile("5:1+3,7+1", 4, 5) && !hasTile("5:1+3,7+1", 1, 6) && !hasTile("", 0, 0));
  assert.deepEqual(tileAt(13, ...CN_TOWER), [2289, 2990]);
});

test("the zoom cap lifts to z19 over the aerial photographs, and only there", () => {
  for (const at of [CN_TOWER, PARLIAMENT, CHATEAU_FRONTENAC, OLD_PORT, LEGISLATURE_EDMONTON, FORKS, STANLEY_PARK] as const) {
    assert.equal(imageryCapAt(AVA_IMAGERY, at[0], at[1]), 19, `at ${at}`);
  }
  // No usable open imagery there (survey: Calgary, Halifax; Gatineau's 2024 set has no licence page).
  for (const at of [CALGARY, HALIFAX, GATINEAU] as const) assert.equal(imageryCapAt(AVA_IMAGERY, at[0], at[1]), 13, `at ${at}`);
  // The ESA imagery alone: z13 everywhere.
  assert.equal(imageryCapAt(ESA_WORLDCOVER_2021, ...CN_TOWER), 13);
});

test("the credit names whose imagery the view shows: the city's own licence, in its words", () => {
  const credit = (at: readonly [number, number], zoom: number, lang: "en" | "fr" = "en") => creditHtml(imageryCredit(AVA_IMAGERY, lang, around(at, zoom)));
  const OGL_ON = /Contains information licensed under the <a href="https:\/\/www.ontario.ca\/page\/open-government-licence-ontario" rel="noreferrer">Open Government Licence – Ontario<\/a>/;
  const QC = /© Gouvernement du Québec, <a href="https:\/\/www.donneesquebec.ca\/recherche\/dataset\/imagerie-orthorectifiee-du-quebec" rel="noreferrer">Imagerie orthorectifiée du Québec<\/a> \(<a href="https:\/\/creativecommons.org\/licenses\/by\/4.0\/" rel="noreferrer">CC BY 4.0<\/a>\), modified/;
  const ESA = /© ESA WorldCover project 2021/;
  assert.match(credit(CN_TOWER, 16), OGL_ON);
  assert.doesNotMatch(credit(CN_TOWER, 16), /Québec|Edmonton|Winnipeg|Vancouver/);
  assert.match(credit(CHATEAU_FRONTENAC, 16), QC);
  assert.doesNotMatch(credit(CHATEAU_FRONTENAC, 16), /Ontario/);
  assert.match(credit(CHATEAU_FRONTENAC, 16, "fr"), /modifiée/);
  assert.match(credit(OLD_PORT, 16), QC);
  assert.match(credit(LEGISLATURE_EDMONTON, 16), /Open Government Licence – City of Edmonton/);
  assert.match(credit(FORKS, 16), /Open Government Licence – Winnipeg/);
  assert.match(credit(STANLEY_PARK, 16), /Open Government Licence – Vancouver/);
  assert.match(credit(PARLIAMENT, 16, "fr"), /Contient de l’information visée par la <a [^>]+>Licence du gouvernement ouvert – Ontario<\/a>/);
  // Far out (below the overlay's tiles) and where there is none: the ESA credit alone.
  assert.equal(credit(CN_TOWER, 12), creditHtml(ESA_WORLDCOVER_2021.credit.en));
  assert.equal(credit(CALGARY, 16), creditHtml(ESA_WORLDCOVER_2021.credit.en));
  // Across the Ottawa River at Parliament: Ontario's photographs, and the ESA imagery over Gatineau.
  assert.deepEqual(imageryCreditsIn(AVA_IMAGERY, around(PARLIAMENT, 13, 0.06)), ["base", "on"]);
  // Downtown, wholly inside the photographs: nothing of the ESA imagery shows, so no ESA credit.
  assert.deepEqual(imageryCreditsIn(AVA_IMAGERY, around(MIDTOWN, 17, 0.003)), ["on"]);
  assert.doesNotMatch(credit(MIDTOWN, 17), /ESA/);
  // At the CN Tower the view takes in the lake, where the photographs end: both.
  assert.deepEqual(imageryCreditsIn(AVA_IMAGERY, around(CN_TOWER, 15, 0.02)), ["base", "on"]);
  // Two credits in one line, the base's first.
  const two = imageryCredit(AVA_IMAGERY, "en", around(PARLIAMENT, 13, 0.06));
  assert.deepEqual(two.slice(0, ESA_WORLDCOVER_2021.credit.en.length), [...ESA_WORLDCOVER_2021.credit.en]);
  assert.equal(two[ESA_WORLDCOVER_2021.credit.en.length], CREDIT_SEPARATOR);
});

test("every credit the overlay can show is a licence's own words, with a link, in both languages", () => {
  const c = AERIAL_CANADA.coverage;
  assert.deepEqual(Object.keys(c.credits).sort(), Object.keys(c.sources).sort(), "a credit for every source, none without one");
  for (const [id, line] of Object.entries(c.credits)) {
    for (const lang of ["en", "fr"] as const) {
      const html = creditHtml(line[lang]);
      assert.ok(line[lang].some((p) => typeof p !== "string"), `${id} ${lang} links its licence`);
      if (id.startsWith("qc-")) assert.match(html, /^© [^,]+, <a [^>]+>Imagerie orthorectifiée du Québec<\/a> \(<a [^>]+>CC BY 4.0<\/a>\), modifi/, id);
      else assert.match(html, /Open Government Licence – |Licence du gouvernement ouvert – Ontario/, id);
    }
  }
  // The licences that were checked and refused are not there (CMQ 2021 is NC-SA, GéoMont 2020 NC, Outaouais 2024 unverified).
  assert.doesNotMatch(JSON.stringify(c.credits), /Communauté métropolitaine|Collines-de-l|Val-d/);
});
