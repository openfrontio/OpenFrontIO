import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The one test that spans the whole path: the real panel over the real
// Api.ts, with only the network faked. TribeNameDebt.test.ts covers the
// reason mapping and TribesPanelDebt.test.ts covers the panel's branches, but
// both stub the seam between them — so neither would notice if the mapping
// and the branch stopped agreeing.
//
// Specifically: it is only here that the raw string "insufficient_balance_debt"
// exists in the fixture at all. That string used to reach the screen verbatim,
// because purchaseTribeName folded every 400 into `invalid` and the panel
// prints an `invalid` message as-is.

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
  });

  it("still shows a real name rejection verbatim", async () => {
    const el = await mountAndBuy(400, { reason: "This name is not allowed" });

    expect(el.textContent).toContain("This name is not allowed");
  });
});
