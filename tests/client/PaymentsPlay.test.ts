import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  createPaymentsCheckout: vi.fn(),
  finalizeGooglePurchase: vi.fn(),
  finalizeSteamOrder: vi.fn(),
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: vi.fn((key: string) => key),
}));

import type { FinalizeGooglePurchaseResult } from "../../src/client/Api";
import {
  createPaymentsCheckout,
  finalizeGooglePurchase,
  getUserMe,
} from "../../src/client/Api";
import {
  drainPlayPurchases,
  fetchPlayPrices,
  purchaseOutcomeMessage,
  setPurchaseAccountRefresh,
  startPlayPurchase,
  startPurchase,
  watchPlayPurchases,
} from "../../src/client/Payments";

const finalizeMock = vi.mocked(finalizeGooglePurchase);
const getUserMeMock = vi.mocked(getUserMe);

const USER_ME = { player: { publicId: "pub-1" } } as Awaited<
  ReturnType<typeof getUserMe>
>;

/** A promise the test settles by hand, to hold a call open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Installs the Android app's Play billing bridge. */
function installPlay() {
  const playBilling = {
    products: vi.fn(async (ids: string[]): Promise<unknown> => ({
      status: "ok",
      products: ids.map((productId) => ({
        productId,
        formattedPrice: `€${productId}`,
      })),
    })),
    purchase: vi.fn(
      async (opts: {
        productId: string;
        accountId: string;
      }): Promise<unknown> => ({
        status: "ok",
        purchaseToken: "tok-new",
      }),
    ),
    unconsumed: vi.fn(async (): Promise<unknown> => ({
      status: "ok",
      purchaseTokens: [],
    })),
  };
  (window as any).openfrontDesktop = {
    shell: { platform: "android" },
    playBilling,
  };
  return playBilling;
}

let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;

beforeEach(() => {
  finalizeMock.mockReset();
  getUserMeMock.mockReset();
  getUserMeMock.mockResolvedValue(USER_ME);
  refresh = vi.fn(async () => {});
  setPurchaseAccountRefresh(refresh);
});

afterEach(() => {
  delete (window as any).openfrontDesktop;
  vi.restoreAllMocks();
  // Drops any follow-up a pending purchase left scheduled.
  vi.useRealTimers();
});

describe("fetchPlayPrices", () => {
  it("is null on the web", async () => {
    expect(await fetchPlayPrices(["p1"])).toBeNull();
  });

  it("maps each product Play returned to its formatted price", async () => {
    const play = installPlay();
    play.products.mockResolvedValue({
      status: "ok",
      products: [{ productId: "p1", formattedPrice: "€1,99" }],
    });
    expect(await fetchPlayPrices(["p1", "p2"])).toEqual(
      new Map([["p1", "€1,99"]]),
    );
    expect(play.products).toHaveBeenCalledWith(["p1", "p2"]);
  });

  it("does not ask Play about an empty list", async () => {
    const play = installPlay();
    expect(await fetchPlayPrices([])).toEqual(new Map());
    expect(play.products).not.toHaveBeenCalled();
  });

  it("is null when Play cannot answer", async () => {
    const play = installPlay();
    play.products.mockResolvedValue({ status: "error", code: "unavailable" });
    expect(await fetchPlayPrices(["p1"])).toBeNull();
  });
});

describe("startPurchase on a Play rail", () => {
  // The Android app must never reach Stripe, bridge or no bridge.
  it.each([
    ["with the bridge", () => installPlay()],
    [
      "without the bridge",
      () => {
        (window as any).openfrontDesktop = { shell: { platform: "android" } };
      },
    ],
  ])("never opens a checkout %s", async (_label, install) => {
    install();
    const outcome = await startPurchase({
      kind: "currency_pack",
      packName: "starter_pack",
    });
    expect(outcome).toEqual({
      outcome: "error",
      message: "store.play_unavailable",
      refetchCatalog: false,
    });
    expect(createPaymentsCheckout).not.toHaveBeenCalled();
  });
});

describe("startPlayPurchase", () => {
  it("says Play is unavailable without the bridge", async () => {
    (window as any).openfrontDesktop = { shell: { platform: "android" } };
    expect(await startPlayPurchase("p1")).toMatchObject({
      outcome: "error",
      message: "store.play_unavailable",
    });
  });

  it("says Play is unavailable for a pack with no Play product", async () => {
    const play = installPlay();
    expect(await startPlayPurchase(undefined)).toMatchObject({
      outcome: "error",
      message: "store.play_unavailable",
    });
    expect(play.purchase).not.toHaveBeenCalled();
  });

  it("asks a logged-out player to log in, without opening Play", async () => {
    const play = installPlay();
    getUserMeMock.mockResolvedValue(false);
    expect(await startPlayPurchase("p1")).toMatchObject({
      outcome: "error",
      message: "store.login_required",
    });
    expect(play.purchase).not.toHaveBeenCalled();
  });

  it("buys for the player's public id and posts the token", async () => {
    const play = installPlay();
    finalizeMock.mockResolvedValue({ ok: true, status: "settled" });

    expect(await startPlayPurchase("p1")).toEqual({ outcome: "completed" });
    expect(play.purchase).toHaveBeenCalledWith({
      productId: "p1",
      accountId: "pub-1",
    });
    expect(finalizeMock).toHaveBeenCalledWith("tok-new");
  });

  it("is quiet when the player closes Play's sheet", async () => {
    const play = installPlay();
    play.purchase.mockResolvedValue({ status: "cancelled" });
    const outcome = await startPlayPurchase("p1");
    expect(outcome).toEqual({ outcome: "cancelled", quiet: true });
    expect(purchaseOutcomeMessage(outcome, "success")).toBeNull();
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("ignores busy", async () => {
    const play = installPlay();
    play.purchase.mockResolvedValue({ status: "error", code: "busy" });
    expect(await startPlayPurchase("p1")).toEqual({
      outcome: "cancelled",
      quiet: true,
    });
  });

  it("posts the earlier purchase on already_owned, then buys again once it settles", async () => {
    const play = installPlay();
    play.purchase.mockResolvedValueOnce({
      status: "error",
      code: "already_owned",
    });
    play.unconsumed.mockResolvedValue({
      status: "ok",
      purchaseTokens: ["tok-old"],
    });
    finalizeMock.mockResolvedValue({ ok: true, status: "settled" });

    expect(await startPlayPurchase("p1")).toEqual({ outcome: "completed" });
    expect(play.purchase).toHaveBeenCalledTimes(2);
    expect(play.purchase).toHaveBeenNthCalledWith(2, {
      productId: "p1",
      accountId: "pub-1",
    });
    expect(finalizeMock.mock.calls.map(([t]) => t)).toEqual([
      "tok-old",
      "tok-new",
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // Play's cache can still list a purchase the server has just consumed.
  it("buys again on already_owned when nothing is unconsumed", async () => {
    const play = installPlay();
    play.purchase.mockResolvedValueOnce({
      status: "error",
      code: "already_owned",
    });
    finalizeMock.mockResolvedValue({ ok: true, status: "settled" });

    expect(await startPlayPurchase("p1")).toEqual({ outcome: "completed" });
    expect(play.purchase).toHaveBeenCalledTimes(2);
    expect(play.unconsumed).toHaveBeenCalledTimes(1);
    expect(finalizeMock.mock.calls.map(([t]) => t)).toEqual(["tok-new"]);
  });

  it.each(["unavailable", "failed"])(
    "does not buy again on already_owned when Play cannot list purchases (%s)",
    async (code) => {
      const play = installPlay();
      play.purchase.mockResolvedValue({
        status: "error",
        code: "already_owned",
      });
      play.unconsumed.mockResolvedValue({ status: "error", code });

      expect(await startPlayPurchase("p1")).toEqual({
        outcome: "pending",
        message: "store.play_earlier_purchase_pending",
      });
      expect(play.purchase).toHaveBeenCalledTimes(1);
      expect(finalizeMock).not.toHaveBeenCalled();
    },
  );

  // already_owned refreshes Play's cache, so a drain that read the list
  // before it cannot decide whether to buy again.
  it("on already_owned, reads the list again after a drain already running", async () => {
    const play = installPlay();
    const held = deferred<unknown>();
    play.unconsumed.mockReturnValueOnce(held.promise);
    play.unconsumed.mockResolvedValue({
      status: "ok",
      purchaseTokens: ["tok-old"],
    });
    play.purchase.mockResolvedValueOnce({
      status: "error",
      code: "already_owned",
    });
    finalizeMock.mockResolvedValue({ ok: true, status: "pending" });

    const drain = drainPlayPurchases("pub-1");
    await vi.waitFor(() => expect(play.unconsumed).toHaveBeenCalledTimes(1));
    const purchase = startPlayPurchase("p1");
    await vi.waitFor(() => expect(play.purchase).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    held.resolve({ status: "ok", purchaseTokens: [] });
    await drain;

    expect(await purchase).toEqual({
      outcome: "pending",
      message: "store.play_earlier_purchase_pending",
    });
    expect(play.unconsumed).toHaveBeenCalledTimes(2);
    expect(play.purchase).toHaveBeenCalledTimes(1);
    expect(finalizeMock.mock.calls.map(([t]) => t)).toEqual(["tok-old"]);
  });

  it("buys again only once, and asks the player to wait if Play still says already_owned", async () => {
    const play = installPlay();
    play.purchase.mockResolvedValue({ status: "error", code: "already_owned" });

    expect(await startPlayPurchase("p1")).toMatchObject({
      outcome: "error",
      message: "store.play_rebuy_too_soon",
    });
    expect(play.purchase).toHaveBeenCalledTimes(2);
    expect(play.unconsumed).toHaveBeenCalledTimes(1);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it.each<[unknown, unknown]>([
    [{ status: "cancelled" }, { outcome: "cancelled", quiet: true }],
    [
      { status: "error", code: "busy" },
      { outcome: "cancelled", quiet: true },
    ],
    [
      { status: "error", code: "unavailable" },
      { outcome: "error", message: "store.play_unavailable" },
    ],
    [
      { status: "error", code: "failed" },
      { outcome: "error", message: "store.purchase_failed" },
    ],
  ])("settles a second purchase %j like a first", async (second, expected) => {
    const play = installPlay();
    play.purchase
      .mockResolvedValueOnce({ status: "error", code: "already_owned" })
      .mockResolvedValueOnce(second);

    expect(await startPlayPurchase("p1")).toMatchObject(
      expected as Record<string, unknown>,
    );
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("holds the purchase lock while it buys again", async () => {
    const play = installPlay();
    const held = deferred<unknown>();
    play.purchase
      .mockResolvedValueOnce({ status: "error", code: "already_owned" })
      .mockReturnValueOnce(held.promise);
    finalizeMock.mockResolvedValue({ ok: true, status: "settled" });

    const first = startPlayPurchase("p1");
    await vi.waitFor(() => expect(play.purchase).toHaveBeenCalledTimes(2));
    expect(await startPlayPurchase("p2")).toEqual({
      outcome: "cancelled",
      quiet: true,
    });
    await drainPlayPurchases("pub-1");
    expect(play.unconsumed).toHaveBeenCalledTimes(1);

    held.resolve({ status: "ok", purchaseToken: "tok-new" });
    expect(await first).toEqual({ outcome: "completed" });
    expect(play.purchase).toHaveBeenCalledTimes(2);
    // The drain asked for meanwhile runs once the purchase is done.
    await vi.waitFor(() => expect(play.unconsumed).toHaveBeenCalledTimes(2));
  });

  it.each<[string, FinalizeGooglePurchaseResult[], unknown]>([
    [
      "is still processing",
      [{ ok: true, status: "pending" }],
      { outcome: "pending", message: "store.play_earlier_purchase_pending" },
    ],
    [
      "could not be decided yet",
      [{ ok: false, code: "retry_later" }],
      { outcome: "pending", message: "store.play_earlier_purchase_pending" },
    ],
    [
      "belongs to another account",
      [{ ok: false, code: "refused", reason: "wrong_account" }],
      { outcome: "error", message: "store.play_wrong_account" },
    ],
    [
      "is one of several, and only another settled",
      [
        { ok: true, status: "pending" },
        { ok: true, status: "settled" },
      ],
      { outcome: "pending", message: "store.play_earlier_purchase_pending" },
    ],
    [
      "is one of several, and only another was refused",
      [
        { ok: true, status: "settled" },
        { ok: false, code: "refused", reason: "wrong_account" },
      ],
      { outcome: "pending", message: "store.play_earlier_purchase_pending" },
    ],
    [
      "met the rate limit",
      [{ ok: false, code: "rate_limited" }],
      { outcome: "pending", message: "store.play_earlier_purchase_pending" },
    ],
    [
      "is refused",
      [{ ok: false, code: "refused", reason: "not_purchased" }],
      { outcome: "error", message: "store.play_purchase_refused" },
    ],
    [
      "is rejected outright",
      [{ ok: false, code: "failed" }],
      { outcome: "error", message: "store.play_purchase_refused" },
    ],
    [
      "and every other one are refused",
      [
        { ok: false, code: "refused", reason: "wrong_account" },
        { ok: false, code: "refused", reason: "not_purchased" },
      ],
      { outcome: "error", message: "store.play_purchase_refused" },
    ],
  ])(
    "on already_owned, says so without buying again when the earlier purchase %s",
    async (_label, results, expected) => {
      const play = installPlay();
      play.purchase.mockResolvedValue({
        status: "error",
        code: "already_owned",
      });
      play.unconsumed.mockResolvedValue({
        status: "ok",
        purchaseTokens: results.map((_, i) => `tok-old-${i}`),
      });
      for (const result of results) finalizeMock.mockResolvedValueOnce(result);

      expect(await startPlayPurchase("p1")).toMatchObject(
        expected as Record<string, unknown>,
      );
      expect(finalizeMock).toHaveBeenCalledTimes(results.length);
      expect(play.purchase).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["unavailable", "store.play_unavailable"],
    ["failed", "store.purchase_failed"],
  ])("maps %s to an error", async (code, message) => {
    const play = installPlay();
    play.purchase.mockResolvedValue({ status: "error", code });
    expect(await startPlayPurchase("p1")).toMatchObject({
      outcome: "error",
      message,
    });
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it.each<[FinalizeGooglePurchaseResult, unknown]>([
    [
      { ok: true, status: "pending" },
      { outcome: "pending", message: "store.play_purchase_pending" },
    ],
    [
      { ok: false, code: "refused", reason: "wrong_account" },
      { outcome: "error", message: "store.play_wrong_account" },
    ],
    [
      { ok: false, code: "refused", reason: "not_purchased" },
      { outcome: "error", message: "store.play_purchase_refused" },
    ],
    [
      { ok: false, code: "failed" },
      { outcome: "error", message: "store.play_purchase_refused" },
    ],
    [
      { ok: false, code: "retry_later" },
      { outcome: "pending", message: "store.play_purchase_retry" },
    ],
    [
      { ok: false, code: "rate_limited" },
      { outcome: "pending", message: "store.play_purchase_retry" },
    ],
    [
      { ok: false, code: "unauthorized" },
      { outcome: "pending", message: "store.play_purchase_retry" },
    ],
  ])("maps finalize %j", async (finalized, expected) => {
    // A pending answer schedules a follow-up; it must not run into a later test.
    vi.useFakeTimers();
    installPlay();
    finalizeMock.mockResolvedValue(finalized);
    expect(await startPlayPurchase("p1")).toMatchObject(
      expected as Record<string, unknown>,
    );
  });

  it("refuses a second purchase while one is running", async () => {
    const play = installPlay();
    const held = deferred<unknown>();
    play.purchase.mockReturnValueOnce(held.promise);
    finalizeMock.mockResolvedValue({ ok: true, status: "settled" });

    const first = startPlayPurchase("p1");
    expect(await startPlayPurchase("p2")).toEqual({
      outcome: "cancelled",
      quiet: true,
    });
    held.resolve({ status: "ok", purchaseToken: "tok-new" });
    expect(await first).toEqual({ outcome: "completed" });
    expect(play.purchase).toHaveBeenCalledTimes(1);

    // Released afterwards.
    expect(await startPlayPurchase("p2")).toEqual({ outcome: "completed" });
  });
});

// The server can credit a purchase seconds after its finalize answered
// pending, and consumes it then, so no drain ever posts it again. The purchase
// posts its own token again a few times so the balance still updates.
describe("startPlayPurchase after a finalize that could not credit yet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // Well past every follow-up post.
  const runFollowUp = () => vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  const posted = () => finalizeMock.mock.calls.map(([t]) => t);

  it.each<[FinalizeGooglePurchaseResult, string]>([
    [{ ok: true, status: "pending" }, "store.play_purchase_pending"],
    [{ ok: false, code: "retry_later" }, "store.play_purchase_retry"],
    [{ ok: false, code: "rate_limited" }, "store.play_purchase_retry"],
  ])(
    "posts the token again after %j and refreshes once it settles",
    async (first, message) => {
      installPlay();
      finalizeMock
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce({ ok: true, status: "pending" })
        .mockResolvedValueOnce({ ok: true, status: "settled" });

      expect(await startPlayPurchase("p1")).toEqual({
        outcome: "pending",
        message,
      });
      expect(refresh).not.toHaveBeenCalled();

      await runFollowUp();
      expect(posted()).toEqual(["tok-new", "tok-new", "tok-new"]);
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it("stops after a few posts if the purchase is still pending", async () => {
    installPlay();
    finalizeMock.mockResolvedValue({ ok: true, status: "pending" });

    await startPlayPurchase("p1");
    await runFollowUp();
    // The purchase's own post, then three more.
    expect(finalizeMock).toHaveBeenCalledTimes(4);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each<FinalizeGooglePurchaseResult>([
    { ok: false, code: "refused", reason: "not_purchased" },
    { ok: false, code: "refused", reason: "wrong_account" },
    { ok: false, code: "failed" },
    { ok: false, code: "unauthorized" },
  ])("stops at %j", async (answer) => {
    installPlay();
    finalizeMock
      .mockResolvedValueOnce({ ok: true, status: "pending" })
      .mockResolvedValueOnce(answer)
      .mockResolvedValue({ ok: true, status: "settled" });

    await startPlayPurchase("p1");
    await runFollowUp();
    expect(finalizeMock).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  // Settled needs nothing more; refused and failed never will; unauthorized
  // logged the player out, and signing in again drains.
  it.each<FinalizeGooglePurchaseResult>([
    { ok: true, status: "settled" },
    { ok: false, code: "refused", reason: "not_purchased" },
    { ok: false, code: "failed" },
    { ok: false, code: "unauthorized" },
  ])("does not post the token again after %j", async (answer) => {
    installPlay();
    finalizeMock.mockResolvedValue(answer);

    await startPlayPurchase("p1");
    await runFollowUp();
    expect(finalizeMock).toHaveBeenCalledTimes(1);
  });

  it("answers at once and releases the purchase lock while it follows up", async () => {
    const play = installPlay();
    const held = deferred<FinalizeGooglePurchaseResult>();
    finalizeMock
      .mockResolvedValueOnce({ ok: true, status: "pending" })
      .mockReturnValueOnce(held.promise)
      .mockResolvedValue({ ok: true, status: "settled" });

    expect(await startPlayPurchase("p1")).toEqual({
      outcome: "pending",
      message: "store.play_purchase_pending",
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(finalizeMock).toHaveBeenCalledTimes(2);

    // The follow-up's post is still open; another purchase goes ahead.
    expect(await startPlayPurchase("p2")).toEqual({ outcome: "completed" });
    expect(play.purchase).toHaveBeenCalledTimes(2);

    held.resolve({ ok: true, status: "settled" });
    await runFollowUp();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(finalizeMock).toHaveBeenCalledTimes(3);
  });
});

describe("drainPlayPurchases", () => {
  it("does nothing on the web", async () => {
    await drainPlayPurchases("pub-1");
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("does nothing when Play cannot list purchases", async () => {
    const play = installPlay();
    play.unconsumed.mockResolvedValue({ status: "error", code: "failed" });
    await drainPlayPurchases("pub-1");
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("posts each token one at a time and refreshes once if any settled", async () => {
    const play = installPlay();
    play.unconsumed.mockResolvedValue({
      status: "ok",
      purchaseTokens: ["t1", "t2", "t3"],
    });
    const holds = [
      deferred<FinalizeGooglePurchaseResult>(),
      deferred<FinalizeGooglePurchaseResult>(),
      deferred<FinalizeGooglePurchaseResult>(),
    ];
    let calls = 0;
    finalizeMock.mockImplementation(() => holds[calls++].promise);

    const drain = drainPlayPurchases("pub-1");
    await vi.waitFor(() => expect(finalizeMock).toHaveBeenCalledTimes(1));
    holds[0].resolve({ ok: false, code: "refused", reason: "wrong_account" });
    await vi.waitFor(() => expect(finalizeMock).toHaveBeenCalledTimes(2));
    holds[1].resolve({ ok: true, status: "settled" });
    await vi.waitFor(() => expect(finalizeMock).toHaveBeenCalledTimes(3));
    holds[2].resolve({ ok: true, status: "pending" });
    await drain;

    expect(finalizeMock.mock.calls.map(([t]) => t)).toEqual(["t1", "t2", "t3"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when nothing settled", async () => {
    const play = installPlay();
    play.unconsumed.mockResolvedValue({ status: "ok", purchaseTokens: ["t1"] });
    finalizeMock.mockResolvedValue({ ok: true, status: "pending" });
    await drainPlayPurchases("pub-1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(["rate_limited", "unauthorized"] as const)(
    "stops at %s",
    async (code) => {
      const play = installPlay();
      play.unconsumed.mockResolvedValue({
        status: "ok",
        purchaseTokens: ["t1", "t2", "t3"],
      });
      finalizeMock
        .mockResolvedValueOnce({ ok: true, status: "settled" })
        .mockResolvedValueOnce({ ok: false, code });
      await drainPlayPurchases("pub-1");
      expect(finalizeMock.mock.calls.map(([t]) => t)).toEqual(["t1", "t2"]);
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps going past a token the server could not decide", async () => {
    const play = installPlay();
    play.unconsumed.mockResolvedValue({
      status: "ok",
      purchaseTokens: ["t1", "t2"],
    });
    finalizeMock
      .mockResolvedValueOnce({ ok: false, code: "retry_later" })
      .mockResolvedValueOnce({ ok: true, status: "settled" });
    await drainPlayPurchases("pub-1");
    expect(finalizeMock).toHaveBeenCalledTimes(2);
  });

  it("joins a drain already running for the same account rather than starting a second", async () => {
    const play = installPlay();
    const held = deferred<unknown>();
    play.unconsumed.mockReturnValueOnce(held.promise);

    const first = drainPlayPurchases("pub-1");
    const second = drainPlayPurchases("pub-1");
    held.resolve({ status: "ok", purchaseTokens: ["t1"] });
    finalizeMock.mockResolvedValue({ ok: true, status: "settled" });
    await Promise.all([first, second]);
    expect(play.unconsumed).toHaveBeenCalledTimes(1);
    expect(finalizeMock).toHaveBeenCalledTimes(1);

    // A drain after it finished runs again.
    play.unconsumed.mockResolvedValue({ status: "ok", purchaseTokens: [] });
    await drainPlayPurchases("pub-1");
    expect(play.unconsumed).toHaveBeenCalledTimes(2);
  });

  it("runs a fresh pass after the running one for another account", async () => {
    const play = installPlay();
    const held = deferred<unknown>();
    play.unconsumed.mockReturnValueOnce(held.promise);
    play.unconsumed.mockResolvedValue({ status: "ok", purchaseTokens: ["t2"] });
    finalizeMock.mockResolvedValue({ ok: true, status: "settled" });

    const first = drainPlayPurchases("pub-1");
    await vi.waitFor(() => expect(play.unconsumed).toHaveBeenCalledTimes(1));
    const second = drainPlayPurchases("pub-2");
    // Requests for the account already queued join its pass.
    const third = drainPlayPurchases("pub-2");
    expect(play.unconsumed).toHaveBeenCalledTimes(1);

    held.resolve({ status: "ok", purchaseTokens: ["t1"] });
    await Promise.all([first, second, third]);
    expect(play.unconsumed).toHaveBeenCalledTimes(2);
    expect(finalizeMock.mock.calls.map(([t]) => t)).toEqual(["t1", "t2"]);
  });

  it("waits for a running purchase, then drains", async () => {
    const play = installPlay();
    const held = deferred<unknown>();
    play.purchase.mockReturnValueOnce(held.promise);

    const purchase = startPlayPurchase("p1");
    await drainPlayPurchases("pub-1");
    expect(play.unconsumed).not.toHaveBeenCalled();
    held.resolve({ status: "cancelled" });
    await purchase;
    await vi.waitFor(() => expect(play.unconsumed).toHaveBeenCalledTimes(1));
  });
});

describe("watchPlayPurchases", () => {
  const added: [string, EventListener][] = [];

  beforeEach(() => {
    const add = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation(
      (type: string, listener: any, options?: any) => {
        added.push([type, listener]);
        add(type, listener, options);
      },
    );
  });

  afterEach(() => {
    for (const [type, listener] of added.splice(0)) {
      document.removeEventListener(type, listener);
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  const userMe = (detail: unknown) =>
    document.dispatchEvent(new CustomEvent("userMeResponse", { detail }));
  const visibility = async (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("listens for nothing off the Play rail", () => {
    watchPlayPurchases();
    (window as any).openfrontDesktop = { shell: { platform: "android" } };
    watchPlayPurchases();
    expect(added).toEqual([]);
  });

  it("drains once logged in, not again for the same account, and again for another", async () => {
    const play = installPlay();
    watchPlayPurchases();

    userMe(false);
    await settle();
    expect(play.unconsumed).not.toHaveBeenCalled();

    userMe({ player: { publicId: "pub-1" } });
    await settle();
    expect(play.unconsumed).toHaveBeenCalledTimes(1);

    userMe({ player: { publicId: "pub-1" } });
    await settle();
    expect(play.unconsumed).toHaveBeenCalledTimes(1);

    userMe({ player: { publicId: "pub-2" } });
    await settle();
    expect(play.unconsumed).toHaveBeenCalledTimes(2);
  });

  it("drains again for an account signed in during a drain", async () => {
    const play = installPlay();
    const held = deferred<unknown>();
    play.unconsumed.mockReturnValueOnce(held.promise);
    watchPlayPurchases();

    userMe({ player: { publicId: "pub-1" } });
    await settle();
    userMe({ player: { publicId: "pub-2" } });
    await settle();
    expect(play.unconsumed).toHaveBeenCalledTimes(1);

    held.resolve({ status: "ok", purchaseTokens: [] });
    await vi.waitFor(() => expect(play.unconsumed).toHaveBeenCalledTimes(2));
  });

  it("drains when the app comes back to the foreground, once logged in", async () => {
    const play = installPlay();
    watchPlayPurchases();

    await visibility("visible");
    await settle();
    expect(play.unconsumed).not.toHaveBeenCalled();

    userMe({ player: { publicId: "pub-1" } });
    await settle();
    await visibility("hidden");
    await settle();
    expect(play.unconsumed).toHaveBeenCalledTimes(1);
    await visibility("visible");
    await settle();
    expect(play.unconsumed).toHaveBeenCalledTimes(2);

    userMe(false);
    await visibility("visible");
    await settle();
    expect(play.unconsumed).toHaveBeenCalledTimes(2);
  });
});
