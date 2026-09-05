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

  // OPE-314. In the packaged Steam build a Manage click cannot reach Stripe:
  // navigationPolicy refuses payment-origin link-outs, per the rule that the
  // desktop build must never steer to a payment page. Rendering the button
  // anyway produces a dead control -- and once infra accepts app://openfront
  // as a returnUrl it gets worse, because the click then raises the shell's
  // "Purchase unavailable / nothing has been charged" modal at a player who
  // is trying to STOP paying. Render static copy instead of a button.
  describe("inside the desktop shell", () => {
    beforeEach(async () => {
      (window as unknown as { openfrontDesktop?: unknown }).openfrontDesktop = {
        steam: {},
      };
      el.sub = sub();
      el.requestUpdate();
      await el.updateComplete;
    });

    afterEach(() => {
      delete (window as unknown as { openfrontDesktop?: unknown })
        .openfrontDesktop;
    });

    it("offers no Manage button", async () => {
      const keys = Array.from(el.querySelectorAll("o-button")).map((b) =>
        b.getAttribute("translationKey"),
      );
      expect(keys).not.toContain("account_modal.manage_subscription");
    });

    it("says where billing is managed instead", async () => {
      expect(text()).toContain("account_modal.manage_subscription_on_web");
    });

    // A link-out is the thing that is prohibited, so the replacement must not
    // quietly become one.
    it("renders no anchor to click", async () => {
      expect(el.querySelector("a")).toBeNull();
    });

    it("offers no Reactivate button either, for the same reason", async () => {
      el.sub = sub({ cancelAtPeriodEnd: true });
      await el.updateComplete;
      const keys = Array.from(el.querySelectorAll("o-button")).map((b) =>
        b.getAttribute("translationKey"),
      );
      expect(keys).not.toContain("account_modal.reactivate_subscription");
    });

    // Cancel does NOT link out -- it is a fetch to our own API -- so it keeps
    // working, and it is the control a player most needs.
    it("keeps the Cancel control", async () => {
      expect(text()).toContain("account_modal.cancel_subscription");
    });
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

  // OPE-314, the blocking half. A granted month (`provider: null`) has no
  // billing period: the server's cancel expires it on the spot and revokes the
  // premium username with it, and the grant ledger only ever earns it once, so
  // nothing short of an admin UPDATE brings it back. Every base-game buyer on
  // Steam holds one of these.
  describe("a granted subscription (provider: null)", () => {
    const granted = () => sub({ provider: null });

    const buttonKeys = () =>
      Array.from(el.querySelectorAll("o-button")).map((b) =>
        b.getAttribute("translationKey"),
      );

    beforeEach(async () => {
      el.sub = granted();
      await el.updateComplete;
    });

    // The one that matters: this exact click is what destroys the month.
    it("offers no Cancel control", () => {
      expect(text()).not.toContain("account_modal.cancel_subscription");
      // Cancel is a bare <button>, not an <o-button>, so check the element too
      // rather than trusting the copy alone.
      expect(el.querySelector("button")).toBeNull();
    });

    it("offers no Manage and no Change Tier either", () => {
      expect(buttonKeys()).toEqual([]);
      expect(text()).not.toContain("account_modal.manage_subscription");
      expect(text()).not.toContain("account_modal.change_tier");
    });

    it("says the access ends instead of claiming it renews", () => {
      expect(text()).toContain("account_modal.sub_granted_ends_on");
      expect(text()).not.toContain("account_modal.sub_renews_on");
    });

    it("says what the subscription actually is", () => {
      expect(text()).toContain("account_modal.sub_granted_from_purchase");
    });

    // Not a link — the desktop build must not hand over a route to a payment
    // page, and there is no billing page to send anyone to in any case.
    it("renders no anchor", () => {
      expect(el.querySelector("a")).toBeNull();
    });

    // A grant is a property of the ACCOUNT, not of the shell. A Steam buyer who
    // signs in on the website meets the same one-way Cancel, so the branch is
    // deliberately not gated on isDesktopShell().
    it("hides the same controls inside the desktop shell", async () => {
      (window as unknown as { openfrontDesktop?: unknown }).openfrontDesktop = {
        steam: {},
      };
      try {
        el.sub = granted();
        el.requestUpdate();
        await el.updateComplete;
        expect(text()).not.toContain("account_modal.cancel_subscription");
        expect(buttonKeys()).toEqual([]);
      } finally {
        delete (window as unknown as { openfrontDesktop?: unknown })
          .openfrontDesktop;
      }
    });

    // The other writer of a provider-null row is the admin grant endpoint,
    // which sets no currentPeriodEnd at all. Telling that player their access
    // came from a Steam purchase would be a new lie in place of the old one.
    it("does not blame Steam for an open-ended grant with no end date", async () => {
      el.sub = sub({ provider: null, currentPeriodEnd: null });
      await el.updateComplete;
      expect(text()).toContain("account_modal.sub_granted_indefinite");
      expect(text()).not.toContain("account_modal.sub_granted_from_purchase");
      expect(text()).not.toContain("account_modal.sub_granted_ends_on");
      expect(text()).not.toContain("account_modal.cancel_subscription");
    });
  });

  // The other half of the same distinction, and the reason `isGranted` tests
  // `=== null` rather than `!provider`. `provider` is on infra `main` but not
  // yet on staging, so an ABSENT field is the live case until the next deploy.
  // A truthiness test would treat those subscribers as granted and take Cancel
  // away from people who are genuinely being billed every month.
  describe("when the server does not send provider at all", () => {
    beforeEach(async () => {
      el.sub = sub();
      await el.updateComplete;
    });

    it("leaves the field undefined rather than null", () => {
      expect(el.sub.provider).toBeUndefined();
      expect(el.sub.provider).not.toBeNull();
    });

    // The negative prediction: this is what a `!provider` implementation
    // breaks. Cancel is the one control a paying subscriber needs, and on an
    // old server we cannot tell them from a grant holder — so we keep it.
    it("keeps Cancel, because a grant is indistinguishable here", () => {
      expect(text()).toContain("account_modal.cancel_subscription");
    });

    it("keeps the full set of billing controls", () => {
      const keys = Array.from(el.querySelectorAll("o-button")).map((b) =>
        b.getAttribute("translationKey"),
      );
      expect(keys).toContain("account_modal.change_tier");
      expect(keys).toContain("account_modal.manage_subscription");
    });

    it("still renders the renews line", () => {
      expect(text()).toContain("account_modal.sub_renews_on");
      expect(text()).not.toContain("account_modal.sub_granted_ends_on");
    });
  });

  // A paid rail is not a grant, however the panel is reached.
  describe.each(["stripe", "steam"] as const)(
    "a %s subscription",
    (provider) => {
      beforeEach(async () => {
        el.sub = sub({ provider });
        await el.updateComplete;
      });

      it("keeps Cancel", () => {
        expect(text()).toContain("account_modal.cancel_subscription");
      });

      it("renews rather than ending", () => {
        expect(text()).toContain("account_modal.sub_renews_on");
        expect(text()).not.toContain("account_modal.sub_granted_from_purchase");
      });
    },
  );
});
