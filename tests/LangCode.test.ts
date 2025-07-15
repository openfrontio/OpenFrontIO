import fs from "fs";
import path from "path";

describe("LangCode Filename Check", () => {
  const langDir = path.join(__dirname, "../resources/lang");

  test("lang_code matches filename", () => {
    const files = fs
      .readdirSync(langDir)
      .filter((file) => file.endsWith(".json"));

    if (files.length === 0) {
      console.log("No resources/lang/*.json files found. Skipping check.");
      return;
    }

    let hasError = false;

    for (const file of files) {
      const filePath = path.join(langDir, file);
      const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      const fileNameWithoutExt = path.basename(file, ".json");
      const langCode = jsonData.lang?.lang_code;

      if (fileNameWithoutExt !== langCode) {
        console.error(
          `${file}: lang_code (${langCode}) does not match filename (${fileNameWithoutExt})`,
        );
        hasError = true;
      }
    }

    if (hasError) {
      throw new Error(
        "One or more lang_code values do not match their filenames.",
      );
    }
  });
});
