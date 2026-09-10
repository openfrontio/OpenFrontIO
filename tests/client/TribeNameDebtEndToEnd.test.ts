import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The one test that spans the whole path: the real panel over the real
// Api.ts. TribeNameDebt.test.ts covers the reason mapping and
// TribesPanelDebt.test.ts covers the panel's branches, but both stub the seam
// between them — so neither would notice if the mapping and the branch
// stopped agreeing.
//
// TribeNameDebt.test.ts sends the same "insufficient_balance_debt" body, but
// only as far as the wrapper's return value. This is the only test where that
// string could reach rendered text, which is what actually used to happen:
// purchaseTribeName folded every 400 into `invalid` and the panel prints an
// `invalid` message as-is.
//
// Stubbed here: fetch, Auth, the list/profile reads and the cosmetics
// catalogue (all incidental to the purchase), the in-game modal, and
// translateText. NOT stubbed: purchaseTribeName and the panel itself.

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  getAuthHeader: vi.fn(async () => "Bearer test"),
  logOut: vi.fn(async () => true),
}));

// Everything except the purchase itself is stubbed, so the only request the
// fetch mock has to serve is the one under test. purchaseTribeName is the
// real implementation.
const { getMyTribeNames, getUserMe, invalidateUserMe, fetchCosmetics } =
  vi.hoisted(() => ({
    getMyTribeNames: vi.fn(),
    getUserMe: vi.fn(),
    invalidateUserMe: vi.fn(),
    fetchCosmetics: vi.fn(),
  }));

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getMyTribeNames: () => getMyTribeNames(),
  getUserMe: () => getUserMe(),
  invalidateUserMe: () => invalidateUserMe(),
}));
vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  fetchCosmetics: () => fetchCosmetics(),
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => true),
  showInGameAlert: vi.fn(async () => true),
}));
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

import { ClientEnv } from "../../src/client/ClientEnv";
import "../../src/client/components/TribesPanel";
import type { TribesPanel } from "../../src/client/components/TribesPanel";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

const PRICE_HARD = 200;

function userWithHard(hard: number): UserMeResponse {
  return {
    user: {},
    player: { publicId: "p", flares: [], currency: { hard, soft: 0 } },
  } as unknown as UserMeResponse;
}

describe("buying a tribe name in debt, panel through Api", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "openfront.io",
      instanceId: "test",
      gitCommit: "test",
      serverHost: "main.openfront.dev",
    };
    ClientEnv.reset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getMyTribeNames.mockResolvedValue({ names: [] });
    getUserMe.mockResolvedValue(userWithHard(500));
    fetchCosmetics.mockResolvedValue({
      tribeNames: {
        priceHard: PRICE_HARD,
        boostPriceHard: 50,
        boostDurationDays: 30,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as any).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    document.body.innerHTML = "";
  });

  async function mountAndBuy(status: number, body: unknown) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
    const el = document.createElement("tribes-panel") as TribesPanel;
    el.userMeResponse = userWithHard(500);
    document.body.appendChild(el);
    await el.updateComplete;
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    el.querySelector<HTMLInputElement>("#tribe-name-input")!.value = "Ninja";
    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    return el;
  }

  it("shows the debt message and never the server's reason string", async () => {
    const el = await mountAndBuy(400, {
      reason: "insufficient_balance_debt",
      debt: "250",
    });

    expect(el.textContent).toContain('store.pack_debt:{"debt":"250"}');
    expect(el.textContent).not.toContain("insufficient_balance_debt");
  });

  // A machine key the client has never heard of must not reach the screen
  // either — that is the whole point of allowlisting the prose reasons.
  it("shows a generic failure for a reason it does not recognise", async () => {
    const el = await mountAndBuy(400, { reason: "some_future_machine_key" });

    expect(el.textContent).toContain("store.purchase_failed");
    expect(el.textContent).not.toContain("some_future_machine_key");
    // Otherwise this passes just as well when the request never happens.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The refusal still reaches the player — as a translated key, not as the
  // server's English sentence.
  it("shows a real name refusal as a translated message", async () => {
    const el = await mountAndBuy(400, { reason: "This name is not allowed" });

    expect(el.textContent).toContain("store.tribe_name_not_allowed");
    expect(el.textContent).not.toContain("This name is not allowed");
  });

  it("interpolates the bounds of the length rule", async () => {
    const el = await mountAndBuy(400, {
      reason: "Name must be 3-24 characters",
    });

    expect(el.textContent).toContain(
      'store.tribe_name_length:{"min":3,"max":24}',
    );
  });

  // OPE-389: the API sends a stable machine `code`, so this is the table that
  // matters — server code in, translation key out. Every body pairs its code
  // with prose this client does not recognise, so a row that still passed by
  // matching the English would fail here.
  describe("each refusal code reaches its translation key", () => {
    const UNMATCHED_PROSE = "Refusal prose this client never matched";

    it.each([
      ["invalid_charset", "store.tribe_name_charset"],
      ["no_letter", "store.tribe_name_no_letter"],
      ["not_allowed", "store.tribe_name_not_allowed"],
    ])("%s renders %s", async (code, key) => {
      const el = await mountAndBuy(400, { code, reason: UNMATCHED_PROSE });

      expect(el.textContent).toContain(key);
      expect(el.textContent).not.toContain(UNMATCHED_PROSE);
    });

    it("length renders the key with the bounds from the body", async () => {
      const el = await mountAndBuy(400, {
        code: "length",
        reason: UNMATCHED_PROSE,
        min: 5,
        max: 30,
      });

      expect(el.textContent).toContain(
        'store.tribe_name_length:{"min":5,"max":30}',
      );
      expect(el.textContent).not.toContain(UNMATCHED_PROSE);
    });

    it("insufficient_balance_debt renders the debt message", async () => {
      const el = await mountAndBuy(400, {
        code: "insufficient_balance_debt",
        reason: UNMATCHED_PROSE,
        debt: "250",
      });

      expect(el.textContent).toContain('store.pack_debt:{"debt":"250"}');
      expect(el.textContent).not.toContain("insufficient_balance_debt");
    });

    // A code this client has never heard of must not reach the screen either
    // — that is the whole point of allowlisting them.
    //
    // Deliberately paired with a reason the legacy path DOES match: the code
    // is the branch key, so reinstating the string matching would render
    // store.tribe_name_no_letter here and fail this test. With unmatched
    // prose it would pass either way and prove nothing.
    it("an unknown code renders the generic purchase failure", async () => {
      const el = await mountAndBuy(400, {
        code: "some_future_code",
        reason: "Name must contain a letter",
      });

      expect(el.textContent).toContain("store.purchase_failed");
      expect(el.textContent).not.toContain("store.tribe_name_no_letter");
      expect(el.textContent).not.toContain("some_future_code");
      expect(el.textContent).not.toContain("Name must contain a letter");
      // Otherwise this passes just as well when the request never happens.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
