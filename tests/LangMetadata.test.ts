import fs from "fs";
import path from "path";

describe("Lang Metadata Check", () => {
  const langDir = path.join(__dirname, "../resources/lang");
  const flagDir = path.join(__dirname, "../resources/flags");
  const metadataFile = path.join(langDir, "metadata.json");

  test("metadata languages point to existing lang json and flag files", () => {
    if (!fs.existsSync(metadataFile)) {
      console.log(
        "No resources/lang/metadata.json file found. Skipping check.",
      );
      return;
    }

    const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf-8"));
    if (!Array.isArray(metadata) || metadata.length === 0) {
      console.log(
        "No language entries found in metadata.json. Skipping check.",
      );
      return;
    }

    const errors: string[] = [];

    for (const entry of metadata) {
      const code = entry?.code;
      const svg = entry?.svg;
      if (typeof code !== "string" || code.length === 0) {
        errors.push(
          `metadata entry missing valid code: ${JSON.stringify(entry)}`,
        );
        continue;
      }
      if (typeof svg !== "string" || svg.length === 0) {
        errors.push(
          `[${code}]: metadata svg is missing or not a non-empty string`,
        );
        continue;
      }

      const langFilePath = path.join(langDir, `${code}.json`);
      if (!fs.existsSync(langFilePath)) {
        errors.push(`[${code}]: lang json file does not exist: ${code}.json`);
      }

      const svgFile = svg.endsWith(".svg") ? svg : `${svg}.svg`;
      const flagPath = path.join(flagDir, svgFile);
      if (!fs.existsSync(flagPath)) {
        errors.push(`[${code}]: SVG file does not exist: ${svgFile}`);
      }
    }

    if (errors.length > 0) {
      console.error(
        "Metadata lang or SVG file check failed:\n" + errors.join("\n"),
      );
      expect(errors).toEqual([]);
    }
  });
});
