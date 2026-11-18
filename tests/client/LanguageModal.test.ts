import { afterEach, describe, expect, it, vi } from "vitest";
import metadata from "../../resources/lang/metadata.json";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));

import { LanguageModal } from "../../src/client/LanguageModal";

describe("language coverage", () => {
  it("has a percentage for every language except English", () => {
    const codes = metadata.map((l) => l.code).filter((c) => c !== "en");
    expect(Object.keys(__LANG_COVERAGE__).sort()).toEqual(codes.sort());
    for (const percent of Object.values(__LANG_COVERAGE__)) {
      expect(Number.isInteger(percent)).toBe(true);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });
});

describe("language-modal", () => {
  let el: LanguageModal;

  afterEach(() => el.remove());

  it("shows the translated percentage for each language but English", async () => {
    if (!customElements.get("language-modal")) {
      customElements.define("language-modal", LanguageModal);
    }
    el = document.createElement("language-modal") as LanguageModal;
    el.inline = true;
    el.languageList = ["en", "fr"].map((code) => {
      const { native, en, svg } = metadata.find((l) => l.code === code)!;
      return { code, native, en, svg };
    });
    document.body.appendChild(el);
    await el.updateComplete;

    const buttons = [...el.querySelectorAll("button")].filter((b) =>
      b.querySelector("img"),
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).not.toContain("select_lang.translated");
    expect(buttons[1].textContent).toContain(
      `select_lang.translated {"percent":${__LANG_COVERAGE__.fr}}`,
    );
  });
});
