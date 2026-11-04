import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  creativeAttributes,
  findStrayAdFrames,
  resetAdForensics,
  trackAdCreatives,
} from "../../src/client/AdForensics";
import type { SlotRenderEndedEvent } from "../../src/client/GoogleTag";

const railPath = "/154013155/1025558-w:75940-bottom_rail";

let onRender: (event: SlotRenderEndedEvent) => void;

function render(
  slotElementId: string,
  adUnitPath: string,
  extra: Partial<SlotRenderEndedEvent> = {},
  targeting: Record<string, string> = {},
): void {
  onRender({
    slot: {
      getSlotElementId: () => slotElementId,
      getAdUnitPath: () => adUnitPath,
      getTargeting: (key) => (key in targeting ? [targeting[key]] : []),
    },
    isEmpty: false,
    size: [728, 90],
    creativeId: 111,
    lineItemId: 222,
    advertiserId: 333,
    campaignId: 444,
    ...extra,
  });
}

function placeFrame(
  parent: Element,
  id: string,
  width = 728,
  height = 90,
  containerId = "",
) {
  const frame = document.createElement("iframe");
  frame.id = id;
  if (containerId !== "") {
    frame.setAttribute("data-google-container-id", containerId);
  }
  frame.getBoundingClientRect = () =>
    new DOMRect(100, window.innerHeight - height, width, height);
  parent.appendChild(frame);
  return frame;
}

beforeEach(() => {
  resetAdForensics();
  const cmd: Array<() => void> = [];
  window.googletag = {
    cmd,
    pubads: () => ({
      setTargeting: () => {},
      addEventListener: (_type, listener) => (onRender = listener),
    }),
  };
  trackAdCreatives();
  cmd.splice(0).forEach((fn) => fn());
});

afterEach(() => {
  document.body.replaceChildren();
  delete window.googletag;
});

describe("creativeAttributes", () => {
  it("names the creative whose GAM iframe is inside the element", () => {
    const rail = document.body.appendChild(document.createElement("div"));
    rail.id = "rail-slot";
    placeFrame(rail, `google_ads_iframe_${railPath}_0`, 728, 90, "7");
    render(
      "rail-slot",
      railPath,
      {},
      {
        hb_bidder: "rubicon",
        hb_adid: "3f2a",
        hb_adomain: "example.com",
      },
    );
    render("other-slot", "/154013155/1025558-w:75940-left_rail", {
      creativeId: 999,
    });

    expect(creativeAttributes(rail)).toEqual({
      creativeMatch: "frame",
      creativeId: "111",
      lineItemId: "222",
      advertiserId: "333",
      campaignId: "444",
      bidder: "rubicon",
      bidId: "3f2a",
      advertiserDomain: "example.com",
    });
  });

  it("is unsure of a frame a later load of the unit could have reused", () => {
    const slot = document.body.appendChild(document.createElement("div"));
    slot.id = "rail-slot";
    const frame = placeFrame(
      slot,
      `google_ads_iframe_${railPath}_0`,
      728,
      90,
      "1",
    );
    render("rail-slot", railPath, { creativeId: 1 });
    frame.setAttribute("data-google-container-id", "2");
    render("rail-slot", railPath, { creativeId: 2 });
    slot.remove();
    const stale = document.body.appendChild(document.createElement("div"));
    placeFrame(stale, `google_ads_iframe_${railPath}_0`, 728, 90, "1");

    expect(creativeAttributes(stale)).toMatchObject({
      creativeMatch: "frame",
      creativeId: "1",
    });
    stale.firstElementChild?.removeAttribute("data-google-container-id");
    expect(creativeAttributes(stale)).toMatchObject({
      creativeMatch: "path",
      creativeId: "2",
    });
  });

  it("does not take a longer unit's frame for a shorter unit's", () => {
    render("rail-slot", railPath, { creativeId: 1 });
    const other = document.body.appendChild(document.createElement("div"));
    placeFrame(other, `google_ads_iframe_${railPath}_bar_0`);

    expect(creativeAttributes(other).creativeMatch).toBe("none");
  });

  it("prefers the source-agnostic ids, which backfill fills in", () => {
    render("rail-slot", railPath, {
      creativeId: null,
      lineItemId: null,
      sourceAgnosticCreativeId: 555,
      sourceAgnosticLineItemId: 666,
    });
    const slot = document.body.appendChild(document.createElement("div"));
    slot.id = "rail-slot";

    expect(creativeAttributes(slot)).toMatchObject({
      creativeMatch: "slot",
      creativeId: "555",
      lineItemId: "666",
    });
  });

  it("falls back to the newest render of the unit, and says so", () => {
    render("rail-slot", railPath, { creativeId: 1 });
    render("rail-slot", railPath, { creativeId: 2 });
    const empty = document.body.appendChild(document.createElement("div"));

    expect(creativeAttributes(empty, "bottom_rail")).toMatchObject({
      creativeMatch: "unit",
      creativeId: "2",
    });
    expect(creativeAttributes(empty)).toMatchObject({
      creativeMatch: "none",
      creativeId: "",
    });
  });

  it("ignores empty renders", () => {
    render("rail-slot", railPath, { isEmpty: true });
    const empty = document.body.appendChild(document.createElement("div"));

    expect(creativeAttributes(empty, "bottom_rail").creativeMatch).toBe("none");
  });
});

describe("findStrayAdFrames", () => {
  it("reports an ad-sized iframe drawn straight onto the page", () => {
    render("rail-slot", railPath);
    const overlay = document.body.appendChild(document.createElement("div"));
    overlay.id = "takeover";
    overlay.style.position = "fixed";
    const frame = placeFrame(overlay, "creative");
    frame.src = "https://ads.example.net/creative.html?id=1";

    const stray = findStrayAdFrames();

    expect(stray).toHaveLength(1);
    expect(stray[0].root).toBe(overlay);
    expect(stray[0].attributes).toMatchObject({
      element: "div",
      elementId: "takeover",
      position: "fixed",
      frameId: "creative",
      frameOrigin: "https://ads.example.net",
      frameRect: `100,${window.innerHeight - 90},728,90`,
      creativeMatch: "none",
      recentCreatives: `${railPath}|728x90|111|222|333|||`,
    });
  });

  it("keeps the rail in the recent creatives after other units render", () => {
    render("rail-slot", railPath, { creativeId: 1 });
    render("rail-slot", railPath, { creativeId: 2 });
    for (const unit of ["left1", "left3", "left4"]) {
      render(unit, `/154013155/1025558-w:75940-${unit}`, { creativeId: 9 });
    }
    const overlay = document.body.appendChild(document.createElement("div"));
    placeFrame(overlay, "creative");

    const recent = findStrayAdFrames()[0].attributes.recentCreatives.split(";");

    expect(recent).toHaveLength(4);
    expect(recent[3]).toBe(`${railPath}|728x90|2|222|333|||`);
  });

  it("still knows the rail's creative after a long game of refreshes", () => {
    render("rail-slot", railPath, { creativeId: 2 });
    for (let i = 0; i < 40; i++) {
      render("left1", "/154013155/1025558-w:75940-left1", { creativeId: i });
    }
    const empty = document.body.appendChild(document.createElement("div"));
    const overlay = document.body.appendChild(document.createElement("div"));
    placeFrame(overlay, "creative");

    expect(creativeAttributes(empty, "bottom_rail")).toMatchObject({
      creativeMatch: "unit",
      creativeId: "2",
    });
    expect(findStrayAdFrames()[0].attributes.recentCreatives).toContain(
      `${railPath}|728x90|2|`,
    );
  });

  it("leaves our own UI and Playwire's containers alone", () => {
    customElements.define("stray-test-hud", class extends HTMLElement {});
    const hud = document.body.appendChild(
      document.createElement("stray-test-hud"),
    );
    placeFrame(hud.appendChild(document.createElement("div")), "ours");
    const rail = document.body.appendChild(document.createElement("div"));
    rail.id = "pw-oop-bottom_rail";
    placeFrame(rail, "rail");
    const corner = document.body.appendChild(document.createElement("div"));
    corner.className = "pw-corner-ad-video";
    placeFrame(corner, "corner");

    expect(findStrayAdFrames()).toEqual([]);
  });

  it("reports a small unit hanging half off the bottom of the screen", () => {
    const overlay = document.body.appendChild(document.createElement("div"));
    const frame = placeFrame(overlay, "half");
    frame.getBoundingClientRect = () =>
      new DOMRect(0, window.innerHeight - 25, 320, 50);

    expect(findStrayAdFrames()).toHaveLength(1);
  });

  it("skips frames too small or off screen to be an ad on display", () => {
    const strip = placeFrame(document.body, "strip");
    strip.getBoundingClientRect = () => new DOMRect(0, 0, 3840, 1);
    placeFrame(document.body, "pixel", 1, 1);
    const offscreen = placeFrame(document.body, "parked");
    offscreen.getBoundingClientRect = () => new DOMRect(-1000, -1000, 728, 90);

    expect(findStrayAdFrames()).toEqual([]);
  });
});
