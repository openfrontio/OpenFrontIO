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
});
