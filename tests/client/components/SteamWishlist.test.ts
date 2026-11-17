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
    // Throws like the browser's, so observing nothing fails the test.
    observe(target: unknown) {
      if (!(target instanceof Element)) {
        throw new TypeError("parameter 1 is not of type 'Element'.");
      }
    }
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

  // Poki doesn't allow promoting other platforms.
  it.each(["steam-wishlist", "steam-wishlist-button"])(
    "%s renders nothing on Poki",
    async (tag) => {
      const name = vi.spyOn(gamePortal, "name").mockReturnValue("poki");
      const el = document.createElement(tag) as SteamWishlist;
      document.body.appendChild(el);
      try {
        await el.updateComplete;
        expect(el.querySelector("iframe, a")).toBeNull();
      } finally {
        el.remove();
        name.mockRestore();
      }
    },
  );

  // The Steam app has nothing to wishlist, and the Android app must not send
  // the player to another store.
  it.each([
    ["steam-wishlist", { steam: {} }],
    ["steam-wishlist-button", { steam: {} }],
    ["steam-wishlist", { shell: { platform: "android" } }],
    ["steam-wishlist-button", { shell: { platform: "android" } }],
  ])("%s renders nothing inside %j", async (tag, shell) => {
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = shell;
    const el = document.createElement(tag) as SteamWishlist;
    document.body.appendChild(el);
    try {
      await el.updateComplete;
      expect(el.querySelector("iframe, a")).toBeNull();
    } finally {
      el.remove();
      delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
    }
  });
});
