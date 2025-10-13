import fs from "fs";
import path from "path";

describe("LangCode Directory Check", () => {
  const langRoot = path.join(__dirname, "../resources/lang");

  test("lang.lang_code matches directory name", () => {
    const entries = fs
      .readdirSync(langRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    if (entries.length === 0) {
      console.log(
        "No resources/lang/<code>/ directories found. Skipping check.",
      );
      return;
    }

    for (const entry of entries) {
      const dir = path.join(langRoot, entry.name);
      const mainPath = path.join(dir, "main.json");
      if (!fs.existsSync(mainPath)) continue; // allow auxiliary dirs
      const jsonData = JSON.parse(fs.readFileSync(mainPath, "utf-8"));
      const langCode = jsonData.lang?.lang_code;
      expect(entry.name).toBe(langCode);
    }
  });
});
