import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  purchaseCosmetic,
  type ResolvedCosmetic,
} from "../../src/client/Cosmetics";

// POST /shop/purchase is the highest-traffic spend path (every single-cosmetic
// buy) and the only one that takes soft currency. It used to return a bare
// boolean and never read the response body, so the shared spend helper's
// `{reason: "insufficient_balance_debt", debt}` — a wallet left negative by a
// refund or chargeback — was indistinguishable from any other failure.
//
// Mirrors CosmeticPackPurchase.test.ts, which covers the same branches on the
// pack path.

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
  purchaseWithCurrency: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn().mockResolvedValue(true),
  showInGameConfirm: vi.fn().mockResolvedValue(true),
}));

const { getUserMe, invalidateUserMe, purchaseWithCurrency } =
  await import("../../src/client/Api");
const { showInGameAlert } = await import("../../src/client/InGameModal");

const translations = {
  "cosmetics.hard": "plutonium",
  "cosmetics.soft": "caps",
  "flags.pirate": "Jolly Roger",
  "store.login_required": "log in",
  "store.pack_debt": "debt {debt}",
  "store.purchase_failed": "failed",
  "store.purchase_success": "bought {name}",
};

const pirateFlag: ResolvedCosmetic = {
  type: "flag",
  cosmetic: {
    name: "pirate",
    priceHard: 100,
    priceSoft: 400,
  },
  colorPalette: null,
  relationship: "purchasable",
  key: "flag:pirate",
} as unknown as ResolvedCosmetic;

function userWith(hard: number, soft: number) {
  return { player: { currency: { hard, soft }, flares: [] } } as never;
}

describe("purchaseCosmetic when the wallet is in debt", () => {
  let languageFixture: HTMLElement;
  let reloadMock: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;

  beforeEach(() => {
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);
    reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });
    vi.mocked(getUserMe).mockResolvedValue(userWith(500, 5000));
  });

  afterEach(() => {
    languageFixture.remove();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.mocked(getUserMe).mockReset();
    vi.mocked(invalidateUserMe).mockReset();
    vi.mocked(purchaseWithCurrency).mockReset();
    vi.mocked(showInGameAlert).mockClear();
  });

  it("names the debt and its amount instead of a generic failure", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "debt",
      debt: "150",
    });

    const result = await purchaseCosmetic(pirateFlag, "hard");

    expect(showInGameAlert).toHaveBeenCalledWith("debt 150");
    // Not the insufficient-currency dialog: topping up cannot clear a debt.
    expect(result).toBeUndefined();
    // Nothing was granted, so the page must not reload as if it had been.
    expect(reloadMock).not.toHaveBeenCalled();
    // The cached profile still holds the pre-chargeback balance, which the
    // store would otherwise keep rendering.
    expect(invalidateUserMe).toHaveBeenCalled();
  });

  // Finding 1: this is the COMMON way a player in debt arrives. The API
  // serves a charged-back wallet as a negative balance, so the pre-check sees
  // it before any request is made — the server refusal above only happens
  // when the chargeback lands mid-session against a stale cache.
  it("explains the debt from a negative cached balance, before any request", async () => {
    vi.mocked(getUserMe).mockResolvedValue(userWith(-150, 5000));

    const result = await purchaseCosmetic(pirateFlag, "hard");

    expect(showInGameAlert).toHaveBeenCalledWith("debt 150");
    // Never reaches the network, and never offers a top-up that cannot help.
    expect(purchaseWithCurrency).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  // The other half of the same 400. Being short IS fixed by topping up, so it
  // keeps the shortfall dialog — re-read after the refusal, since the balance
  // moved under a pre-check that passed.
  it("reports a shortfall when the balance moved after the pre-check", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "insufficient_balance",
    });
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(userWith(500, 5000))
      .mockResolvedValueOnce(userWith(40, 5000));

    const result = await purchaseCosmetic(pirateFlag, "hard");

    expect(result).toEqual({
      currency: "plutonium",
      shortfall: 60,
      item: "Jolly Roger",
      canTopUp: true,
    });
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(showInGameAlert).not.toHaveBeenCalled();
  });

  // Caps cannot be bought, so the dialog must not offer a top-up for them.
  it("does not offer a top-up for a soft-currency shortfall", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "insufficient_balance",
    });
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(userWith(500, 5000))
      .mockResolvedValueOnce(userWith(500, 10));

    const result = await purchaseCosmetic(pirateFlag, "soft");

    expect(result).toMatchObject({
      currency: "caps",
      shortfall: 390,
      canTopUp: false,
    });
  });

  // The server refused on a balance the re-read still says covers the price.
  // There is no shortfall to quote, and "you need 1 more" would send them to
  // buy currency they already have for a purchase that would now succeed.
  it("does not invent a shortfall when the re-read covers the price", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "insufficient_balance",
    });

    const result = await purchaseCosmetic(pirateFlag, "hard");

    expect(result).toBeUndefined();
    expect(showInGameAlert).toHaveBeenCalledWith("failed");
  });

  // Finding 1's other half: the chargeback landed mid-session, so the
  // pre-check ran on a cache that still showed a positive balance.
  it("explains the debt when the re-read comes back negative", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "insufficient_balance",
    });
    vi.mocked(getUserMe)
      .mockResolvedValueOnce(userWith(500, 5000))
      .mockResolvedValueOnce(userWith(-150, 5000));

    const result = await purchaseCosmetic(pirateFlag, "hard");

    expect(showInGameAlert).toHaveBeenCalledWith("debt 150");
    expect(result).toBeUndefined();
  });

  it("still reports an unexplained failure generically", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "failed",
    });

    await purchaseCosmetic(pirateFlag, "hard");

    expect(showInGameAlert).toHaveBeenCalledWith("failed");
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("still grants and reloads on success", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({ ok: true });

    await purchaseCosmetic(pirateFlag, "hard");

    expect(purchaseWithCurrency).toHaveBeenCalledWith(
      "flag",
      "pirate",
      "hard",
      undefined,
    );
    expect(showInGameAlert).toHaveBeenCalledWith("bought pirate");
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(reloadMock).toHaveBeenCalled();
  });
});
