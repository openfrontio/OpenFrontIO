import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/HomepagePromos";
import type { HomepagePromos } from "../../src/client/HomepagePromos";
import { hideMenuChrome, restoreMenuChrome } from "../../src/client/MenuChrome";
import { reportEvent } from "../../src/client/Telemetry";

vi.mock("../../src/client/Telemetry", () => ({ reportEvent: vi.fn() }));

// The index.html stub before ramp.js loads: a queue and nothing else. drain()
// stands in for ramp.js arriving and running whatever was queued.
function stubRamp() {
  const que: Array<() => void> = [];
  const ramp = {
    que,
    spaAddAds: vi.fn(),
    destroyUnits: vi.fn(() => Promise.resolve()),
    addUnits: vi.fn(() => Promise.resolve()),
    displayUnits: vi.fn(),
  };
  (window as unknown as { ramp: unknown }).ramp = ramp;
  return {
    ramp,
    drain: () => que.splice(0).forEach((fn) => fn()),
  };
}

function addedTypes(ramp: ReturnType<typeof stubRamp>["ramp"]): string[] {
  return ramp.spaAddAds.mock.calls.flatMap(([ads]) =>
    (ads as Array<{ type: string }>).map((a) => a.type),
  );
}

function userMe(): void {
  document.dispatchEvent(new CustomEvent("userMeResponse", { detail: false }));
}

let promos: HomepagePromos;

beforeEach(() => {
  window.adsEnabled = true;
  promos = document.createElement("homepage-promos") as HomepagePromos;
  document.body.appendChild(promos);
});

afterEach(() => {
  promos.remove();
  restoreMenuChrome();
  delete (window as unknown as { ramp?: unknown }).ramp;
});

describe("HomepagePromos in a running game", () => {
  it("does not reload the homepage ads when userMeResponse fires mid-game", () => {
    const { ramp, drain } = stubRamp();
    promos.close();
    hideMenuChrome();

    userMe();
    drain();

    expect(ramp.spaAddAds).not.toHaveBeenCalled();
  });

  it("drops gutter ads queued before the game when ramp.js loads after it starts", () => {
    const { ramp, drain } = stubRamp();
    userMe();
    promos.close();
    hideMenuChrome();

    drain();

    expect(ramp.spaAddAds).not.toHaveBeenCalled();
  });

  it("loads the gutter ads again once the menu is restored", () => {
    const { ramp, drain } = stubRamp();
    promos.close();
    hideMenuChrome();
    userMe();

    restoreMenuChrome();
    drain();

    expect(addedTypes(ramp)).toEqual(["left_rail", "right_rail", "flex"]);
  });

  it("does not restore the gutter ads for an ad-free player", () => {
    const { ramp, drain } = stubRamp();
    window.adsEnabled = false;
    hideMenuChrome();

    restoreMenuChrome();
    drain();

    expect(ramp.spaAddAds).not.toHaveBeenCalled();
  });

  it("drops queued ads when the player turned out ad-free before ramp.js loaded", () => {
    const { ramp, drain } = stubRamp();
    userMe();
    promos.loadBottomRail();
    window.adsEnabled = false;

    drain();

    expect(ramp.spaAddAds).not.toHaveBeenCalled();
  });

  it("drops a queued bottom rail that was destroyed before ramp.js loaded", () => {
    const { ramp, drain } = stubRamp();
    promos.loadBottomRail();
    promos.destroyBottomRail();

    drain();

    expect(ramp.spaAddAds).not.toHaveBeenCalled();
  });
});

describe("HomepagePromos bottom rail after its destroy", () => {
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const slot =
    "/154013155/1025558-w:75940-bottom_rail/1025558-w:75940-bottom_rail-HP_0";

  function renderRail(): HTMLElement {
    const rail = document.createElement("div");
    rail.id = "pw-oop-bottom_rail";
    rail.className = "pw-tag pointer-modifier pw-size-728x90";
    const creative = document.createElement("iframe");
    creative.id = `google_ads_iframe_${slot}`;
    rail.appendChild(creative);
    document.body.appendChild(rail);
    return rail;
  }

  function joinLobby(): void {
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: { gameID: "cSkwPxCLWx", source: "public" },
      }),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(reportEvent).mockClear();
  });

  afterEach(() => {
    document.getElementById("pw-oop-bottom_rail")?.remove();
    vi.useRealTimers();
  });

  it("destroys and reports a rail that finishes rendering after the destroy", async () => {
    const { ramp, drain } = stubRamp();
    joinLobby();
    drain();
    promos.destroyBottomRail();
    await flush();

    const rail = renderRail();
    await flush();

    expect(ramp.destroyUnits).toHaveBeenCalledTimes(2);
    expect(rail.isConnected).toBe(false);
    expect(reportEvent).toHaveBeenCalledExactlyOnceWith("bottom_rail_in_game", {
      gameID: "cSkwPxCLWx",
      lobbySource: "public",
      secondsAfterDestroy: "0",
      size: "728x90",
      adSlot: slot,
      destroyUnits: "resolved",
      removedBy: "openfront",
      outcome: "removed",
    });
  });

  it("reports Playwire's removal when destroyUnits takes the rail away", async () => {
    const { ramp } = stubRamp();
    joinLobby();
    promos.destroyBottomRail();
    await flush();
    const rail = renderRail();
    ramp.destroyUnits.mockImplementation(() => {
      rail.remove();
      return Promise.resolve();
    });

    await flush();

    expect(reportEvent).toHaveBeenCalledWith(
      "bottom_rail_in_game",
      expect.objectContaining({ removedBy: "playwire", outcome: "removed" }),
    );
  });

  it("reports an unknown remover once the next lobby lifted the ban", async () => {
    const { ramp } = stubRamp();
    joinLobby();
    promos.destroyBottomRail();
    await flush();
    let settle = () => {};
    ramp.destroyUnits.mockImplementation(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );
    renderRail();
    await flush();

    joinLobby();
    settle();
    await flush();

    expect(reportEvent).toHaveBeenCalledExactlyOnceWith(
      "bottom_rail_in_game",
      expect.objectContaining({ removedBy: "unknown", outcome: "removed" }),
    );
    expect(document.getElementById("pw-oop-bottom_rail")).not.toBeNull();
  });

  it("reports an unknown remover when a later lobby came and went mid-destroy", async () => {
    const { ramp } = stubRamp();
    joinLobby();
    promos.destroyBottomRail();
    await flush();
    let settle = () => {};
    ramp.destroyUnits.mockImplementation(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );
    renderRail();
    await flush();

    joinLobby();
    promos.destroyBottomRail();
    settle();
    await vi.advanceTimersByTimeAsync(2000);

    expect(reportEvent).toHaveBeenCalledExactlyOnceWith(
      "bottom_rail_in_game",
      expect.objectContaining({ removedBy: "unknown", outcome: "removed" }),
    );
  });

  it("removes and reports the rail when destroyUnits rejects", async () => {
    const { ramp } = stubRamp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ramp.destroyUnits.mockImplementation(() =>
      Promise.reject(new Error("unknown unit")),
    );
    joinLobby();
    promos.destroyBottomRail();

    const rail = renderRail();
    await flush();

    expect(rail.isConnected).toBe(false);
    expect(reportEvent).toHaveBeenCalledWith(
      "bottom_rail_in_game",
      expect.objectContaining({ destroyUnits: "rejected" }),
    );
    warn.mockRestore();
  });

  it("reports a rail creative still on the page two seconds later", async () => {
    stubRamp();
    joinLobby();
    promos.destroyBottomRail();
    renderRail();
    await flush();
    const elsewhere = document.createElement("iframe");
    elsewhere.id = `google_ads_iframe_${slot}`;
    document.body.appendChild(elsewhere);

    await vi.advanceTimersByTimeAsync(2000);

    expect(reportEvent).toHaveBeenLastCalledWith(
      "bottom_rail_in_game",
      expect.objectContaining({ outcome: "still_visible", adSlot: slot }),
    );
    elsewhere.remove();
  });

  it("does not pin a later lobby's rail on this one's game", async () => {
    stubRamp();
    joinLobby();
    promos.destroyBottomRail();
    renderRail();
    await flush();

    joinLobby();
    promos.destroyBottomRail();
    await flush();
    const later = document.createElement("iframe");
    later.id = `google_ads_iframe_${slot}`;
    document.body.appendChild(later);
    await vi.advanceTimersByTimeAsync(2000);

    expect(reportEvent).not.toHaveBeenCalledWith(
      "bottom_rail_in_game",
      expect.objectContaining({ outcome: "still_visible" }),
    );
    later.remove();
  });

  it("does not report a rail that its own destroy removes", async () => {
    const { ramp, drain } = stubRamp();
    const rail = renderRail();
    ramp.destroyUnits.mockImplementation(() => {
      rail.remove();
      return Promise.resolve();
    });
    joinLobby();
    drain();
    promos.destroyBottomRail();
    // An unrelated in-game DOM change while the destroy is in flight.
    const unrelated = document.body.appendChild(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(2000);

    expect(ramp.destroyUnits).toHaveBeenCalledTimes(1);
    expect(reportEvent).not.toHaveBeenCalled();
    unrelated.remove();
  });

  it("leaves the rail of the next lobby alone", async () => {
    const { ramp, drain } = stubRamp();
    joinLobby();
    promos.destroyBottomRail();
    joinLobby();
    drain();

    const rail = renderRail();
    await vi.advanceTimersByTimeAsync(2000);

    expect(rail.isConnected).toBe(true);
    expect(ramp.destroyUnits).toHaveBeenCalledTimes(1);
    expect(reportEvent).not.toHaveBeenCalled();
  });
});
