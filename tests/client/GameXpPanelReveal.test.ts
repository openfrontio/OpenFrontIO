import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import "../../src/client/components/GameXpPanel";
import type { GameXpPanel } from "../../src/client/components/GameXpPanel";
import type { GameXpEligible } from "../../src/core/ApiSchemas";

const data: GameXpEligible = {
  gameId: "g1",
  eligible: true,
  breakdown: {
    leftEarly: false,
    played: 50,
    time: 20,
    placement: 0,
    win: 100,
    firstGame: 0,
    feats: 0,
    subtotal: 170,
    gamePermille: 1000,
    subscriberPermille: 1000,
    total: 170,
  },
  before: { prestige: 0, level: 4, xpInLevel: 100, xpForNext: 400 },
  after: {
    prestige: 0,
    level: 4,
    xpInLevel: 270,
    xpForNext: 400,
    lifetimeXp: 2000,
    legend: false,
    canPrestige: false,
  },
  levelsReached: [],
};

describe("game-xp-panel reveal polish", () => {
  let panel: GameXpPanel;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    panel?.remove();
    vi.useRealTimers();
  });

  async function mount(view: GameXpPanel["view"]): Promise<void> {
    panel = document.createElement("game-xp-panel") as GameXpPanel;
    panel.view = view;
    document.body.appendChild(panel);
    await panel.updateComplete;
  }

  async function step(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await panel.updateComplete;
  }

  const fill = () => panel.querySelector<HTMLElement>("[data-xp-bar-fill]")!;

  it("lights the bar's leading edge only while it fills", async () => {
    await mount({ kind: "result", data });
    expect(fill().classList.contains("xp-bar-filling")).toBe(false);
    // Into the first source's climb.
    let filling = false;
    for (let i = 0; i < 40 && !filling; i++) {
      await step(25);
      filling = fill().classList.contains("xp-bar-filling");
    }
    expect(filling).toBe(true);
    // The fill and its edge move together: the class rides with the width
    // transition.
    expect(fill().classList.contains("transition-[width]")).toBe(true);
    // Once the reveal is over, the bar rests without it.
    await step(20_000);
    expect(panel.querySelector("[data-xp-revealing]")).toBeNull();
    expect(fill().classList.contains("xp-bar-filling")).toBe(false);
  });

  it("draws the edge and sheen as pseudo-elements, off under reduced motion", async () => {
    await mount({ kind: "result", data });
    const css = panel.querySelector("style")!.textContent!;
    expect(css).toContain(".xp-bar-filling::after");
    expect(css).toContain(".xp-bar-filling::before");
    // The sheen moves by transform, not by background-position.
    const sheen = css.slice(css.indexOf("@keyframes xp-bar-sheen"));
    expect(sheen.slice(0, sheen.indexOf("}") + 1)).toContain("transform");
    const reduced = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain(".xp-bar-filling::before");
    expect(reduced).toContain(".xp-bar-filling::after");
  });

  it("holds the calculating spinner still under reduced motion", async () => {
    await mount({ kind: "calculating" });
    const spinner = panel.querySelector(".animate-spin")!;
    expect(spinner.classList.contains("motion-reduce:animate-none")).toBe(true);
  });
});
