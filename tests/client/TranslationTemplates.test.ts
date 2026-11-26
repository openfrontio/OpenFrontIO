import { afterEach, describe, expect, it } from "vitest";

import { translationTemplates } from "../../src/client/Utils";

// A stand-in for <lang-selector>: Utils finds it in the document and reads
// its loaded languages.
function langSelector(
  translations: Record<string, string> | undefined,
  defaultTranslations: Record<string, string>,
  currentLang = "fr",
) {
  const el = Object.assign(document.createElement("lang-selector"), {
    translations,
    defaultTranslations,
    currentLang,
  });
  document.body.appendChild(el);
  return el;
}

describe("translationTemplates", () => {
  afterEach(() => document.body.replaceChildren());

  it("gives every key under the prefix, in the player's language over English, unformatted", () => {
    langSelector(
      { "clan_map.claim_land": "Revendiquer", "other.key": "x" },
      {
        "clan_map.claim_land": "Claim land",
        "clan_map.tip_claim": "Claim it for {troops} troops",
        "other.key": "y",
      },
    );
    expect(translationTemplates("clan_map.")).toEqual({
      claim_land: "Revendiquer",
      tip_claim: "Claim it for {troops} troops",
    });
  });

  it("in debug mode gives each key's own full name, as translateText shows it", () => {
    langSelector(
      undefined,
      {
        "clan_map.claim_land": "Claim land",
        "clan_map.tip_claim": "Claim it for {troops} troops",
        "other.key": "y",
      },
      "debug",
    );
    expect(translationTemplates("clan_map.")).toEqual({
      claim_land: "clan_map.claim_land",
      tip_claim: "clan_map.tip_claim",
    });
  });
});
