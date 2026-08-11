import { beforeEach, describe, expect, it, vi } from "vitest";
import { FLAG_KEY, PATTERN_KEY } from "../../src/core/game/UserSettings";
import { completeCosmeticPurchaseReturn } from "../../src/client/Cosmetics";

describe("completeCosmeticPurchaseReturn", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(PATTERN_KEY, "pattern:old");
    localStorage.setItem(FLAG_KEY, "country:us");
  });

  it("reports a completed purchase without changing the loadout", () => {
    const actions = {
      strip: vi.fn(),
      alertAndStrip: vi.fn(),
      openTokenLogin: vi.fn(),
      refreshStore: vi.fn(),
    };

    completeCosmeticPurchaseReturn("pattern:new", null, actions);

    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "purchase succeeded: pattern:new",
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
