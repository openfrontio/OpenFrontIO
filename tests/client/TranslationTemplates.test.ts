import { afterEach, describe, expect, it } from "vitest";

import { translationTemplates } from "../../src/client/Utils";

// A stand-in for <lang-selector>: Utils finds it in the document and reads
// its loaded languages.
function langSelector(
  translations: Record<string, string> | undefined,
  defaultTranslations: Record<string, string>,
) {
  const el = Object.assign(document.createElement("lang-selector"), {
    translations,
    defaultTranslations,
    currentLang: "fr",
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
});
