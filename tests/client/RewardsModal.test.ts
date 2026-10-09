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

import type { Reward } from "@openfront/shared/ApiSchemas";
import type { RewardsChangedDetail } from "../../src/client/components/RewardsPanel";
import { RewardsModal } from "../../src/client/RewardsModal";

if (!customElements.get("rewards-modal")) {
  customElements.define("rewards-modal", RewardsModal);
}

function reward(id: string, held?: string): Reward {
  return {
    id,
    currencyType: "hard",
    amount: "50",
    reason: "level_milestone",
    note: null,
    ...(held === undefined ? {} : { held }),
  };
}

describe("<rewards-modal> dismissal", () => {
  let el: RewardsModal | undefined;

  afterEach(() => {
    el?.remove();
    el = undefined;
  });

  async function mount(
    rewards: Reward[],
    signedIn = true,
  ): Promise<RewardsModal> {
    el = document.createElement("rewards-modal") as RewardsModal;
    document.body.appendChild(el);
    await el.updateComplete;
    el.openWithRewards(rewards, signedIn);
    await el.updateComplete;
    return el;
  }

  it.each([true, false])(
    "passes the viewer's sign-in (%s) to the panel",
    async (signedIn) => {
      const modal = await mount([reward("1"), reward("2", "trust")], signedIn);
      const panel = modal.querySelector("rewards-panel") as unknown as {
        signedIn: boolean;
      };
      expect(panel.signedIn).toBe(signedIn);
    },
  );

  // What the panel emits after a claim; the modal listens on the panel.
  async function panelChanged(
    modal: RewardsModal,
    detail: RewardsChangedDetail,
  ): Promise<void> {
    const panel = modal.querySelector("rewards-panel");
    expect(panel).not.toBeNull();
    panel!.dispatchEvent(
      new CustomEvent<RewardsChangedDetail>("rewards-changed", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
    await modal.updateComplete;
  }

  it("closes once only held rewards remain", async () => {
    const modal = await mount([reward("1"), reward("2", "trust")]);
    expect(modal.isOpen()).toBe(true);
    await panelChanged(modal, {
      currency: { soft: 0, hard: 50 },
      rewards: [reward("2", "trust")],
    });
    expect(modal.isOpen()).toBe(false);
  });

  it("stays open while a reward can still be claimed", async () => {
    const modal = await mount([reward("1"), reward("2"), reward("3", "trust")]);
    await panelChanged(modal, {
      currency: { soft: 0, hard: 50 },
      rewards: [reward("2"), reward("3", "trust")],
    });
    expect(modal.isOpen()).toBe(true);
  });

  it("closes when the list empties", async () => {
    const modal = await mount([reward("1")]);
    await panelChanged(modal, { currency: { soft: 0, hard: 50 }, rewards: [] });
    expect(modal.isOpen()).toBe(false);
  });

  it("doesn't open with nothing to claim", async () => {
    const modal = await mount([reward("1", "trust"), reward("2", "other")]);
    expect(modal.isOpen()).toBe(false);
  });
});
