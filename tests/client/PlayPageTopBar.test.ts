import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isOnCrazyGames } = vi.hoisted(() => ({
  isOnCrazyGames: vi.fn(() => false),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames,
    // <username-input> mounts with the page and asks the SDK for a name.
    getUsername: vi.fn(async () => null),
    getUserProfile: vi.fn(async () => null),
    addAuthListener: vi.fn(),
  },
}));
vi.mock("../../src/core/AssetUrls", () => ({
  assetUrl: (path: string) => path,
}));

// Rendering play-page mounts its children too (steam-wishlist, cosmetic
// background, …), and some reach for browser APIs jsdom doesn't ship.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import { PlayPage } from "../../src/client/components/PlayPage";

describe("play-page mobile top bar", () => {
  let el: PlayPage;

  async function mount() {
    if (!customElements.get("play-page")) {
      customElements.define("play-page", PlayPage);
    }
    el = document.createElement("play-page") as PlayPage;
    document.body.appendChild(el);
    await el.updateComplete;
  }

  afterEach(() => {
    el?.remove();
    vi.clearAllMocks();
    isOnCrazyGames.mockReturnValue(false);
  });

  const rightSlot = () =>
    Array.from(el.querySelector(".col-start-3")!.children).map((c) =>
      c.tagName.toLowerCase(),
    );

  describe("off CrazyGames", () => {
    beforeEach(mount);

    it("puts the bell/help icons beside the profile menu", () => {
      expect(rightSlot()).toEqual(["nav-utility-icons", "nav-account-menu"]);
    });
  });

  describe("on CrazyGames", () => {
    beforeEach(async () => {
      isOnCrazyGames.mockReturnValue(true);
      await mount();
    });

    it("keeps CrazyGames' own account button, still driveable by id", () => {
      // News and Help left the hamburger, so the icons have to be here for
      // CrazyGames players too — and the account button keeps the id
      // CrazyGamesAccountButton looks up.
      expect(rightSlot()).toEqual(["nav-utility-icons", "button"]);
      const button = el.querySelector("#crazygames-account-btn");
      expect(button).not.toBeNull();
      expect(
        button!.querySelector("#crazygames-account-avatar"),
      ).not.toBeNull();
      expect(button!.querySelector("#crazygames-account-icon")).not.toBeNull();
      expect(el.querySelector("nav-account-menu")).toBeNull();
    });
  });
});
