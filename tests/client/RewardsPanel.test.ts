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

import type { Reward } from "@openfront/shared/ApiSchemas";
import { RewardsPanel } from "../../src/client/components/RewardsPanel";

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
