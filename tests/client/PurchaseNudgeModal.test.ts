import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isOnCrazyGames } = vi.hoisted(() => ({
  isOnCrazyGames: vi.fn(() => false),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames },
}));
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));

import { PurchaseNudgeModal } from "../../src/client/hud/layers/PurchaseNudgeModal";
import type { GameView } from "../../src/client/view";

function fireUserMe(adfree: boolean | null) {
  const detail = adfree === null ? false : { player: { adfree } };
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
}

function makeGame(opts: { spawnPhase?: boolean; replay?: boolean } = {}) {
  return {
    inSpawnPhase: () => opts.spawnPhase ?? true,
    config: () => ({ isReplay: () => opts.replay ?? false }),
  } as unknown as GameView;
}

describe("purchase-nudge-modal", () => {
  let el: PurchaseNudgeModal;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem("gamesPlayed", "51");
    isOnCrazyGames.mockReturnValue(false);
    if (!customElements.get("purchase-nudge-modal")) {
      customElements.define("purchase-nudge-modal", PurchaseNudgeModal);
    }
    el = document.createElement("purchase-nudge-modal") as PurchaseNudgeModal;
    el.game = makeGame();
    document.body.appendChild(el);
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
    vi.restoreAllMocks();
  });

  async function shown(): Promise<boolean> {
    el.tick();
    await el.updateComplete;
    return el.querySelector('[role="dialog"]') !== null;
  }

  it("shows once in the spawn phase for a long-time non-adfree player", async () => {
    fireUserMe(false);
    expect(await shown()).toBe(true);
    expect(localStorage.getItem("purchaseNudgeShown")).toBe("1");
  });

  it("shows for logged-out players (they cannot be ad-free)", async () => {
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

  it("stays hidden for ad-free players", async () => {
    fireUserMe(true);
    expect(await shown()).toBe(false);
  });

  it("stays hidden until the profile is known", async () => {
    expect(await shown()).toBe(false);
    fireUserMe(false);
    expect(await shown()).toBe(true);
  });

  it("stays hidden on CrazyGames", async () => {
    isOnCrazyGames.mockReturnValue(true);
    fireUserMe(false);
    expect(await shown()).toBe(false);
  });

  it("stays hidden outside the spawn phase and in replays", async () => {
    fireUserMe(false);
    el.game = makeGame({ spawnPhase: false });
    expect(await shown()).toBe(false);
    el.game = makeGame({ replay: true });
    expect(await shown()).toBe(false);
  });

  it("closes on its own when the spawn phase ends", async () => {
    fireUserMe(false);
    expect(await shown()).toBe(true);
    el.game = makeGame({ spawnPhase: false });
    expect(await shown()).toBe(false);
  });

  it("opens the store in a new tab and closes", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    fireUserMe(false);
    expect(await shown()).toBe(true);
    (el.querySelector("o-button") as HTMLElement).click();
    await el.updateComplete;
    expect(open).toHaveBeenCalledWith("/#modal=store", "_blank", "noopener");
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes on 'maybe later' without reopening", async () => {
    fireUserMe(false);
    expect(await shown()).toBe(true);
    (el.querySelector("button") as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(await shown()).toBe(false);
  });
});
