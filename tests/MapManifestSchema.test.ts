import {
  MapInfoSchema,
  MapManifestSchema,
} from "@openfront/engine-api/game/MapManifest";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import {
  MAP_INFO_SCHEMA_PATH,
  mapInfoJsonSchema,
} from "../scripts/genMapInfoSchema";

const ROOT = path.resolve(__dirname, "..");

function listJson(dir: string, file: string): [string, unknown][] {
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name, file))
    .filter((p) => fs.existsSync(p))
    .map((p) => [
      path.relative(ROOT, p),
      JSON.parse(fs.readFileSync(p, "utf8")),
    ]);
}

describe("Map schemas", () => {
  test.each(
    listJson(path.join(ROOT, "map-generator/assets/maps"), "info.json"),
  )("%s matches MapInfoSchema", (_file, info) => {
    const result = MapInfoSchema.safeParse(info);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  test.each(listJson(path.join(ROOT, "resources/maps"), "manifest.json"))(
    "%s matches MapManifestSchema",
    (_file, manifest) => {
      const result = MapManifestSchema.safeParse(manifest);
      expect(result.error?.issues ?? []).toEqual([]);
    },
  );

  test("every info.json points at the committed JSON Schema", () => {
    for (const [file, info] of listJson(
      path.join(ROOT, "map-generator/assets/maps"),
      "info.json",
    )) {
      const rel = (info as { $schema?: string }).$schema;
      expect(rel, file).toBeDefined();
      expect(path.resolve(ROOT, path.dirname(file), rel!)).toBe(
        MAP_INFO_SCHEMA_PATH,
      );
    }
  });

  test("the committed JSON Schema is current (npm run gen-map-schema)", () => {
    expect(JSON.parse(fs.readFileSync(MAP_INFO_SCHEMA_PATH, "utf8"))).toEqual(
      JSON.parse(mapInfoJsonSchema()),
    );
  });

  test("rejects unknown keys", () => {
    const result = MapManifestSchema.safeParse({
      ...JSON.parse(
        fs.readFileSync(
          path.join(ROOT, "resources/maps/aegean/manifest.json"),
          "utf8",
        ),
      ),
      special_team_count_: 3,
    });
    expect(result.error?.issues.map((i) => i.code)).toEqual([
      "unrecognized_keys",
    ]);
  });

  test("rejects spawns outside the map", () => {
    const base = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "resources/maps/aegean/manifest.json"),
        "utf8",
      ),
    );
    const result = MapManifestSchema.safeParse({
      ...base,
      nations: [{ name: "Atlantis", coordinates: [base.map.width, 0] }],
      teamGameSpawnAreas: {
        "2": [{ x: 0, y: 0, width: base.map.width + 1, height: 1 }],
      },
    });
    expect(result.error?.issues.map((i) => i.path.join("."))).toEqual([
      "nations.0.coordinates",
      "teamGameSpawnAreas.2.0",
    ]);
  });
});
