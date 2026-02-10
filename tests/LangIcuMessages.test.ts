import fs from "fs";
import IntlMessageFormat from "intl-messageformat";
import path from "path";

type NestedTranslations = Record<string, unknown>;

function flattenTranslations(
  obj: NestedTranslations,
  file: string,
  parentKey = "",
  result: Record<string, string> = {},
  errors: string[] = [],
): Record<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;
    if (typeof value === "string") {
      result[fullKey] = value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenTranslations(
        value as NestedTranslations,
        file,
        fullKey,
        result,
        errors,
      );
      continue;
    }
    errors.push(
      `${file}:${fullKey} has invalid type ${Array.isArray(value) ? "array" : typeof value}`,
    );
  }
  return result;
}

describe("Language ICU messages", () => {
  const languageDir = path.join(process.cwd(), "resources", "lang");

  test("all translation strings are valid ICU messages", () => {
    const files = fs
      .readdirSync(languageDir)
      .filter((file) => file.endsWith(".json") && file !== "metadata.json")
      .sort();

    const errors: string[] = [];

    for (const file of files) {
      const fullPath = path.join(languageDir, file);
      let raw: string;
      try {
        raw = fs.readFileSync(fullPath, "utf-8");
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        errors.push(`${file}: failed to read file (${details})`);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        errors.push(`${file}: invalid JSON (${details})`);
        continue;
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push(`${file}: root must be an object`);
        continue;
      }

      const flat = flattenTranslations(
        parsed as NestedTranslations,
        file,
        "",
        {},
        errors,
      );

      for (const [key, message] of Object.entries(flat)) {
        try {
          new IntlMessageFormat(message, "en");
        } catch (error) {
          const details =
            error instanceof Error ? error.message : String(error);
          errors.push(`${file}:${key} has invalid ICU syntax (${details})`);
        }
      }
    }

    if (errors.length > 0) {
      console.error("ICU translation validation failed:\n" + errors.join("\n"));
    }
    expect(errors).toEqual([]);
  });
});
