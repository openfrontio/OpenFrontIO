import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimReward, getUserMe, invalidateUserMe, fetchCosmetics, catalog } =
  vi.hoisted(() => ({
    claimReward: vi.fn(),
    getUserMe: vi.fn(),
    invalidateUserMe: vi.fn(),
    fetchCosmetics: vi.fn(async () => ({})),
    catalog: { entries: [] as unknown[] },
  }));

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock("../../src/client/Api", () => ({
  claimReward,
  getUserMe,
  invalidateUserMe,
}));

vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics,
  resolveCosmetics: vi.fn(() => catalog.entries),
}));

// The real preview draws the cosmetic; here it only has to exist.
vi.mock("../../src/client/components/CosmeticPreview", () => {
  class FakeCosmeticPreview extends HTMLElement {}
  if (!customElements.get("cosmetic-preview")) {
    customElements.define("cosmetic-preview", FakeCosmeticPreview);
  }
  return {};
});

import "../../src/client/components/GameXpPanel";
import type { GameXpPanel } from "../../src/client/components/GameXpPanel";
import { summarizeGameRewards } from "../../src/client/GameRewards";
import type {
  GameXpEligible,
  GameXpFlare,
  GameXpReward,
} from "../../src/core/ApiSchemas";

function reward(
  level: number,
  currencyType: "soft" | "hard",
  amount: number,
  extra: Partial<GameXpReward> = {},
): GameXpReward {
  return {
    prestige: 3,
    level,
    id: `rw${level}${currencyType}`,
    currencyType,
    amount: String(amount),
    reason: currencyType === "soft" ? "level_up" : "level_milestone",
    note: null,
    claimed: false,
    ...extra,
  };
}

const firebird: GameXpFlare = {
  kind: "level",
  prestige: 3,
  level: 50,
  flareId: "9",
  flareName: "effect:firebird_trail",
  cosmetic: { type: "effect", name: "firebird_trail", url: null },
};

// A game from `from` (most of the way through it) to `to`, crossing every
// level in between.
function game(
  from: number,
  to: number,
  extra: Partial<GameXpEligible> = {},
): GameXpEligible {
  const levelsReached = [];
  for (let l = from + 1; l <= to; l++)
    levelsReached.push({ prestige: 3, level: l });
  return {
    gameId: "wndrG4me1",
    eligible: true,
    breakdown: {
      leftEarly: false,
      played: 50,
      time: 280,
      placement: 90,
      win: 300,
      firstGame: 0,
      feats: 0,
      subtotal: 720,
      gamePermille: 1000,
      subscriberPermille: 1000,
      total: 720,
    },
    before: { prestige: 3, level: from, xpInLevel: 1700, xpForNext: 2000 },
    after: {
      prestige: 3,
      level: to,
      xpInLevel: 120,
      xpForNext: 2000,
      lifetimeXp: 132_600,
      legend: false,
      canPrestige: false,
    },
    levelsReached,
    ...extra,
  };
}

const single = () => game(46, 47, { rewards: [reward(47, "soft", 100)] });
const several = () =>
  game(44, 47, {
    rewards: [
      reward(45, "soft", 100),
      reward(46, "soft", 100),
      reward(47, "soft", 100),
    ],
  });
const milestone = (extra: Partial<GameXpEligible> = {}) =>
  game(49, 50, {
    rewards: [reward(50, "soft", 100), reward(50, "hard", 25)],
    flares: [firebird],
    ...extra,
  });

const me = (soft: number, hard: number) => ({
  user: { email: "wonder@example.com" },
  player: {
    publicId: "wonder01",
    currency: { soft, hard },
    rewards: [
      {
        id: "daily1",
        currencyType: "soft",
        amount: "50",
        reason: "subscription_daily",
        note: null,
      },
    ],
  },
});

describe("game-xp-panel level rewards", () => {
  let panel: GameXpPanel;

  beforeEach(() => {
    vi.useFakeTimers();
    claimReward.mockReset();
    getUserMe.mockReset();
    invalidateUserMe.mockReset();
    catalog.entries = [];
  });

  afterEach(() => {
    panel?.remove();
    vi.useRealTimers();
  });

  async function mount(
    data: GameXpEligible,
    opts: { compact?: boolean; reveal?: boolean } = {},
  ): Promise<void> {
    panel?.remove();
    panel = document.createElement("game-xp-panel") as GameXpPanel;
    panel.compact = opts.compact ?? false;
    panel.view = { kind: "result", data };
    document.body.appendChild(panel);
    await settle();
    // Most tests look at the final state: skip the reveal, as a player can.
    if (!opts.reveal && !panel.compact) {
      section().click();
      await settle();
    }
  }

  async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await panel.updateComplete;
  }

  const section = () => panel.querySelector<HTMLElement>("[data-xp-panel]")!;
  const row = () => panel.querySelector<HTMLElement>("[data-xp-rewards]");
  const text = (el: Element | null) =>
    el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const amounts = () =>
    [...panel.querySelectorAll("[data-xp-reward-amount]")].map((el) =>
      text(el),
    );
  const claimButton = () =>
    panel.querySelector<HTMLButtonElement>("[data-xp-claim] button");
  const revealing = () =>
    section().getAttribute("data-xp-revealing") === "true";

  it("shows the row for the server's result only", async () => {
    panel = document.createElement("game-xp-panel") as GameXpPanel;
    panel.view = { kind: "calculating" };
    document.body.appendChild(panel);
    await settle();
    expect(row()).toBeNull();
    // The past-game summary has no rewards row either.
    await mount(single(), { compact: true });
    expect(section().getAttribute("data-xp-state")).toBe("result");
    expect(row()).toBeNull();
    await mount(single());
    expect(row()).not.toBeNull();
    // A game that paid nothing has no row.
    await mount(game(46, 47));
    expect(row()).toBeNull();
  });

  it("names a single level's reward", async () => {
    await mount(single());
    expect(text(panel.querySelector("[data-xp-rewards-heading]"))).toBe(
      'progression.rewards_level_one:{"level":47}',
    );
    expect(amounts()).toEqual(["+100"]);
    expect(panel.querySelector("[data-xp-reward-each]")).toBeNull();
    expect(text(row())).toContain("cosmetics.soft");
    expect(text(claimButton())).toBe("account_modal.claim");
  });

  it("sums several levels' rewards, with how they add up", async () => {
    await mount(several());
    expect(text(panel.querySelector("[data-xp-rewards-heading]"))).toBe(
      'progression.rewards_levels:{"from":45,"to":47}',
    );
    expect(amounts()).toEqual(["+300"]);
    expect(text(panel.querySelector("[data-xp-reward-each]"))).toBe(
      'progression.rewards_each:{"count":3,"amount":"100"}',
    );
  });

  it("shows a milestone's Caps and Plutonium", async () => {
    await mount(milestone());
    expect(text(panel.querySelector("[data-xp-rewards-heading]"))).toBe(
      'progression.rewards_level_many:{"level":50}',
    );
    const lines = [...panel.querySelectorAll("[data-xp-reward]")].map((el) =>
      el.getAttribute("data-xp-reward"),
    );
    expect(lines).toEqual(["soft", "hard"]);
    expect(amounts()).toEqual(["+100", "+25"]);
    expect(text(row())).toContain("cosmetics.hard");
  });

  it("sums amounts exactly, past what a number can hold", () => {
    const summary = summarizeGameRewards([
      reward(50, "soft", 0, { amount: "9007199254740993" }),
      reward(51, "soft", 0, { amount: "9007199254740993", id: "x" }),
    ])!;
    expect(summary.lines[0].total).toBe(18014398509481986n);
    expect(summary.lines[0].each).toBe(9007199254740993n);
  });

  it("rises in after the last level-up, its amounts counting up", async () => {
    await mount(several(), { reveal: true });
    expect(revealing()).toBe(true);
    // Laid out but closed until the reveal gets there.
    expect(
      panel
        .querySelector("[data-xp-rewards]")!
        .closest("[data-xp-collapsible]")!
        .getAttribute("data-xp-collapsible"),
    ).toBe("closed");
    const seen = new Set<string>();
    let sawLevel47 = false;
    let openedAfter47 = false;
    for (let i = 0; i < 600 && revealing(); i++) {
      await settle(20);
      const moment = panel
        .querySelector("[data-xp-caption-levelup]")
        ?.getAttribute("data-xp-caption-levelup");
      if (moment === "47") sawLevel47 = true;
      const open =
        row()!
          .closest("[data-xp-collapsible]")!
          .getAttribute("data-xp-collapsible") === "open";
      if (open) {
        if (!sawLevel47) throw new Error("rewards row opened before level 47");
        openedAfter47 = true;
        seen.add(amounts()[0]);
      }
    }
    expect(openedAfter47).toBe(true);
    // It counted up: from zero, through values on the way, to the total.
    expect(seen.has("+0")).toBe(true);
    expect([...seen].some((a) => a !== "+0" && a !== "+300")).toBe(true);
    expect(amounts()).toEqual(["+300"]);
  });

  it("adds what the game unlocked to the milestone card", async () => {
    await mount(milestone());
    const card = panel.querySelector("[data-xp-levelup]")!;
    const unlock = card.querySelector("[data-xp-unlock]")!;
    expect(unlock.getAttribute("data-xp-unlock")).toBe("effect:firebird_trail");
    // Named from the flare while the catalog doesn't list it.
    expect(text(unlock.querySelector("[data-xp-unlock-name]"))).toBe(
      "Firebird Trail",
    );
    expect(text(unlock)).toContain("progression.unlocked");
    expect(text(unlock)).toContain("progression.unlock_in_locker");
    // Wraps under the milestone on a phone, beside it from sm up.
    expect(unlock.classList.contains("basis-full")).toBe(true);
    expect(unlock.classList.contains("sm:basis-auto")).toBe(true);
  });

  it("shows the unlock's preview when the catalog lists it", async () => {
    catalog.entries = [
      {
        type: "effect",
        cosmetic: { name: "firebird_trail" },
        colorPalette: null,
        relationship: "owned",
        key: "effect:transportShipTrail:firebird_trail",
        effectType: "transportShipTrail",
      },
    ];
    await mount(milestone());
    await settle();
    const unlock = panel.querySelector("[data-xp-unlock]")!;
    expect(unlock.querySelector("cosmetic-preview")).not.toBeNull();
    expect(text(unlock)).toContain(
      'progression.unlock_in_locker:{"type":"cosmetics.type_effect:{\\"type\\":\\"effects.type.transportShipTrail\\"}"}',
    );
  });

  it("wipes the unlock in once the milestone card has landed", async () => {
    await mount(milestone(), { reveal: true });
    const unlock = () => panel.querySelector("[data-xp-unlock]")!;
    expect(unlock().getAttribute("data-xp-slot-hidden")).toBe("true");
    let landed = false;
    for (let i = 0; i < 400 && revealing(); i++) {
      await settle(20);
      if (unlock().getAttribute("data-xp-slot-hidden") === null) {
        landed = true;
        expect(unlock().classList.contains("xp-unlock-in")).toBe(true);
        // By now the milestone card is on screen.
        expect(
          panel
            .querySelector("[data-xp-levelup]")!
            .getAttribute("data-xp-slot-hidden"),
        ).toBeNull();
        break;
      }
    }
    expect(landed).toBe(true);
  });

  it("gives an unlock with no milestone a card of its own", async () => {
    await mount(game(46, 47, { flares: [{ ...firebird, level: 47 }] }));
    expect(panel.querySelector("[data-xp-levelup]")).toBeNull();
    const card = panel.querySelector("[data-xp-unlock-card]")!;
    expect(card.querySelector("[data-xp-unlock]")).not.toBeNull();
  });

  it("claims only this game's rewards, then shows the new balance", async () => {
    getUserMe.mockResolvedValue(me(18_550, 125));
    const changed = vi.fn();
    await mount(milestone());
    panel.addEventListener("rewards-changed", (e) =>
      changed((e as CustomEvent).detail),
    );

    let resolveSecond!: () => void;
    claimReward.mockImplementationOnce(() =>
      Promise.resolve({ currency: { soft: 18_550, hard: 100 } }),
    );
    claimReward.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveSecond = () => r({ currency: { soft: 18_550, hard: 125 } });
        }),
    );
    claimButton()!.click();
    await settle();
    // Claiming: disabled, with a spinner.
    expect(claimButton()!.disabled).toBe(true);
    expect(panel.querySelector("[data-xp-claim-spinner]")).not.toBeNull();
    expect(text(claimButton())).toBe("progression.rewards_claiming");
    resolveSecond();
    await settle();

    expect(claimReward.mock.calls.map((c) => c[0])).toEqual([
      "rw50soft",
      "rw50hard",
    ]);
    expect(invalidateUserMe).toHaveBeenCalled();
    const claimed = panel.querySelector("[data-xp-claimed]")!;
    expect(text(claimed)).toContain("progression.rewards_claimed");
    expect(claimButton()).toBeNull();
    // The balance counts up from the old total to the new one.
    expect(text(panel.querySelector("[data-xp-balance]"))).toBe(
      `progression.rewards_balance:${JSON.stringify({ caps: (18_450).toLocaleString(), plutonium: (100).toLocaleString() })}`,
    );
    await settle(1_000);
    expect(text(panel.querySelector("[data-xp-balance]"))).toBe(
      `progression.rewards_balance:${JSON.stringify({ caps: (18_550).toLocaleString(), plutonium: (125).toLocaleString() })}`,
    );
    // The rest of the page hears about it, as from the rewards panel.
    expect(changed).toHaveBeenCalledWith({
      currency: { soft: 18_550, hard: 125 },
      rewards: me(0, 0).player.rewards,
    });
  });

  it("skips rewards already claimed, and shows a Caps-only balance", async () => {
    claimReward.mockResolvedValue({ currency: { soft: 900, hard: 3 } });
    getUserMe.mockResolvedValue(me(900, 3));
    await mount(
      game(44, 47, {
        rewards: [
          reward(45, "soft", 100, { claimed: true }),
          reward(46, "soft", 100),
          reward(47, "soft", 100),
        ],
      }),
    );
    claimButton()!.click();
    await settle(1_000);
    expect(claimReward.mock.calls.map((c) => c[0])).toEqual([
      "rw46soft",
      "rw47soft",
    ]);
    expect(text(panel.querySelector("[data-xp-balance]"))).toBe(
      `progression.rewards_balance_caps:${JSON.stringify({ caps: (900).toLocaleString() })}`,
    );
  });

  it("restores the button with an error when a claim fails, and retries the rest", async () => {
    claimReward
      .mockResolvedValueOnce({ currency: { soft: 18_550, hard: 100 } })
      .mockResolvedValueOnce(false);
    await mount(milestone());
    claimButton()!.click();
    await settle();
    expect(panel.querySelector("[data-xp-claim-error]")).not.toBeNull();
    expect(claimButton()!.disabled).toBe(false);
    expect(text(claimButton())).toBe("account_modal.claim");
    expect(invalidateUserMe).not.toHaveBeenCalled();

    // The retry claims only what didn't go through.
    claimReward.mockResolvedValueOnce({
      currency: { soft: 18_550, hard: 125 },
    });
    getUserMe.mockResolvedValue(me(18_550, 125));
    claimButton()!.click();
    await settle(1_000);
    expect(claimReward.mock.calls.map((c) => c[0])).toEqual([
      "rw50soft",
      "rw50hard",
      "rw50hard",
    ]);
    expect(panel.querySelector("[data-xp-claim-error]")).toBeNull();
    expect(panel.querySelector("[data-xp-claimed]")).not.toBeNull();
  });

  it("counts a reward claimed elsewhere first as claimed", async () => {
    claimReward.mockResolvedValue("not_found");
    getUserMe.mockResolvedValue(me(700, 4));
    await mount(single());
    claimButton()!.click();
    await settle(1_000);
    expect(panel.querySelector("[data-xp-claimed]")).not.toBeNull();
    // Nothing was credited by this claim: the balance is just the current one.
    expect(text(panel.querySelector("[data-xp-balance]"))).toBe(
      `progression.rewards_balance_caps:${JSON.stringify({ caps: (700).toLocaleString() })}`,
    );
  });

  it("shows rewards that were all claimed already as claimed", async () => {
    await mount(
      milestone({
        rewards: [
          reward(50, "soft", 100, { claimed: true }),
          reward(50, "hard", 25, { claimed: true }),
        ],
      }),
    );
    expect(panel.querySelector("[data-xp-claimed]")).not.toBeNull();
    expect(claimButton()).toBeNull();
    // No claim made here, so no balance to show.
    expect(panel.querySelector("[data-xp-balance]")).toBeNull();
    expect(claimReward).not.toHaveBeenCalled();
  });

  it("claims mid-reveal without skipping it; a click elsewhere still skips", async () => {
    claimReward.mockResolvedValue({ currency: { soft: 1_000, hard: 0 } });
    getUserMe.mockResolvedValue(me(1_000, 0));
    await mount(single(), { reveal: true });
    for (let i = 0; i < 400 && revealing(); i++) {
      await settle(20);
      if (row()!.getAttribute("data-xp-slot-hidden") === null) break;
    }
    expect(revealing()).toBe(true);
    claimButton()!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await settle();
    expect(
      panel.querySelector("[data-xp-claim]")!.classList.contains("scale-95"),
    ).toBe(true);
    claimButton()!.click();
    await settle();
    expect(claimReward).toHaveBeenCalledWith("rw47soft");
    expect(revealing()).toBe(true);
    section().click();
    await settle();
    expect(revealing()).toBe(false);
    expect(panel.querySelector("[data-xp-claimed]")).not.toBeNull();
  });

  it("shows the static final state under reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    try {
      claimReward.mockResolvedValue({ currency: { soft: 1_000, hard: 0 } });
      getUserMe.mockResolvedValue(me(1_000, 0));
      panel?.remove();
      panel = document.createElement("game-xp-panel") as GameXpPanel;
      panel.view = { kind: "result", data: milestone() };
      document.body.appendChild(panel);
      await settle();
      // No reveal: the row, its amounts and the unlock are there at once.
      expect(revealing()).toBe(false);
      expect(amounts()).toEqual(["+100", "+25"]);
      expect(row()!.className).not.toContain("xp-card-in");
      const unlock = panel.querySelector("[data-xp-unlock]")!;
      expect(unlock.className).not.toContain("xp-unlock-in");
      // The balance lands on its total without counting.
      claimButton()!.click();
      await settle();
      expect(text(panel.querySelector("[data-xp-balance]"))).toBe(
        `progression.rewards_balance:${JSON.stringify({ caps: (1_000).toLocaleString(), plutonium: (0).toLocaleString() })}`,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("starts each new result unclaimed", async () => {
    claimReward.mockResolvedValue({ currency: { soft: 1_000, hard: 0 } });
    getUserMe.mockResolvedValue(me(1_000, 0));
    await mount(single());
    claimButton()!.click();
    await settle(1_000);
    expect(panel.querySelector("[data-xp-claimed]")).not.toBeNull();
    panel.view = { kind: "result", data: several() };
    await settle();
    section().click();
    await settle();
    expect(panel.querySelector("[data-xp-claimed]")).toBeNull();
    expect(claimButton()).not.toBeNull();
  });
});
