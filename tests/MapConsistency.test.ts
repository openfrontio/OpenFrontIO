import fs from "fs";
import path from "path";
import { GameMapName, GameMapType, mapCategories } from "../src/core/game/Game";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a GameMapName enum key to its folder name (lowercase key). */
function toFolderName(key: GameMapName): string {
  return key.toLowerCase();
}

const ROOT = path.resolve(__dirname, "..");
const MAP_GEN_MAPS = path.join(ROOT, "map-generator", "assets", "maps");
const RESOURCES_MAPS = path.join(ROOT, "resources", "maps");
const MAIN_GO = path.join(ROOT, "map-generator", "main.go");
const EN_JSON = path.join(ROOT, "resources", "lang", "en.json");
const MAP_PLAYLIST = path.join(ROOT, "src", "server", "MapPlaylist.ts");

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

/** Parse the main.go maps registry and return the set of non-test map folder names. */
function getMainGoMaps(): Set<string> {
  const content = fs.readFileSync(MAIN_GO, "utf8");
  const names = new Set<string>();
  // Match lines like {Name: "africa"} or {Name: "africa", IsTest: true}
  const re = /\{Name:\s*"([^"]+)"(?:,\s*IsTest:\s*true)?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    // Check if it's a test map
    if (!m[0].includes("IsTest: true")) {
      names.add(m[1]);
    }
  }
  return names;
}

/** Get the en.json map translation keys. */
function getEnJsonMapKeys(): Set<string> {
  const content = JSON.parse(fs.readFileSync(EN_JSON, "utf8"));
  const mapSection = content.map as Record<string, string>;
  // Exclude meta keys that aren't actual maps.
  const metaKeys = new Set(["map", "featured", "all", "random"]);
  return new Set(Object.keys(mapSection).filter((k) => !metaKeys.has(k)));
}

/** Get all maps listed in the mapCategories from Game.ts. */
function getCategorizedMaps(): Set<string> {
  const result = new Set<string>();
  for (const maps of Object.values(mapCategories)) {
    for (const map of maps) {
      result.add(map as string);
    }
  }
  return result;
}

/** Parse the frequency record keys from MapPlaylist.ts. */
function getFrequencyKeys(): Set<string> {
  const content = fs.readFileSync(MAP_PLAYLIST, "utf8");
  // Extract the frequency block
  const freqMatch = content.match(/const frequency[\s\S]*?\{([\s\S]*?)\};/);
  if (!freqMatch) {
    throw new Error(
      `Failed to parse frequency record from MapPlaylist.ts (first 200 chars: ${content.slice(0, 200)})`,
    );
  }
  const keys = new Set<string>();
  const re = /(\w+):/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(freqMatch[1])) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Map consistency", () => {
  test("Every GameMapType is registered in main.go", () => {
    const mainGoMaps = getMainGoMaps();
    const errors: string[] = [];
    for (const key of allMapKeys) {
      const folder = toFolderName(key);
      if (!mainGoMaps.has(folder)) {
        errors.push(`${key} (folder "${folder}") is missing from main.go`);
      }
    }
    if (errors.length > 0) {
      throw new Error("Maps missing from main.go:\n" + errors.join("\n"));
    }
  });

  test("Every main.go map has a GameMapType entry", () => {
    const mainGoMaps = getMainGoMaps();
    const folderToKey = new Map(allMapKeys.map((k) => [toFolderName(k), k]));
    const errors: string[] = [];
    for (const folder of mainGoMaps) {
      if (!folderToKey.has(folder)) {
        errors.push(
          `main.go map "${folder}" has no matching GameMapType entry`,
        );
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "main.go maps missing from GameMapType:\n" + errors.join("\n"),
      );
    }
  });

  test("Every GameMapType has map-generator assets (image.png + info.json only)", () => {
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
      const expected = ["image.png", "info.json"];
      if (
        files.length !== expected.length ||
        !files.every((f, i) => f === expected[i])
      ) {
        errors.push(
          `${key}: expected [${expected.join(", ")}] but found [${files.join(", ")}]`,
        );
      }
    }
    if (errors.length > 0) {
      throw new Error("Map generator asset violations:\n" + errors.join("\n"));
    }
  });

  test("Every GameMapType is listed in at least one mapCategories group", () => {
    const categorized = getCategorizedMaps();
    const errors: string[] = [];
    for (const key of allMapKeys) {
      const value = GameMapType[key];
      if (!categorized.has(value)) {
        errors.push(
          `${key} ("${value}") is not listed in any mapCategories group`,
        );
      }
    }
    if (errors.length > 0) {
      throw new Error("Maps missing from mapCategories:\n" + errors.join("\n"));
    }
  });

  test("Every GameMapType (except exemptions) has a frequency entry", () => {
    const freqKeys = getFrequencyKeys();
    const errors: string[] = [];
    for (const key of allMapKeys) {
      if (FREQUENCY_EXEMPTIONS.has(key)) continue;
      if (!freqKeys.has(key)) {
        errors.push(
          `${key} is missing from the frequency record in MapPlaylist.ts`,
        );
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "Maps missing from frequency (not exempted):\n" + errors.join("\n"),
      );
    }
  });

  test("No unknown keys in frequency record", () => {
    const freqKeys = getFrequencyKeys();
    const validKeys = new Set(allMapKeys);
    const errors: string[] = [];
    for (const key of freqKeys) {
      if (!validKeys.has(key as GameMapName)) {
        errors.push(`"${key}" in frequency is not a valid GameMapName`);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        "Unknown keys in frequency record:\n" + errors.join("\n"),
      );
    }
  });

  test("Every GameMapType is registered in en.json map translations", () => {
    const enKeys = getEnJsonMapKeys();
    const errors: string[] = [];
    for (const key of allMapKeys) {
      const folder = toFolderName(key);
      if (!enKeys.has(folder)) {
        errors.push(
          `${key} (key "${folder}") is missing from en.json map translations`,
        );
      }
    }
    if (errors.length > 0) {
      throw new Error("Maps missing from en.json:\n" + errors.join("\n"));
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

        type NationEntry = { name: string; coordinates: [number, number] };
        const infoNations: NationEntry[] = (info.nations ?? []).map(
          (n: NationEntry) => ({ name: n.name, coordinates: n.coordinates }),
        );
        const manifestNations: NationEntry[] = (manifest.nations ?? []).map(
          (n: NationEntry) => ({ name: n.name, coordinates: n.coordinates }),
        );

        if (infoNations.length !== manifestNations.length) {
          errors.push(
            `${key}: nation count mismatch — info.json has ${infoNations.length}, manifest.json has ${manifestNations.length}`,
          );
          continue;
        }

        // Compare nations by index (order must match; names can be duplicated).
        for (let i = 0; i < infoNations.length; i++) {
          const inf = infoNations[i];
          const man = manifestNations[i];
          if (inf.name !== man.name) {
            errors.push(
              `${key}: nations[${i}] name mismatch — info.json "${inf.name}" vs manifest.json "${man.name}"`,
            );
            continue;
          }
          const [ix, iy] = inf.coordinates;
          const [mx, my] = man.coordinates;
          if (ix !== mx || iy !== my) {
            errors.push(
              `${key}: nation "${inf.name}" (index ${i}) coordinates differ — info.json [${ix}, ${iy}] vs manifest.json [${mx}, ${my}]`,
            );
          }
        }
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
});
