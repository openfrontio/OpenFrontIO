import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A Stripe subscriber whose renewal bounced is past_due. /users/@me returns
// no subscription for them, so the account panel's Manage button is gone,
// and checkout refuses a new subscription with 409 subscription_past_due.
// The store's refusal is therefore the only place left to reach the billing
// portal, which is where the card gets fixed.

vi.mock("../../src/client/Api", () => ({
  changeSubscriptionTier: vi.fn(),
  getApiBase: vi.fn(() => "https://api.test"),
  getUserMe: vi.fn(async () => false),
  invalidateUserMe: vi.fn(),
  openSubscriptionPortal: vi.fn(),
  purchaseCosmeticPack: vi.fn(),
  purchaseWithCurrency: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => true),
  showInGameConfirm: vi.fn(async () => true),
}));

vi.mock("../../src/client/DesktopShell", () => ({
  isDesktopShell: vi.fn(() => false),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: vi.fn((key: string) => key),
}));

vi.mock("../../src/client/Payments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Payments")>()),
  startPurchase: vi.fn(),
}));

import { openSubscriptionPortal } from "../../src/client/Api";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import { purchaseCosmetic } from "../../src/client/Cosmetics";
import { isDesktopShell } from "../../src/client/DesktopShell";
import {
  showInGameAlert,
  showInGameConfirm,
} from "../../src/client/InGameModal";
import { startPurchase } from "../../src/client/Payments";
import type { Subscription } from "../../src/core/CosmeticSchemas";

const startPurchaseMock = startPurchase as unknown as ReturnType<typeof vi.fn>;
const alertMock = showInGameAlert as unknown as ReturnType<typeof vi.fn>;
const confirmMock = showInGameConfirm as unknown as ReturnType<typeof vi.fn>;
const portalMock = openSubscriptionPortal as unknown as ReturnType<
  typeof vi.fn
>;
const desktopMock = isDesktopShell as unknown as ReturnType<typeof vi.fn>;

const SOVEREIGN = {
  type: "subscription",
  cosmetic: { name: "sovereign", priceMonthly: 20 } as unknown as Subscription,
  colorPalette: null,
  relationship: "purchasable",
  key: "subscription:sovereign",
} as ResolvedCosmetic;

let openMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  startPurchaseMock.mockResolvedValue({
    outcome: "error",
    message: "store.subscription_past_due",
    refetchCatalog: false,
    manageBilling: true,
  });
  confirmMock.mockResolvedValue(true);
  desktopMock.mockReturnValue(false);
  portalMock.mockResolvedValue("https://billing.stripe.com/p/session/test");
  openMock = vi.fn();
  vi.stubGlobal("open", openMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("purchaseCosmetic: a past_due subscriber is sent to billing", () => {
  it("offers Manage billing and opens the portal", async () => {
    await purchaseCosmetic(SOVEREIGN, "dollar");

    expect(confirmMock).toHaveBeenCalledWith(
      "store.subscription_past_due",
      expect.objectContaining({ confirmText: "store.manage_billing" }),
    );
    expect(portalMock).toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledWith(
      "https://billing.stripe.com/p/session/test",
      "_blank",
      "noopener,noreferrer",
    );
    // Not the generic failure the player used to see.
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("opens nothing when the player dismisses the prompt", async () => {
    confirmMock.mockResolvedValue(false);

    await purchaseCosmetic(SOVEREIGN, "dollar");

    expect(portalMock).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });

  it("says so when the portal cannot be opened", async () => {
    portalMock.mockResolvedValue(false);

    await purchaseCosmetic(SOVEREIGN, "dollar");

    expect(alertMock).toHaveBeenCalledWith(
      "account_modal.subscription_portal_failed",
    );
    expect(openMock).not.toHaveBeenCalled();
  });

  it("does not link out to billing from the desktop build", async () => {
    desktopMock.mockReturnValue(true);

    await purchaseCosmetic(SOVEREIGN, "dollar");

    expect(alertMock).toHaveBeenCalledWith(
      "store.subscription_past_due_desktop",
    );
    expect(confirmMock).not.toHaveBeenCalled();
    expect(portalMock).not.toHaveBeenCalled();
  });
});
