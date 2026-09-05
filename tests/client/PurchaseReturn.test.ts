import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  changeSubscriptionTier: vi.fn(),
  createCheckoutSession: vi.fn(),
  getApiBase: vi.fn(() => "https://api.test"),
  getUserMe: vi.fn(async () => false),
  invalidateUserMe: vi.fn(),
  purchaseCosmeticPack: vi.fn(),
  purchaseWithCurrency: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => true),
  showInGameConfirm: vi.fn(async () => true),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: vi.fn((key: string) => key),
}));

import { invalidateUserMe } from "../../src/client/Api";
import { handlePurchaseReturn } from "../../src/client/Cosmetics";

const actions = {
  strip: vi.fn(),
  alertAndStrip: vi.fn(),
  // Resolves when the dialog is dismissed, unlike alertAndStrip.
  alert: vi.fn(async () => undefined),
  openTokenLogin: vi.fn(),
  refreshStore: vi.fn(),
  reload: vi.fn(),
};

function ret(query: string) {
  handlePurchaseReturn(new URLSearchParams(query), actions);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("handlePurchaseReturn: failure", () => {
  // The old message was the raw English literal "purchase failed", which the
  // repo's i18n rule forbids.
  it("reports a failure through a translation key, not a raw literal", () => {
    ret("status=false&type=currency_pack");
    expect(actions.alertAndStrip).toHaveBeenCalledWith("store.purchase_failed");
  });

  // A missing status is NOT a failure. Only an explicit status=false is.
  // Anything else -- absent, or a value the rail adds later -- degrades to
  // the pending message, which points at order history instead of telling a
  // player who may well have been charged that their purchase failed.
  it("treats a missing status as pending, not as a failure", () => {
    ret("type=currency_pack");
    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "store.purchase_pending",
    );
  });
});

// Both behaviours below arrived in the client's own dialog refactor while this
// work was in flight, and a merge that silently dropped them would have been a
// regression disguised as a clean rebase.
describe("handlePurchaseReturn: behaviour preserved across the rebase", () => {
  it("reloads only after the subscription dialog is dismissed", async () => {
    let dismiss!: () => void;
    actions.alert.mockReturnValueOnce(
      new Promise<undefined>((r) => {
        dismiss = () => r(undefined);
      }),
    );

    ret("status=true&type=subscription_tier");
    await Promise.resolve();

    // Still open: reloading here would throw the message away unread.
    expect(actions.reload).not.toHaveBeenCalled();
    dismiss();
    await vi.waitFor(() => expect(actions.reload).toHaveBeenCalled());
  });

  // The purchase very likely succeeded and it is our own landing URL that is
  // malformed, so "purchase failed" would be the wrong claim.
  it("reports a malformed cosmetic return generically, not as a failure", () => {
    ret("status=true");
    expect(actions.alert).toHaveBeenCalledWith("common.error_generic");
    expect(actions.alertAndStrip).not.toHaveBeenCalledWith(
      "store.purchase_failed",
    );
  });
});

describe("handlePurchaseReturn: pending", () => {
  // status=pending used to fall into the failure branch. It means the purchase
  // is GOING to succeed — capture in flight, a throwing resolve, or a rail
  // disabled mid-flight. The order is durable in all three.
  it("does NOT report a pending purchase as failed", () => {
    ret("status=pending&type=currency_pack&provider=steam&orderId=1234");
    expect(actions.alertAndStrip).not.toHaveBeenCalledWith(
      "store.purchase_failed",
    );
    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "store.purchase_pending",
    );
  });

  it("refreshes the wallet so the credit shows up when it lands", () => {
    ret("status=pending&type=custom_currency");
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(actions.refreshStore).toHaveBeenCalled();
  });

  it("does not reload the page out from under the pending message", () => {
    ret("status=pending&type=subscription_tier&tier=supporter");
    expect(actions.reload).not.toHaveBeenCalled();
    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "store.purchase_pending",
    );
  });
});

describe("handlePurchaseReturn: success", () => {
  it("confirms a currency pack", () => {
    ret("status=true&type=currency_pack&pack=starter_pack&provider=steam");
    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "store.currency_pack_purchase_success",
    );
  });

  it("confirms a custom currency top-up", () => {
    ret("status=true&type=custom_currency");
    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "store.custom_currency_purchase_success",
    );
  });

  // `subscription` arrives on the wire as `subscription_tier`.
  it("confirms a subscription and reloads with a fresh profile", async () => {
    ret("status=true&type=subscription_tier&tier=supporter");
    // Announced through `alert` rather than `alertAndStrip`, because the
    // reload has to wait for the dialog to be dismissed; the hash is cleared
    // separately by `strip`. See the rebase-preservation tests above.
    expect(actions.alert).toHaveBeenCalledWith(
      "store.subscription_purchase_success",
    );
    expect(actions.strip).toHaveBeenCalled();
    expect(invalidateUserMe).toHaveBeenCalled();
    await vi.waitFor(() => expect(actions.reload).toHaveBeenCalled());
  });

  it("still routes a cosmetic purchase through the legacy return path", () => {
    ret("status=true&cosmetic=camo");
    expect(actions.alertAndStrip).toHaveBeenCalledWith(
      "store.purchase_success",
    );
    expect(actions.refreshStore).toHaveBeenCalled();
  });

  it("still opens the token-login flow when the return carries one", () => {
    ret("status=true&cosmetic=camo&login-token=abc");
    expect(actions.openTokenLogin).toHaveBeenCalledWith("abc");
  });
});
