import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

vi.mock("../../src/client/Api", () => ({
  claimAllRewards: vi.fn(),
  claimReward: vi.fn(),
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames: vi.fn(() => false) },
}));

import type { Reward, UserMeResponse } from "@openfront/shared/ApiSchemas";
import {
  claimAllRewards,
  claimReward,
  getUserMe,
  invalidateUserMe,
} from "../../src/client/Api";
import {
  RewardsPanel,
  type RewardsChangedDetail,
} from "../../src/client/components/RewardsPanel";
import { crazyGamesSDK } from "../../src/client/CrazyGamesSDK";
import { showInGameAlert } from "../../src/client/InGameModal";

if (!customElements.get("rewards-panel")) {
  customElements.define("rewards-panel", RewardsPanel);
}

function reward(reason: string, note: string | null = null): Reward {
  return { id: reason, currencyType: "soft", amount: "100", reason, note };
}

describe("<rewards-panel> reward labels", () => {
  let el: RewardsPanel | undefined;

  afterEach(() => {
    el?.remove();
    el = undefined;
  });

  async function labels(rewards: Reward[]): Promise<string[]> {
    el = document.createElement("rewards-panel") as RewardsPanel;
    el.rewards = rewards;
    document.body.appendChild(el);
    await el.updateComplete;
    return [...el.querySelectorAll("span.truncate")].map(
      (s) => s.textContent?.trim() ?? "",
    );
  }

  it("gives the progression reasons their own copy", async () => {
    expect(
      await labels([
        reward("level_up"),
        reward("level_milestone"),
        reward("prestige"),
      ]),
    ).toEqual([
      "account_modal.reward_level_up",
      "account_modal.reward_level_milestone",
      "account_modal.reward_prestige",
    ]);
  });

  it("prefers the localized copy over a level reward's server note", async () => {
    expect(await labels([reward("level_up", "Reached level 20")])).toEqual([
      "account_modal.reward_level_up",
    ]);
  });

  it("still falls back to the note, then the reason, for unknown reasons", async () => {
    expect(
      await labels([
        reward("season_bonus", "Season 3 bonus"),
        reward("mystery_reason"),
      ]),
    ).toEqual(["Season 3 bonus", "mystery_reason"]);
  });

  it("keeps the existing subscription copy", async () => {
    expect(await labels([reward("subscription_daily")])).toEqual([
      "account_modal.reward_daily",
    ]);
  });
});

describe("<rewards-panel> held rewards", () => {
  let el: RewardsPanel | undefined;

  afterEach(() => {
    el?.remove();
    el = undefined;
    vi.mocked(crazyGamesSDK.isOnCrazyGames).mockReturnValue(false);
    vi.clearAllMocks();
  });

  function plutonium(id: string, held?: "trust"): Reward {
    return {
      id,
      currencyType: "hard",
      amount: "50",
      reason: "level_milestone",
      note: null,
      ...(held === undefined ? {} : { held }),
    };
  }

  async function mount(rewards: Reward[]): Promise<RewardsPanel> {
    el = document.createElement("rewards-panel") as RewardsPanel;
    el.rewards = rewards;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  // Each reward's row, keyed by the claim affordance it offers.
  function rows(panel: RewardsPanel): ("claim" | "held")[] {
    return [...panel.querySelectorAll("div.justify-between.p-3")].map((row) =>
      row.querySelector("[data-reward-held]") !== null ? "held" : "claim",
    );
  }

  function claimAllButton(panel: RewardsPanel): Element | null {
    return panel.querySelector(
      'o-button[translationKey="account_modal.claim_all"]',
    );
  }

  function changes(panel: RewardsPanel): RewardsChangedDetail[] {
    const seen: RewardsChangedDetail[] = [];
    panel.addEventListener("rewards-changed", (e) =>
      seen.push((e as CustomEvent<RewardsChangedDetail>).detail),
    );
    return seen;
  }

  it("shows a held reward's label and note in place of its claim button", async () => {
    const panel = await mount([plutonium("1", "trust")]);
    expect(rows(panel)).toEqual(["held"]);
    expect(
      panel.querySelector('o-button[translationKey="account_modal.claim"]'),
    ).toBeNull();
    expect(panel.querySelector("[data-reward-held]")?.textContent?.trim()).toBe(
      "account_modal.reward_held_trust",
    );
    expect(
      panel.querySelector("[data-reward-held-note]")?.textContent?.trim(),
    ).toBe("account_modal.reward_held_trust_info");
  });

  it("uses the CrazyGames note there (no purchases)", async () => {
    vi.mocked(crazyGamesSDK.isOnCrazyGames).mockReturnValue(true);
    const panel = await mount([plutonium("1", "trust")]);
    expect(
      panel.querySelector("[data-reward-held-note]")?.textContent?.trim(),
    ).toBe("account_modal.reward_held_trust_info_crazygames");
  });

  it("shows no note when nothing is held", async () => {
    const panel = await mount([plutonium("1"), plutonium("2")]);
    expect(rows(panel)).toEqual(["claim", "claim"]);
    expect(panel.querySelector("[data-reward-held-note]")).toBeNull();
  });

  it("offers claim all only for rewards that can be claimed", async () => {
    // Two held and one claimable: nothing for claim all to add.
    let panel = await mount([
      plutonium("1", "trust"),
      plutonium("2", "trust"),
      reward("level_up"),
    ]);
    expect(rows(panel)).toEqual(["held", "held", "claim"]);
    expect(claimAllButton(panel)).toBeNull();
    panel.remove();

    panel = await mount([
      plutonium("1", "trust"),
      reward("level_up"),
      reward("prestige"),
    ]);
    expect(claimAllButton(panel)).not.toBeNull();
  });

  it("keeps the rewards claim all left held", async () => {
    const held = plutonium("1", "trust");
    vi.mocked(claimAllRewards).mockResolvedValue({
      claimed: [{ id: "level_up" }, { id: "prestige" }],
      held: [held],
      currency: { soft: 300, hard: 0 },
    });
    const panel = await mount([held, reward("level_up"), reward("prestige")]);
    const seen = changes(panel);
    (claimAllButton(panel) as HTMLElement).click();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      currency: { soft: 300, hard: 0 },
      rewards: [held],
    });
    expect(showInGameAlert).not.toHaveBeenCalled();
  });

  function clickFirstClaim(panel: RewardsPanel): void {
    (
      panel.querySelector(
        'o-button[translationKey="account_modal.claim"]',
      ) as HTMLElement
    ).click();
  }

  it("marks a reward held when its claim is refused as held", async () => {
    vi.mocked(claimReward).mockResolvedValue({ held: "trust" });
    vi.mocked(getUserMe).mockResolvedValue(false);
    const level = reward("level_up");
    const panel = await mount([plutonium("1"), level]);
    const seen = changes(panel);
    clickFirstClaim(panel);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(claimReward).toHaveBeenCalledWith("1");
    expect(showInGameAlert).not.toHaveBeenCalled();
    // Nothing was claimed: the wallet stays as it is, and the reward stays.
    expect(seen[0]).toEqual({
      currency: null,
      rewards: [plutonium("1", "trust"), level],
    });

    // Rendered with the hold, as the parent passes the new list back.
    panel.rewards = seen[0].rewards;
    await panel.updateComplete;
    expect(rows(panel)).toEqual(["held", "claim"]);
    expect(panel.querySelector("[data-reward-held-note]")).not.toBeNull();
  });

  it("keeps the hold the 403 named, not an assumed one", async () => {
    vi.mocked(claimReward).mockResolvedValue({ held: "other" });
    vi.mocked(getUserMe).mockResolvedValue(false);
    const panel = await mount([plutonium("1")]);
    const seen = changes(panel);
    clickFirstClaim(panel);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].rewards).toEqual([{ ...plutonium("1"), held: "other" }]);
  });

  it("re-reads the whole list after a held refusal: the hold is per account", async () => {
    vi.mocked(claimReward).mockResolvedValue({ held: "trust" });
    // The fresh list holds both milestones, not just the one clicked.
    vi.mocked(getUserMe).mockResolvedValue({
      player: {
        currency: { soft: 10, hard: 0 },
        rewards: [plutonium("1", "trust"), plutonium("2", "trust")],
      },
    } as unknown as UserMeResponse);
    const panel = await mount([plutonium("1"), plutonium("2")]);
    const seen = changes(panel);
    clickFirstClaim(panel);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(seen[0]).toEqual({
      currency: { soft: 10, hard: 0 },
      rewards: [plutonium("1", "trust"), plutonium("2", "trust")],
    });
  });

  it("marks the refused reward held even if the fresh list lags", async () => {
    vi.mocked(claimReward).mockResolvedValue({ held: "trust" });
    vi.mocked(getUserMe).mockResolvedValue({
      player: { rewards: [plutonium("1"), plutonium("2")] },
    } as unknown as UserMeResponse);
    const panel = await mount([plutonium("1"), plutonium("2")]);
    const seen = changes(panel);
    clickFirstClaim(panel);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      currency: null,
      rewards: [plutonium("1", "trust"), plutonium("2")],
    });
  });

  it("treats a hold it has no copy for as held", async () => {
    const panel = await mount([
      { ...plutonium("1"), held: "future_hold" },
      reward("level_up"),
      reward("prestige"),
    ]);
    expect(rows(panel)).toEqual(["held", "claim", "claim"]);
    expect(
      panel.querySelectorAll("[data-reward-held-note]").length,
    ).toBeGreaterThan(0);
  });

  it("still alerts when a claim fails for another reason", async () => {
    vi.mocked(claimReward).mockResolvedValue(false);
    const panel = await mount([plutonium("1")]);
    const seen = changes(panel);
    (
      panel.querySelector(
        'o-button[translationKey="account_modal.claim"]',
      ) as HTMLElement
    ).click();
    await vi.waitFor(() =>
      expect(showInGameAlert).toHaveBeenCalledWith(
        "account_modal.claim_failed",
      ),
    );
    expect(seen).toEqual([]);
  });
});
