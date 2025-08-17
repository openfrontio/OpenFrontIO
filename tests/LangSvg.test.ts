import fs from "fs";
import path from "path";

describe("Lang SVG Field and File Existence Check", () => {
  const langDir = path.join(__dirname, "../resources/lang");
  const flagDir = path.join(__dirname, "../resources/flags");

  test("each lang.json file has a valid lang.svg string and the SVG file exists", () => {
    const files = fs
      .readdirSync(langDir)
      .filter((file) => file.endsWith(".json"));

    if (files.length === 0) {
      console.log("No resources/lang/*.json files found. Skipping check.");
      return;
    }

    const errors: string[] = [];

    for (const file of files) {
      try {
        const filePath = path.join(langDir, file);
        const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const langSvg =
          jsonData &&
          typeof jsonData === "object" &&
          "lang" in jsonData &&
          jsonData.lang &&
          typeof jsonData.lang === "object" &&
          "svg" in jsonData.lang &&
          jsonData.lang.svg;
        if (typeof langSvg !== "string" || langSvg.length === 0) {
          errors.push(
            `[${file}]: lang.svg is missing or not a non-empty string`,
          );
          continue;
        }

        // Check if the SVG file exists in the flags directory
        const svgFile = langSvg.endsWith(".svg") ? langSvg : `${langSvg}.svg`;
        const flagPath = path.join(flagDir, svgFile);

        if (!fs.existsSync(flagPath)) {
          errors.push(`[${file}]: SVG file does not exist: ${svgFile}`);
        }
      } catch (err) {
        errors.push(
          `[${file}]: Exception occurred - ${(err as Error).message}`,
        );
      }
    }

    if (errors.length > 0) {
      console.error(
        "Lang SVG field or file check failed:\n" + errors.join("\n"),
      );
      expect(errors).toEqual([]);
    }
  });
});
