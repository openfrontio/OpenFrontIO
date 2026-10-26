// Writes map-generator/info.schema.json from MapInfoSchema so editors can
// check info.json as it is typed. Run by `npm run gen-maps`.
import { MapInfoSchema } from "@openfront/engine-api/game/MapManifest";
import fs from "fs";
import path from "path";
import { z } from "zod";

export const MAP_INFO_SCHEMA_PATH = path.resolve(
  import.meta.dirname,
  "../map-generator/info.schema.json",
);

export function mapInfoJsonSchema(): string {
  const schema = z.toJSONSchema(MapInfoSchema, { target: "draft-2020-12" });
  return JSON.stringify(
    { ...schema, title: "OpenFront map info.json" },
    null,
    2,
  );
}

if (process.argv[1] === import.meta.filename) {
  fs.writeFileSync(MAP_INFO_SCHEMA_PATH, mapInfoJsonSchema() + "\n");
}
