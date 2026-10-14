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
