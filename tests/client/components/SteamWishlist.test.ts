import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/SteamSDK", () => ({
  steamSDK: { isOnSteam: () => false },
}));
vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

import "../../../src/client/components/SteamWishlist";
import type { SteamWishlist } from "../../../src/client/components/SteamWishlist";
import "../../../src/client/components/SteamWishlistButton";
import { gamePortal } from "../../../src/client/GamePortal";

describe("steam-wishlist", () => {
  it("gives the widget's iframe Steam's light color scheme on the dark page", async () => {
    const el = document.createElement("steam-wishlist") as SteamWishlist;
    el.campaign = "test";
    document.body.appendChild(el);
    try {
      await el.updateComplete;
      const iframe = el.querySelector("iframe");
      expect(iframe).not.toBeNull();
      // A scheme differing from the embedded page's paints a white backdrop.
      expect(iframe!.style.colorScheme).toBe("light");
    } finally {
      el.remove();
    }
  });

  // Poki doesn't allow promoting other platforms. CrazyGames allows a store
  // link only on the desktop main menu: the footer strip, not the widget.
  it.each([
    ["steam-wishlist", "poki", false],
    ["steam-wishlist", "crazygames", false],
    ["steam-wishlist-button", "poki", false],
    ["steam-wishlist-button", "crazygames", true],
  ] as const)("%s on %s shows: %s", async (tag, portal, shown) => {
    const name = vi.spyOn(gamePortal, "name").mockReturnValue(portal);
    const onPortal = vi
      .spyOn(gamePortal, "isOnGamePortal")
      .mockReturnValue(true);
    const el = document.createElement(tag) as SteamWishlist;
    document.body.appendChild(el);
    try {
      await el.updateComplete;
      expect(el.querySelector("iframe, a") !== null).toBe(shown);
    } finally {
      el.remove();
      name.mockRestore();
      onPortal.mockRestore();
    }
  });
});
