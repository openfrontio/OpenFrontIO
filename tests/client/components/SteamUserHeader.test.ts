import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SteamUserHeader } from "../../../src/client/components/baseComponents/stats/SteamUserHeader";
import type { SteamUser } from "../../../src/core/ApiSchemas";

// Mock translateText as identity so fallback-key assertions are exact.
vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

describe("SteamUserHeader", () => {
  let header: SteamUserHeader;

  beforeEach(async () => {
    if (!customElements.get("steam-user-header")) {
      customElements.define("steam-user-header", SteamUserHeader);
    }
    header = document.createElement("steam-user-header") as SteamUserHeader;
    document.body.appendChild(header);
    await header.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(header);
  });

  it("renders the persona name and an <img> with the avatar src for a full profile", async () => {
    const profile: SteamUser = {
      steamId: "76561198000000001",
      personaName: "SnugglePuppy",
      avatarUrl: "https://cdn/x.jpg",
    };
    header.data = profile;
    await header.updateComplete;

    expect(header.textContent).toContain("SnugglePuppy");
    const img = header.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("https://cdn/x.jpg");
  });

  it("falls back to the default name and renders no <img> for a null profile", async () => {
    const profile: SteamUser = {
      steamId: "76561198000000002",
      personaName: null,
      avatarUrl: null,
    };
    header.data = profile;
    await header.updateComplete;

    expect(header.textContent).toContain("steam_user_header.default_name");
    expect(header.querySelector("img")).toBeNull();
  });

  it("falls back to the default name for an empty-string persona name", async () => {
    const profile: SteamUser = {
      steamId: "76561198000000003",
      personaName: "",
      avatarUrl: "https://cdn/x.jpg",
    };
    header.data = profile;
    await header.updateComplete;

    expect(header.textContent).toContain("steam_user_header.default_name");
  });

  it("hides the <img> once it fires an error event", async () => {
    const profile: SteamUser = {
      steamId: "76561198000000004",
      personaName: "SnugglePuppy",
      avatarUrl: "https://cdn/x.jpg",
    };
    header.data = profile;
    await header.updateComplete;

    const img = header.querySelector("img");
    expect(img).toBeTruthy();
    img!.dispatchEvent(new Event("error"));
    await header.updateComplete;

    expect(header.querySelector("img")).toBeNull();
    // The name should still render even without the avatar.
    expect(header.textContent).toContain("SnugglePuppy");
  });

  it("resets _avatarError on a new `data` assignment, re-rendering the <img>", async () => {
    const first: SteamUser = {
      steamId: "76561198000000005",
      personaName: "SnugglePuppy",
      avatarUrl: "https://cdn/x.jpg",
    };
    header.data = first;
    await header.updateComplete;

    const img = header.querySelector("img");
    img!.dispatchEvent(new Event("error"));
    await header.updateComplete;
    expect(header.querySelector("img")).toBeNull();

    // A fresh profile (new object, distinct avatar) should clear the error
    // state and let the avatar render again — this locks in the deliberate
    // reset in the `data` setter (see SteamUserHeader.ts).
    const second: SteamUser = {
      steamId: "76561198000000006",
      personaName: "AnotherPup",
      avatarUrl: "https://cdn/y.jpg",
    };
    header.data = second;
    await header.updateComplete;

    const newImg = header.querySelector("img");
    expect(newImg).toBeTruthy();
    expect(newImg?.getAttribute("src")).toBe("https://cdn/y.jpg");
  });
});
