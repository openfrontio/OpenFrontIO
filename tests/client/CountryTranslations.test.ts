import Countries from "../../src/client/data/countries.json";
import EnTranslations from "../../resources/lang/en.json";

function countryCodeToTranslationKey(countryCode: string): string {
  return countryCode
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

describe("Country Translations", () => {
  test("all countries in countries.json should have corresponding translation keys in en.json", () => {
    const missingTranslations: string[] = [];

    Countries.forEach((country) => {
      const normalizedKey = countryCodeToTranslationKey(country.code);
      const translationKey = `countries.${normalizedKey}`;
      if (!EnTranslations.countries[normalizedKey as keyof typeof EnTranslations.countries]) {
        missingTranslations.push(`Missing translation for "${country.code}" -> "${translationKey}"`);
      }
    });

    if (missingTranslations.length > 0) {
      throw new Error(
        `Found ${missingTranslations.length} missing country translations:\n` +
        missingTranslations.join("\n") +
        "\n\nPlease add the missing translations to resources/lang/en.json",
      );
    }
  });

  test("country code normalization should work correctly", () => {
    expect(countryCodeToTranslationKey("xx")).toBe("xx");
    expect(countryCodeToTranslationKey("Abbasid Caliphate")).toBe("abbasid_caliphate");
    expect(countryCodeToTranslationKey("sh-ac")).toBe("sh-ac");
    expect(countryCodeToTranslationKey("1_Airgialla")).toBe("1_airgialla");
    expect(countryCodeToTranslationKey("United States")).toBe("united_states");
    expect(countryCodeToTranslationKey("Côte d'Ivoire")).toBe("cte_divoire");
  });

  test("translation keys should have non-empty values", () => {
    const emptyTranslations: string[] = [];

    Object.entries(EnTranslations.countries).forEach(([key, value]) => {
      if (!value || value.trim() === "") {
        emptyTranslations.push(key);
      }
    });

    expect(emptyTranslations).toEqual([]);
  });
});
