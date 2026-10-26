import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/HomepagePromos";
import type { HomepagePromos } from "../../src/client/HomepagePromos";
import { hideMenuChrome, restoreMenuChrome } from "../../src/client/MenuChrome";

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
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function renderRail(): HTMLElement {
    const rail = document.createElement("div");
    rail.id = "pw-oop-bottom_rail";
    document.body.appendChild(rail);
    return rail;
  }

  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    document.getElementById("pw-oop-bottom_rail")?.remove();
    error.mockRestore();
  });

  it("destroys a rail that finishes rendering after the destroy", async () => {
    const { ramp, drain } = stubRamp();
    promos.loadBottomRail();
    drain();
    promos.destroyBottomRail();
    await flush();

    renderRail();
    await flush();

    expect(ramp.destroyUnits).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("removes the rail itself when destroyUnits leaves it on the page", async () => {
    stubRamp();
    promos.loadBottomRail();
    promos.destroyBottomRail();

    const rail = renderRail();
    await flush();

    expect(rail.isConnected).toBe(false);
  });

  it("removes the rail when destroyUnits rejects", async () => {
    const { ramp } = stubRamp();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ramp.destroyUnits.mockImplementation(() =>
      Promise.reject(new Error("unknown unit")),
    );
    promos.loadBottomRail();
    promos.destroyBottomRail();

    const rail = renderRail();
    await flush();

    expect(rail.isConnected).toBe(false);
    warn.mockRestore();
  });

  it("does not report a rail that its own destroy removes", async () => {
    const { ramp, drain } = stubRamp();
    const rail = renderRail();
    ramp.destroyUnits.mockImplementation(() => {
      rail.remove();
      return Promise.resolve();
    });
    promos.loadBottomRail();
    drain();
    promos.destroyBottomRail();
    // An unrelated in-game DOM change while the destroy is in flight.
    document.body.appendChild(document.createElement("div"));
    await flush();

    expect(ramp.destroyUnits).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("leaves the rail of the next lobby alone", async () => {
    const { ramp, drain } = stubRamp();
    promos.loadBottomRail();
    promos.destroyBottomRail();
    promos.loadBottomRail();
    drain();

    const rail = renderRail();
    await flush();

    expect(rail.isConnected).toBe(true);
    expect(ramp.destroyUnits).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
});
