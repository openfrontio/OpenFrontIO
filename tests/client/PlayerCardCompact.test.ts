import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import { CardBackground } from "../../src/client/components/card/CardBackground";
import { PlayerCard } from "../../src/client/components/card/PlayerCard";
import type { PlayerCardView } from "../../src/client/components/card/PlayerCardModel";

// The player panel's card: size "panel", one strip with badge, flag, clan
// tag, name, prestige and level, and the trackers, over a still background.

if (!customElements.get("player-card")) {
  customElements.define("player-card", PlayerCard);
}
if (!customElements.get("card-background")) {
  customElements.define("card-background", CardBackground);
}

const VIEW: PlayerCardView = {
  username: "Volt",
  clanTag: "UN",
  flag: "/flags/gb.svg",
  badge: { level: 42, prestige: 3, legend: false },
  background: {
    name: "bg_frontline",
    url: "/cosmetics/bg_frontline.webp",
    rarity: "legendary",
    animation: { layers: [] },
  },
  trackers: [
    { stat: "wins", value: 1204 },
    { stat: "best_elo", value: 1840 },
    { stat: "games_played", value: 38912 },
  ],
};

async function mount(
  view: PlayerCardView,
  props: Partial<PlayerCard> = {},
): Promise<PlayerCard> {
  const el = document.createElement("player-card") as PlayerCard;
  el.view = view;
  el.size = "panel";
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe("player card: compact panel layout", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("puts badge, flag, clan, name, level and trackers in one row", async () => {
    const el = await mount(VIEW);
    const section = el.querySelector('[data-player-card="panel"]')!;
    expect(section).not.toBeNull();
    const row = section.querySelector("[data-card-row]")!;
    expect(row.className).toContain("flex");
    expect(row.className).not.toContain("flex-col");
    expect(row.className).not.toContain("flex-wrap");
    const badge = row.querySelector("level-badge") as HTMLElement & {
      size: number;
    };
    expect(badge.size).toBe(28);
    expect(row.querySelector("[data-card-flag]")).not.toBeNull();
    expect(row.querySelector("[data-profile-clan]")?.textContent).toContain(
      "UN",
    );
    expect(row.querySelector("[data-profile-name]")?.textContent).toContain(
      "Volt",
    );
    expect(row.querySelector("[data-profile-level-line]")).not.toBeNull();
    const trackers = row.querySelectorAll("[data-card-tracker]");
    expect(trackers).toHaveLength(3);
    // Short numbers, so three fit beside the name.
    expect(trackers[2].textContent).toContain("38.9k");
  });

  it("keeps the name in view at panel width: level under the name, labels truncate", async () => {
    const el = await mount(VIEW);
    // Name and level share one column that takes the free width, so three
    // trackers can't squeeze the name to nothing (as a ~320px panel row did).
    const name = el.querySelector("[data-profile-name]")!;
    const level = el.querySelector("[data-profile-level-line]")!;
    const column = name.closest(".flex-1")!;
    expect(column.contains(level)).toBe(true);
    expect(name.className).toContain("truncate");
    for (const t of el.querySelectorAll("[data-card-tracker]")) {
      expect(t.className).toContain("max-w-");
      expect(t.lastElementChild!.className).toContain("truncate");
    }
  });

  it("never truncates the level line: the trackers give way first", async () => {
    const el = await mount(VIEW);
    const level = el.querySelector<HTMLElement>("[data-profile-level-line]")!;
    // Measured in a real browser: at 1366 and 390 the panel's row is too
    // narrow for name, level and three trackers, and the level line was cut
    // to "PRESTIGE 3 · LEV…". Two lines still, nothing wraps.
    const wrapper = level.parentElement!;
    expect(wrapper.className).not.toMatch(/(^|\s)truncate(\s|$)/);
    expect(wrapper.className).not.toContain(
      "[&_[data-profile-level-line]]:truncate",
    );
    expect(wrapper.className).toContain("whitespace-nowrap");
    // The column is at least as wide as the level line...
    const column = el.querySelector("[data-profile-name]")!.closest(".flex-1")!;
    expect(column.className).toContain("min-w-fit");
    // ...the name row doesn't set that width (it still truncates)...
    const nameRow = el.querySelector("[data-profile-name]")!.parentElement!;
    expect(nameRow.className).toContain("w-0");
    expect(nameRow.className).toContain("min-w-full");
    // ...and the trackers shrink instead, their labels truncating.
    const trackers = el.querySelector("[data-card-trackers-inline]")!;
    expect(trackers.className).not.toContain("shrink-0");
    expect(trackers.className).toContain("min-w-0");
    for (const t of el.querySelectorAll("[data-card-tracker]")) {
      expect(t.className).toContain("min-w-0");
    }
  });

  it("is never animated, even if asked", async () => {
    const el = await mount(VIEW, { animated: true });
    const bg = el.querySelector("card-background") as CardBackground;
    expect(bg.animated).toBe(false);
  });

  it("keeps the rarity border and the name truncating", async () => {
    const el = await mount(VIEW);
    const section = el.querySelector("[data-player-card]")!;
    expect(section.getAttribute("data-card-rarity")).toBe("legendary");
    const name = el.querySelector("[data-profile-name]")!;
    expect(name.className).toContain("truncate");
  });

  it("without a level or trackers it still renders the name", async () => {
    const el = await mount({ ...VIEW, badge: null, trackers: [] });
    expect(el.querySelector("level-badge")).toBeNull();
    expect(el.querySelector("[data-profile-level-line]")).toBeNull();
    expect(el.querySelector("[data-card-tracker]")).toBeNull();
    expect(el.querySelector("[data-profile-name]")?.textContent).toContain(
      "Volt",
    );
  });
});
