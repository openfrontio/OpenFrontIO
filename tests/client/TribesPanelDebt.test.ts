import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What a player in debt actually ends up looking at. The Api-level mapping
// lives in TribeNameDebt.test.ts; here the wrappers are stubbed so these
// exercise the panel's branches on the result code.
//
// The purchase path is the one that stung: its 400 folded into `invalid`,
// whose `message` the panel prints verbatim — so a charged-back player was
// shown the literal string "insufficient_balance_debt".

const {
  purchaseTribeName,
  boostTribeName,
  getMyTribeNames,
  getUserMe,
  invalidateUserMe,
  fetchCosmetics,
  showInGameConfirm,
} = vi.hoisted(() => ({
  purchaseTribeName: vi.fn(),
  boostTribeName: vi.fn(),
  getMyTribeNames: vi.fn(),
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
  fetchCosmetics: vi.fn(),
  showInGameConfirm: vi.fn(),
}));

vi.mock("../../src/client/Api", () => ({
  purchaseTribeName: (name: string) => purchaseTribeName(name),
  boostTribeName: (id: string, key: string) => boostTribeName(id, key),
  getMyTribeNames: () => getMyTribeNames(),
  getUserMe: () => getUserMe(),
  invalidateUserMe: () => invalidateUserMe(),
}));
vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: () => fetchCosmetics(),
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: (message: string, options?: unknown) =>
    showInGameConfirm(message, options),
  showInGameAlert: vi.fn(async () => true),
}));
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  // Echo the key and its interpolations so assertions can read both.
  translateText: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

import "../../src/client/components/TribesPanel";
import type { TribesPanel } from "../../src/client/components/TribesPanel";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

const PRICE_HARD = 200;
const BOOST_PRICE_HARD = 50;

function userWithHard(hard: number): UserMeResponse {
  return {
    user: {},
    player: { publicId: "p", flares: [], currency: { hard, soft: 0 } },
  } as unknown as UserMeResponse;
}

// Comfortably above both prices, so the client-side pre-checks pass and the
// request is actually made — the refusals under test all come from the server.
const userMe = userWithHard(500);

const tribe = {
  id: "7",
  displayName: "Ronin",
  status: "live",
  reviewReason: null,
  activeBoosts: 0,
  boostExpiresAt: null,
};

async function mount(): Promise<TribesPanel> {
  const el = document.createElement("tribes-panel") as TribesPanel;
  el.userMeResponse = userMe;
  document.body.appendChild(el);
  await el.updateComplete;
  // updated() kicks off the list + cosmetics fetch; let both settle and the
  // resulting re-render land.
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

async function buy(el: TribesPanel, name: string) {
  const input = el.querySelector<HTMLInputElement>("#tribe-name-input")!;
  input.value = name;
  el.querySelector("form")!.dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

async function boost(el: TribesPanel) {
  const button = [...el.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("store.tribe_boost_button"),
  )!;
  button.click();
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

function dialog(el: TribesPanel) {
  return el.querySelector("insufficient-currency-dialog") as HTMLElement & {
    info: unknown;
  };
}

describe("TribesPanel when the wallet is in debt", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    getMyTribeNames.mockResolvedValue({ names: [tribe] });
    getUserMe.mockResolvedValue(userMe);
    fetchCosmetics.mockResolvedValue({
      tribeNames: {
        priceHard: PRICE_HARD,
        boostPriceHard: BOOST_PRICE_HARD,
        boostDurationDays: 30,
      },
    });
    showInGameConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("buying a name", () => {
    it("explains the debt and its amount", async () => {
      purchaseTribeName.mockResolvedValue({
        ok: false,
        code: "debt",
        debt: "250",
      });
      const el = await mount();

      await buy(el, "Ninja");

      expect(el.textContent).toContain('store.pack_debt:{"debt":"250"}');
    });

    // Being short is the other half of the same 400 and DOES want the
    // top-up path, the way the boost handler has always done it.
    it("quotes the shortfall against the refetched balance", async () => {
      purchaseTribeName.mockResolvedValue({
        ok: false,
        code: "insufficient_balance",
      });
      // The pre-check passed on the bound balance (500) and the server
      // refused anyway, so the real balance is whatever the refetch returns.
      // Quoting the stale one would say "you need 1 more" when they need 180.
      getUserMe.mockResolvedValue(userWithHard(20));
      const el = await mount();

      await buy(el, "Ninja");

      expect(dialog(el).info).toMatchObject({
        shortfall: PRICE_HARD - 20,
        item: "Ninja",
        canTopUp: true,
      });
      expect(el.textContent).not.toContain("Insufficient balance");
    });

    // The refetch can fail (offline, a 500). Falling back to a zero balance
    // overstates the shortfall, but never understates it to a reassuring
    // "1 more" on a purchase the server just refused.
    it("still quotes a shortfall when the refetch fails", async () => {
      purchaseTribeName.mockResolvedValue({
        ok: false,
        code: "insufficient_balance",
      });
      getUserMe.mockResolvedValue(false);
      const el = await mount();

      await buy(el, "Ninja");

      expect(dialog(el).info).toMatchObject({ shortfall: PRICE_HARD });
    });

    it("still shows a genuine name rejection as prose", async () => {
      purchaseTribeName.mockResolvedValue({
        ok: false,
        code: "invalid",
        message: "Name is not allowed",
      });
      const el = await mount();

      await buy(el, "Ninja");

      expect(el.textContent).toContain("Name is not allowed");
      expect(dialog(el).info).toBeNull();
    });
  });

  describe("boosting a name", () => {
    it("explains the debt instead of offering a top-up", async () => {
      boostTribeName.mockResolvedValue({
        ok: false,
        code: "debt",
        debt: "80",
      });
      const el = await mount();

      await boost(el);

      expect(el.textContent).toContain('store.pack_debt:{"debt":"80"}');
      expect(dialog(el).info).toBeNull();
    });

    it("still offers the top-up dialog when merely short", async () => {
      boostTribeName.mockResolvedValue({
        ok: false,
        code: "insufficient_balance",
      });
      getUserMe.mockResolvedValue(userWithHard(20));
      const el = await mount();

      await boost(el);

      expect(dialog(el).info).toMatchObject({
        shortfall: BOOST_PRICE_HARD - 20,
        item: "Ronin",
        canTopUp: true,
      });
      expect(el.textContent).not.toContain("store.pack_debt");
    });
  });
});
