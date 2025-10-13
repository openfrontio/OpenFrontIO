import fs from "fs";
import path from "path";

describe("Lang SVG Field and File Existence Check", () => {
  const langRoot = path.join(__dirname, "../resources/lang");
  const flagDir = path.join(__dirname, "../resources/flags");

  test("each main.json has a valid lang.svg and the SVG file exists", () => {
    const dirs = fs
      .readdirSync(langRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    if (dirs.length === 0) {
      console.log(
        "No resources/lang/<code>/ directories found. Skipping check.",
      );
      return;
    }

    const errors: string[] = [];

    for (const entry of dirs) {
      const mainPath = path.join(langRoot, entry.name, "main.json");
      if (!fs.existsSync(mainPath)) continue; // allow dirs without main.json
      try {
        const jsonData = JSON.parse(fs.readFileSync(mainPath, "utf-8"));
        const langSvg = jsonData.lang?.svg;
        if (typeof langSvg !== "string" || langSvg.length === 0) {
          errors.push(
            `[${entry.name}/main.json]: lang.svg is missing or not a non-empty string`,
          );
          continue;
        }

        const svgFile = langSvg.endsWith(".svg") ? langSvg : `${langSvg}.svg`;
        const flagPath = path.join(flagDir, svgFile);

        if (!fs.existsSync(flagPath)) {
          errors.push(
            `[${entry.name}/main.json]: SVG file does not exist: ${svgFile}`,
          );
        }
      } catch (err) {
        errors.push(
          `[${entry.name}/main.json]: Exception occurred - ${(err as Error).message}`,
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
