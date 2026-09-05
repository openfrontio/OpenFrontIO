import type { PaymentsProvider } from "../core/ApiSchemas";
import {
  createPaymentsCheckout,
  finalizeSteamOrder,
  invalidateUserMe,
  type PaymentsCheckoutRequest,
  type PaymentsCheckoutResult,
} from "./Api";
import { showToast, translateText } from "./Utils";

export type { PaymentsProvider };

/**
 * Which payment rail this client buys on.
 *
 * The server does NOT infer the rail — `provider` is explicit on every
 * checkout — so this is the single place the decision is made. Steam inside
 * the desktop shell, Stripe on the web.
 *
 * Note what this deliberately does NOT check: whether Steam is actually
 * running, or whether the shell is new enough to carry the microtxn bridge.
 * `preload.ts` exposes the `steam` namespace unconditionally, so this is
 * true of every desktop build, Steam running or not.
 *
 * That is the right answer rather than a shortcut. The desktop build must
 * never reach Stripe — `navigationPolicy.ts` refuses payment-origin link-outs
 * — so falling back to "stripe" here would hand back a `redirectUrl` the
 * shell then blocks, which is a dead button and a support ticket. Choosing
 * "steam" instead fails honestly: without a Steam session the server answers
 * `provider_account_required`, which tells the player to sign in again. And
 * on a shell too old to have the bridge, the checkout still succeeds and the
 * overlay dialog still appears (the server raises it, not us) — the purchase
 * simply settles via the poll loop instead of our finalize call, which is
 * exactly what `startPurchase` reports as pending.
 */
export function paymentsProvider(): PaymentsProvider {
  return steamBridge() !== undefined ? "steam" : "stripe";
}

/**
 * Whether the custom-amount ("choose your own Plutonium") card should be
 * offered.
 *
 * custom_currency is switched off on the Steam rail for launch: the server
 * answers `kind_unavailable_on_provider` there, so offering the card would be
 * offering a button that cannot work. Hide it instead.
 */
export function customCurrencyAvailable(): boolean {
  return paymentsProvider() !== "steam";
}

// ---------------------------------------------------------------------------
// The desktop shell's Steam microtransaction bridge.

/**
 * Steam's report of what the player did with the overlay purchase dialog.
 *
 * `orderId` here is STEAM's order id, and it is null when the value could not
 * be represented exactly. It is NOT the id passed to finalizeSteamOrder --
 * that is the internal purchases id from the checkout response.
 */
export interface MicroTxnAuthorization {
  appId: number;
  orderId: string | null;
  authorized: boolean;
}

export interface SteamMicroTxnBridge {
  subscribe(listener: (e: MicroTxnAuthorization) => void): () => void;
  // The dialog can be approved before anything subscribes, so approvals queue
  // up. Draining is destructive.
  consumePending(): Promise<MicroTxnAuthorization[]>;
}

// window.openfrontDesktop is declared `unknown` by DesktopShell.ts (kept loose
// there on purpose), so narrow it locally -- same convention SteamSDK.ts
// follows, and for the same reason (a second `declare global` with a different
// type triggers TS2717).
function steamBridge(): { microTxn?: SteamMicroTxnBridge } | undefined {
  if (typeof window === "undefined") return undefined;
  const desktop = window.openfrontDesktop as
    | { steam?: { microTxn?: SteamMicroTxnBridge } }
    | undefined;
  return desktop?.steam;
}

/**
 * The microtransaction bridge, or null when it is unavailable -- on the web,
 * and on any desktop shell older than the one that introduced it. Returning
 * null rather than throwing is the contract every other shell bridge in this
 * client follows: the shell ships in the Steam depot and updates on Steam's
 * schedule while this client updates at runtime, so a client newer than its
 * shell is ordinary and must degrade rather than break.
 */
export function steamMicroTxn(): SteamMicroTxnBridge | null {
  return steamBridge()?.microTxn ?? null;
}

/**
 * How many overlay waits are currently blocked on the bridge.
 *
 * Delivery is EXACTLY ONCE: subscribe()'s callback and consumePending() go
 * through the same atomic drain in the main process, so an authorization
 * reaches exactly one of them. That makes a mount-time drain landing in the
 * middle of a purchase actively harmful -- it would take the authorization the
 * in-flight wait is blocked on and strand that purchase until it timed out.
 * The wait already drains for itself (see awaitSteamAuthorization), so while
 * one is running the mount drain stands down.
 */
let steamPurchaseInFlight = false;

/**
 * Drains the pending-authorization queue and RETURNS what was parked there.
 *
 * Call this every time the store or payment UI mounts. It is required, not an
 * optimisation: the main process parks authorizations and its "something
 * arrived" message to the renderer is a contentless nudge, so a nudge that
 * fires before any window exists (cold start, or before this UI mounted) is
 * heard by nobody and the authorization sits parked. subscribe() alone will
 * never surface it.
 *
 * Returns an empty list when there is no bridge, when the bridge fails, and
 * while an overlay wait is in flight.
 */
export async function drainPendingSteamAuthorizations(): Promise<
  MicroTxnAuthorization[]
> {
  const bridge = steamMicroTxn();
  if (!bridge || steamPurchaseInFlight) return [];
  try {
    return await bridge.consumePending();
  } catch (e) {
    console.error("drainPendingSteamAuthorizations: bridge failed", e);
    return [];
  }
}

/**
 * Drains at mount and tells the player about any approval found parked there.
 *
 * Such an approval CANNOT be finalized: the payload carries only Steam's own
 * order id, and finalize needs the internal one from the checkout response,
 * which this client no longer holds (the app restarted, or the store had not
 * mounted). The order is real and durable either way and the server-side
 * sweeper settles it, so the honest report is "still processing" rather than
 * silence -- and the cached wallet is dropped so the credit shows up when it
 * lands.
 *
 * A parked `authorized: false` needs no report: nothing was charged and the
 * player already knows they dismissed the dialog.
 *
 * Returns whether anything was reported.
 */
export async function reportPendingSteamAuthorizations(): Promise<boolean> {
  const parked = await drainPendingSteamAuthorizations();
  if (!parked.some((a) => a.authorized)) return false;
  invalidateUserMe();
  showToast(translateText("store.purchase_pending"), "green");
  return true;
}

/**
 * How long to wait for the player to answer the Steam overlay dialog.
 *
 * Generous on purpose: the timeout is a guard against a wedged bridge, not a
 * deadline for the player. It resolves to `pending` and NEVER finalizes, so
 * the worst case is that the server-side sweeper settles the order instead of
 * us.
 */
export const STEAM_OVERLAY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Whether this authorization belongs to the checkout that is waiting for it.
 *
 * Infra mints Steam's order id as `(namespace << 60) | purchases.id`, so the
 * low 60 bits are exactly the internal `orderId` that
 * `POST /payments/checkout` handed us and that we send to finalize. Masking
 * them off identifies the owner without the client needing to know the
 * environment namespace at all -- the high bits are simply discarded.
 *
 * A NULL order id is accepted rather than rejected. That is the documented
 * "arrived as a number that could not represent it exactly" case from the
 * shell's bridge: we cannot tell whose it is, and refusing would strand a real
 * approval. The in-flight guard in startPurchase means there is at most one
 * wait it could belong to, so accepting is the safe direction.
 *
 * This duplicates a bit layout that lives in infra, which is the one thing to
 * watch: if the mint changes, this silently stops matching and every
 * authorization looks like someone else's. The tests pin the round trip
 * against ids built the same way infra builds them.
 */
function belongsToOrder(auth: MicroTxnAuthorization, orderId: string): boolean {
  if (auth.orderId === null) return true;
  try {
    return (BigInt(auth.orderId) & ((1n << 60n) - 1n)).toString() === orderId;
  } catch {
    // Not a decimal integer, so it identifies nothing. Same reasoning as null.
    return true;
  }
}

async function awaitSteamAuthorization(
  bridge: SteamMicroTxnBridge,
  orderId: string,
): Promise<MicroTxnAuthorization | "timeout"> {
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<MicroTxnAuthorization | "timeout">((resolve) => {
      let settled = false;
      const settle = (value: MicroTxnAuthorization | "timeout") => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        unsubscribe = bridge.subscribe((auth) => {
          // A stale approval for an earlier purchase must not settle this
          // wait -- finalizing on it would call finalize for an order Valve
          // never approved. Keep waiting instead; the sweeper owns the other.
          if (!belongsToOrder(auth, orderId)) return;
          settle(auth);
        });
      } catch (e) {
        console.error("awaitSteamAuthorization: subscribe failed", e);
      }
      timer = setTimeout(() => settle("timeout"), STEAM_OVERLAY_TIMEOUT_MS);
      // Drained only AFTER subscribing, so an approval arriving while this is
      // in flight is caught by the listener rather than lost between the two.
      // The two paths cannot both see the same authorization -- delivery is
      // exactly-once through one atomic drain -- so this needs no de-duping;
      // the `settled` guard above is for the timeout race.
      void (async () => {
        try {
          const pending = (await bridge.consumePending()).filter((a) =>
            belongsToOrder(a, orderId),
          );
          if (pending.length === 0) return;
          // consume() is DESTRUCTIVE -- it clears everything it returns -- and
          // only one value can settle this wait, so anything not chosen here
          // is gone. Prefer a real approval over whatever happens to be first:
          // discarding an approval loses a purchase the player paid for, while
          // discarding a cancellation costs nothing. The server-side sweeper
          // still owns whatever we drop, which is why this warns rather than
          // trying to re-park anything.
          const approval = pending.find((a) => a.authorized);
          if (pending.length > 1) {
            console.warn(
              "awaitSteamAuthorization: drained more authorizations than this " +
                "wait can settle; the sweeper owns the remainder",
              { drained: pending.length, tookApproval: approval !== undefined },
            );
          }
          settle(approval ?? pending[0]);
        } catch (e) {
          console.error("awaitSteamAuthorization: consumePending failed", e);
        }
      })();
    });
  } finally {
    unsubscribe?.();
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// The purchase flow.

/** What to buy. The rail is chosen by {@link paymentsProvider}, not here. */
export type PurchaseRequest =
  | { kind: "currency_pack"; packName: string }
  | { kind: "custom_currency"; hardAmount: number }
  | { kind: "subscription_tier"; tierName: string };

export type PurchaseOutcome =
  // Navigation to the rail has been triggered; the page is going away.
  | { outcome: "redirecting" }
  // The Steam overlay purchase was approved and finalized.
  | { outcome: "completed" }
  // The player dismissed the Steam overlay. Nothing was charged and nothing
  // was finalized.
  | { outcome: "cancelled" }
  // The order is real and durable but its settlement is not ours to observe --
  // the server-side sweeper owns it. Say "check your order history"; never
  // "purchase failed".
  | { outcome: "pending" }
  // `message` is ready to display: already translated, or the server's own
  // player-facing text where it had one.
  | { outcome: "error"; message: string; refetchCatalog: boolean };

export interface StartPurchaseOptions {
  /** Injected so tests don't navigate the jsdom window. */
  navigate?: (url: string) => void;
}

function defaultNavigate(url: string): void {
  window.location.href = url;
}

// Rails are proper nouns, so they are interpolated rather than translated.
function providerName(provider: PaymentsProvider): string {
  return provider === "steam" ? "Steam" : "Stripe";
}

function error(message: string, refetchCatalog = false): PurchaseOutcome {
  return { outcome: "error", message, refetchCatalog };
}

function checkoutError(
  result: Extract<PaymentsCheckoutResult, { ok: false }>,
): PurchaseOutcome {
  switch (result.code) {
    case "listing_stale":
      return error(translateText("store.checkout_listing_stale"), true);
    case "retry_later":
      return error(translateText("store.checkout_retry_later"));
    case "kind_unavailable_on_provider":
      return error(
        translateText("store.checkout_kind_unavailable", {
          provider: providerName(result.provider),
        }),
      );
    case "provider_account_required":
      return error(
        translateText("store.checkout_reauth_required", {
          provider: providerName(result.provider),
        }),
      );
    case "unauthorized":
      return error(translateText("store.login_required"));
    // The server's text already names the rail the player subscribes on;
    // re-deriving that here would only risk disagreeing with it.
    case "subscription_exclusivity":
      return error(
        result.message !== ""
          ? result.message
          : translateText("store.checkout_failed"),
      );
    case "pending_provider_transaction":
      return error(
        translateText("store.pending_provider_transaction", {
          provider: providerName(result.provider),
        }),
      );
    case "rate_limited":
      return error(translateText("store.checkout_rate_limited"));
    // Not a breakage: the rail is deliberately switched off (501, never 500).
    case "provider_unavailable":
      return error(translateText("store.checkout_rail_unavailable"));
    case "provider_error":
      return error(
        translateText(
          result.retryable
            ? "store.checkout_retry_later"
            : "store.checkout_failed",
        ),
      );
    case "client_bug":
    case "failed":
      return error(translateText("store.checkout_failed"));
  }
}

/**
 * Buys one thing on the player's rail, all the way through the handoff.
 *
 * Branches on `handoff` and nothing else. A `client_overlay` response has
 * `redirectUrl: null` because Steam's dialog is already on the player's
 * screen, so deciding from "is there a URL?" would silently mishandle it.
 */
export async function startPurchase(
  request: PurchaseRequest,
  options: StartPurchaseOptions = {},
): Promise<PurchaseOutcome> {
  const navigate = options.navigate ?? defaultNavigate;
  const provider = paymentsProvider();

  // Refuse a second overlay purchase while one is still waiting, BEFORE
  // minting an order for it.
  //
  // The bridge fans an authorization out to every live listener, so two waits
  // running at once both settle on whichever dialog the player answered, and
  // each then finalizes ITS OWN order id -- one of which Valve never approved.
  // The server's QueryTxn-first guard means that cannot double-charge, but the
  // client should not be issuing the call, and the order it minted would be
  // left open for the sweeper to tidy.
  //
  // Refusing mirrors the platform's own rule rather than inventing one: Steam
  // error 107 is "user has a pending transaction that must be completed before
  // beginning a new transaction", so a second InitTxn is very likely refused
  // anyway. This makes the client's behaviour explicit and legible instead of
  // depending on that.
  //
  // Deliberately BEFORE createPaymentsCheckout: refusing after would leave a
  // stranded PENDING row behind every rejected click.
  if (provider === "steam" && steamPurchaseInFlight) {
    return error(
      translateText("store.pending_provider_transaction", {
        provider: providerName(provider),
      }),
    );
  }
  // RESERVE, do not merely check. Reading the flag and then awaiting the
  // checkout would leave a window in which a second call reads the same
  // `false`, so both mint an order and both open a wait -- the exact failure
  // this guard exists to prevent, plus a stranded order. The reservation is
  // taken synchronously, before the first await, and released in the `finally`
  // below on every exit including a failed checkout.
  const reserved = provider === "steam";
  if (reserved) steamPurchaseInFlight = true;
  try {
    return await runPurchase(provider, request, navigate);
  } finally {
    if (reserved) steamPurchaseInFlight = false;
  }
}

async function runPurchase(
  provider: PaymentsProvider,
  request: PurchaseRequest,
  navigate: (url: string) => void,
): Promise<PurchaseOutcome> {
  const result = await createPaymentsCheckout({
    provider,
    ...request,
  } as PaymentsCheckoutRequest);
  if (!result.ok) return checkoutError(result);

  const { handoff, redirectUrl, orderId } = result.data;

  if (handoff === "redirect") {
    // Verbatim. The URL is the rail's, signed and parameterised by it -- do
    // not parse it, append to it, or rewrite it. The schema has already
    // guaranteed it is non-null for this handoff.
    navigate(redirectUrl!);
    return { outcome: "redirecting" };
  }

  // handoff === "client_overlay": there is nothing to navigate to.
  showToast(translateText("store.steam_overlay_waiting"), "green");

  const bridge = steamMicroTxn();
  if (bridge === null || orderId === null) {
    // The order exists either way; we simply cannot observe or address it.
    console.error(
      "startPurchase: client_overlay handoff without a usable bridge/order id",
      { hasBridge: bridge !== null, orderId },
    );
    return { outcome: "pending" };
  }

  // No counter maintained here: the reservation taken in startPurchase covers
  // the checkout AND the wait, so a mount-time drain stands down for the whole
  // purchase rather than only while the listener is attached.
  const authorization = await awaitSteamAuthorization(bridge, orderId);

  // SAFETY: finalize only on a reported authorization. A client-channel order
  // skips the server's abandon rule and settles unconditionally, so finalizing
  // a cancelled or unanswered dialog charges a player who walked away.
  if (authorization === "timeout") return { outcome: "pending" };
  if (!authorization.authorized) return { outcome: "cancelled" };

  const finalized = await finalizeSteamOrder(orderId);
  // Steam authorized the purchase, so the money settles regardless of whether
  // our finalize call landed. An unreachable finalize is pending, not failed.
  if (!finalized.ok) return { outcome: "pending" };

  switch (finalized.resolution) {
    case "settled":
      return { outcome: "completed" };
    // The one resolution that means the buyer was never charged and never
    // will be.
    case "expired":
      return error(translateText("store.purchase_failed"));
    // Neither is a failure. "open" is in fact the EXPECTED answer to a prompt
    // finalize on the client channel -- an order Valve still reports as Init
    // resolves to "open" and the credit arrives via the poll loop shortly
    // after. "unresolved" is transient. The sweeper owns both.
    case "open":
    case "unresolved":
      return { outcome: "pending" };
  }
}

/**
 * The one line to show the player once a purchase settles, or null when there
 * is nothing to say because the page is already navigating away.
 *
 * `successMessageKey` is the caller's, because only the caller knows what was
 * bought. Everything else is shared, and deliberately so: "cancelled" must
 * always reassure that nothing was charged, and "pending" must always point at
 * order history rather than report a failure.
 */
export function purchaseOutcomeMessage(
  outcome: PurchaseOutcome,
  successMessageKey: string,
): string | null {
  switch (outcome.outcome) {
    case "redirecting":
      return null;
    case "completed":
      return translateText(successMessageKey);
    case "cancelled":
      return translateText("store.steam_overlay_cancelled");
    case "pending":
      return translateText("store.purchase_pending");
    case "error":
      return outcome.message;
  }
}

// ---------------------------------------------------------------------------
// The return page.

export type PurchaseReturnStatus = "success" | "pending" | "failed";

/**
 * Reads the `status` param on the #purchase-completed landing URL.
 *
 * `pending` is the value that used to fall into the failure branch, and it is
 * the one that means the purchase is GOING TO SUCCEED: capture is still in
 * flight, the resolve threw, or the rail was disabled mid-flight. In all three
 * the order is durable and something else owns it, so it must never be
 * reported to the player as a failure.
 */
export function classifyPurchaseReturn(
  status: string | null,
): PurchaseReturnStatus {
  if (status === "true") return "success";
  // ONLY an explicit "false" is a failure. Everything else -- "pending", a
  // value the rail adds later, a missing param -- degrades to pending, which
  // sends the player to their order history rather than asserting an outcome
  // we do not know. Defaulting the unknown case to "failed" is the same
  // mistake this function was written to fix.
  if (status === "false") return "failed";
  return "pending";
}
