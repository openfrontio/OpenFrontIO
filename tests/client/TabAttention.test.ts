// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

vi.mock("../../src/client/UserSettings", () => ({
  UserSettings: class {
    tabAttention() {
      return true;
    }
  },
}));

import { TabAttention } from "../../src/client/TabAttention";

const ORIGINAL_HREF = "/images/Favicon.svg";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function iconHref(): string | null {
  return document.querySelector('link[rel~="icon"]')!.getAttribute("href");
}

describe("TabAttention", () => {
  let attention: TabAttention;
  let enabled = true;

  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = `<link rel="icon" type="image/svg+xml" href="${ORIGINAL_HREF}" />`;
    document.title = "OpenFront";
    setHidden(false);
    enabled = true;
    attention = new TabAttention(() => enabled);
  });

  afterEach(() => {
    attention.release();
    vi.useRealTimers();
  });

  it("does nothing while the tab is visible", () => {
    attention.request("spawn");
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe("OpenFront");
    expect(iconHref()).toBe(ORIGINAL_HREF);
  });

  it("alternates title and icon while the tab is hidden", () => {
    setHidden(true);
    attention.request("spawn");
    expect(document.title).toBe("tab_attention.pick_spawn");
    expect(iconHref()).not.toBe(ORIGINAL_HREF);

    vi.advanceTimersByTime(250);
    expect(document.title).toBe("OpenFront");
    expect(iconHref()).toBe(ORIGINAL_HREF);

    vi.advanceTimersByTime(250);
    expect(document.title).toBe("tab_attention.pick_spawn");
  });

  it("uses the starting message before the spawn phase", () => {
    setHidden(true);
    attention.request("starting");
    expect(document.title).toBe("tab_attention.starting");
  });

  it("restores the title and icon when the tab becomes visible", () => {
    setHidden(true);
    attention.request("spawn");
    setHidden(false);
    expect(document.title).toBe("OpenFront");
    expect(iconHref()).toBe(ORIGINAL_HREF);
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe("OpenFront");
  });

  it("resumes when the player leaves again while still needed", () => {
    attention.request("spawn");
    setHidden(true);
    expect(document.title).toBe("tab_attention.pick_spawn");
  });

  it("stops and restores on release", () => {
    setHidden(true);
    attention.request("spawn");
    attention.release();
    expect(document.title).toBe("OpenFront");
    expect(iconHref()).toBe(ORIGINAL_HREF);
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe("OpenFront");
  });

  it("gives up after two minutes", () => {
    setHidden(true);
    attention.request("spawn");
    vi.advanceTimersByTime(2 * 60 * 1000 + 500);
    expect(document.title).toBe("OpenFront");
    expect(iconHref()).toBe(ORIGINAL_HREF);
  });

  it("does not restart the two-minute limit on repeated requests", () => {
    setHidden(true);
    attention.request("spawn");
    vi.advanceTimersByTime(2 * 60 * 1000 + 500);
    expect(document.title).toBe("OpenFront");
    // A game tick asks again; it must stay stopped.
    attention.request("spawn");
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe("OpenFront");
    expect(iconHref()).toBe(ORIGINAL_HREF);
  });

  it("does not use up the limit while the tab is visible", () => {
    attention.request("spawn");
    // Waiting in a visible tab for longer than the limit, with game ticks.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(60 * 1000);
      attention.request("spawn");
    }
    setHidden(true);
    expect(document.title).toBe("tab_attention.pick_spawn");
    vi.advanceTimersByTime(2 * 60 * 1000 + 500);
    expect(document.title).toBe("OpenFront");
  });

  it("still flashes for a spawn request after the starting flash timed out", () => {
    setHidden(true);
    attention.request("starting");
    vi.advanceTimersByTime(2 * 60 * 1000 + 500);
    expect(document.title).toBe("OpenFront");

    // Same kind stays ignored (no restart from repeated requests)...
    attention.request("starting");
    expect(document.title).toBe("OpenFront");

    // ...but a different need gets its own two minutes.
    attention.request("spawn");
    expect(document.title).toBe("tab_attention.pick_spawn");
    vi.advanceTimersByTime(2 * 60 * 1000 + 500);
    expect(document.title).toBe("OpenFront");
  });

  it("allows a new two-minute period after the need is released", () => {
    setHidden(true);
    attention.request("spawn");
    vi.advanceTimersByTime(2 * 60 * 1000 + 500);
    attention.release();
    attention.request("spawn");
    expect(document.title).toBe("tab_attention.pick_spawn");
  });

  it("does nothing when the setting is off", () => {
    enabled = false;
    setHidden(true);
    attention.request("spawn");
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe("OpenFront");
    expect(iconHref()).toBe(ORIGINAL_HREF);
  });

  it("stops and restores if the setting is switched off mid-flash", () => {
    setHidden(true);
    attention.request("spawn");
    expect(document.title).toBe("tab_attention.pick_spawn");
    enabled = false;
    vi.advanceTimersByTime(250);
    expect(document.title).toBe("OpenFront");
    expect(iconHref()).toBe(ORIGINAL_HREF);
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe("OpenFront");
  });

  it("flashes again once the setting is switched back on", () => {
    enabled = false;
    setHidden(true);
    attention.request("spawn");
    expect(document.title).toBe("OpenFront");
    enabled = true;
    attention.request("spawn");
    expect(document.title).toBe("tab_attention.pick_spawn");
  });
});
