import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isOnCrazyGames, isDesktopShell } = vi.hoisted(() => ({
  isOnCrazyGames: vi.fn(() => false),
  isDesktopShell: vi.fn(() => false),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames },
}));
vi.mock("../../src/client/DesktopShell", () => ({ isDesktopShell }));
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));

import { PurchaseNudgeModal } from "../../src/client/components/PurchaseNudgeModal";

function fireUserMe(adfree: boolean | null) {
  const detail = adfree === null ? false : { player: { adfree } };
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
}

describe("purchase-nudge-modal", () => {
  let el: PurchaseNudgeModal;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem("gamesPlayed", "51");
    isOnCrazyGames.mockReturnValue(false);
    isDesktopShell.mockReturnValue(false);
    window.location.hash = "";
    if (!customElements.get("purchase-nudge-modal")) {
      customElements.define("purchase-nudge-modal", PurchaseNudgeModal);
    }
    el = document.createElement("purchase-nudge-modal") as PurchaseNudgeModal;
    document.body.appendChild(el);
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
    vi.restoreAllMocks();
  });

  async function shown(): Promise<boolean> {
    await el.updateComplete;
    return el.querySelector('[role="dialog"]') !== null;
  }

  it("shows on load for a long-time non-adfree player and records it", async () => {
    fireUserMe(false);
    expect(await shown()).toBe(true);
    expect(localStorage.getItem("purchaseNudgeShown")).toBe("1");
  });

  it("shows for logged-out players", async () => {
    fireUserMe(null);
    expect(await shown()).toBe(true);
  });

  it("never shows again once it has been shown", async () => {
    localStorage.setItem("purchaseNudgeShown", "1");
    fireUserMe(false);
    expect(await shown()).toBe(false);
  });

  it("stays hidden until the player passes 50 games", async () => {
    localStorage.setItem("gamesPlayed", "50");
    fireUserMe(false);
    expect(await shown()).toBe(false);
    expect(localStorage.getItem("purchaseNudgeShown")).toBeNull();
  });

  it("stays hidden for ad-free players and latches the shown flag", async () => {
    fireUserMe(true);
    expect(await shown()).toBe(false);
    expect(localStorage.getItem("purchaseNudgeShown")).toBe("1");
  });

  it("does not nudge an ad-free player who later logs out", async () => {
    fireUserMe(true);
    fireUserMe(null);
    expect(await shown()).toBe(false);
  });

  it("stays hidden on CrazyGames", async () => {
    isOnCrazyGames.mockReturnValue(true);
    fireUserMe(false);
    expect(await shown()).toBe(false);
  });

  it("stays hidden in the desktop shell, which never shows ads", async () => {
    isDesktopShell.mockReturnValue(true);
    fireUserMe(false);
    expect(await shown()).toBe(false);
    expect(localStorage.getItem("purchaseNudgeShown")).toBeNull();
  });

  it("opens the store and closes", async () => {
    fireUserMe(false);
    expect(await shown()).toBe(true);
    (el.querySelector("o-button") as HTMLElement).click();
    await el.updateComplete;
    expect(window.location.hash).toBe("#modal=store");
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes only via the X, not by clicking the backdrop", async () => {
    fireUserMe(false);
    expect(await shown()).toBe(true);
    (el.firstElementChild as HTMLElement).click();
    await el.updateComplete;
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    (
      el.querySelector(
        'button[aria-label="purchase_nudge.close"]',
      ) as HTMLButtonElement
    ).click();
    await el.updateComplete;
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    // A later profile refresh must not bring it back.
    fireUserMe(false);
    expect(await shown()).toBe(false);
  });
});
