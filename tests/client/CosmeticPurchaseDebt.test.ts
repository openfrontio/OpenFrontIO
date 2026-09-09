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
  });

  it("never leaks the machine reason into the message", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "debt",
      debt: "150",
    });

    await purchaseCosmetic(pirateFlag, "hard");

    expect(vi.mocked(showInGameAlert).mock.calls[0][0]).not.toContain(
      "insufficient_balance_debt",
    );
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

  // The server can refuse on a balance this client still reads as sufficient.
  // A zero or negative shortfall would render as "you have enough", which is
  // the one thing we know is false.
  it("never reports a non-positive shortfall", async () => {
    vi.mocked(purchaseWithCurrency).mockResolvedValue({
      ok: false,
      code: "insufficient_balance",
    });

    const result = await purchaseCosmetic(pirateFlag, "hard");

    expect(result).toMatchObject({ shortfall: 1 });
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
