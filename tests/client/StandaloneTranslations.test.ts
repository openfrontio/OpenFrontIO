import {
  setStandaloneTranslations,
  translateText,
} from "../../src/client/Utils";

// Own file: the standalone translations are module state, and every other
// test relies on translateText falling back to the key.
describe("setStandaloneTranslations", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    (translateText as unknown as { langSelector?: unknown }).langSelector =
      undefined;
  });

  test("before any are set, keys come back as keys", () => {
    expect(translateText("store.preview_error")).toBe("store.preview_error");
  });

  test("without a <lang-selector>, they translate, ICU plurals included", () => {
    setStandaloneTranslations({
      "store.preview_error": "Failed to load in-game preview.",
      "store.preview_salvo_count":
        "{count, plural, one {Single (x#)} other {Salvo (x#)}}",
    });
    expect(translateText("store.preview_error")).toBe(
      "Failed to load in-game preview.",
    );
    expect(translateText("store.preview_salvo_count", { count: 5 })).toBe(
      "Salvo (x5)",
    );
    expect(translateText("store.unknown_key")).toBe("store.unknown_key");
  });

  test("a <lang-selector> in the page still wins", () => {
    setStandaloneTranslations({ "store.preview_error": "standalone" });
    const selector = Object.assign(document.createElement("lang-selector"), {
      currentLang: "en",
      translations: undefined,
      defaultTranslations: { "store.preview_error": "from the game" },
    });
    document.body.append(selector);
    expect(translateText("store.preview_error")).toBe("from the game");
  });
});
