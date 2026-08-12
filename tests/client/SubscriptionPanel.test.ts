import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  cancelSubscription: vi.fn(async () => true),
  invalidateUserMe: vi.fn(),
  openSubscriptionPortal: vi.fn(async () => "https://portal.example"),
}));
vi.mock("../../src/client/Cosmetics", () => ({
  translateCosmetic: vi.fn((_kind: string, name: string) => name),
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => true),
  showInGameConfirm: vi.fn(async () => false),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { SubscriptionPanel } from "../../src/client/components/SubscriptionPanel";
import type { UserSubscription } from "../../src/core/ApiSchemas";

function sub(overrides: Partial<UserSubscription> = {}): UserSubscription {
  return {
    tier: "plutonium",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  } as UserSubscription;
}

describe("subscription-panel", () => {
  let el: SubscriptionPanel;

  beforeEach(async () => {
    if (!customElements.get("subscription-panel")) {
      customElements.define("subscription-panel", SubscriptionPanel);
    }
    el = document.createElement("subscription-panel") as SubscriptionPanel;
    el.sub = sub();
    document.body.appendChild(el);
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
    vi.clearAllMocks();
    window.location.hash = "";
  });

  const text = () => el.textContent ?? "";

  it("asks the host to close before navigating to the store", async () => {
    const closes: Event[] = [];
    el.addEventListener("request-close", (e) => closes.push(e));

    const changeTier = Array.from(el.querySelectorAll("o-button")).find(
      (b) => b.getAttribute("translationKey") === "account_modal.change_tier",
    )!;
    expect(changeTier).toBeTruthy();
    changeTier.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Without this the popup subscription modal stayed open behind the store.
    expect(closes).toHaveLength(1);
    expect(window.location.hash).toBe("#modal=store&tab=subscriptions");
  });

  it("swaps the actions for a subscription that is winding down", async () => {
    el.sub = sub({ cancelAtPeriodEnd: true });
    await el.updateComplete;

    const keys = Array.from(el.querySelectorAll("o-button")).map((b) =>
      b.getAttribute("translationKey"),
    );
    expect(keys).toEqual(["account_modal.reactivate_subscription"]);
    // Cancel is gone too — it's already canceling.
    expect(text()).not.toContain("account_modal.cancel_subscription");
    expect(text()).toContain("account_modal.sub_status_canceling");
  });
});
