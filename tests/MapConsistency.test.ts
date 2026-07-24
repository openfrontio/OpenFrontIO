import fs from "fs";
import path from "path";
import {
  type CustomTribe,
  GameMapName,
  GameMapType,
  MapInfo,
  maps,
} from "../src/core/game/Game";
import { validateLayer } from "./util/layerValidation";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a GameMapName enum key to its folder name (lowercase key). */
function toFolderName(key: GameMapName): string {
  return key.toLowerCase();
}

const ROOT = path.resolve(__dirname, "..");
const MAP_GEN_MAPS = path.join(ROOT, "map-generator", "assets", "maps");
const RESOURCES_MAPS = path.join(ROOT, "resources", "maps");
const EN_JSON = path.join(ROOT, "resources", "lang", "en.json");

const allMapKeys = Object.keys(GameMapType) as GameMapName[];

// Maps excluded from the frequency requirement (not part of regular playlists).
const FREQUENCY_EXEMPTIONS: Set<GameMapName> = new Set([
  "GiantWorldMap",
  "Oceania",
  "BaikalNukeWars",
  "Tourney1",
  "Tourney2",
  "Tourney3",
  "Tourney4",
  "EuropeClassic",
  "BritanniaClassic",
]);

// Keys in the en.json "map" section that are UI strings, not map names.
const EN_JSON_META_KEYS = new Set([
  "map",
  "featured",
  "all",
  "favorites",
  "random",
]);

/** Get the en.json "map" section. */
function getEnJsonMapSection(): Record<string, string> {
  const content = JSON.parse(fs.readFileSync(EN_JSON, "utf8"));
  return content.map as Record<string, string>;
}

const mapsById = new Map<GameMapName, MapInfo>(maps.map((m) => [m.id, m]));

/** Read the parsed info.json for a map, or null if missing. */
function readInfoJson(key: GameMapName): Record<string, unknown> | null {
  const infoPath = path.join(MAP_GEN_MAPS, toFolderName(key), "info.json");
  if (!fs.existsSync(infoPath)) return null;
  return JSON.parse(fs.readFileSync(infoPath, "utf8"));
}

/** The generator treats falsy info.json values (0, "") as "omitted". */
function orOmitted(value: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return value || undefined;
}

/**
 * Normalize info.json custom_tribes (mixed string/object array) to the
 * Maps.gen.ts format (all CustomTribe objects with name and optional coordinates).
 */
function normalizeCustomTribes(raw: unknown): CustomTribe[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((entry) => {
    if (typeof entry === "string") return { name: entry };
    return entry as CustomTribe;
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Map consistency", () => {
  test("Every GameMapType has map-generator assets (image.png + info.json + layer PNGs only)", () => {
    const errors: string[] = [];
    for (const key of allMapKeys) {
      const folder = toFolderName(key);
      const dir = path.join(MAP_GEN_MAPS, folder);

      if (!fs.existsSync(dir)) {
        errors.push(
          `${key}: directory "${folder}" missing in map-generator/assets/maps/`,
        );
        continue;
      }

      const files = fs.readdirSync(dir).sort();
      // image.png and info.json are always required.
      if (!files.includes("image.png")) {
        errors.push(
          `${key}: missing "image.png" in map-generator/assets/maps/${folder}/`,
        );
      }
      if (!files.includes("info.json")) {
        errors.push(
          `${key}: missing "info.json" in map-generator/assets/maps/${folder}/`,
        );
      }

      // Build the set of expected PNGs: image.png + layer PNGs.
      const info = readInfoJson(key);
      const layers = (info?.layers as Array<{ id: string }> | undefined) ?? [];
      const allowedPngs = new Set(["image.png"]);
      for (const layer of layers) {
        allowedPngs.add(`${layer.id}.png`);
      }

      for (const file of files) {
        if (file === "info.json") continue;
        if (file.endsWith(".png") && !allowedPngs.has(file)) {
          errors.push(
            `${key}: unexpected file "${file}" in map-generator/assets/maps/${folder}/`,
          );
        }
        if (!file.endsWith(".png") && file !== "info.json") {
          errors.push(
            `${key}: unexpected file "${file}" in map-generator/assets/maps/${folder}/`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error("Map generator asset violations:\n" + errors.join("\n"));
    }
  });

  test("The maps list and GameMapType match one-to-one", () => {
    const errors: string[] = [];
    for (const key of allMapKeys) {
      if (!mapsById.has(key)) {
        errors.push(`${key} has no entry in the generated maps list`);
      }
    }
    for (const m of maps) {
      if (!(m.id in GameMapType)) {
        errors.push(`maps list entry "${m.id}" is not a GameMapType key`);
      }
    }
    if (maps.length !== mapsById.size) {
      errors.push("maps list contains duplicate ids");
    }
    if (errors.length > 0) {
      throw new Error("maps list violations:\n" + errors.join("\n"));
    }
  });

  // Maps.gen.ts is generated from the info.json files by the map-generator.
  // If this test fails, run `npm run gen-maps` to regenerate it.
  test("info.json metadata matches the generated Maps.gen.ts", () => {
    const errors: string[] = [];
    for (const key of allMapKeys) {
      const info = readInfoJson(key);
      const map = mapsById.get(key);
      if (info === null || map === undefined) {
        continue; // Other tests catch missing files/entries.
      }
      const value = GameMapType[key];
      if (info.id !== key) {
        errors.push(`${key}: info.json id is "${info.id}", expected "${key}"`);
      }
      if (info.name !== value) {
        errors.push(
          `${key}: info.json name is "${info.name}", but GameMapType.${key} is "${value}"`,
        );
      }
      const fields: [string, unknown, unknown][] = [
        ["categories", info.categories, map.categories],
        ["translation_key", info.translation_key, map.translationKey],
        [
          "multiplayer_frequency",
          info.multiplayer_frequency ?? 0,
          map.multiplayerFrequency,
        ],
        ["featured_rank", orOmitted(info.featured_rank), map.featuredRank],
        [
          "special_team_count",
          orOmitted(info.special_team_count),
          map.specialTeamCount,
        ],
        ["themes", orOmitted(info.themes), map.themes],
        [
          "custom_tribes",
          normalizeCustomTribes(info.custom_tribes),
          map.customTribes,
        ],
      ];
      for (const [field, infoValue, mapValue] of fields) {
        if (JSON.stringify(infoValue) !== JSON.stringify(mapValue)) {
          errors.push(
            `${key}: info.json ${field} is ${JSON.stringify(infoValue)}, but the maps list has ${JSON.stringify(mapValue)}`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "info.json and Maps.gen.ts are out of sync (run `npm run gen-maps`):\n" +
          errors.join("\n"),
      );
    }
  });

  test("Every GameMapType (except exemptions) has a positive multiplayer_frequency", () => {
    const errors: string[] = [];
    for (const key of allMapKeys) {
      if (FREQUENCY_EXEMPTIONS.has(key)) continue;
      const info = readInfoJson(key);
      if (info === null) continue; // Other tests catch missing files.
      const freq = info.multiplayer_frequency;
      if (typeof freq !== "number" || freq <= 0) {
        errors.push(
          `${key} has multiplayer_frequency ${JSON.stringify(freq)} in info.json (must be > 0, or add the map to FREQUENCY_EXEMPTIONS)`,
        );
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "Maps missing a multiplayer frequency (not exempted):\n" +
          errors.join("\n"),
      );
    }
  });

  // The en.json "map" section is generated from the info.json files.
  // If this test fails, run `npm run gen-maps` to regenerate it.
  test("en.json map translations match info.json display names", () => {
    const enMapSection = getEnJsonMapSection();
    const errors: string[] = [];
    for (const key of allMapKeys) {
      const folder = toFolderName(key);
      const info = readInfoJson(key);
      if (info === null) continue; // Other tests catch missing files.
      const expected = orOmitted(info.display_name) ?? info.name;
      if (enMapSection[folder] === undefined) {
        errors.push(
          `${key} (key "${folder}") is missing from en.json map translations`,
        );
      } else if (enMapSection[folder] !== expected) {
        errors.push(
          `${key}: en.json map.${folder} is "${enMapSection[folder]}", but info.json says "${expected}"`,
        );
      }
    }
    const validKeys = new Set(allMapKeys.map((k) => toFolderName(k)));
    for (const enKey of Object.keys(enMapSection)) {
      if (!EN_JSON_META_KEYS.has(enKey) && !validKeys.has(enKey)) {
        errors.push(`en.json map.${enKey} does not match any map`);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "en.json map section is out of sync (run `npm run gen-maps`):\n" +
          errors.join("\n"),
      );
    }
  });

  test("Every GameMapType has resources/maps/ with thumbnail.webp, bin files, and manifest.json", () => {
    const errors: string[] = [];
    const requiredFiles = [
      "manifest.json",
      "map.bin",
      "map4x.bin",
      "map16x.bin",
      "thumbnail.webp",
    ];

    for (const key of allMapKeys) {
      const folder = toFolderName(key);
      const dir = path.join(RESOURCES_MAPS, folder);

      if (!fs.existsSync(dir)) {
        errors.push(`${key}: directory "${folder}" missing in resources/maps/`);
        continue;
      }

      const files = fs.readdirSync(dir);
      for (const req of requiredFiles) {
        if (!files.includes(req)) {
          errors.push(`${key}: missing "${req}" in resources/maps/${folder}/`);
        }
      }
    }
    if (errors.length > 0) {
      throw new Error("Resource map file violations:\n" + errors.join("\n"));
    }
  });

  test("No excess folders in resources/maps/ or map-generator/assets/maps/", () => {
    const expectedFolders = new Set(allMapKeys.map((k) => toFolderName(k)));
    const errors: string[] = [];

    const resourceDirs = fs
      .readdirSync(RESOURCES_MAPS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const dir of resourceDirs) {
      if (!expectedFolders.has(dir)) {
        errors.push(`resources/maps/${dir}/ has no matching GameMapType entry`);
      }
    }

    const genDirs = fs
      .readdirSync(MAP_GEN_MAPS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const dir of genDirs) {
      if (!expectedFolders.has(dir)) {
        errors.push(
          `map-generator/assets/maps/${dir}/ has no matching GameMapType entry`,
        );
      }
    }

    if (errors.length > 0) {
      throw new Error("Excess map folders:\n" + errors.join("\n"));
    }
  });

  test("Nations in info.json and manifest.json should match", () => {
    const errors: string[] = [];

    for (const key of allMapKeys) {
      const folder = toFolderName(key);
      const infoPath = path.join(MAP_GEN_MAPS, folder, "info.json");
      const manifestPath = path.join(RESOURCES_MAPS, folder, "manifest.json");

      if (!fs.existsSync(infoPath) || !fs.existsSync(manifestPath)) {
        continue; // Other tests catch missing files.
      }

      try {
        const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

        // ── Compare nations ──────────────────────────────────────────────
        type NationEntry = {
          name: string;
          coordinates?: [number, number];
        };

        function compareNationArrays(
          label: string,
          infoArr: NationEntry[],
          manifestArr: NationEntry[],
        ): void {
          if (infoArr.length !== manifestArr.length) {
            errors.push(
              `${key}: ${label} count mismatch — info.json has ${infoArr.length}, manifest.json has ${manifestArr.length}`,
            );
            return;
          }
          for (let i = 0; i < infoArr.length; i++) {
            const inf = infoArr[i];
            const man = manifestArr[i];
            if (inf.name !== man.name) {
              errors.push(
                `${key}: ${label}[${i}] name mismatch — info.json "${inf.name}" vs manifest.json "${man.name}"`,
              );
              continue;
            }
            const infHasCoords = inf.coordinates !== undefined;
            const manHasCoords = man.coordinates !== undefined;
            if (infHasCoords !== manHasCoords) {
              errors.push(
                `${key}: ${label} "${inf.name}" (index ${i}) coordinate presence differs — info.json ${infHasCoords ? "has" : "missing"} coordinates, manifest.json ${manHasCoords ? "has" : "missing"} coordinates`,
              );
              continue;
            }
            if (inf.coordinates && man.coordinates) {
              const [ix, iy] = inf.coordinates;
              const [mx, my] = man.coordinates;
              if (ix !== mx || iy !== my) {
                errors.push(
                  `${key}: ${label} "${inf.name}" (index ${i}) coordinates differ — info.json [${ix}, ${iy}] vs manifest.json [${mx}, ${my}]`,
                );
              }
            }
          }
        }

        const toEntry = (n: NationEntry) => ({
          name: n.name,
          coordinates: n.coordinates,
        });

        compareNationArrays(
          "nation",
          (info.nations ?? []).map(toEntry),
          (manifest.nations ?? []).map(toEntry),
        );

        compareNationArrays(
          "additionalNation",
          (info.additionalNations ?? []).map(toEntry),
          (manifest.additionalNations ?? []).map(toEntry),
        );
      } catch (err) {
        errors.push(`${key}: failed to parse JSON — ${(err as Error).message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(
        "Nation data mismatches between info.json and manifest.json:\n" +
          errors.join("\n"),
      );
    }
  });

  test("Map metadata in info.json and manifest.json should match", () => {
    const metadataKeys = [
      "id",
      "name",
      "display_name",
      "translation_key",
      "categories",
      "multiplayer_frequency",
      "featured_rank",
      "special_team_count",
    ];
    const errors: string[] = [];

    for (const key of allMapKeys) {
      const info = readInfoJson(key);
      const manifestPath = path.join(
        RESOURCES_MAPS,
        toFolderName(key),
        "manifest.json",
      );
      if (info === null || !fs.existsSync(manifestPath)) {
        continue; // Other tests catch missing files.
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      for (const field of metadataKeys) {
        if (JSON.stringify(info[field]) !== JSON.stringify(manifest[field])) {
          errors.push(
            `${key}: "${field}" mismatch — info.json ${JSON.stringify(info[field])} vs manifest.json ${JSON.stringify(manifest[field])}`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "Metadata mismatches between info.json and manifest.json (run `npm run gen-maps`):\n" +
          errors.join("\n"),
      );
    }
  });

  // ── Layer validation ────────────────────────────────────────────────────

  test("Layer definitions in info.json are valid", () => {
    const errors: string[] = [];

    for (const key of allMapKeys) {
      const info = readInfoJson(key);
      if (info === null) continue;
      const layers = info.layers as
        | Array<{ id: string; placement: string; nukeable?: boolean }>
        | undefined;
      if (!layers || !Array.isArray(layers)) continue;

      const ids = new Set<string>();
      for (let i = 0; i < layers.length; i++) {
        errors.push(...validateLayer(layers[i], i, key, ids));
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "Layer definition violations in info.json:\n" + errors.join("\n"),
      );
    }
  });

  test("Layer PNGs exist in map-generator and resources for every defined layer", () => {
    const errors: string[] = [];

    for (const key of allMapKeys) {
      const info = readInfoJson(key);
      if (info === null) continue;
      const layers = info.layers as
        | Array<{ id: string; placement: string }>
        | undefined;
      if (!layers || !Array.isArray(layers)) continue;

      const folder = toFolderName(key);
      const genDir = path.join(MAP_GEN_MAPS, folder);
      const resDir = path.join(RESOURCES_MAPS, folder);

      for (const layer of layers) {
        const genPng = path.join(genDir, `${layer.id}.png`);
        if (!fs.existsSync(genPng)) {
          errors.push(
            `${key}: layer PNG "${layer.id}.png" missing in map-generator/assets/maps/${folder}/`,
          );
        }
        const resPng = path.join(resDir, `${layer.id}.png`);
        if (!fs.existsSync(resPng)) {
          errors.push(
            `${key}: layer PNG "${layer.id}.png" missing in resources/maps/${folder}/`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error("Missing layer PNGs:\n" + errors.join("\n"));
    }
  });

  test("No unreferenced PNGs in map-generator asset folders", () => {
    const errors: string[] = [];

    for (const key of allMapKeys) {
      const info = readInfoJson(key);
      if (info === null) continue;
      const folder = toFolderName(key);
      const genDir = path.join(MAP_GEN_MAPS, folder);

      const layers = (info.layers as Array<{ id: string }> | undefined) ?? [];
      const allowedPngs = new Set(["image.png"]);
      for (const layer of layers) {
        allowedPngs.add(`${layer.id}.png`);
      }

      const files = fs.readdirSync(genDir);
      for (const file of files) {
        if (file.endsWith(".png") && !allowedPngs.has(file)) {
          errors.push(
            `${key}: unexpected PNG "${file}" in map-generator/assets/maps/${folder}/ (not image.png or a defined layer)`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error("Unreferenced PNGs:\n" + errors.join("\n"));
    }
  });

  test("Layers in manifest.json match info.json", () => {
    const errors: string[] = [];

    for (const key of allMapKeys) {
      const info = readInfoJson(key);
      const manifestPath = path.join(
        RESOURCES_MAPS,
        toFolderName(key),
        "manifest.json",
      );
      if (info === null || !fs.existsSync(manifestPath)) continue;

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const infoLayers =
        (info.layers as Array<Record<string, unknown>> | undefined) ?? [];
      const manifestLayers =
        (manifest.layers as Array<Record<string, unknown>> | undefined) ?? [];

      if (infoLayers.length !== manifestLayers.length) {
        errors.push(
          `${key}: "layers" count mismatch — info.json has ${infoLayers.length}, manifest.json has ${manifestLayers.length}`,
        );
        continue;
      }

      for (let i = 0; i < infoLayers.length; i++) {
        // Compare by serializing sorted keys (Go marshals keys alphabetically).
        const normalize = (obj: Record<string, unknown>) =>
          JSON.stringify(obj, Object.keys(obj).sort());
        if (normalize(infoLayers[i]) !== normalize(manifestLayers[i])) {
          errors.push(
            `${key}: layers[${i}] mismatch — info.json ${JSON.stringify(infoLayers[i])} vs manifest.json ${JSON.stringify(manifestLayers[i])}`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "Layer data mismatches between info.json and manifest.json:\n" +
          errors.join("\n"),
      );
    }
  });

  test("Layer names exist in en.json map_layers section", () => {
    const enContent = JSON.parse(fs.readFileSync(EN_JSON, "utf8"));
    const mapLayersSection = enContent.map_layers as
      | Record<string, string>
      | undefined;
    if (!mapLayersSection) {
      // No layers defined anywhere — that's fine.
      return;
    }

    const errors: string[] = [];
    for (const key of allMapKeys) {
      const info = readInfoJson(key);
      if (info === null) continue;
      const layers = info.layers as Array<{ id: string }> | undefined;
      if (!layers || !Array.isArray(layers)) continue;

      for (const layer of layers) {
        if (mapLayersSection[layer.id] === undefined) {
          errors.push(
            `${key}: layer "${layer.id}" is missing from en.json map_layers section`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "Layer names missing from en.json (run `npm run gen-maps`):\n" +
          errors.join("\n"),
      );
    }
  });
});
