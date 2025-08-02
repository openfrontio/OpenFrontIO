import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";

describe("LangCode Filename Check", () => {
  const langDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../resources/lang",
  );

  test("lang_code matches filename", () => {
    const files = fs
      .readdirSync(langDir)
      .filter((file) => file.endsWith(".json"));

    if (files.length === 0) {
      console.log("No resources/lang/*.json files found. Skipping check.");
      return;
    }

    for (const file of files) {
      const filePath = path.join(langDir, file);
      const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      const fileNameWithoutExt = path.basename(file, ".json");
      const langCode = jsonData.lang?.lang_code;

      expect(fileNameWithoutExt).toBe(langCode);
    }
  });
});
