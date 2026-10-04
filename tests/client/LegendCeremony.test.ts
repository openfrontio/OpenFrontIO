import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import {
  LEGEND_CEREMONY_MS,
  LEGEND_IDLE_MS,
  LegendCeremony,
  legendCeremonySeen,
  markLegendCeremonySeen,
} from "../../src/client/components/LegendCeremony";
import type { ProfileShare } from "../../src/client/components/ProfileShare";
import { playerProfileUrl } from "../../src/client/utilities/PlayerProfileUrl";

if (!customElements.get("legend-ceremony")) {
  customElements.define("legend-ceremony", LegendCeremony);
}

const MOMENT = {
  lifetimeXp: 2106720,
  at: new Date("2026-10-03T12:00:00Z"),
  publicId: "wonder01",
};

describe("<legend-ceremony>", () => {
  let ceremony: LegendCeremony;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    ceremony = document.createElement("legend-ceremony") as LegendCeremony;
    document.body.appendChild(ceremony);
    await ceremony.updateComplete;
  });

  afterEach(() => {
    ceremony.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const q = <T extends Element = HTMLElement>(sel: string) =>
    document.body.querySelector<T>(sel);
  const root = () => q("[data-legend-ceremony]");
  const beat = () => root()?.dataset.beat;
  async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await ceremony.updateComplete;
  }
  const comb = () => q<SVGElement>("[data-legend-ceremony] .lc-honeycomb")!;

  it("plays its beats in order", async () => {
    ceremony.show(MOMENT);
    await settle();
    expect(beat()).toBe("intro");
    expect(document.activeElement).toBe(root());
    // The P10 emblem at level 99.
    const badge = () =>
      q<HTMLElement & { level: number; prestige: number }>(
        "[data-legend-ceremony] .lc-emblem level-badge",
      )!;
    expect(badge().level).toBe(99);
    expect(badge().prestige).toBe(10);

    await settle(500);
    expect(beat()).toBe("charge");
    expect(q(".lc-charge")).not.toBeNull();
    expect(comb().classList.contains("lc-hx-charge")).toBe(true);
    expect(q(".lc-rays")!.classList.contains("lc-rays-charge")).toBe(true);

    await settle(2100);
    expect(beat()).toBe("implode");
    expect(q(".lc-implode")).not.toBeNull();
    expect(q(".lc-pinpoint")).not.toBeNull();

    await settle(250);
    expect(beat()).toBe("descend");
    expect(q("[data-legend-crown]")!.classList.contains("lc-crown-drop")).toBe(
      true,
    );
    expect(badge().level).toBe(100);

    await settle(850);
    expect(beat()).toBe("impact");
    // The flash, two shockwaves, the shake and the gold wave.
    expect(q(".lc-flash:not(.lc-flash-small)")).not.toBeNull();
    expect(document.body.querySelectorAll(".lc-shock")).toHaveLength(2);
    expect(q(".lc-world")!.classList.contains("lc-shake")).toBe(true);
    expect(comb().classList.contains("lc-hx-burst")).toBe(true);
    expect(q(".lc-rays")!.classList.contains("lc-rays-burst")).toBe(true);
    expect(q("[data-legend-title]")).toBeNull();

    await settle(1300);
    expect(beat()).toBe("title");
    expect(q("[data-legend-title]")!.textContent).toContain(
      "progression.legend",
    );
    await settle(100);
    // Landed: the shockwaves and the shake are over.
    expect(document.body.querySelectorAll(".lc-shock")).toHaveLength(0);
    expect(q(".lc-world")!.classList.contains("lc-shake")).toBe(false);

    await settle(500);
    expect(beat()).toBe("line");
    const line = q("[data-legend-line]")!.textContent!;
    expect(line).toContain("legend_ceremony.top_of_track");
    // The XP in bold, inside its translated phrase.
    expect(q("[data-legend-line] b")!.textContent).toBe(
      (2106720).toLocaleString(),
    );
    expect(line).toContain("legend_ceremony.lifetime_xp");
    expect(line).toContain("2026");

    await settle(800);
    expect(beat()).toBe("done");
    expect(document.activeElement).toBe(q("[data-legend-continue]"));
    expect(comb().classList.contains("lc-hx-idle")).toBe(true);
    expect(root()!.hasAttribute("data-skipped")).toBe(false);
  });

  it("holds the honeycomb still after a while at rest", async () => {
    ceremony.show(MOMENT);
    await settle(LEGEND_CEREMONY_MS);
    expect(comb().classList.contains("lc-hx-frozen")).toBe(false);
    await settle(LEGEND_IDLE_MS);
    expect(comb().classList.contains("lc-hx-frozen")).toBe(true);
  });

  it("skips to the end on a click", async () => {
    ceremony.show(MOMENT);
    await settle(1000);
    root()!.click();
    await settle();
    expect(beat()).toBe("done");
    expect(root()!.hasAttribute("data-skipped")).toBe(true);
    expect(q("[data-legend-continue]")).not.toBeNull();
    expect(q("[data-legend-title]")).not.toBeNull();
    // Nothing left to play on top of the end state.
    await settle(LEGEND_CEREMONY_MS);
    expect(beat()).toBe("done");
    expect(q(".lc-flash")).toBeNull();
  });

  it("skips on any key, and keeps keys from the page behind", async () => {
    const page = vi.fn();
    window.addEventListener("keydown", page);
    try {
      ceremony.show(MOMENT);
      await settle(300);
      root()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true }),
      );
      await settle();
      expect(beat()).toBe("done");
      expect(page).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", page);
    }
  });

  it("Escape skips first, then closes", async () => {
    const closed = vi.fn();
    ceremony.addEventListener("legend-ceremony-closed", closed);
    ceremony.show(MOMENT);
    await settle(300);
    const escape = () =>
      root()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    escape();
    await settle();
    expect(beat()).toBe("done");
    expect(closed).not.toHaveBeenCalled();
    escape();
    await settle();
    expect(root()).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(ceremony.isOpen).toBe(false);
  });

  it("closes on Continue", async () => {
    const closed = vi.fn();
    ceremony.addEventListener("legend-ceremony-closed", closed);
    ceremony.show(MOMENT);
    await settle(LEGEND_CEREMONY_MS);
    q<HTMLButtonElement>("[data-legend-continue]")!.click();
    await settle();
    expect(root()).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("shows the end state at once under reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({ matches: query.includes("reduce") })),
    );
    ceremony.show(MOMENT);
    await settle();
    expect(beat()).toBe("done");
    expect(root()!.hasAttribute("data-skipped")).toBe(true);
    expect(q("[data-legend-continue]")).not.toBeNull();
    expect(q(".lc-flash")).toBeNull();
  });

  describe("the share row", () => {
    const share = () => q("[data-legend-share]");
    const shareEl = () => q<ProfileShare>("[data-legend-share] profile-share");

    it("comes in at the end, between the line and Continue", async () => {
      ceremony.show(MOMENT);
      await settle(LEGEND_CEREMONY_MS - 1);
      expect(beat()).toBe("line");
      expect(share()).toBeNull();
      await settle(1);
      expect(beat()).toBe("done");
      const row = share()!;
      expect(row).not.toBeNull();
      const line = q("[data-legend-line]")!;
      const cont = q("[data-legend-continue]")!;
      expect(
        line.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        row.compareDocumentPosition(cont) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // Simply there: no rise or fade of its own.
      expect(row.classList.contains("lc-rise")).toBe(false);
      expect(row.classList.contains("lc-final-in")).toBe(false);
      // Continue still takes the focus.
      expect(document.activeElement).toBe(cont);
    });

    it("shares the player's Legend moment, solid and centred", async () => {
      ceremony.show(MOMENT);
      await settle(LEGEND_CEREMONY_MS);
      const el = shareEl()!;
      expect(el.url).toBe(`${playerProfileUrl("wonder01")}?moment=legend`);
      expect(el.text).toBe("progression.share_text_legend");
      expect(el.solid).toBe(true);
      expect(el.centered).toBe(true);
      await el.updateComplete;
      expect(el.querySelectorAll("button[data-share]").length).toBeGreaterThan(
        0,
      );
    });

    it("is there at once when skipped", async () => {
      ceremony.show(MOMENT);
      await settle(1000);
      root()!.click();
      await settle();
      expect(share()).not.toBeNull();
    });

    it("keeps its clicks from the ceremony", async () => {
      const closed = vi.fn();
      ceremony.addEventListener("legend-ceremony-closed", closed);
      ceremony.show(MOMENT);
      await settle(LEGEND_CEREMONY_MS);
      const reached = vi.fn();
      root()!.addEventListener("click", reached);
      share()!.click();
      await settle();
      expect(reached).not.toHaveBeenCalled();
      expect(root()).not.toBeNull();
      expect(closed).not.toHaveBeenCalled();
    });

    it("isn't there without a public ID", async () => {
      ceremony.show({ ...MOMENT, publicId: "" });
      await settle(LEGEND_CEREMONY_MS);
      expect(beat()).toBe("done");
      expect(share()).toBeNull();
      expect(q("[data-legend-continue]")).not.toBeNull();
    });

    it("Tab moves between the share buttons and Continue", async () => {
      ceremony.show(MOMENT);
      await settle(LEGEND_CEREMONY_MS);
      await shareEl()!.updateComplete;
      const buttons = [
        ...root()!.querySelectorAll<HTMLButtonElement>("button"),
      ];
      const cont = q<HTMLButtonElement>("[data-legend-continue]")!;
      expect(buttons[buttons.length - 1]).toBe(cont);
      expect(buttons.length).toBeGreaterThan(1);
      const tab = (shiftKey = false) =>
        root()!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }),
        );
      expect(document.activeElement).toBe(cont);
      tab();
      expect(document.activeElement).toBe(buttons[0]);
      tab(true);
      expect(document.activeElement).toBe(cont);
      tab(true);
      expect(document.activeElement).toBe(buttons[buttons.length - 2]);
      // Still open: Tab never closes or leaves it.
      expect(root()).not.toBeNull();
    });
  });

  it("ignores a second show while it's up", async () => {
    ceremony.show(MOMENT);
    await settle(1000);
    ceremony.show({ ...MOMENT, lifetimeXp: 1 });
    await settle();
    expect(
      document.body.querySelectorAll("[data-legend-ceremony]"),
    ).toHaveLength(1);
    expect(beat()).toBe("charge");
  });

  it("goes when it's taken off the page", async () => {
    ceremony.show(MOMENT);
    await settle(1000);
    ceremony.remove();
    expect(root()).toBeNull();
  });
});

describe("Legend ceremony seen flag", () => {
  beforeEach(() => localStorage.clear());

  it("is per account", () => {
    expect(legendCeremonySeen("wonder01")).toBe(false);
    markLegendCeremonySeen("wonder01");
    expect(legendCeremonySeen("wonder01")).toBe(true);
    expect(legendCeremonySeen("someone-else")).toBe(false);
  });

  it("treats storage that throws as not seen", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => markLegendCeremonySeen("wonder01")).not.toThrow();
    expect(legendCeremonySeen("wonder01")).toBe(false);
    vi.restoreAllMocks();
  });
});
