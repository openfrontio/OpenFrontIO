import type {
  PaymentsProvider,
  StorePlacement,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import {
  createPaymentsCheckout,
  finalizeGooglePurchase,
  finalizeSteamOrder,
  type FinalizeGooglePurchaseResult,
  getUserMe,
  invalidateUserMe,
  type PaymentsCheckoutRequest,
  type PaymentsCheckoutResult,
} from "./Api";
import {
  desktopPlayBilling,
  isDesktopShell,
  type PlayBilling,
} from "./DesktopShell";
import { showToast, translateText } from "./Utils";

export type { PaymentsProvider };

/**
 * The checkout rails, plus two the checkout never sees. "google" is the
 * Android app's Play billing: its purchases are credited by
 * POST /payments/google/finalize, not bought through /payments/checkout.
 * "none" is an Android app without the Play billing bridge, which sells
 * nothing for real money.
 */
export type PaymentsRail = PaymentsProvider | "google" | "none";

/**
 * Which payment rail this client buys on.
 *
 * The server does NOT infer the rail — `provider` is explicit on every
 * checkout — so this is the single place the decision is made. Steam inside
 * the desktop shell, Google Play inside the Android app, Stripe on the web.
 *
 * The Android app must never reach Stripe either: Play is the only way it may
 * take money for anything in the game. An Android app without the Play
 * billing bridge (one older than it) is therefore "none", never "stripe".
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
export function paymentsProvider(): PaymentsRail {
  if (steamBridge() !== undefined) return "steam";
  if (desktopPlayBilling() !== null) return "google";
  // Any other shell is the Android app.
  if (isDesktopShell()) return "none";
  return "stripe";
}

/**
 * True in the Android app, where Google Play is the only way to pay. Nothing
 * else real-money (checkout, subscriptions, custom amounts, the billing
 * portal) may be offered there, and nothing may point the player elsewhere to
 * buy.
 */
export function sellsOnlyThroughPlay(): boolean {
  const rail = paymentsProvider();
  return rail === "google" || rail === "none";
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
interface SteamPaymentsBridge {
  microTxn?: SteamMicroTxnBridge;
  isOverlayAttached?: () => Promise<boolean>;
}

function steamBridge(): SteamPaymentsBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const desktop = window.openfrontDesktop as
    | { steam?: SteamPaymentsBridge }
    | undefined;
  return desktop?.steam;
}

/**
 * Whether Steam can show its purchase dialog in this window. A shell too old
 * to say is assumed to have the overlay, which is what every purchase before
 * this assumed.
 */
async function steamOverlayAttached(): Promise<boolean> {
  const check = steamBridge()?.isOverlayAttached;
  if (typeof check !== "function") return true;
  try {
    return await check();
  } catch (e) {
    console.error("steamOverlayAttached: bridge failed", e);
    return true;
  }
}

/**
 * How long after sending a player to Steam's approval page a refocused game
 * window re-reads the account. The purchase settles when their browser
 * reaches the return route, which this window never hears about.
 */
const BROWSER_APPROVAL_REFRESH_MS = 15 * 60 * 1000;

let refreshAccount: () => unknown = () => invalidateUserMe();
let browserApprovalUntil = 0;
let refreshingOnFocus = false;

/** Main supplies the refetch-and-broadcast, which lives above this module. */
export function setPurchaseAccountRefresh(refresh: () => unknown): void {
  refreshAccount = refresh;
}

function refreshOnReturnFromBrowser(): void {
  browserApprovalUntil = Date.now() + BROWSER_APPROVAL_REFRESH_MS;
  if (refreshingOnFocus) return;
  refreshingOnFocus = true;
  window.addEventListener("focus", () => {
    if (Date.now() <= browserApprovalUntil) void refreshAccount();
  });
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
export type PurchaseRequest = (
  | { kind: "currency_pack"; packName: string }
  | { kind: "custom_currency"; hardAmount: number }
  | { kind: "subscription_tier"; tierName: string }
) & {
  /** Where in the store it was bought (store analytics); omitted when unknown. */
  placement?: StorePlacement;
};

export type PurchaseOutcome =
  // Navigation to the rail has been triggered; the page is going away.
  | { outcome: "redirecting" }
  // A desktop without the Steam overlay: Steam's approval page is open in the
  // player's browser, and the purchase settles when they approve it there.
  | { outcome: "browser_approval" }
  // The Steam overlay purchase was approved and finalized.
  | { outcome: "completed" }
  // The player dismissed the Steam overlay. Nothing was charged and nothing
  // was finalized. `quiet`: nothing to tell them (they closed Play's sheet, or
  // a purchase was already running).
  | { outcome: "cancelled"; quiet?: true }
  // The order is real and durable but its settlement is not ours to observe --
  // the server-side sweeper owns it. Say "check your order history"; never
  // "purchase failed". `message` replaces that line where the rail has a more
  // precise one (Play).
  | { outcome: "pending"; message?: string }
  // `message` is ready to display: already translated, or the server's own
  // player-facing text where it had one. `manageBilling` means the fix is in
  // the billing portal, so callers should offer a way there.
  | {
      outcome: "error";
      message: string;
      refetchCatalog: boolean;
      manageBilling?: true;
    };

export type PurchaseError = Extract<PurchaseOutcome, { outcome: "error" }>;

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

function error(message: string, refetchCatalog = false): PurchaseError {
  return { outcome: "error", message, refetchCatalog };
}

function checkoutError(
  result: Extract<PaymentsCheckoutResult, { ok: false }>,
): PurchaseError {
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
    case "subscription_past_due":
      return {
        ...error(translateText("store.subscription_past_due")),
        manageBilling: true,
      };
    // Nothing was charged; the store's own copy for "you have this already".
    case "already_subscribed":
      return error(translateText("store.already_subscribed"));
    // The server's text says what to do (cancel in the Steam account, then
    // subscribe again); fall back to a generic line if it sent none.
    case "tier_change_unavailable_on_provider":
      return error(
        result.message !== ""
          ? result.message
          : translateText("store.checkout_tier_change_unavailable", {
              provider: providerName(result.provider),
            }),
      );
    case "rate_limited":
      return error(translateText("store.checkout_rate_limited"));
    case "steam_licence_required":
      return error(translateText("store.steam_licence_required"));
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

  // The Android app buys only through startPlayPurchase; nothing it shows
  // should get here, and a checkout must never be minted for it if it does.
  if (provider === "google" || provider === "none") {
    return error(translateText("store.play_unavailable"));
  }

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
  // Leaving "client_overlay" out is what asks the server for Steam's web
  // approval page instead of a dialog nobody would see.
  const withoutOverlay =
    provider === "steam" && !(await steamOverlayAttached());
  const result = await createPaymentsCheckout({
    provider,
    ...request,
    ...(withoutOverlay ? { handoffs: ["redirect"] } : {}),
  } as PaymentsCheckoutRequest);
  if (!result.ok) return checkoutError(result);

  const { handoff, redirectUrl, orderId } = result.data;

  if (handoff === "redirect") {
    // Verbatim. The URL is the rail's, signed and parameterised by it -- do
    // not parse it, append to it, or rewrite it. The schema has already
    // guaranteed it is non-null for this handoff.
    navigate(redirectUrl!);
    if (provider !== "steam") return { outcome: "redirecting" };
    // The desktop shell opens Steam's page in the OS browser and this window
    // stays put.
    refreshOnReturnFromBrowser();
    return { outcome: "browser_approval" };
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

// ---------------------------------------------------------------------------
// Google Play (the Android app).
//
// Play does the charging; the server credits the purchase when the client
// posts its token to POST /payments/google/finalize, and consumes it once
// credited. Until then the purchase stays in the bridge's unconsumed() list,
// so posting it again is the retry: the drain below does that whenever the
// app opens. The client never consumes anything itself.

/**
 * Play's local price for each product id it returned, or null when there is
 * no bridge or Play could not answer. Ids Play did not return are absent.
 */
export async function fetchPlayPrices(
  productIds: string[],
): Promise<Map<string, string> | null> {
  const billing = desktopPlayBilling();
  if (billing === null) return null;
  if (productIds.length === 0) return new Map();
  const result = await billing.products(productIds);
  if (result.status !== "ok") return null;
  return new Map(result.products.map((p) => [p.productId, p.formattedPrice]));
}

// A purchase posts its own token, so a drain asked for while one runs waits
// for it to finish.
let playPurchaseInFlight = false;
let playDrainAfterPurchase: string | null = null;

/**
 * The server's answer to one token a drain pass posted. "pending" includes a
 * purchase it could not decide yet; "refused" one it will never credit. The
 * bridge does not say which product a token is for.
 */
type PlayDrainAnswer = "settled" | "pending" | "wrong_account" | "refused";

// The newest pass, the account it drains for, and its answers in order (null
// when Play could not list the unconsumed purchases).
interface PlayDrainPass {
  account: string;
  result: Promise<PlayDrainAnswer[] | null>;
}
let playDrain: PlayDrainPass | null = null;

/**
 * Buys one Play product. `productId` is the pack's googleProductId.
 *
 * "pending" carries its own message: a purchase Play has not finished, and one
 * the server could not credit yet, are both credited later without the player
 * doing anything, and they need telling which.
 */
export async function startPlayPurchase(
  productId: string | undefined,
): Promise<PurchaseOutcome> {
  const billing = desktopPlayBilling();
  if (billing === null || productId === undefined) {
    return error(translateText("store.play_unavailable"));
  }
  if (playPurchaseInFlight) return { outcome: "cancelled", quiet: true };
  // Reserved before the first await, like steamPurchaseInFlight.
  playPurchaseInFlight = true;
  try {
    const userMe = await getUserMe();
    if (userMe === false) return error(translateText("store.login_required"));

    return await buyOnPlay(
      billing,
      { productId, accountId: userMe.player.publicId },
      false,
    );
  } finally {
    playPurchaseInFlight = false;
    drainAfterPurchase();
  }
}

/**
 * Opens Play's dialog and settles what it returns. `retried` marks the second
 * dialog an already_owned answer can open; it never opens a third.
 */
async function buyOnPlay(
  billing: PlayBilling,
  request: Parameters<PlayBilling["purchase"]>[0],
  retried: boolean,
): Promise<PurchaseOutcome> {
  const purchase = await billing.purchase(request);
  if (purchase.status === "cancelled") {
    return { outcome: "cancelled", quiet: true };
  }
  if (purchase.status === "error") {
    switch (purchase.code) {
      // Play is already showing a purchase.
      case "busy":
        return { outcome: "cancelled", quiet: true };
      // An earlier purchase of this product was never consumed, so the
      // server has not credited it yet. Posting it is what credits it.
      // With no product ids to tell them apart, only an answer every
      // unconsumed purchase got is about this one.
      //
      // Or Play's cache is stale: it can still list a purchase the server
      // has just consumed, and this error is what refreshes it. Nothing
      // left unconsumed, or every one settled (the server consumes what it
      // credits), means the product is free again, so Play's advice is to
      // buy it again. Once: a second already_owned is not drained again.
      // A list Play could not give says neither, so it is not bought again.
      // The list is read afresh, after the error: a pass already running read
      // it before Play refreshed its cache.
      case "already_owned": {
        if (retried) return error(translateText("store.play_rebuy_too_soon"));
        const answers = await startPlayDrain(request.accountId);
        if (answers === null) {
          return {
            outcome: "pending",
            message: translateText("store.play_earlier_purchase_pending"),
          };
        }
        const all = (...allowed: PlayDrainAnswer[]) =>
          answers.length > 0 && answers.every((a) => allowed.includes(a));
        if (all("wrong_account")) {
          return error(translateText("store.play_wrong_account"));
        }
        if (all("wrong_account", "refused")) {
          return error(translateText("store.play_purchase_refused"));
        }
        if (answers.length === 0 || all("settled")) {
          return buyOnPlay(billing, request, true);
        }
        return {
          outcome: "pending",
          message: translateText("store.play_earlier_purchase_pending"),
        };
      }
      case "unavailable":
        return error(translateText("store.play_unavailable"));
      case "failed":
        return error(translateText("store.purchase_failed"));
    }
  }

  const finalized = await finalizeGooglePurchase(purchase.purchaseToken);
  // Not awaited: the purchase answers now, and the follow-up runs on its own.
  if (mayStillSettle(finalized)) {
    void followUpPlayPurchase(purchase.purchaseToken);
  }
  if (finalized.ok) {
    return finalized.status === "settled"
      ? { outcome: "completed" }
      : {
          outcome: "pending",
          message: translateText("store.play_purchase_pending"),
        };
  }
  switch (finalized.code) {
    case "refused":
      return error(
        translateText(
          finalized.reason === "wrong_account"
            ? "store.play_wrong_account"
            : "store.play_purchase_refused",
        ),
      );
    case "failed":
      return error(translateText("store.play_purchase_refused"));
    // Nothing is lost: the purchase stays unconsumed and the next drain
    // posts it again.
    case "rate_limited":
    case "unauthorized":
    case "retry_later":
      return {
        outcome: "pending",
        message: translateText("store.play_purchase_retry"),
      };
  }
}

/**
 * How long to wait before each further post of a purchase's token, after its
 * own post could not credit it yet. The server can credit it moments later
 * (Google's notification, or its own retry) and consumes it then, so no drain
 * ever sees it again: posting it again is how the client learns it settled.
 * Only a few: finalize is rate limited per IP.
 */
const PLAY_FOLLOW_UP_DELAYS_MS = [3_000, 10_000, 30_000];

/**
 * An answer a later post of the same token may turn into "settled". Not
 * `unauthorized`: that logged the player out, and signing in again drains.
 */
function mayStillSettle(finalized: FinalizeGooglePurchaseResult): boolean {
  return finalized.ok
    ? finalized.status === "pending"
    : finalized.code === "retry_later" || finalized.code === "rate_limited";
}

/** Re-posts the token a few times; refreshes the account once it settles. */
async function followUpPlayPurchase(token: string): Promise<void> {
  for (const delay of PLAY_FOLLOW_UP_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const finalized = await finalizeGooglePurchase(token);
    if (finalized.ok && finalized.status === "settled") {
      await refreshAccount();
      return;
    }
    if (!mayStillSettle(finalized)) return;
  }
}

/** Runs the drain asked for while the purchase ran, if one was. */
function drainAfterPurchase(): void {
  const queued = playDrainAfterPurchase;
  playDrainAfterPurchase = null;
  if (queued !== null) void drainPlayPurchases(queued);
}

/**
 * Posts every purchase Play reports as not yet consumed, one at a time, as
 * `account` (the player's public id): purchases the app closed before
 * posting, ones the server could not credit yet, and pending ones that have
 * since completed. Silent; refreshes the account if anything settled. Joins
 * a pass already running for the same account rather than starting a second.
 */
export function drainPlayPurchases(account: string): Promise<void> {
  if (playPurchaseInFlight) {
    playDrainAfterPurchase = account;
    return Promise.resolve();
  }
  return joinPlayDrain(account).then(() => undefined);
}

function joinPlayDrain(account: string): Promise<PlayDrainAnswer[] | null> {
  if (playDrain?.account === account) return playDrain.result;
  // The server checks each purchase against the account posting it, so a
  // pass for another account cannot answer for this one.
  return startPlayDrain(account);
}

/** A new pass, run once the running one (if any) ends: one at a time. */
function startPlayDrain(account: string): Promise<PlayDrainAnswer[] | null> {
  const previous = playDrain?.result ?? Promise.resolve();
  const pass: PlayDrainPass = {
    account,
    result: previous.then(runPlayDrain, runPlayDrain).finally(() => {
      if (playDrain === pass) playDrain = null;
    }),
  };
  playDrain = pass;
  return pass.result;
}

async function runPlayDrain(): Promise<PlayDrainAnswer[] | null> {
  const answers: PlayDrainAnswer[] = [];
  const billing = desktopPlayBilling();
  if (billing === null) return null;
  const unconsumed = await billing.unconsumed();
  if (unconsumed.status !== "ok") return null;
  for (const token of unconsumed.purchaseTokens) {
    const finalized = await finalizeGooglePurchase(token);
    if (finalized.ok) {
      answers.push(finalized.status);
      continue;
    }
    if (finalized.code === "refused") {
      answers.push(
        finalized.reason === "wrong_account" ? "wrong_account" : "refused",
      );
      continue;
    }
    answers.push(finalized.code === "failed" ? "refused" : "pending");
    // Every further post would meet the same answer.
    if (
      finalized.code === "rate_limited" ||
      finalized.code === "unauthorized"
    ) {
      break;
    }
  }
  if (answers.includes("settled")) await refreshAccount();
  return answers;
}

/**
 * On the Play rail, drains once an account is known (at launch, and again
 * after signing in as someone else) and whenever the app comes back to the
 * foreground. Main calls this once.
 */
export function watchPlayPurchases(): void {
  if (paymentsProvider() !== "google") return;
  let drainedFor: string | null = null;
  document.addEventListener("userMeResponse", (event) => {
    const userMe = (event as CustomEvent<UserMeResponse | false>).detail;
    const publicId = userMe === false ? null : userMe.player.publicId;
    // A same-account refresh (one the drain itself causes) is not a reason
    // to drain again.
    if (publicId === drainedFor) return;
    drainedFor = publicId;
    if (publicId !== null) void drainPlayPurchases(publicId);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && drainedFor !== null) {
      void drainPlayPurchases(drainedFor);
    }
  });
}

// ---------------------------------------------------------------------------
// The inline Stripe flow (wallet button / in-page card form; see
// StripeInline.ts for the Stripe.js half).

/**
 * Parses a catalog display price ("$4.99") into cents, or null when it isn't
 * a plain dollar amount. Null means "no inline checkout for this tile"; the
 * tile falls back to the redirect flow, which needs no amount client-side.
 *
 * Deliberately strict. The parsed amount seeds Stripe's payment sheet, and
 * while the server prices the PaymentIntent from its own catalog regardless,
 * a sheet showing a different amount than gets charged is a support ticket —
 * so a format this doesn't recognise gets no sheet at all.
 */
export function priceStringToCents(price: string): number | null {
  const match = /^\$(\d{1,5})(?:\.(\d{2}))?$/.exec(price.trim());
  if (match === null) return null;
  return (
    Number(match[1]) * 100 + (match[2] === undefined ? 0 : Number(match[2]))
  );
}

export type InlineIntentResult =
  | { kind: "client_secret"; clientSecret: string }
  // The server answered with the pre-inline handoff — an API deployed before
  // client_secret support, or a listing it only sells by redirect. Not an
  // error: the caller performs the redirect, exactly like startPurchase.
  | { kind: "redirect"; redirectUrl: string }
  | { kind: "error"; error: PurchaseError };

/**
 * Mints a Stripe PaymentIntent for an inline purchase and returns its client
 * secret. Stripe-rail only: the Steam rail's overlay flow is startPurchase's.
 *
 * Callers should mint this LAZILY (at confirm time, not tile render) and
 * reuse the returned secret across retries of the same purchase: checkout is
 * rate-limited per player, and a declined card leaves the PaymentIntent
 * perfectly reusable.
 */
export async function createInlinePaymentIntent(
  request: PurchaseRequest,
): Promise<InlineIntentResult> {
  const result = await createPaymentsCheckout({
    provider: "stripe",
    handoffs: ["redirect", "client_secret"],
    ...request,
  } as PaymentsCheckoutRequest);
  if (!result.ok) return { kind: "error", error: checkoutError(result) };

  const { handoff, redirectUrl, clientSecret } = result.data;
  if (handoff === "client_secret") {
    // The schema has already guaranteed clientSecret is non-null here.
    return { kind: "client_secret", clientSecret: clientSecret! };
  }
  if (handoff === "redirect") {
    return { kind: "redirect", redirectUrl: redirectUrl! };
  }
  // "client_overlay" cannot happen on the Stripe rail; treat it as a server
  // bug rather than guessing at a handoff we can't perform.
  console.error("createInlinePaymentIntent: unexpected handoff", handoff);
  return {
    kind: "error",
    error: error(translateText("store.checkout_failed")),
  };
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
    case "browser_approval":
      return translateText("store.steam_browser_approval");
    case "completed":
      return translateText(successMessageKey);
    case "cancelled":
      return outcome.quiet
        ? null
        : translateText("store.steam_overlay_cancelled");
    case "pending":
      return outcome.message ?? translateText("store.purchase_pending");
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
