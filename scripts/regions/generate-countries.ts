/**
 * generate-countries.ts — offline generator for the Europe map's country data
 * (country-start mode: nations pre-fill whole countries, humans pick one).
 *
 * Reads the committed resources/maps/europe/regions.json (metadata emitted by
 * generate-regions.ts: 852 regions with { id, name, country }), groups region
 * ids by their `country` value, applies the COUNTRY_META table below (display
 * name + flag per value, plus a few folds: the Cyprus sovereign base areas and
 * Northern Cyprus fold into Cyprus, Gaza Strip and West Bank fold into
 * Palestine) and writes resources/maps/europe/countries.json:
 *
 *   { "version": 1,
 *     "countries": [ { "name": "Albania", "flag": "al", "regions": [1, ...] }, ... ] }
 *
 * Region ids are identical for the Normal and Compact rasters, so one file
 * serves both. Countries are sorted by name (binary compare) and region ids
 * ascending — the file is fully deterministic.
 *
 * Validates that every region id 1..regionCount appears in exactly one
 * country and that every flag exists in resources/flags/.
 *
 * Run: npm run gen-countries
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MAP_DIR = join(ROOT, "resources", "maps", "europe");
const FLAGS_DIR = join(ROOT, "resources", "flags");

interface RegionsJson {
  version: number;
  regionCount: number;
  regions: { id: number; name: string; country: string }[];
}

interface CountriesJson {
  version: number;
  countries: { name: string; flag: string; regions: number[] }[];
}

type CountryMeta = { name: string; flag: string } | { foldInto: string };

/**
 * regions.json `country` value → country definition or fold target.
 * Values are a mix of ISO2 codes and Natural Earth admin names (see
 * generate-regions.ts). `foldInto` refers to the *final* country name of
 * another entry.
 */
const COUNTRY_META: Record<string, CountryMeta> = {
  AL: { name: "Albania", flag: "al" },
  AT: { name: "Austria", flag: "at" },
  BA: { name: "Bosnia and Herzegovina", flag: "ba" },
  BE: { name: "Belgium", flag: "be" },
  BG: { name: "Bulgaria", flag: "bg" },
  BY: { name: "Belarus", flag: "by" },
  CH: { name: "Switzerland", flag: "ch" },
  CZ: { name: "Czechia", flag: "cz" },
  DE: { name: "Germany", flag: "de" },
  DK: { name: "Denmark", flag: "dk" },
  EE: { name: "Estonia", flag: "ee" },
  ES: { name: "Spain", flag: "es" },
  FI: { name: "Finland", flag: "fi" },
  FR: { name: "France", flag: "fr" },
  GB: { name: "United Kingdom", flag: "gb" },
  GR: { name: "Greece", flag: "gr" },
  HR: { name: "Croatia", flag: "hr" },
  HU: { name: "Hungary", flag: "hu" },
  IE: { name: "Ireland", flag: "ie" },
  IS: { name: "Iceland", flag: "is" },
  IT: { name: "Italy", flag: "it" },
  LT: { name: "Lithuania", flag: "lt" },
  LU: { name: "Luxembourg", flag: "lu" },
  LV: { name: "Latvia", flag: "lv" },
  MD: { name: "Moldova", flag: "md" },
  ME: { name: "Montenegro", flag: "me" },
  MK: { name: "North Macedonia", flag: "mk" },
  MT: { name: "Malta", flag: "mt" },
  NL: { name: "Netherlands", flag: "nl" },
  NO: { name: "Norway", flag: "no" },
  PL: { name: "Poland", flag: "pl" },
  PT: { name: "Portugal", flag: "pt" },
  RO: { name: "Romania", flag: "ro" },
  RS: { name: "Serbia", flag: "rs" },
  RU: { name: "Russia", flag: "ru" },
  SE: { name: "Sweden", flag: "se" },
  SI: { name: "Slovenia", flag: "si" },
  SK: { name: "Slovakia", flag: "sk" },
  TR: { name: "Turkey", flag: "tr" },
  UA: { name: "Ukraine", flag: "ua" },
  XK: { name: "Kosovo", flag: "xk" },
  Cyprus: { name: "Cyprus", flag: "cy" },
  "Akrotiri Sovereign Base Area": { foldInto: "Cyprus" },
  "Dhekelia Sovereign Base Area": { foldInto: "Cyprus" },
  "Northern Cyprus": { foldInto: "Cyprus" },
  "West Bank": { name: "Palestine", flag: "ps" },
  "Gaza Strip": { foldInto: "Palestine" },
  Algeria: { name: "Algeria", flag: "dz" },
  Armenia: { name: "Armenia", flag: "am" },
  Azerbaijan: { name: "Azerbaijan", flag: "az" },
  Egypt: { name: "Egypt", flag: "eg" },
  "Faroe Islands": { name: "Faroe Islands", flag: "fo" },
  Georgia: { name: "Georgia", flag: "ge" },
  Iran: { name: "Iran", flag: "ir" },
  Iraq: { name: "Iraq", flag: "iq" },
  "Isle of Man": { name: "Isle of Man", flag: "im" },
  Israel: { name: "Israel", flag: "il" },
  Jersey: { name: "Jersey", flag: "je" },
  Jordan: { name: "Jordan", flag: "jo" },
  Kazakhstan: { name: "Kazakhstan", flag: "kz" },
  Lebanon: { name: "Lebanon", flag: "lb" },
  Libya: { name: "Libya", flag: "ly" },
  Morocco: { name: "Morocco", flag: "ma" },
  "Saudi Arabia": { name: "Saudi Arabia", flag: "sa" },
  Syria: { name: "Syria", flag: "sy" },
  Tunisia: { name: "Tunisia", flag: "tn" },
};

function main(): void {
  const regionsPath = join(MAP_DIR, "regions.json");
  const regionsJson = JSON.parse(
    readFileSync(regionsPath, "utf8"),
  ) as RegionsJson;
  const { regionCount, regions } = regionsJson;
  if (regions.length !== regionCount) {
    throw new Error(
      `regions.json regionCount ${regionCount} != regions length ${regions.length}`,
    );
  }

  // Resolve every regions.json country value to a final country name.
  const byName = new Map<string, { flag: string; regions: number[] }>();
  // First pass: create country entries from concrete definitions.
  for (const value of Object.keys(COUNTRY_META)) {
    const meta = COUNTRY_META[value];
    if ("foldInto" in meta) continue;
    if (byName.has(meta.name)) {
      throw new Error(`duplicate country name ${meta.name} in COUNTRY_META`);
    }
    byName.set(meta.name, { flag: meta.flag, regions: [] });
  }
  // Validate fold targets exist.
  for (const value of Object.keys(COUNTRY_META)) {
    const meta = COUNTRY_META[value];
    if ("foldInto" in meta && !byName.has(meta.foldInto)) {
      throw new Error(`fold target ${meta.foldInto} has no definition`);
    }
  }

  // Second pass: assign region ids.
  const seen = new Uint8Array(regionCount + 1);
  for (const region of regions) {
    if (
      !Number.isInteger(region.id) ||
      region.id < 1 ||
      region.id > regionCount
    ) {
      throw new Error(`region id ${region.id} out of range 1..${regionCount}`);
    }
    if (seen[region.id]) {
      throw new Error(`region id ${region.id} appears twice in regions.json`);
    }
    seen[region.id] = 1;
    const meta = COUNTRY_META[region.country];
    if (meta === undefined) {
      throw new Error(
        `no COUNTRY_META entry for country value "${region.country}" ` +
          `(region ${region.id} ${region.name})`,
      );
    }
    const finalName = "foldInto" in meta ? meta.foldInto : meta.name;
    byName.get(finalName)!.regions.push(region.id);
  }
  for (let id = 1; id <= regionCount; id++) {
    if (!seen[id]) throw new Error(`region id ${id} missing from regions.json`);
  }

  // Build the output: countries sorted by name, region ids ascending; drop
  // any COUNTRY_META definition that ended up with no regions.
  const names = [...byName.keys()]
    .filter((name) => byName.get(name)!.regions.length > 0)
    .sort();
  const out: CountriesJson = {
    version: 1,
    countries: names.map((name) => {
      const entry = byName.get(name)!;
      return {
        name,
        flag: entry.flag,
        regions: entry.regions.sort((a, b) => a - b),
      };
    }),
  };

  // Every flag must exist.
  for (const c of out.countries) {
    const flagPath = join(FLAGS_DIR, `${c.flag}.svg`);
    if (!existsSync(flagPath)) {
      throw new Error(`flag ${c.flag}.svg for ${c.name} not found in flags/`);
    }
  }
  // Partition check on the output itself (belt and braces).
  const covered = new Uint8Array(regionCount + 1);
  for (const c of out.countries) {
    for (const r of c.regions) {
      if (covered[r]) throw new Error(`region ${r} in multiple countries`);
      covered[r] = 1;
    }
  }
  for (let id = 1; id <= regionCount; id++) {
    if (!covered[id]) throw new Error(`region ${id} not covered`);
  }

  const outPath = join(MAP_DIR, "countries.json");
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    `[countries] wrote ${out.countries.length} countries covering ` +
      `${regionCount} regions to ${outPath}`,
  );
}

main();
