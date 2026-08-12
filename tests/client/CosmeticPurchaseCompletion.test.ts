import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeCosmeticPurchaseReturn } from "../../src/client/Cosmetics";
import { FLAG_KEY, PATTERN_KEY } from "../../src/core/game/UserSettings";

describe("completeCosmeticPurchaseReturn", () => {
  let languageFixture: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(PATTERN_KEY, "pattern:old");
    localStorage.setItem(FLAG_KEY, "country:us");
    languageFixture = document.createElement("lang-selector");
    const translations = {
      "store.purchase_success": "Localized purchase: {name}",
    };
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
  });

  afterEach(() => languageFixture.remove());

  it("reports a completed purchase without changing the loadout", () => {
    const actions = {
      strip: vi.fn(),
      alertAndStrip: vi.fn(),
      openTokenLogin: vi.fn(),
      refreshStore: vi.fn(),
    };

    completeCosmeticPurchaseReturn("pattern:new", null, actions);

    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "Localized purchase: pattern:new",
    );
    expect(actions.refreshStore).toHaveBeenCalledOnce();
    expect(localStorage.getItem(PATTERN_KEY)).toBe("pattern:old");
    expect(localStorage.getItem(FLAG_KEY)).toBe("country:us");
  });

  it("starts token login without installing an equip-on-unload action", () => {
    const actions = {
      strip: vi.fn(),
      alertAndStrip: vi.fn(),
      openTokenLogin: vi.fn(),
      refreshStore: vi.fn(),
    };

    completeCosmeticPurchaseReturn("flag:new", "login-token", actions);

    expect(actions.strip).toHaveBeenCalledOnce();
    expect(actions.openTokenLogin).toHaveBeenCalledWith("login-token");
    expect(actions.alertAndStrip).not.toHaveBeenCalled();
    expect(actions.refreshStore).not.toHaveBeenCalled();
    expect(localStorage.getItem(PATTERN_KEY)).toBe("pattern:old");
    expect(localStorage.getItem(FLAG_KEY)).toBe("country:us");
  });
});
