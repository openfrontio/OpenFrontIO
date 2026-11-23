import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STEAM_AWARDS_DISMISSED_KEY,
  STEAM_AWARDS_NOMINATIONS_END,
  steamAwardsBannerShown,
} from "../../../src/client/components/SteamAwardsBanner";

const before = STEAM_AWARDS_NOMINATIONS_END - 60_000;

describe("steamAwardsBannerShown", () => {
  it("shows in the Steam app while nominations are open", () => {
    expect(steamAwardsBannerShown(true, false, before)).toBe(true);
  });

  it("never shows outside the Steam app", () => {
    expect(steamAwardsBannerShown(false, false, before)).toBe(false);
  });

  it("stays closed once the player closes it", () => {
    expect(steamAwardsBannerShown(true, true, before)).toBe(false);
  });

  it("is gone once nominations close", () => {
    expect(
      steamAwardsBannerShown(true, false, STEAM_AWARDS_NOMINATIONS_END),
    ).toBe(false);
  });

  it("closes at 10am Pacific on 30 November 2026", () => {
    expect(new Date(STEAM_AWARDS_NOMINATIONS_END).toISOString()).toBe(
      "2026-11-30T18:00:00.000Z",
    );
  });
});

describe("<steam-awards-banner>", () => {
  beforeEach(() => {
    localStorage.clear();
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
    const link = el.querySelector("a");
    expect(link?.href).toBe(
      "https://store.steampowered.com/news/app/3560670/view/711166768421274599",
    );
    expect(link?.target).toBe("_blank");
  });

  it.runIf(open)("closes for good when dismissed", async () => {
    const el = await mount();
    let fired = false;
    document.body.addEventListener("steam-awards-dismissed", () => {
      fired = true;
    });
    el.querySelector<HTMLButtonElement>("[data-steam-awards-dismiss]")!.click();
    expect(fired).toBe(true);
    expect(localStorage.getItem(STEAM_AWARDS_DISMISSED_KEY)).toBe("1");
    const again = await mount();
    expect(again.querySelector("[data-steam-awards-banner]")).toBeNull();
  });

  it("renders nothing on the web", async () => {
    window.openfrontDesktop = undefined;
    const el = await mount();
    expect(el.querySelector("[data-steam-awards-banner]")).toBeNull();
  });
});
