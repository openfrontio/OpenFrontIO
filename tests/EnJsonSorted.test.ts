import fs from "fs";
import path from "path";

const EN_JSON = path.join(__dirname, "..", "resources", "lang", "en.json");

/** Collect every object whose keys are out of order, as dotted paths. */
function findUnsortedObjects(value: unknown, objectPath: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  const errors: string[] = [];
  const keys = Object.keys(value);
  for (let i = 1; i < keys.length; i++) {
    if (keys[i - 1] > keys[i]) {
      errors.push(
        `${objectPath}: "${keys[i]}" should come before "${keys[i - 1]}"`,
      );
    }
  }
  for (const [key, child] of Object.entries(value)) {
    errors.push(...findUnsortedObjects(child, `${objectPath}.${key}`));
  }
  return errors;
}

// en.json keys are kept alphabetically sorted at every level. This keeps the
// file deterministic, gives translation PRs stable insertion points, and lets
// the map-generator rewrite it with a plain JSON round-trip (Go's
// encoding/json sorts object keys on marshal).
// Other language files are managed by Crowdin and are not checked.
test("en.json keys are alphabetically sorted at every level", () => {
  const content = JSON.parse(fs.readFileSync(EN_JSON, "utf8"));
  const errors = findUnsortedObjects(content, "en.json");
  if (errors.length > 0) {
    throw new Error(
      "en.json keys are out of order (sort with `jq -S . resources/lang/en.json` + prettier):\n" +
        errors.join("\n"),
    );
  }
});
