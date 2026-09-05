import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  createPaymentsCheckout: vi.fn(),
  finalizeSteamOrder: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: vi.fn((key: string) => key),
}));

import type { PaymentsCheckoutResult } from "../../src/client/Api";
import {
  createPaymentsCheckout,
  finalizeSteamOrder,
  invalidateUserMe,
} from "../../src/client/Api";
import {
  classifyPurchaseReturn,
  customCurrencyAvailable,
  drainPendingSteamAuthorizations,
  paymentsProvider,
  purchaseOutcomeMessage,
  reportPendingSteamAuthorizations,
  startPurchase,
  STEAM_OVERLAY_TIMEOUT_MS,
  steamMicroTxn,
} from "../../src/client/Payments";
import { translateText } from "../../src/client/Utils";

const checkoutMock = createPaymentsCheckout as unknown as ReturnType<
  typeof vi.fn
>;
const finalizeMock = finalizeSteamOrder as unknown as ReturnType<typeof vi.fn>;

type Authorization = {
  appId: number;
  orderId: string | null;
  authorized: boolean;
};

/** Lets startPurchase run far enough to have subscribed to the bridge. */
async function tick(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Installs a fake desktop shell with (optionally) a Steam microtxn bridge. */
function installShell(options: { steam?: boolean; microTxn?: boolean } = {}) {
  const listeners: ((e: Authorization) => void)[] = [];
  let pending: Authorization[] = [];
  const bridge = {
    subscribe: vi.fn((listener: (e: Authorization) => void) => {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
    consumePending: vi.fn(async () => {
      const drained = pending;
      pending = [];
      return drained;
    }),
  };
  (window as any).openfrontDesktop = {
    steam:
      options.steam === false
        ? undefined
        : {
            getAuthTicket: async () => ({ ok: false, reason: "unavailable" }),
            getUser: async () => null,
            ...(options.microTxn === false ? {} : { microTxn: bridge }),
          },
  };
  return {
    bridge,
    emit: (e: Authorization) => listeners.forEach((l) => l(e)),
    queue: (e: Authorization) => pending.push(e),
    listenerCount: () => listeners.length,
    /**
     * Resolves once the code under test has actually subscribed to the bridge.
     *
     * Replaces a fixed `await tick()` flush count. How many microtasks elapse
     * before the subscription lands depends on how many awaits the production
     * path happens to contain, so a constant is a race rather than a wait --
     * and it lost whenever the whole directory ran, firing emit() into an
     * empty listener list. That failed non-deterministically (a different
     * three-to-six tests each run) and passed every time this file was run
     * alone, which is the signature of exactly this bug.
     *
     * Bounded rather than unbounded so a genuine "never subscribes"
     * regression fails the test quickly instead of hanging the suite.
     */
    whenListening: async (budget = 1000) => {
      for (let i = 0; i < budget; i++) {
        if (listeners.length > 0) return;
        await Promise.resolve();
      }
      throw new Error(
        "the code under test never subscribed to the microTxn bridge",
      );
    },
  };
}

function okRedirect(url: string): PaymentsCheckoutResult {
  return {
    ok: true,
    data: {
      orderId: "1234",
      provider: "stripe",
      kind: "currency_pack",
      handoff: "redirect",
      redirectUrl: url,
      expiresAt: null,
    },
  };
}

function okOverlay(orderId: string | null = "1234"): PaymentsCheckoutResult {
  return {
    ok: true,
    data: {
      orderId,
      provider: "steam",
      kind: "currency_pack",
      handoff: "client_overlay",
      redirectUrl: null,
      expiresAt: null,
    },
  };
}

const PACK: Parameters<typeof startPurchase>[0] = {
  kind: "currency_pack",
  packName: "starter_pack",
};

let navigate: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  navigate = vi.fn();
  checkoutMock.mockReset();
  finalizeMock.mockReset();
  vi.mocked(invalidateUserMe).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete (window as any).openfrontDesktop;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("paymentsProvider", () => {
  it("is stripe on the plain web build", () => {
    expect(paymentsProvider()).toBe("stripe");
  });

  it("is steam inside the desktop shell when the Steam bridge is present", () => {
    installShell();
    expect(paymentsProvider()).toBe("steam");
  });

  it("is stripe inside a desktop shell with no Steam bridge", () => {
    installShell({ steam: false });
    expect(paymentsProvider()).toBe("stripe");
  });
});

describe("customCurrencyAvailable", () => {
  it("is available on the Stripe rail", () => {
    expect(customCurrencyAvailable()).toBe(true);
  });

  // custom_currency is off on Steam for launch; the server answers
  // kind_unavailable_on_provider, so the card must not be offered at all.
  it("is unavailable on the Steam rail", () => {
    installShell();
    expect(customCurrencyAvailable()).toBe(false);
  });
});

describe("steamMicroTxn", () => {
  it("is null on the web", () => {
    expect(steamMicroTxn()).toBeNull();
  });

  it("is null on a desktop shell too old to expose microTxn", () => {
    installShell({ microTxn: false });
    expect(steamMicroTxn()).toBeNull();
  });

  it("returns the bridge when the shell exposes it", () => {
    const shell = installShell();
    expect(steamMicroTxn()).toBe(shell.bridge);
  });
});

// The main process parks authorizations in a queue and its "something
// arrived" nudge is contentless: if that nudge fires before any window exists,
// nobody hears it and the authorization sits parked. subscribe() alone will
// never surface it, so draining at mount is REQUIRED, not an optimisation.
describe("drainPendingSteamAuthorizations", () => {
  it("returns what it drained instead of discarding it", async () => {
    const shell = installShell();
    const parked = { appId: 480, orderId: "9", authorized: true };
    shell.queue(parked);

    expect(await drainPendingSteamAuthorizations()).toEqual([parked]);
    expect(shell.bridge.consumePending).toHaveBeenCalledOnce();
  });

  it("returns nothing without a bridge", async () => {
    await expect(drainPendingSteamAuthorizations()).resolves.toEqual([]);
  });

  it("survives a bridge that throws", async () => {
    const shell = installShell();
    shell.bridge.consumePending.mockRejectedValueOnce(new Error("ipc gone"));
    await expect(drainPendingSteamAuthorizations()).resolves.toEqual([]);
  });

  // Delivery is exactly-once through one atomic drain shared by subscribe()
  // and consumePending(), so a mount drain landing mid-purchase would TAKE the
  // authorization the in-flight wait is blocked on and strand that purchase.
  it("does not drain while an overlay wait is in flight", async () => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));
    finalizeMock.mockResolvedValue({ ok: true, resolution: "settled" });

    const promise = startPurchase(PACK, { navigate });
    await tick();
    shell.bridge.consumePending.mockClear();

    expect(await drainPendingSteamAuthorizations()).toEqual([]);
    expect(shell.bridge.consumePending).not.toHaveBeenCalled();

    shell.emit({ appId: 480, orderId: "7777", authorized: true });
    expect(await promise).toEqual({ outcome: "completed" });

    // ...and it drains again once the wait is over.
    await drainPendingSteamAuthorizations();
    expect(shell.bridge.consumePending).toHaveBeenCalled();
  });
});

// An authorization carries only Steam's own order id, so an approval drained
// at mount cannot be finalized -- we no longer hold the internal order id it
// belongs to. It is still real, and the server sweeper settles it, so the
// player is told it is processing rather than left with silence.
describe("reportPendingSteamAuthorizations", () => {
  let stopListening: (() => void) | undefined;
  afterEach(() => {
    stopListening?.();
    stopListening = undefined;
  });

  function toasts() {
    const seen: string[] = [];
    const onToast = (e: Event) => seen.push((e as CustomEvent).detail.message);
    window.addEventListener("show-message", onToast);
    stopListening = () => window.removeEventListener("show-message", onToast);
    return seen;
  }

  it("announces a parked approval and drops the cached wallet", async () => {
    const shell = installShell();
    shell.queue({ appId: 480, orderId: "9", authorized: true });
    const seen = toasts();

    expect(await reportPendingSteamAuthorizations()).toBe(true);
    expect(seen).toContain("store.purchase_pending");
    expect(invalidateUserMe).toHaveBeenCalled();
  });

  it("says nothing for a parked cancellation", async () => {
    const shell = installShell();
    shell.queue({ appId: 480, orderId: "9", authorized: false });
    const seen = toasts();

    expect(await reportPendingSteamAuthorizations()).toBe(false);
    expect(seen).toEqual([]);
    expect(invalidateUserMe).not.toHaveBeenCalled();
  });

  it("says nothing when the queue is empty", async () => {
    installShell();
    const seen = toasts();

    expect(await reportPendingSteamAuthorizations()).toBe(false);
    expect(seen).toEqual([]);
  });

  it("is silent and harmless on the web", async () => {
    expect(await reportPendingSteamAuthorizations()).toBe(false);
  });
});

describe("startPurchase — redirect handoff", () => {
  it("navigates to redirectUrl verbatim", async () => {
    const url = "https://checkout.stripe.com/c/pay/cs_test_a1?x=1&y=2#frag";
    checkoutMock.mockResolvedValue(okRedirect(url));

    const result = await startPurchase(PACK, { navigate });

    expect(result).toEqual({ outcome: "redirecting" });
    expect(navigate).toHaveBeenCalledWith(url);
  });

  it("sends the rail the client picked", async () => {
    installShell();
    checkoutMock.mockResolvedValue(okOverlay());
    finalizeMock.mockResolvedValue({ ok: true, resolution: "settled" });
    const shell = installShell();

    const promise = startPurchase(PACK, { navigate });
    await shell.whenListening();
    shell.emit({ appId: 1, orderId: "s-1", authorized: true });
    await promise;

    expect(checkoutMock).toHaveBeenCalledWith({
      provider: "steam",
      kind: "currency_pack",
      packName: "starter_pack",
    });
  });

  // A client_overlay response carries redirectUrl: null. Branching on the URL
  // instead of on handoff would try to navigate to nothing.
  it("does not navigate on a client_overlay handoff", async () => {
    installShell();
    checkoutMock.mockResolvedValue(okOverlay());
    finalizeMock.mockResolvedValue({ ok: true, resolution: "settled" });
    const shell = installShell();

    const promise = startPurchase(PACK, { navigate });
    await shell.whenListening();
    shell.emit({ appId: 1, orderId: "s-1", authorized: true });
    await promise;

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("startPurchase — Steam overlay handoff", () => {
  it("finalizes with the INTERNAL order id once Steam reports authorization", async () => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));
    finalizeMock.mockResolvedValue({ ok: true, resolution: "settled" });

    const promise = startPurchase(PACK, { navigate });
    await shell.whenListening();
    // Steam's own order id is deliberately different — it must not be used.
    shell.emit({ appId: 480, orderId: "77770000", authorized: true });

    expect(await promise).toEqual({ outcome: "completed" });
    expect(finalizeMock).toHaveBeenCalledWith("1234");
  });

  it("NEVER finalizes a dialog the player cancelled", async () => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));

    const promise = startPurchase(PACK, { navigate });
    await shell.whenListening();
    shell.emit({ appId: 480, orderId: "77770000", authorized: false });

    expect(await promise).toEqual({ outcome: "cancelled" });
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("picks up an authorization that landed before it subscribed", async () => {
    const shell = installShell();
    shell.queue({ appId: 480, orderId: "77770000", authorized: true });
    checkoutMock.mockResolvedValue(okOverlay("1234"));
    finalizeMock.mockResolvedValue({ ok: true, resolution: "settled" });

    expect(await startPurchase(PACK, { navigate })).toEqual({
      outcome: "completed",
    });
    expect(finalizeMock).toHaveBeenCalledWith("1234");
  });

  it("unsubscribes once the wait settles", async () => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));
    finalizeMock.mockResolvedValue({ ok: true, resolution: "settled" });

    const promise = startPurchase(PACK, { navigate });
    await shell.whenListening();
    shell.emit({ appId: 480, orderId: null, authorized: true });
    await promise;

    expect(shell.listenerCount()).toBe(0);
  });

  it("announces the waiting state without blocking", async () => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));
    finalizeMock.mockResolvedValue({ ok: true, resolution: "settled" });

    const messages: string[] = [];
    const onToast = (e: Event) =>
      messages.push((e as CustomEvent).detail.message);
    window.addEventListener("show-message", onToast);

    const promise = startPurchase(PACK, { navigate });
    await shell.whenListening();
    expect(messages).toContain("store.steam_overlay_waiting");
    shell.emit({ appId: 480, orderId: null, authorized: true });
    await promise;

    window.removeEventListener("show-message", onToast);
  });

  // The order is durable and the server-side sweeper owns it, so an
  // unobservable overlay is "pending", never "failed".
  it("reports pending — and does not finalize — when the shell has no microTxn bridge", async () => {
    installShell({ microTxn: false });
    checkoutMock.mockResolvedValue(okOverlay("1234"));

    expect(await startPurchase(PACK, { navigate })).toEqual({
      outcome: "pending",
    });
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("reports pending — and does not finalize — when the response carries no order id", async () => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay(null));

    // No emit and no wait for a subscription: with no order id there is
    // nothing to finalize, so this path returns pending WITHOUT ever
    // subscribing. Asserting the listener count is the real invariant --
    // an emit here would fire into an empty list and prove nothing.
    expect(await startPurchase(PACK, { navigate })).toEqual({
      outcome: "pending",
    });
    expect(shell.listenerCount()).toBe(0);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("times out to pending, never to a failure, and does not finalize", async () => {
    vi.useFakeTimers();
    installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));

    const promise = startPurchase(PACK, { navigate });
    await vi.advanceTimersByTimeAsync(STEAM_OVERLAY_TIMEOUT_MS + 1);

    expect(await promise).toEqual({ outcome: "pending" });
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  // finalize answers with one of FOUR resolutions and only two are terminal.
  // Collapsing "open"/"unresolved" into an error is the same mistake as
  // reading status=pending on the return page as "purchase failed".
  it.each([
    ["settled", { outcome: "completed" }],
    ["open", { outcome: "pending" }],
    ["unresolved", { outcome: "pending" }],
  ] as const)("maps resolution %s", async (resolution, expected) => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));
    finalizeMock.mockResolvedValue({ ok: true, resolution });

    const promise = startPurchase(PACK, { navigate });
    await shell.whenListening();
    shell.emit({ appId: 480, orderId: "7777", authorized: true });

    expect(await promise).toEqual(expected);
  });

  // The wait's own drain is destructive: consume() clears everything it
  // returns. Taking pending[0] blindly therefore DISCARDS any other parked
  // authorization, and an approval thrown away here is a purchase the player
  // paid for and never hears about again from us. Rare -- the store-open
  // drain normally empties the queue first -- but it is money, so prefer a
  // real approval over whatever happens to be first.
  it("prefers a parked approval over an earlier parked cancellation", async () => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));
    finalizeMock.mockResolvedValue({ ok: true, resolution: "settled" });
    shell.queue({ appId: 480, orderId: "aaa", authorized: false });
    shell.queue({ appId: 480, orderId: "bbb", authorized: true });

    expect(await startPurchase(PACK, { navigate })).toEqual({
      outcome: "completed",
    });
    expect(finalizeMock).toHaveBeenCalledWith("1234");
  });

  // "expired" is the one resolution that means the buyer was never charged
  // and never will be. It is the ONLY definitive failure.
  it("reports a definitive failure for resolution expired", async () => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));
    finalizeMock.mockResolvedValue({ ok: true, resolution: "expired" });

    const promise = startPurchase(PACK, { navigate });
    await shell.whenListening();
    shell.emit({ appId: 480, orderId: "7777", authorized: true });

    expect(await promise).toEqual({
      outcome: "error",
      message: "store.purchase_failed",
      refetchCatalog: false,
    });
  });

  // Steam authorized the purchase, so the money settles regardless; an
  // unreachable finalize is the server's problem, not a failed purchase.
  it("reports pending when finalize fails after a real authorization", async () => {
    const shell = installShell();
    checkoutMock.mockResolvedValue(okOverlay("1234"));
    finalizeMock.mockResolvedValue({ ok: false, code: "failed" });

    const promise = startPurchase(PACK, { navigate });
    await shell.whenListening();
    shell.emit({ appId: 480, orderId: "7777", authorized: true });

    expect(await promise).toEqual({ outcome: "pending" });
  });
});

describe("startPurchase — error mapping", () => {
  async function failWith(result: PaymentsCheckoutResult) {
    checkoutMock.mockResolvedValue(result);
    return startPurchase(PACK, { navigate });
  }

  it("shows the generic checkout failure for a client bug", async () => {
    expect(await failWith({ ok: false, code: "client_bug" })).toEqual({
      outcome: "error",
      message: "store.checkout_failed",
      refetchCatalog: false,
    });
  });

  it("asks for a catalog refetch on a stale listing", async () => {
    expect(await failWith({ ok: false, code: "listing_stale" })).toEqual({
      outcome: "error",
      message: "store.checkout_listing_stale",
      refetchCatalog: true,
    });
  });

  it("says try again later when the listing has not synced", async () => {
    expect(await failWith({ ok: false, code: "retry_later" })).toMatchObject({
      message: "store.checkout_retry_later",
    });
  });

  it("maps kind_unavailable_on_provider to its own message", async () => {
    expect(
      await failWith({
        ok: false,
        code: "kind_unavailable_on_provider",
        provider: "steam",
        kind: "custom_currency",
      }),
    ).toMatchObject({ message: "store.checkout_kind_unavailable" });
  });

  it("prompts re-auth when the rail account is missing", async () => {
    expect(
      await failWith({
        ok: false,
        code: "provider_account_required",
        provider: "steam",
      }),
    ).toMatchObject({ message: "store.checkout_reauth_required" });
    expect(translateText).toHaveBeenCalledWith(
      "store.checkout_reauth_required",
      { provider: "Steam" },
    );
  });

  it("asks the player to log in on 401", async () => {
    expect(await failWith({ ok: false, code: "unauthorized" })).toMatchObject({
      message: "store.login_required",
    });
  });

  // The server's message names the rail, so it is shown as-is rather than
  // replaced by a key that would have to re-derive it.
  it("shows the server's own text for a subscription exclusivity conflict", async () => {
    expect(
      await failWith({
        ok: false,
        code: "subscription_exclusivity",
        message: "You already subscribe through Stripe.",
        existingProvider: "stripe",
        existingTier: "supporter",
      }),
    ).toEqual({
      outcome: "error",
      message: "You already subscribe through Stripe.",
      refetchCatalog: false,
    });
  });

  it("names the rail when an earlier transaction is still open", async () => {
    expect(
      await failWith({
        ok: false,
        code: "pending_provider_transaction",
        provider: "steam",
      }),
    ).toMatchObject({ message: "store.pending_provider_transaction" });
    expect(translateText).toHaveBeenCalledWith(
      "store.pending_provider_transaction",
      { provider: "Steam" },
    );
  });

  it("backs off on 429", async () => {
    expect(
      await failWith({
        ok: false,
        code: "rate_limited",
        retryAfterSeconds: 42,
      }),
    ).toMatchObject({ message: "store.checkout_rate_limited" });
  });

  it("says the rail is off on 501 rather than reporting a breakage", async () => {
    expect(
      await failWith({
        ok: false,
        code: "provider_unavailable",
        provider: "steam",
      }),
    ).toMatchObject({ message: "store.checkout_rail_unavailable" });
  });

  it("invites a retry for a retryable provider error", async () => {
    expect(
      await failWith({
        ok: false,
        code: "provider_error",
        provider: "steam",
        providerCode: "k_EResultTimeout",
        retryable: true,
      }),
    ).toMatchObject({ message: "store.checkout_retry_later" });
  });

  it("does not invite a retry for a non-retryable provider error", async () => {
    expect(
      await failWith({
        ok: false,
        code: "provider_error",
        provider: "steam",
        providerCode: "k_EResultInvalidParam",
        retryable: false,
      }),
    ).toMatchObject({ message: "store.checkout_failed" });
  });
});

describe("classifyPurchaseReturn", () => {
  it("treats status=true as success", () => {
    expect(classifyPurchaseReturn("true")).toBe("success");
  });

  // The credit lands seconds later; the order is durable and something else
  // owns it. Falling into the failure branch (the old behaviour) tells a
  // paying player their purchase failed when it did not.
  it("treats status=pending as pending, NOT as a failure", () => {
    expect(classifyPurchaseReturn("pending")).toBe("pending");
  });

  it("treats status=false as a failure", () => {
    expect(classifyPurchaseReturn("false")).toBe("failed");
  });

  // Only an EXPLICIT "false" is a failure. Anything unrecognised degrades to
  // pending, which points the player at their order history instead of
  // asserting something we do not know. Defaulting the unknown case to
  // "failed" repeats the exact bug this classifier exists to fix: if the rail
  // ever grows a fourth status value, a player whose purchase is fine would
  // be told it failed. The asymmetry is deliberate -- wrongly saying "still
  // processing" costs a little confusion, wrongly saying "failed" costs a
  // support ticket from someone who has been charged.
  it("treats a missing or unknown status as pending, not as a failure", () => {
    expect(classifyPurchaseReturn(null)).toBe("pending");
    expect(classifyPurchaseReturn("wat")).toBe("pending");
  });
});

describe("purchaseOutcomeMessage", () => {
  it("says nothing while the page is navigating away", () => {
    expect(
      purchaseOutcomeMessage({ outcome: "redirecting" }, "store.ok"),
    ).toBeNull();
  });

  it("uses the caller's success message when the purchase completed", () => {
    expect(purchaseOutcomeMessage({ outcome: "completed" }, "store.ok")).toBe(
      "store.ok",
    );
  });

  it("reassures the player that a cancelled overlay charged nothing", () => {
    expect(purchaseOutcomeMessage({ outcome: "cancelled" }, "store.ok")).toBe(
      "store.steam_overlay_cancelled",
    );
  });

  // Never "purchase failed": the order is durable and something else owns it.
  it("points a pending purchase at order history, not at a failure", () => {
    expect(purchaseOutcomeMessage({ outcome: "pending" }, "store.ok")).toBe(
      "store.purchase_pending",
    );
  });

  it("passes an error's already-resolved message straight through", () => {
    expect(
      purchaseOutcomeMessage(
        {
          outcome: "error",
          message: "You already subscribe through Stripe.",
          refetchCatalog: false,
        },
        "store.ok",
      ),
    ).toBe("You already subscribe through Stripe.");
  });
});
