import { beforeEach, describe, expect, it, vi } from "vitest";
import { SteamLinkSignpost } from "../../src/client/SteamLinkSignpost";
import { steamSDK } from "../../src/client/SteamSDK";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("SteamLinkSignpost", () => {
  it("is visible on first Steam launch, hidden after dismiss", () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    const el = new SteamLinkSignpost();
    expect(el.shouldShow()).toBe(true);
    el.dismiss();
    expect(localStorage.getItem("steam_link_signpost_seen")).toBe("1");
    expect(el.shouldShow()).toBe(false);
  });

  it("never shows off Steam", () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(false);
    expect(new SteamLinkSignpost().shouldShow()).toBe(false);
  });
});
