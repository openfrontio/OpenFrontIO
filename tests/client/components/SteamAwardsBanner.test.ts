import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STEAM_AWARDS_NOMINATIONS_END,
  steamAwardsBannerShown,
} from "../../../src/client/components/SteamAwardsBanner";

const before = STEAM_AWARDS_NOMINATIONS_END - 60_000;

describe("steamAwardsBannerShown", () => {
  it("shows in the Steam app while nominations are open", () => {
    expect(steamAwardsBannerShown(true, before)).toBe(true);
  });

  it("never shows outside the Steam app", () => {
    expect(steamAwardsBannerShown(false, before)).toBe(false);
  });

  it("is gone once nominations close", () => {
    expect(steamAwardsBannerShown(true, STEAM_AWARDS_NOMINATIONS_END)).toBe(
      false,
    );
  });

  it("closes at 10am Pacific on 30 November 2026", () => {
    expect(new Date(STEAM_AWARDS_NOMINATIONS_END).toISOString()).toBe(
      "2026-11-30T18:00:00.000Z",
    );
  });
});

describe("<steam-awards-banner>", () => {
  beforeEach(() => {
    window.openfrontDesktop = { steam: {} };
  });

  afterEach(() => {
    window.openfrontDesktop = undefined;
    document.body.innerHTML = "";
  });

  async function mount() {
    const el = document.createElement("steam-awards-banner");
    document.body.appendChild(el);
    await (el as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;
    return el;
  }

  // Nominations close on 30 Nov 2026; after that the banner renders nothing
  // whatever the platform, so these only run while it is open.
  const open = Date.now() < STEAM_AWARDS_NOMINATIONS_END;

  it.runIf(open)("links to the nomination post", async () => {
    const el = await mount();
    const link = el.querySelector<HTMLAnchorElement>(
      "a[data-steam-awards-banner]",
    );
    expect(link?.href).toBe(
      "https://store.steampowered.com/news/app/3560670/view/711166768421274599",
    );
    expect(link?.target).toBe("_blank");
  });

  it.runIf(open)("can't be closed", async () => {
    const el = await mount();
    expect(el.querySelector("[data-steam-awards-banner]")).toBeTruthy();
    expect(el.querySelector("button")).toBeNull();
  });

  it("renders nothing on the web", async () => {
    window.openfrontDesktop = undefined;
    const el = await mount();
    expect(el.querySelector("[data-steam-awards-banner]")).toBeNull();
  });
});
