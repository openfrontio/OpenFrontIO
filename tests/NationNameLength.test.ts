import fs from "fs";
import { globSync } from "glob";

type Nation = {
  name?: string;
};

type Manifest = {
  nations?: Nation[];
};

describe("Map manifests: nation name length constraint", () => {
  test("All nations' names must be ≤ 27 characters", () => {
    const manifestPaths = globSync("resources/maps/**/manifest.json");

    expect(manifestPaths.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const manifestPath of manifestPaths) {
      try {
        const raw = fs.readFileSync(manifestPath, "utf8");
        const manifest = JSON.parse(raw) as Manifest;

        (manifest.nations ?? []).forEach((nation, idx) => {
          const name = nation?.name;
          if (typeof name !== "string") {
            violations.push(
              `${manifestPath} -> nations[${idx}].name is not a string`,
            );
            return;
          }
          if (name.length > 27) {
            violations.push(
              `${manifestPath} -> nations[${idx}].name "${name}" has length ${name.length} (> 27)`,
            );
          }
        });
      } catch (err) {
        violations.push(
          `Failed to parse ${manifestPath}: ${(err as Error).message}`,
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        "Nation name length violations:\n" + violations.join("\n"),
      );
    }
  });
});
