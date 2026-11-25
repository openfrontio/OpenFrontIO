import {
  giftSubscriptionOf,
  isGrantedSubscription,
  paidSubscriptionOf,
  type StorePlacement,
  subscriptionsOf,
  UserMeResponse,
  UserSubscription,
} from "@openfront/shared/ApiSchemas";
import { assetUrl } from "@openfront/shared/AssetUrls";
import {
  ColorPalette,
  CosmeticPack,
  CosmeticPackItem,
  Cosmetics,
  CosmeticsSchema,
  Crown,
  Effect,
  findEffectForSlot,
  Flag,
  Pack,
  Pattern,
  Skin,
  Subscription,
} from "@openfront/shared/CosmeticSchemas";
import {
  PlayerCosmeticRefs,
  PlayerCosmetics,
  PlayerEffect,
  PlayerPattern,
} from "@openfront/shared/WireSchemas";
import {
  changeSubscriptionTier,
  getApiBase,
  getUserMe,
  invalidateUserMe,
  openSubscriptionPortal,
  purchaseCosmeticPack,
  purchaseWithCurrency,
} from "./Api";
import { currentPublicId, sessionUncertain, userAuth } from "./Auth";
import {
  cardItemName,
  type CardItem,
  CARD_ITEM_GROUP,
  type CardItemType,
  isCardItemType,
} from "./components/card/CardItems";
import {
  clearPendingPurchase,
  hasPendingPurchase,
  peekPendingPurchase,
} from "./components/inventory/PendingEquip";
import { isDesktopShell } from "./DesktopShell";
import {
  COSMETICS_CHANGED,
  EXPERIMENTS_CHANGED,
  experimentsState,
  setCatalogGeneration,
  waitForExperiments,
} from "./Experiments";
import { showInGameAlert, showInGameConfirm } from "./InGameModal";
import {
  classifyPurchaseReturn,
  paymentsProvider,
  purchaseOutcomeMessage,
  sellsOnlyThroughPlay,
  startPlayPurchase,
  startPurchase,
} from "./Payments";
import { currentPrice } from "./SalePrice";
import { storePlatform } from "./StoreTracking";
import { STEAM_TIER_CHANGE_IN_APP } from "./SubscriptionPolicy";
import { UserSettings } from "./UserSettings";
import { showToast, translateText } from "./Utils";

export { currentPrice } from "./SalePrice";

/**
 * Ceiling on the cosmetics catalog request. Matches the bound the auth calls
 * already use (Auth.ts, Api.ts) rather than something tighter: when the
 * catalog fails to load, getPlayerCosmeticsRefs cannot expand the saved
 * `pattern:<name>` selection into pattern data, so an online player who is
 * merely slow rather than offline would join without their territory
 * pattern. A connection that has not answered in ten seconds is down; one
 * that answers in eight is not, and should keep its cosmetics.
 */
export const COSMETICS_FETCH_TIMEOUT_MS = 10_000;

let __cosmetics: Promise<Cosmetics | null> | null = null;
let __cosmeticsHash: string | null = null;
let __cosmeticsCache: Cosmetics | null = null;
let __cosmeticsFetchedAt = 0;
/**
 * What one catalog request was fetched for (store experiments,
 * Experiments.ts). Each request keeps its own, so a request that lands late
 * can never be tagged with another request's group.
 */
interface CatalogTag {
  // The experiments generation: `undefined` while the request still waits
  // for the player's group, null when it went out without it (timed out).
  generation: number | null | undefined;
  // The cohort it was fetched with (null: the plain catalog).
  cohort: string | null;
  // Whether it has landed and its catalog is the one in use.
  landed: boolean;
  // Fetched by reloadCosmetics, which tells the Store and banner itself.
  reload: boolean;
}
// The tag of the request in `__cosmetics` (meaningless while that is null).
let __cosmeticsTag: CatalogTag = {
  generation: undefined,
  cohort: null,
  landed: false,
  reload: false,
};
// The experiments generation of the catalog last landed (undefined: none yet).
let __landedGeneration: number | null | undefined = undefined;

/**
 * How long a catalog fetch waits for the player's store experiment group
 * before going out plain. With no test running the answer is near-instant.
 */
export const EXPERIMENTS_WAIT_MS = 1500;

/** How long a fetched catalog is trusted before the store refetches it. */
export const COSMETICS_STALE_MS = 60_000;

/**
 * Synchronous accessor for the most recently resolved cosmetics. Returns null
 * before the first successful `fetchCosmetics()` call. Useful when a code path
 * cannot await (e.g. WebGL per-frame sync).
 */
export function getCachedCosmetics(): Cosmetics | null {
  return __cosmeticsCache;
}

export type PaymentMethod = "dollar" | "hard" | "soft";

/** Returned by {@link purchaseCosmetic} when the player can't afford an item. */
export interface InsufficientCurrency {
  /** Display name of the currency, e.g. "Plutonium". */
  currency: string;
  /** How much more currency is needed (raw; localized in the dialog text). */
  shortfall: number;
  /** Display name of the item being bought. */
  item: string;
  /** Whether the currency can be topped up (hard currency only). */
  canTopUp: boolean;
  /** End screen only (purchaseCosmeticInPlace). A top-up leaves the game, so
   * the box warns first and remembers the item (`itemKey`, for `player`). */
  leavesGame?: boolean;
  itemKey?: string;
  player?: string;
  /** End screen only: the caps price, when Plutonium is short and the
   * player has enough caps for it. */
  capsPrice?: number;
}

/** Outcome of a purchase: unaffordable details, or void on success/redirect. */
export type PurchaseResult = InsufficientCurrency | void;

let purchaseReloadStarted = false;

/**
 * True once a purchase has started reloading the page. `purchaseCosmetic`
 * calls `location.reload()` and then returns, so the caller runs again
 * before the page unloads: this is how it tells that apart from a purchase
 * that ended without a reload (failed, cancelled, or not enough currency).
 */
export function purchaseReloading(): boolean {
  return purchaseReloadStarted;
}

function reloadAfterPurchase(): void {
  purchaseReloadStarted = true;
  window.location.reload();
}

export interface CosmeticPurchaseReturnActions {
  strip(): void;
  alertAndStrip(message: string): void;
  openTokenLogin(token: string): void;
  refreshStore(): void;
}

export function completeCosmeticPurchaseReturn(
  cosmeticName: string,
  loginToken: string | null,
  actions: CosmeticPurchaseReturnActions,
): void {
  if (loginToken) {
    actions.strip();
    actions.openTokenLogin(loginToken);
    return;
  }
  actions.alertAndStrip(
    translateText("store.purchase_success", { name: cosmeticName }),
  );
  actions.refreshStore();
}

export interface PurchaseReturnActions extends CosmeticPurchaseReturnActions {
  reload(): void;
  /**
   * Show a dialog and RESOLVE WHEN IT IS DISMISSED, unlike `alertAndStrip`
   * which fires and forgets. Needed only where something must happen after
   * the player has actually read the message -- see the reload below.
   */
  alert(message: string): Promise<unknown>;
}

/**
 * Handles the #purchase-completed landing hash the payment rails send players
 * back to.
 *
 * `status` has THREE values, not two. `pending` is the one that used to fall
 * into the failure branch and it means the opposite: the order is durable and
 * something else -- a capture still in flight, the server-side sweeper -- owns
 * settling it. Telling a paying player their purchase failed there is the
 * single worst thing this function can do, so pending is never reported as a
 * failure and never given a client-side deadline of its own.
 *
 * `type` is the checkout's `kind`, except that a subscription arrives as
 * `subscription_tier`. `provider`, `orderId`, `pack` and `tier` also ride
 * along; none of them changes what is shown.
 */
/**
 * A Plutonium top-up landed back on the site. With an end-screen item
 * remembered ("Get Plutonium"), the Store opens on it once the success
 * message is closed; otherwise the message shows as before.
 */
function topUpLanded(actions: PurchaseReturnActions, message: string): void {
  if (!hasPendingPurchase()) {
    actions.alertAndStrip(message);
    return;
  }
  actions.strip();
  void actions.alert(message).then(() => resumePendingPurchase());
}

export function handlePurchaseReturn(
  params: URLSearchParams,
  actions: PurchaseReturnActions,
): void {
  const status = classifyPurchaseReturn(params.get("status"));

  if (status === "failed") {
    actions.alertAndStrip(translateText("store.purchase_failed"));
    return;
  }

  if (status === "pending") {
    // The credit lands seconds later; drop the cached profile so the balance
    // is re-read rather than served stale, and say so without claiming the
    // purchase either succeeded or failed.
    invalidateUserMe();
    actions.alertAndStrip(translateText("store.purchase_pending"));
    actions.refreshStore();
    return;
  }

  const type = params.get("type");
  if (type === "currency_pack") {
    // The in-page card form reloads onto this landing marked resume, after
    // showing its own message: straight to the resume.
    if (params.get("resume") === "1") {
      actions.strip();
      void resumePendingPurchase();
      return;
    }
    topUpLanded(actions, translateText("store.currency_pack_purchase_success"));
    return;
  }

  if (type === "custom_currency") {
    // Plutonium is credited asynchronously by the rail's webhook; the balance
    // refreshes from /users/@me on the next load.
    topUpLanded(
      actions,
      translateText("store.custom_currency_purchase_success"),
    );
    return;
  }

  if (type === "subscription_tier") {
    actions.strip();
    invalidateUserMe();
    // Reload only once the dialog is DISMISSED, matching the blocking alert
    // this replaced. Reloading underneath an open dialog throws the message
    // away before the player has read it.
    void actions
      .alert(translateText("store.subscription_purchase_success"))
      .then(() => actions.reload());
    return;
  }

  const cosmeticName = params.get("cosmetic");
  if (!cosmeticName) {
    // A generic error rather than "purchase failed": the purchase very likely
    // succeeded and it is our own landing URL that is malformed, so claiming
    // failure would be the wrong end of the same mistake `pending` fixes.
    // Deliberately does NOT strip -- there is nothing here we can act on, and
    // the unstripped hash keeps the evidence for a bug report.
    void actions.alert(translateText("common.error_generic"));
    console.error("purchase-completed but no cosmetic name");
    return;
  }

  completeCosmeticPurchaseReturn(
    cosmeticName,
    params.get("login-token"),
    actions,
  );
}

/**
 * After a Plutonium top-up that started from the end screen ("Get
 * Plutonium"), open the Store on the item the player was buying, ready to
 * buy. True when it did. The record (PendingEquip.ts) is this player's and
 * fresh, or it is dropped; it is dropped too once the item is owned.
 */
export async function resumePendingPurchase({
  waitForProfile = true,
}: { waitForProfile?: boolean } = {}): Promise<boolean> {
  const me = await getUserMe();
  if (me !== false) return await resumePendingPurchaseFor(me);
  if (!waitForProfile) return false;
  // On a fresh landing this runs before the page has signed in, so there is
  // no profile yet: try once more on the app's first profile broadcast.
  return new Promise<boolean>((resolve) => {
    const onUserMe = (e: Event) => {
      done();
      const fresh = (e as CustomEvent<UserMeResponse | false>).detail;
      resolve(fresh ? resumePendingPurchaseFor(fresh) : false);
    };
    const timer = setTimeout(() => {
      done();
      resolve(false);
    }, RESUME_WAIT_MS);
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener("userMeResponse", onUserMe);
    };
    document.addEventListener("userMeResponse", onUserMe);
  });
}

// How long a fresh landing waits for the player's profile before giving up
// (signed out, or the API unreachable).
const RESUME_WAIT_MS = 15_000;

async function resumePendingPurchaseFor(me: UserMeResponse): Promise<boolean> {
  const player = me.player.publicId;
  if (!player) return false;
  const key = peekPendingPurchase(player);
  if (key === null) return false;
  if ((me.player.flares ?? []).includes(key)) {
    clearPendingPurchase();
    return false;
  }
  // One resume at a time; it stops if the player goes elsewhere (another
  // modal: any hash change) or into a game (setGameInProgress), and then
  // never opens the Store. The record stays for the next visit.
  cancelPendingResume();
  const abort = new AbortController();
  resumeAbort = abort;
  // Only a real move elsewhere: a hashchange queued from just before this
  // resume started (the hash as it is now) doesn't count.
  const startHash = window.location.hash;
  const onHashChange = () => {
    if (window.location.hash !== startHash) abort.abort();
  };
  window.addEventListener("hashchange", onHashChange);
  try {
    // The Plutonium can lag the redirect (the rail's webhook credits it):
    // say so, and re-check for a while before opening the item to buy.
    const price = await hardPriceOf(key);
    let hard = me.player.currency?.hard ?? 0;
    if (price !== null && hard < price && !abort.signal.aborted) {
      showToast(translateText("store.plutonium_on_its_way"), "green");
      const until = Date.now() + PLUTONIUM_WAIT_MS;
      while (hard < price && Date.now() < until && !abort.signal.aborted) {
        await new Promise((r) => setTimeout(r, PLUTONIUM_RECHECK_MS));
        if (abort.signal.aborted) break;
        const fresh = await broadcastFreshUserMe();
        if (fresh !== false) hard = fresh.player.currency?.hard ?? 0;
      }
    }
    if (abort.signal.aborted || gameInProgress) return false;
  } finally {
    window.removeEventListener("hashchange", onHashChange);
    if (resumeAbort === abort) resumeAbort = null;
  }
  window.location.hash = `modal=store&tab=cosmetics&item=${encodeURIComponent(key)}`;
  return true;
}

let resumeAbort: AbortController | null = null;
let gameInProgress = false;

/** Stops a resume that is waiting for a top-up's Plutonium. */
export function cancelPendingResume(): void {
  resumeAbort?.abort();
  resumeAbort = null;
}

/**
 * Whether a game is running (ClientGameRunner start/stop). A resume never
 * opens the Store during one, and starting one cancels a waiting resume.
 */
export function setGameInProgress(running: boolean): void {
  gameInProgress = running;
  if (running) cancelPendingResume();
}

// How long a resume waits for a top-up's Plutonium to land, and how often it
// re-reads the balance meanwhile.
const PLUTONIUM_WAIT_MS = 30_000;
const PLUTONIUM_RECHECK_MS = 3_000;

// A card item's Plutonium price from its key ("<type>:<name>"), or null.
async function hardPriceOf(key: string): Promise<number | null> {
  const [type, name] = key.split(":");
  if (!isCardItemType(type) || !name) return null;
  const group = CARD_ITEM_GROUP[type];
  const cosmetics = await fetchCosmetics();
  const item = (
    cosmetics?.[group] as Record<string, Pattern | Flag> | undefined
  )?.[name];
  return item === undefined ? null : (currentPrice(item, "hard") ?? null);
}

/**
 * Re-read the profile and tell the app about it.
 *
 * `invalidateUserMe()` alone only drops the cache; nothing refetches and
 * nothing is notified, so a surface holding a `userMeResponse` -- an open
 * StoreModal, the header balance -- keeps rendering the old one. This is the
 * pair that actually refreshes them.
 *
 * A `false` result is deliberately NOT broadcast: getUserMe returns false on
 * any error, not only an auth failure, and broadcasting it would flip the
 * whole app to its logged-out UI immediately after a successful purchase. A
 * stale balance is much the better failure.
 *
 * `beforeBroadcast` sees the fresh profile first (not called for `false`),
 * for a caller whose own state must change before everyone else's does.
 */
let freshUserMeRequestId = 0;
export async function broadcastFreshUserMe(
  beforeBroadcast?: (fresh: UserMeResponse) => void,
): Promise<UserMeResponse | false> {
  const requestId = ++freshUserMeRequestId;
  invalidateUserMe();
  const fresh = await getUserMe();
  if (fresh !== false) beforeBroadcast?.(fresh);
  // A newer refresh owns the broadcast, even if it is still pending or failed.
  if (fresh === false || requestId !== freshUserMeRequestId) return fresh;
  document.dispatchEvent(
    new CustomEvent("userMeResponse", {
      detail: fresh,
      bubbles: true,
      cancelable: true,
    }),
  );
  // Return this call's result even when a newer refresh superseded its broadcast.
  return fresh;
}

// "Insufficient balance" means three different things once the real balance is
// known, and each needs a different message. Shared by the single-cosmetic and
// pack paths so they cannot drift apart.
function balanceOutcome(
  balance: number,
  price: number,
): "debt" | "shortfall" | "unexplained" {
  // A chargeback landed since the pre-check; topping up cannot clear it.
  if (balance < 0) return "debt";
  // The re-read says they can afford it, so there is no shortfall to quote and
  // inventing one sends them to buy currency they already have.
  if (price - balance <= 0) return "unexplained";
  return "shortfall";
}

function debtMessage(debt: number): string {
  return translateText("store.pack_debt", { debt: String(debt) });
}

/**
 * Whole days left on a granted subscription, or null when there is no end date
 * to count to.
 *
 * A Steam ownership grant is a fixed free month, and an admin comp can be
 * given an end date, so `currentPeriodEnd` is set and the number is real. An
 * open-ended admin comp has nothing to count — the caller uses the no-days copy
 * rather than inventing a figure. A date already in the past returns null for
 * the same reason: "0 days" reads as a bug, and a row the sweeper has not got
 * to yet is not worth quoting.
 *
 * Rounded UP: two hours into a 30-day grant, floor would say "29 days".
 */
function grantedDaysRemaining(sub: UserSubscription): number | null {
  const end = sub.currentPeriodEnd;
  if (!end) return null;
  const ms = end.getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.ceil(ms / 86_400_000);
}

/**
 * A granted player with no paid subscription starting one — any tier,
 * including the one their grant already gives them.
 *
 * The confirm is not the tier-change copy. That copy promises Stripe proration
 * ("charged the prorated difference", "credit for the unused portion"), and
 * none of it is true here: the first month is charged at checkout. What
 * happens to the grant must match infra, and is the same on both rails:
 *
 * - A grant whose tier ranks above the one bought (by monthly price) keeps
 *   running beside the paid subscription until its own end.
 * - Otherwise the grant is replaced, and its unused days move the paid
 *   subscription's next payment later. An open-ended grant has no days to
 *   carry; it simply ends.
 *
 * The purchase itself is the ordinary first-purchase flow: same startPurchase,
 * same success string, same profile refresh. Only the confirm differs.
 */
async function purchaseOverGrant(
  sub: Subscription,
  gift: UserSubscription,
  placement?: StorePlacement,
): Promise<void> {
  const targetName = translateCosmetic("subscriptions", sub.name);
  const giftTier = subscriptionTier(await fetchCosmetics(), gift.tier);
  const days = grantedDaysRemaining(gift);
  const keepsGift =
    giftTier !== null &&
    giftTier.priceMonthly > sub.priceMonthly &&
    (!gift.currentPeriodEnd || days !== null);
  // Every key passed as a literal so the en.json sync test can see them.
  const confirmed = await showInGameConfirm(
    keepsGift
      ? gift.currentPeriodEnd
        ? translateText("store.confirm_subscribe_beside_grant", {
            tier: targetName,
            giftTier: translateCosmetic("subscriptions", gift.tier),
            date: gift.currentPeriodEnd.toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            }),
          })
        : translateText("store.confirm_subscribe_beside_grant_no_date", {
            tier: targetName,
            giftTier: translateCosmetic("subscriptions", gift.tier),
          })
      : days === null
        ? translateText("store.confirm_subscribe_over_grant_no_days", {
            tier: targetName,
          })
        : translateText("store.confirm_subscribe_over_grant_carried", {
            tier: targetName,
            days,
          }),
    {
      heading: translateText("store.subscribe_heading"),
      variant: "warning",
    },
  );
  if (!confirmed) return;

  const outcome = await startPurchase({
    kind: "subscription_tier",
    tierName: sub.name,
    placement,
  });
  if (outcome.outcome === "completed") await broadcastFreshUserMe();
  if (outcome.outcome === "error" && outcome.refetchCatalog) {
    invalidateCosmetics();
  }
  if (outcome.outcome === "error" && outcome.manageBilling) {
    return promptManageBilling(outcome.message);
  }
  const message = purchaseOutcomeMessage(
    outcome,
    "store.subscription_purchase_success",
  );
  if (message !== null) await showInGameAlert(message);
}

/**
 * Checkout refused a new subscription because the player's Stripe one failed
 * to renew. /users/@me does not return a past_due subscription, so the
 * account panel's Manage button is gone and this is the only way left to the
 * billing portal, which does admit past_due. The desktop build must not link
 * out to a payment page (see SubscriptionPanel.renderManageOnWeb), so it only
 * says where to go.
 */
async function promptManageBilling(message: string): Promise<void> {
  if (isDesktopShell()) {
    await showInGameAlert(translateText("store.subscription_past_due_desktop"));
    return;
  }
  const confirmed = await showInGameConfirm(message, {
    variant: "warning",
    confirmText: translateText("store.manage_billing"),
  });
  if (!confirmed) return;
  const url = await openSubscriptionPortal();
  if (url === false) {
    await showInGameAlert(
      translateText("account_modal.subscription_portal_failed"),
    );
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** What a currency purchase is short of, for the insufficient-funds box. */
function currencyShortfall(
  resolved: ResolvedCosmetic,
  method: "hard" | "soft",
  price: number,
  available: number,
): InsufficientCurrency {
  const c = resolved.cosmetic!;
  const currencyName = translateText(
    method === "hard" ? "cosmetics.hard" : "cosmetics.soft",
  );
  let itemName: string;
  if (resolved.type === "flag") {
    itemName = translateCosmetic("flags", c.name);
  } else if (isCardItemType(resolved.type)) {
    itemName = cardItemName(resolved.type, c as CardItem);
  } else if (resolved.type === "crown") {
    itemName = translateCosmetic("crowns", c.name);
  } else {
    itemName = translateCosmetic("territory_patterns.pattern", c.name);
  }
  // Every palette of a pattern shares one name, so say which colour is short.
  if (resolved.colorPalette !== null) {
    itemName = translateText("inventory.selected_cosmetic_variant", {
      name: itemName,
      variant: translateCosmetic(
        "territory_patterns.color_palette",
        resolved.colorPalette.name,
      ),
    });
  }
  return {
    currency: currencyName,
    // Clamped: the server can refuse on a balance the client still reads as
    // sufficient, and a zero or negative shortfall reads as "you have
    // enough", which is the one thing we know is untrue.
    shortfall: Math.max(1, price - available),
    item: itemName,
    // Only plutonium can be topped up; caps are dismiss-only.
    canTopUp: method === "hard",
  };
}

/** What the end screen's shortfall box needs: the Store's shortfall, plus
 * the caps price when Plutonium is short and caps are enough, and what to
 * remember across "Get Plutonium". */
function inPlaceShortfall(
  resolved: ResolvedCosmetic,
  method: "hard" | "soft",
  price: number,
  me: UserMeResponse,
  available: number,
): InsufficientCurrency {
  const capsPrice = currentPrice(resolved.cosmetic as Pattern | Flag, "soft");
  const soft = me.player.currency?.soft ?? 0;
  return {
    ...currencyShortfall(resolved, method, price, available),
    leavesGame: true,
    itemKey: resolved.key,
    player: me.player.publicId,
    capsPrice:
      method === "hard" &&
      capsPrice !== undefined &&
      capsPrice > 0 &&
      soft >= capsPrice
        ? capsPrice
        : undefined,
  };
}

/** What the end screen's check on tap answers (<purchase-button preflight>):
 * affordable, with the balance read; or not, with the shortfall to show
 * (none when the check couldn't run or explained itself). */
export type PurchasePreflight =
  | { ok: true; balance: number }
  | {
      ok: false;
      info?: InsufficientCurrency;
      // The profile couldn't be read: no session (none, or a 401 cleared
      // it), or a session but no answer (the network).
      reason?: "signed_out" | "unreachable";
    };

/**
 * The end screen's check when a buy button is tapped, before any confirm box:
 * one fresh read of the profile (the cache dropped first, so an older copy
 * can't decide; broadcast, so the rest of the screen follows). Charges
 * nothing. The purchase itself only runs from the confirm box this leads to.
 */
export async function checkInPlacePurchase(
  resolved: ResolvedCosmetic,
  method: "hard" | "soft",
): Promise<PurchasePreflight> {
  const c = resolved.cosmetic;
  if (!c || resolved.type === "subscription" || resolved.type === "pack") {
    return { ok: false };
  }
  const price = currentPrice(c as Pattern | Flag, method) ?? 0;
  const me = await broadcastFreshUserMe();
  if (me === false) {
    // A 401 on the read clears the session, so no session here means
    // signed out; a session that got no profile means the network. So does
    // a refresh that got no answer (sessionUncertain): the cookie may be
    // fine, and signing in would leave the game.
    // userAuth(false) on purpose, unlike purchaseCosmeticInPlace's
    // userAuth(): broadcastFreshUserMe just read the profile through
    // getAuthHeader, which refreshed the token, and recorded how that
    // refresh went. Don't "align" it into a second refresh.
    const session = await userAuth(false);
    return {
      ok: false,
      reason:
        session === false && !sessionUncertain() ? "signed_out" : "unreachable",
    };
  }
  const wallet = me.player.currency;
  const balance = method === "hard" ? (wallet?.hard ?? 0) : (wallet?.soft ?? 0);
  if (balance < 0) {
    await showInGameAlert(debtMessage(-balance));
    return { ok: false };
  }
  if (balance < price) {
    return {
      ok: false,
      info: inPlaceShortfall(resolved, method, price, me, balance),
    };
  }
  return { ok: true, balance };
}

/** How an end-screen purchase ended (purchaseCosmeticInPlace). */
export type InPlacePurchase =
  // Bought, or the server says it was already owned: owned now either way.
  // The fresh profile has been broadcast (false when the re-read failed).
  // `notice`: charged other than the price shown; the Store's message.
  | { kind: "owned"; fresh: UserMeResponse | false; notice?: string }
  // Not enough of the currency: nothing charged.
  | { kind: "insufficient"; info: InsufficientCurrency }
  // Refused for a reason the API names, so nothing charged.
  | { kind: "failed" }
  // `failed` from the API (a network drop, a timeout, a 5xx or an unnamed
  // refusal) and not owned on the re-read: whether it charged can't be said.
  | { kind: "unconfirmed" }
  // No account: nothing to buy with.
  | { kind: "signed_out" }
  // A session, but its profile couldn't be read: nothing sent.
  | { kind: "unreachable" }
  // Explained already with its own message (a wallet in debt, or a
  // price_changed refusal: nothing charged).
  | { kind: "handled" };

/**
 * A currency purchase from the end screen. Unlike purchaseCosmetic it never
 * reloads the page, which would end the player's game: on success (or
 * `already_owned`) it re-reads /users/@me and broadcasts it, so ownership and
 * every balance on screen update in place, and it says nothing itself. The
 * caller shows the outcome where the purchase was made. A shortfall carries
 * what the end screen offers besides a top-up: the caps price when the
 * player can afford it, and what to remember across "Get Plutonium".
 *
 * `onOwned` runs as soon as it is known to be owned, before the fresh
 * profile is broadcast: the end screen marks it bought here first, so no
 * render sees it owned but not bought here (which would drop it and rebuild
 * the block).
 *
 * `signedInAs`, when given, is the account (currentPublicId) that opened the
 * confirm: the purchase is only sent as that account. A sign-in in another
 * tab replaces the refresh cookie, so a JWT refresh here could otherwise
 * buy as the other account. A different account (or none) answers
 * `signed_out`, with nothing sent.
 *
 * `shownAmount` is the price the confirm box showed: the server refuses
 * (409 price_changed) to charge more, as for purchaseCosmetic. Without it,
 * the price the catalogue in hand gives now.
 */
export async function purchaseCosmeticInPlace(
  resolved: ResolvedCosmetic,
  method: "hard" | "soft",
  placement?: StorePlacement,
  onOwned?: () => void,
  signedInAs?: string | null,
  shownAmount?: number,
): Promise<InPlacePurchase> {
  const c = resolved.cosmetic;
  if (!c || resolved.type === "subscription" || resolved.type === "pack") {
    return { kind: "failed" };
  }
  const priced = c as Pattern | Flag;
  const price = currentPrice(priced, method) ?? 0;
  const userMe = await getUserMe();
  if (userMe === false) {
    // getUserMe answers (and caches) false for a failed read too: only the
    // session says signed out, and not a refresh that got no answer
    // (sessionUncertain). Either way nothing was sent. With refresh: a
    // cached false sent no request that would have renewed the token, and
    // userAuth(false) calls one near expiry signed out despite a good
    // refresh cookie.
    const session = await userAuth();
    return {
      kind:
        session === false && !sessionUncertain() ? "signed_out" : "unreachable",
    };
  }
  const bound = signedInAs !== undefined;
  if (bound && (signedInAs === null || userMe.player.publicId !== signedInAs)) {
    return { kind: "signed_out" };
  }
  const wallet = userMe.player.currency;
  const balance = method === "hard" ? (wallet?.hard ?? 0) : (wallet?.soft ?? 0);
  if (balance < 0) {
    await showInGameAlert(debtMessage(-balance));
    return { kind: "handled" };
  }
  const shortfall = (available: number): InPlacePurchase => ({
    kind: "insufficient",
    info: inPlaceShortfall(resolved, method, price, userMe, available),
  });
  if (balance < price) return shortfall(balance);

  const owned = (fresh: UserMeResponse | false, notice?: string) => {
    if (userMe.player.publicId) {
      const pending = peekPendingPurchase(userMe.player.publicId);
      if (pending === resolved.key) clearPendingPurchase();
    }
    return { kind: "owned" as const, fresh, notice };
  };
  // `failed` isn't a refusal: purchaseWithCurrency also answers it for a
  // network drop, a timeout or a 5xx, and the server's transaction can still
  // commit after that. Re-read: owned now means it went through. Otherwise
  // say it couldn't be confirmed, never "you weren't charged"; a retry is
  // safe, as a committed buy answers already_owned.
  const ownsIt = (fresh: UserMeResponse) =>
    (fresh.player.flares ?? []).includes(resolved.key);
  const settleFailure = async (): Promise<InPlacePurchase> => {
    const fresh = await broadcastFreshUserMe((f) => {
      if (ownsIt(f)) onOwned?.();
    });
    if (fresh !== false && ownsIt(fresh)) {
      return owned(fresh);
    }
    return { kind: "unconfirmed" };
  };

  // Checked again by purchaseWithCurrency once it holds the token it will
  // send: reading it can refresh the JWT, and the refresh can pick up
  // another tab's sign-in (CardSaveQueue does the same for a card save).
  const stillSignedInAs = () => !bound || currentPublicId() === signedInAs;

  let result: Awaited<ReturnType<typeof purchaseWithCurrency>>;
  try {
    result = await purchaseWithCurrency(
      resolved.type as "pattern" | "flag" | "crown" | "effect" | CardItemType,
      c.name,
      method,
      resolved.colorPalette?.name,
      placement,
      { expectedAmount: shownAmount ?? price, platform: storePlatform() },
      stillSignedInAs,
    );
  } catch (error) {
    console.error("End-screen purchase failed", error);
    return settleFailure();
  }
  // Another account by the time the token was read: nothing was sent.
  if (!result.ok && result.code === "cancelled") return { kind: "signed_out" };
  // The server would charge more than the box showed: nothing charged. The
  // reload announces the catalogue now, so the end screen re-prices.
  if (!result.ok && result.code === "price_changed") {
    await priceChanged();
    return { kind: "handled" };
  }
  if (!result.ok && result.code === "insufficient_balance") {
    const fresh = await broadcastFreshUserMe();
    if (fresh === false) return { kind: "failed" };
    const available =
      method === "hard"
        ? (fresh.player.currency?.hard ?? 0)
        : (fresh.player.currency?.soft ?? 0);
    return available < price ? shortfall(available) : { kind: "failed" };
  }
  if (!result.ok && result.code !== "already_owned") {
    if (result.code === "debt") {
      await broadcastFreshUserMe();
      await showInGameAlert(
        translateText("store.pack_debt", { debt: result.debt }),
      );
      return { kind: "handled" };
    }
    return settleFailure();
  }
  // Charged something other than the price shown (a sale started or ended
  // since the catalogue loaded): say what was taken, as the Store does, and
  // drop the catalogue that showed the wrong price.
  const notice =
    result.ok && result.amount !== undefined && result.amount !== price
      ? purchaseSuccessMessage(c.name, price, result.amount, method)
      : undefined;
  onOwned?.();
  return owned(await broadcastFreshUserMe(), notice);
}

export async function purchaseCosmetic(
  resolved: ResolvedCosmetic,
  method: PaymentMethod,
  placement?: StorePlacement,
  // The price on the button the player clicked, if the caller rendered one.
  // The server refuses (409) to charge more than this. Without it, the price
  // the catalog in hand gives now.
  shownAmount?: number,
): Promise<PurchaseResult> {
  if (!resolved.cosmetic) return;
  const c = resolved.cosmetic;
  const colorPaletteName = resolved.colorPalette?.name;

  if (resolved.type === "subscription") {
    // The Android app sells no subscription (Play is its only way to pay) and
    // never offers one; nothing here may start a checkout or a tier change.
    if (sellsOnlyThroughPlay()) return;
    const sub = c as Subscription;
    const userMe = await getUserMe();
    // The paid row decides: a grant beside it is not something to change
    // tier from.
    const paidSub = userMe === false ? null : paidSubscriptionOf(userMe.player);
    const giftSub = userMe === false ? null : giftSubscriptionOf(userMe.player);
    const currentSub = paidSub ?? giftSub;

    if (currentSub) {
      // OPE-440, and BEFORE every branch below it, including the
      // already-subscribed one. A grant is not a purchase: nobody is being
      // billed, so there is no agreement to reprice and `change-tier` answers
      // 400 "Cannot change tier of a granted subscription" for every tier —
      // which is why a granted player currently cannot pay us at all. Their
      // tier selection is a FIRST purchase, and /payments/checkout admits
      // them on both rails (its exclusivity gate filters
      // `isNotNull(subscriptions.provider)`, so a granted row is never an
      // incumbent).
      //
      // Including the tier they already hold: buying that same tier is the
      // likeliest conversion of the whole cohort, and `already_subscribed`
      // would refuse the one click we most want.
      //
      // No rail check like the Steam ones below, because a grant HAS no rail:
      // `provider` is null, so there is no account fact to disagree with the
      // device, and startPurchase's paymentsProvider() is the only answer
      // there is — Steam inside the shell, Stripe on the web. Both are
      // admitted.
      if (paidSub === null) {
        return purchaseOverGrant(sub, currentSub, placement);
      }

      if (currentSub.tier === sub.name) {
        await showInGameAlert(translateText("store.already_subscribed"));
        return;
      }

      // S1 (infra OPE-230, lead decision pending Josh): a Steam subscriber
      // cannot change tier in-app at launch. The server would refuse the
      // checkout with a 409 anyway; refusing HERE, before the confirm and
      // before an order is minted, means no dialog that only ever ends in a
      // refusal and no stranded PENDING row. Same switch the panel reads.
      if (currentSub.provider === "steam" && !STEAM_TIER_CHANGE_IN_APP) {
        await showInGameAlert(
          translateText("store.tier_change_unavailable_steam"),
        );
        return;
      }

      // Rail vs account. `currentSub.provider` is where the ACCOUNT is
      // billed; `paymentsProvider()` is what this DEVICE can check out on
      // (Steam only inside the desktop shell). A Steam-billed subscriber in
      // a plain browser would otherwise see the Steam confirm and then have
      // a Stripe checkout minted for them — which the server refuses at
      // gate 1, leaving a stranded row. A Steam agreement can only be
      // replaced by another Steam agreement, so say where to do it.
      if (currentSub.provider === "steam" && paymentsProvider() !== "steam") {
        await showInGameAlert(
          translateText("store.tier_change_steam_needs_desktop"),
        );
        return;
      }

      // Direction-aware confirm based on priceMonthly. We don't have the
      // server's sortOrder client-side — priceMonthly is a good proxy.
      const currentCosmetic = subscriptionTier(
        await fetchCosmetics(),
        currentSub.tier,
      );
      const isUpgrade =
        currentCosmetic !== null
          ? sub.priceMonthly > currentCosmetic.priceMonthly
          : true;
      const targetName = translateCosmetic("subscriptions", sub.name);
      // The Stripe copy promises proration ("charged the prorated
      // difference", "credit for the unused portion"). On Steam neither
      // exists: the new tier is a NEW agreement at full price, starting now,
      // and the rest of the old month is forfeited. Say that, not the
      // Stripe thing.
      const confirmKey =
        currentSub.provider === "steam"
          ? "store.confirm_tier_change_steam"
          : isUpgrade
            ? "store.confirm_upgrade"
            : "store.confirm_downgrade";
      const confirmed = await showInGameConfirm(
        translateText(confirmKey, { tier: targetName }),
        {
          heading: translateText("account_modal.change_tier"),
          variant: "warning",
        },
      );
      if (!confirmed) return;

      // A Steam subscription cannot be repriced in place: Steam's only
      // mechanism is a NEW billing agreement, whose approval disables the old
      // one (infra Phase 9, §4.4 — and the server's change-tier answers 409
      // requires_approval for a Steam row). So the change IS a fresh checkout
      // for the target tier, through the same overlay flow as a first
      // purchase; the server's gate admits a same-rail different-tier
      // incumbent and expires the old row when the new one settles. Nothing
      // is cancelled first: a player who dismisses the dialog keeps what
      // they had.
      if (currentSub.provider === "steam") {
        const outcome = await startPurchase({
          kind: "subscription_tier",
          tierName: sub.name,
          placement,
        });
        if (outcome.outcome === "completed") await broadcastFreshUserMe();
        if (outcome.outcome === "error" && outcome.refetchCatalog) {
          invalidateCosmetics();
        }
        const message = purchaseOutcomeMessage(
          outcome,
          "store.change_tier_success_steam",
        );
        if (message !== null) await showInGameAlert(message);
        return;
      }

      const result = await changeSubscriptionTier(sub.name);
      if (result === "rate_limited") {
        await showInGameAlert(translateText("store.change_tier_rate_limited"));
        return;
      }
      if (result === "steam_licence_required") {
        await showInGameAlert(translateText("store.steam_licence_required"));
        return;
      }
      if (!result) {
        await showInGameAlert(translateText("store.change_tier_failed"));
        return;
      }
      await showInGameAlert(
        translateText("store.change_tier_success", { tier: targetName }),
      );
      reloadAfterPurchase();
      return;
    }
  }

  if (resolved.type === "cosmeticPack") {
    return purchasePack(c as CosmeticPack, method, placement, shownAmount);
  }

  if (method === "dollar") {
    // Currency packs and subscription tiers go through the rail-agnostic
    // /payments/checkout, which identifies a listing by NAME. Neither may gate
    // on the Stripe `product` block: it is null for every Steam-only listing,
    // and gating on it is what made those unbuyable.
    if (resolved.type === "pack" || resolved.type === "subscription") {
      const isPack = resolved.type === "pack";
      // In the Android app a currency pack is a Play product instead.
      const outcome =
        isPack && paymentsProvider() === "google"
          ? await startPlayPurchase((c as Pack).googleProductId)
          : await startPurchase(
              isPack
                ? { kind: "currency_pack", packName: c.name, placement }
                : { kind: "subscription_tier", tierName: c.name, placement },
            );
      if (outcome.outcome === "completed") {
        // Not just invalidateUserMe(): that clears the cache and nothing more.
        // On the overlay path the page never navigates, so an open StoreModal
        // keeps the `userMeResponse` it was rendered from and shows a stale
        // balance and subscription after a purchase that has already settled.
        // Fetching and broadcasting is what actually updates it -- the same
        // shape TribesPanel uses after a hard-currency purchase.
        await broadcastFreshUserMe();
      }
      // The catalog this store rendered from named something the rail no
      // longer sells; drop it so the next open refetches.
      if (outcome.outcome === "error" && outcome.refetchCatalog) {
        invalidateCosmetics();
      }
      if (outcome.outcome === "error" && outcome.manageBilling) {
        return promptManageBilling(outcome.message);
      }
      const message = purchaseOutcomeMessage(
        outcome,
        isPack
          ? "store.currency_pack_purchase_success"
          : "store.subscription_purchase_success",
      );
      if (message !== null) await showInGameAlert(message);
      // A top-up for an item from the end screen: open the Store on it.
      if (isPack && outcome.outcome === "completed") {
        // In page: the profile is as known as it will be.
        await resumePendingPurchase({ waitForProfile: false });
      }
      return;
    }

    // Real money only buys plutonium (packs above) or a subscription;
    // dollar-priced cosmetics/flares and their legacy create-checkout-session
    // endpoint are gone. Only a stale cached cosmetics.json that still
    // carries a product block can land here.
    await showInGameAlert(translateText("store.checkout_failed"));
    return;
  }

  // Currency purchase (hard or soft) — not valid for subscriptions.
  if (resolved.type === "subscription") {
    console.error(
      "purchaseCosmetic: currency purchase not supported for subscriptions",
    );
    return;
  }
  // ResolvedCosmetic isn't a discriminated union, so the guard above doesn't
  // narrow cosmetic's type. Subscriptions are excluded by the runtime check.
  const priced = c as Pattern | Flag | Pack;
  const nowPrice = currentPrice(priced, method);
  const price = nowPrice ?? 0;
  // A sale can end between the render and the click: the button still showed
  // the sale price, and that is what the player agreed to pay.
  const shownPrice = shownAmount ?? nowPrice;
  // Checked against the cheaper of the two: a sale that ended since the render
  // lets the server answer price_changed (and the catalog refresh) rather
  // than a top-up for an amount the button never showed, and one that started
  // since doesn't block a balance that covers the price now.
  const needed = lowerPrice(shownAmount, price);
  const userMe = await getUserMe();
  if (userMe === false) {
    await showInGameAlert(translateText("store.login_required"));
    return;
  }
  const balance =
    method === "hard"
      ? (userMe.player.currency?.hard ?? 0)
      : (userMe.player.currency?.soft ?? 0);
  // A charged-back wallet is served as a NEGATIVE balance (the API derives its
  // own `debt` field as exactly `-hard`), so this — not the server refusal
  // below — is how a player in debt normally gets here. Without this branch
  // the negative balance just fails the shortfall check underneath and they
  // are told "you need 400 more" with a top-up button that cannot clear a
  // debt. Soft currency can never go negative, so this only fires for hard.
  if (balance < 0) {
    await showInGameAlert(debtMessage(-balance));
    return;
  }
  // Built for the pre-check below and reused when the server refuses for the
  // same reason, so both routes describe the same item the same way. Quoted
  // from the price now, not `needed`: after a sale ends, a top-up to the
  // shown price would only end in price_changed and another shortfall.
  const insufficient = (available: number): InsufficientCurrency =>
    currencyShortfall(resolved, method, price, available);
  if (balance < needed) {
    return insufficient(balance);
  }

  const cosmeticType = resolved.type as
    | "pattern"
    | "skin"
    | "flag"
    | "crown"
    | "effect"
    | CardItemType;
  const result = await purchaseWithCurrency(
    cosmeticType,
    c.name,
    method,
    colorPaletteName,
    placement,
    { expectedAmount: shownPrice, platform: storePlatform() },
  );
  if (!result.ok) {
    switch (result.code) {
      case "price_changed":
        await priceChanged();
        return;
      case "insufficient_balance": {
        // The balance moved since the pre-check: re-read it for the shortfall,
        // the same way the pack path does. Broadcast as well as re-read —
        // dropping the cache alone leaves the open Store rendering the old
        // balance, since it renders from the userMeResponse event.
        const fresh = await broadcastFreshUserMe();
        // A failed re-read leaves the real balance unknown. Treating it as
        // zero would quote the full price as the shortfall — a guess wearing
        // a number, with a top-up button sized to it.
        if (fresh === false) {
          await showInGameAlert(translateText("store.purchase_failed"));
          return;
        }
        const available =
          method === "hard"
            ? (fresh.player.currency?.hard ?? 0)
            : (fresh.player.currency?.soft ?? 0);
        const outcome = balanceOutcome(available, needed);
        if (outcome === "debt") {
          await showInGameAlert(debtMessage(-available));
          return;
        }
        if (outcome === "unexplained") {
          await showInGameAlert(translateText("store.purchase_failed"));
          return;
        }
        return insufficient(available);
      }
      case "debt":
        // A refund or chargeback left the wallet negative. Topping up does not
        // unblock it, so this gets a plain explanation rather than the
        // insufficient-currency dialog — the debt settles out of the next
        // credit. Re-read and re-broadcast so the store stops showing the
        // pre-chargeback balance: dropping the cache alone would not do it,
        // since the Store renders from the userMeResponse broadcast.
        await broadcastFreshUserMe();
        await showInGameAlert(
          translateText("store.pack_debt", { debt: result.debt }),
        );
        return;
      case "already_owned":
        // Either a genuine double-buy or a retry of a purchase that did go
        // through (the success response was lost): both mean the local
        // ownership state is stale, so refetch. Mirrors the pack path. No
        // broadcastFreshUserMe() here — the reload below tears the page down,
        // so re-dispatching the profile first would be dead work.
        // Owned now: a top-up remembered for it is done with.
        if (
          userMe.player.publicId &&
          peekPendingPurchase(userMe.player.publicId) === resolved.key
        ) {
          clearPendingPurchase();
        }
        await showInGameAlert(translateText("store.already_owned"));
        invalidateUserMe();
        reloadAfterPurchase();
        return;
      default:
        await showInGameAlert(translateText("store.purchase_failed"));
        return;
    }
  }
  // The item a top-up was for (resumePendingPurchase) is bought.
  if (userMe.player.publicId) {
    const pending = peekPendingPurchase(userMe.player.publicId);
    if (pending === resolved.key) clearPendingPurchase();
  }
  await showInGameAlert(
    purchaseSuccessMessage(c.name, price, result.amount, method),
  );
  invalidateUserMe();
  reloadAfterPurchase();
}

/**
 * The server refused to charge more than the store showed (409
 * price_changed): nothing was charged. Refetch the catalog so the store and
 * the homepage banner show the price as it is now, and say so.
 */
async function priceChanged(): Promise<void> {
  const reload = reloadCosmetics();
  await showInGameAlert(translateText("store.price_changed"));
  await reload;
}

/**
 * The success alert. The server prices off its own clock, so a sale that
 * started or ended since the store loaded (or a client clock that is off)
 * can charge something other than the price shown: say what was taken, and
 * drop the catalog that showed the wrong price.
 */
function purchaseSuccessMessage(
  name: string,
  shownPrice: number,
  charged: number | undefined,
  method: "hard" | "soft",
): string {
  if (charged === undefined || charged === shownPrice) {
    return translateText("store.purchase_success", { name });
  }
  invalidateCosmetics();
  return translateText("store.purchase_success_charged", {
    name,
    amount: charged,
    currency: translateText(
      method === "hard" ? "cosmetics.hard" : "cosmetics.soft",
    ),
  });
}

/**
 * The amount a balance pre-check asks for: the lower of the price the button
 * showed and the price now, or the price now when nothing was shown.
 */
export function lowerPrice(shown: number | undefined, now: number): number {
  return shown === undefined ? now : Math.min(shown, now);
}

/**
 * Buys a cosmetic pack (plutonium only). Mirrors the single-cosmetic currency
 * flow: a local balance pre-check surfaces the insufficient-funds dialog
 * before any request; a success reloads so every granted item shows as owned.
 */
async function purchasePack(
  pack: CosmeticPack,
  method: PaymentMethod,
  placement?: StorePlacement,
  shownAmount?: number,
): Promise<PurchaseResult> {
  if (method !== "hard") {
    console.error("purchaseCosmetic: packs are only sold for hard currency");
    return;
  }
  const price = currentPrice(pack, "hard") ?? pack.priceHard;
  // As for a single cosmetic: the cheaper of the shown and current price.
  const needed = lowerPrice(shownAmount, price);
  const userMe = await getUserMe();
  if (userMe === false) {
    await showInGameAlert(translateText("store.login_required"));
    return;
  }
  const insufficient = (balance: number): InsufficientCurrency => ({
    currency: translateText("cosmetics.hard"),
    // Clamped like the single-cosmetic path: never zero or negative. From
    // the price now, as there: `needed` only decides whether to send.
    shortfall: Math.max(1, price - balance),
    item: pack.displayName,
    canTopUp: true,
  });
  const balance = userMe.player.currency?.hard ?? 0;
  // Same as the single-cosmetic path: a charged-back wallet arrives here as a
  // negative balance, and without this it reads as a very large shortfall
  // with a top-up button that cannot clear a debt.
  if (balance < 0) {
    await showInGameAlert(debtMessage(-balance));
    return;
  }
  if (balance < needed) {
    return insufficient(balance);
  }

  const result = await purchaseCosmeticPack(pack.name, placement, {
    expectedAmount: shownAmount ?? price,
    platform: storePlatform(),
  });
  if (result.ok) {
    const charged = Number(result.data.amount);
    await showInGameAlert(
      purchaseSuccessMessage(
        pack.displayName,
        price,
        Number.isFinite(charged) ? charged : undefined,
        "hard",
      ),
    );
    invalidateUserMe();
    reloadAfterPurchase();
    return;
  }
  switch (result.code) {
    case "price_changed":
      await priceChanged();
      return;
    case "insufficient_balance": {
      // The balance moved since the pre-check: re-read it for the shortfall,
      // and re-broadcast so the open Store stops showing the old balance.
      const fresh = await broadcastFreshUserMe();
      // Unknown balance — no honest number to quote.
      if (fresh === false) {
        await showInGameAlert(translateText("store.purchase_failed"));
        return;
      }
      const available = fresh.player.currency?.hard ?? 0;
      const outcome = balanceOutcome(available, needed);
      if (outcome === "debt") {
        await showInGameAlert(debtMessage(-available));
        return;
      }
      if (outcome === "unexplained") {
        await showInGameAlert(translateText("store.purchase_failed"));
        return;
      }
      return insufficient(available);
    }
    case "debt":
      // Re-read and re-broadcast, not just invalidate: the Store renders from
      // the userMeResponse broadcast, so dropping the cache alone would leave
      // it showing the pre-chargeback balance.
      await broadcastFreshUserMe();
      await showInGameAlert(
        translateText("store.pack_debt", { debt: result.debt }),
      );
      return;
    case "already_owned":
      // Either a genuine conflict or a retry of a purchase that did go
      // through: both mean the local ownership state is stale, so refetch.
      await showInGameAlert(
        translateText("store.pack_already_owned", {
          items: result.ownedFlareNames.map(flareDisplayName).join(", "),
        }),
      );
      invalidateUserMe();
      reloadAfterPurchase();
      return;
    case "unavailable":
      await showInGameAlert(translateText("store.pack_unavailable"));
      return;
    default:
      await showInGameAlert(translateText("store.purchase_failed"));
      return;
  }
}

/**
 * The translated name of the cosmetic a flare refers to: "<type>:<name>",
 * or "pattern:<name>:<palette>" for a coloured pattern ("Camo (Crimson)").
 */
function flareDisplayName(flare: string): string {
  const [type, name, palette] = flare.split(":");
  const prefix = {
    pattern: "territory_patterns.pattern",
    skin: "territory_patterns.pattern",
    flag: "flags",
    crown: "crowns",
    effect: "effects",
  }[type];
  if (!prefix || !name) return flare;
  const displayName = translateCosmetic(prefix, name);
  if (!palette) return displayName;
  return translateText("inventory.selected_cosmetic_variant", {
    name: displayName,
    variant: translateCosmetic("territory_patterns.color_palette", palette),
  });
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Drops the cached cosmetics.json so the next fetchCosmetics() goes to the
 * network. The remedy for a checkout rejected with a stale listing ("Pack not
 * available" / "Tier not available"): the catalog the store rendered from no
 * longer matches what the rail sells.
 */
export function invalidateCosmetics(): void {
  __cosmetics = null;
}

/** Tests only: forget which experiments group the last catalog was for. */
export function resetCatalogGenerationForTest(): void {
  __landedGeneration = undefined;
}

/**
 * Whether a catalog item is new to the store: the API sends `newUntil` while
 * it is (added in the last 14 days). Judged against the clock, since the
 * catalog is cached and an item can stop being new while the store is open.
 */
export function isNew(cosmetic: unknown, now: number = Date.now()): boolean {
  const until = newUntilMs(cosmetic);
  return until !== null && until > now;
}

/**
 * When a catalog item stops being new (ms), or null if it has no newUntil or
 * an unparseable one.
 */
export function newUntilMs(cosmetic: unknown): number | null {
  const newUntil = (cosmetic as { newUntil?: string } | null)?.newUntil;
  if (newUntil === undefined) return null;
  const ms = new Date(newUntil).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The running sale that discounts a catalog item, or null: it names a
 * promotion that hasn't ended, and a list price above its price in at least
 * one currency.
 */
export function activeSale(
  cosmetic: unknown,
  now: number = Date.now(),
): { percentOff: number; endsAt: string; kind?: "flash" } | null {
  const priced = cosmetic as {
    promotion?: { percentOff: number; endsAt: string; kind?: "flash" };
    priceHard?: number;
    priceSoft?: number;
    listPriceHard?: number;
    listPriceSoft?: number;
  } | null;
  const promotion = priced?.promotion;
  if (!promotion || new Date(promotion.endsAt).getTime() <= now) return null;
  const discounted =
    (priced.listPriceHard ?? 0) > (priced.priceHard ?? Infinity) ||
    (priced.listPriceSoft ?? 0) > (priced.priceSoft ?? Infinity);
  return discounted ? promotion : null;
}

/**
 * Drops a catalog fetched more than COSMETICS_STALE_MS ago, so the next
 * fetchCosmetics() refetches it. Sale prices start and end on the server's
 * clock; the API serves cosmetics.json from a one-minute cache, so this keeps
 * the store within about two minutes of what a purchase is charged. Returns
 * whether it dropped the catalog.
 */
export function refreshStaleCosmetics(now: number = Date.now()): boolean {
  if (
    __cosmeticsCache === null ||
    now - __cosmeticsFetchedAt <= COSMETICS_STALE_MS
  ) {
    return false;
  }
  invalidateCosmetics();
  return true;
}

/**
 * Whether the cached catalog is missing or older than COSMETICS_STALE_MS, so
 * the next open refetches it. Unlike refreshStaleCosmetics, drops nothing.
 */
export function cosmeticsCacheIsStale(now: number = Date.now()): boolean {
  return (
    __cosmeticsCache === null || now - __cosmeticsFetchedAt > COSMETICS_STALE_MS
  );
}

export type TierListingRail = "steam" | "web";

// cosmetics.json lists subscription tiers per rail: the one this device checks
// out on. The only place the listing hint is decided.
export function tierListingRail(): TierListingRail {
  return paymentsProvider() === "steam" ? "steam" : "web";
}

function cosmeticsJsonUrl(cohort: string | null): string {
  const rail = tierListingRail();
  const base = `${getApiBase()}/cosmetics.json?rail=${rail}`;
  // A store experiment cohort's catalog is a web-rail thing; Steam never
  // sends one.
  return cohort !== null && rail === "web"
    ? `${base}&cohort=${encodeURIComponent(cohort)}`
    : base;
}

export async function fetchCosmetics(): Promise<Cosmetics | null> {
  if (__cosmetics !== null) {
    return __cosmetics;
  }
  const tag: CatalogTag = {
    generation: undefined,
    cohort: null,
    landed: false,
    reload: false,
  };
  __cosmeticsTag = tag;
  // A holder, so the body can recognise its own request as the cached one
  // (filled in before any await inside can resume).
  const self: { request?: Promise<Cosmetics | null> } = {};
  const request = (async () => {
    try {
      // The player's experiment group decides which catalog to fetch. If it
      // isn't known in time, the plain catalog goes out untagged, sends no
      // exposure, and is refetched when the group lands.
      const experiments = await waitForExperiments(EXPERIMENTS_WAIT_MS);
      const cohort = experiments?.catalogCohort ?? null;
      tag.generation = experiments?.generation ?? null;
      tag.cohort = cohort;
      const response = await fetch(cosmeticsJsonUrl(cohort), {
        signal: AbortSignal.timeout(COSMETICS_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.warn(`HTTP error! status: ${response.status}`);
        return null;
      }
      const result = CosmeticsSchema.safeParse(await response.json());
      if (!result.success) {
        console.error(`Invalid cosmetics: ${result.error.message}`);
        return null;
      }
      // Only the cached request caches and tags. One replaced meanwhile (a
      // refetch for a new group) or dropped (invalidated, or its refetch
      // failed) hands its data to its own caller and touches nothing: it may
      // be for a group that is no longer the player's.
      if (__cosmetics !== self.request) return result.data;
      const patternKeys = Object.keys(result.data.patterns).sort();
      const hashInput = patternKeys.join(",");
      __cosmeticsHash = simpleHash(hashInput);
      __cosmeticsCache = result.data;
      __cosmeticsFetchedAt = Date.now();
      tag.landed = true;
      const generation = tag.generation ?? null;
      const groupChanged =
        __landedGeneration !== undefined && __landedGeneration !== generation;
      __landedGeneration = generation;
      setCatalogGeneration(generation);
      // A catalog for another group replaced the one the Store and the
      // homepage banner show (say the store opened after a failed refetch):
      // move them onto it, so what they show is what exposures are sent for.
      if (groupChanged && !tag.reload) announceCatalog(result.data);
      // The groups moved on while this was in flight (a switch, or a late
      // answer that landed before this request was tagged): refetch for the
      // groups now known rather than keep this cohort until the 60 s refresh.
      followExperiments();
      return result.data;
    } catch (error) {
      console.warn("Error getting cosmetics:", error);
      return null;
    }
  })();
  self.request = request;
  __cosmetics = request;
  void request.then((result) => {
    if (result === null && __cosmetics === request) {
      __cosmetics = null;
    }
  });
  return request;
}

/**
 * Drops the catalog, fetches it afresh, and tells the open Store and the
 * homepage banner (COSMETICS_CHANGED): invalidating alone isn't enough, since
 * they keep the catalog object they rendered. A failed fetch dispatches
 * nothing, so they keep what they show.
 */
export async function reloadCosmetics(): Promise<Cosmetics | null> {
  invalidateCosmetics();
  const request = fetchCosmetics();
  __cosmeticsTag.reload = true;
  const fresh = await request;
  // Only the catalog now in use: a reload that a newer one overtook hands its
  // data back but must not replace what the newer one put on screen.
  if (fresh !== null && fresh === __cosmeticsCache) announceCatalog(fresh);
  return fresh;
}

function announceCatalog(cosmetics: Cosmetics): void {
  document.dispatchEvent(
    new CustomEvent<Cosmetics>(COSMETICS_CHANGED, { detail: cosmetics }),
  );
}

// The player's experiment group landed or changed (a late answer, a sign-in,
// an account switch, a logout): a catalog fetched for another group, or
// without one, is refetched in every group, control included, so neither
// group keeps a catalog that can never send exposures. A request still
// waiting for the group picks it up itself.
document.addEventListener(EXPERIMENTS_CHANGED, () => followExperiments());

/**
 * Brings the catalog in hand up to the latest experiment groups. With no
 * test for this player (signed out, or nothing running) and the same cohort,
 * the catalog is already right: it is only re-tagged, with no request. Any
 * other change refetches, the same way in every group.
 */
function followExperiments(): void {
  // Nothing cached: the next fetch (the store opening, the banner's recheck,
  // the 60 s refresh) is tagged with the groups known then.
  if (__cosmetics === null) return;
  const tag = __cosmeticsTag;
  if (tag.generation === undefined) return;
  const latest = experimentsState();
  if (latest === null || tag.generation === latest.generation) return;
  if (latest.assignments.length === 0 && latest.catalogCohort === tag.cohort) {
    tag.generation = latest.generation;
    if (tag.landed) setCatalogGeneration(latest.generation);
    return;
  }
  void reloadCosmetics();
}

/** A tier by name, listed on this rail or not. */
export function subscriptionTier(
  cosmetics: Cosmetics | null | undefined,
  name: string,
): Subscription | null {
  return (
    cosmetics?.subscriptions?.[name] ??
    cosmetics?.unlistedSubscriptions?.[name] ??
    null
  );
}

/**
 * Warms the two caches every cosmetics resolution reads — the profile and the
 * catalog — so a later getPlayerCosmetics()/getPlayerCosmeticsRefs() answers
 * from memory instead of the network.
 *
 * Called from paths that are about to need cosmetics but are not ready to wait
 * for them, so the network time is spent while the player is still choosing
 * rather than after they commit. Never rejects: both calls already resolve to
 * a falsy value on failure, and callers fire and forget.
 */
export function prewarmCosmetics(): Promise<void> {
  return Promise.all([getUserMe(), fetchCosmetics()]).then(
    () => undefined,
    () => undefined,
  );
}

async function resolveFlagUrl(flagRef: string): Promise<string | undefined> {
  if (flagRef.startsWith("flag:")) {
    const key = flagRef.slice("flag:".length);
    const cosmetics = await fetchCosmetics();
    const flagData = cosmetics?.flags?.[key];
    return flagData?.url;
  }
  if (flagRef.startsWith("country:")) {
    const code = flagRef.slice("country:".length);
    return assetUrl(`flags/${code}.svg`);
  }
  return undefined;
}

export async function getCosmeticsHash(): Promise<string | null> {
  await fetchCosmetics();
  return __cosmeticsHash;
}

export function cosmeticRelationship(
  opts: {
    wildcardFlare: string;
    requiredFlare: string;
    priceSoft?: number;
    priceHard?: number;
    affiliateCode: string | null;
    itemAffiliateCode: string | null;
  },
  userMeResponse: UserMeResponse | false,
): "owned" | "purchasable" | "blocked" {
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);

  if (flares.includes(opts.wildcardFlare)) {
    return "owned";
  }

  if (flares.includes(opts.requiredFlare)) {
    return "owned";
  }

  if (opts.affiliateCode !== opts.itemAffiliateCode) {
    return "blocked";
  }

  // Cosmetics are sold for currency only (USD checkout was removed).
  if (opts.priceSoft !== undefined || opts.priceHard !== undefined) {
    return "purchasable";
  }

  return "blocked";
}

function patternRelationship(
  pattern: Pattern,
  colorPalette: { name: string; isArchived?: boolean } | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  if (colorPalette === null) {
    // For backwards compatibility only show non-colored patterns if they are owned.
    const flares =
      userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
    if (
      flares.includes("pattern:*") ||
      flares.includes(`pattern:${pattern.name}`)
    ) {
      return "owned";
    }
    return "blocked";
  }

  if (colorPalette.isArchived) {
    // Check ownership first — if owned, show it even if archived.
    const flares =
      userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
    if (
      flares.includes("pattern:*") ||
      flares.includes(`pattern:${pattern.name}:${colorPalette.name}`)
    ) {
      return "owned";
    }
    return "blocked";
  }

  return cosmeticRelationship(
    {
      wildcardFlare: "pattern:*",
      requiredFlare: `pattern:${pattern.name}:${colorPalette.name}`,
      priceSoft: pattern.priceSoft,
      priceHard: pattern.priceHard,
      affiliateCode,
      itemAffiliateCode: pattern.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

function flagRelationship(
  flag: Flag,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "flag:*",
      requiredFlare: `flag:${flag.name}`,
      priceSoft: flag.priceSoft,
      priceHard: flag.priceHard,
      affiliateCode,
      itemAffiliateCode: flag.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

export function crownRelationship(
  crown: Crown,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "crown:*",
      requiredFlare: `crown:${crown.name}`,
      priceSoft: crown.priceSoft,
      priceHard: crown.priceHard,
      affiliateCode,
      itemAffiliateCode: crown.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

function skinRelationship(
  skin: Skin,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "skin:*",
      requiredFlare: `skin:${skin.name}`,
      priceSoft: skin.priceSoft,
      priceHard: skin.priceHard,
      affiliateCode,
      itemAffiliateCode: skin.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

function effectRelationship(
  effect: Effect,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  return cosmeticRelationship(
    {
      wildcardFlare: "effect:*",
      requiredFlare: `effect:${effect.name}`,
      priceSoft: effect.priceSoft,
      priceHard: effect.priceHard,
      affiliateCode,
      itemAffiliateCode: effect.affiliateCode ?? null,
    },
    userMeResponse,
  );
}

/** The flare a pack item's purchase grants, e.g. "pattern:camo:red". */
export function packItemFlare(item: CosmeticPackItem): string {
  const base = `${item.type}:${item.name}`;
  return item.colorPalette ? `${base}:${item.colorPalette}` : base;
}

/**
 * The resolved entry a pack item refers to, or undefined if its cosmetic is
 * no longer in the catalog. A pattern item is the entry for its palette —
 * the "pattern:<key>:<palette>" one, or the uncoloured "pattern:<key>" one
 * when the item names no palette — since that is the flare the pack grants.
 */
export function findPackItem(
  item: CosmeticPackItem,
  candidates: readonly ResolvedCosmetic[],
): ResolvedCosmetic | undefined {
  return candidates.find(
    (r) =>
      r.type === item.type &&
      r.cosmetic?.name === item.name &&
      (item.type !== "pattern" ||
        r.key.split(":")[2] === (item.colorPalette ?? undefined)),
  );
}

/**
 * The pack's items the player already owns — by the item's own flare or the
 * type wildcard. Any owned item blocks buying the pack (the server answers
 * 409; there is no partial grant), so callers use this to explain why.
 */
export function ownedPackItems(
  pack: CosmeticPack,
  userMeResponse: UserMeResponse | false,
): CosmeticPackItem[] {
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
  return pack.items.filter(
    (item) =>
      flares.includes(packItemFlare(item)) || flares.includes(`${item.type}:*`),
  );
}

function cosmeticPackRelationship(
  pack: CosmeticPack,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): "owned" | "purchasable" | "blocked" {
  if (pack.items.length === 0) return "blocked";
  const owned = ownedPackItems(pack, userMeResponse).length;
  if (owned === pack.items.length) return "owned";
  // Pack revenue isn't attributed to affiliates: hidden in affiliate mode.
  if (affiliateCode !== null) return "blocked";
  // Partially owned packs can't be bought (see ownedPackItems).
  if (owned > 0) return "blocked";
  return pack.priceHard > 0 ? "purchasable" : "blocked";
}

export type ResolvedCosmetic = {
  type:
    | "pattern"
    | "skin"
    | "flag"
    | "crown"
    | "effect"
    | "pack"
    | "cosmeticPack"
    | "subscription"
    | CardItemType;
  cosmetic:
    | Pattern
    | Skin
    | Flag
    | Crown
    | Effect
    | Pack
    | CosmeticPack
    | Subscription
    | CardItem
    | null;
  colorPalette: ColorPalette | null;
  relationship: "owned" | "purchasable" | "blocked";
  /** Unique key for selection/identity, e.g. "pattern:hearts:red" or "skin:mountain" */
  key: string;
  /** For effects only: the effectType (also the catalog's outer key). */
  effectType?: string;
  /**
   * For cosmetic packs only: the pack's items resolved against this catalog,
   * in pack order. An item whose cosmetic is no longer in the catalog is
   * skipped (the server still sells whatever remains in the pack).
   */
  packItems?: ResolvedCosmetic[];
};

/**
 * Resolves all cosmetics into a flat display-ready list with relationship
 * status and resolved color palettes. Callers can filter by relationship.
 */
export function resolveCosmetics(
  cosmetics: Cosmetics | null,
  userMeResponse: UserMeResponse | false,
  affiliateCode: string | null,
): ResolvedCosmetic[] {
  if (!cosmetics) return [];
  const result: ResolvedCosmetic[] = [];

  // Default pattern (always owned)
  result.push({
    type: "pattern",
    cosmetic: null,
    colorPalette: null,
    relationship: "owned",
    key: "pattern:default",
  });

  // Patterns × color palettes
  for (const [patternKey, pattern] of Object.entries(cosmetics.patterns)) {
    const colorPalettes = [...(pattern.colorPalettes ?? []), null];
    for (const cp of colorPalettes) {
      const rel = patternRelationship(
        pattern,
        cp,
        userMeResponse,
        affiliateCode,
      );
      const resolvedPalette = cp
        ? (cosmetics.colorPalettes?.[cp.name] ?? null)
        : null;
      const key = cp
        ? `pattern:${patternKey}:${cp.name}`
        : `pattern:${patternKey}`;
      result.push({
        type: "pattern",
        cosmetic: pattern,
        colorPalette: resolvedPalette,
        relationship: rel,
        key,
      });
    }
  }

  // Flags
  for (const [flagKey, flag] of Object.entries(cosmetics.flags)) {
    const rel = flagRelationship(flag, userMeResponse, affiliateCode);
    result.push({
      type: "flag",
      cosmetic: flag,
      colorPalette: null,
      relationship: rel,
      key: `flag:${flagKey}`,
    });
  }

  // Crowns
  for (const [crownKey, crown] of Object.entries(cosmetics.crowns ?? {})) {
    const rel = crownRelationship(crown, userMeResponse, affiliateCode);
    result.push({
      type: "crown",
      cosmetic: crown,
      colorPalette: null,
      relationship: rel,
      key: `crown:${crownKey}`,
    });
  }

  // Skins (image-based territory cosmetics). No separate "default" entry —
  // the pattern default doubles as "no skin": selecting it clears both.
  for (const [skinKey, skin] of Object.entries(cosmetics.skins ?? {})) {
    const rel = skinRelationship(skin, userMeResponse, affiliateCode);
    result.push({
      type: "skin",
      cosmetic: skin,
      colorPalette: null,
      relationship: rel,
      key: `skin:${skinKey}`,
    });
  }

  // Effects (boat-trail wakes, etc.) — a cosmetic category like skins/flags.
  // Catalog is nested: effects[effectType][effectName]. We carry effectType (the
  // outer key, which each effect also stores) on the resolved item.
  for (const [effectType, byName] of Object.entries(cosmetics.effects ?? {})) {
    for (const [effectKey, effect] of Object.entries(byName ?? {})) {
      const rel = effectRelationship(effect, userMeResponse, affiliateCode);
      result.push({
        type: "effect",
        cosmetic: effect,
        colorPalette: null,
        relationship: rel,
        key: `effect:${effectType}:${effectKey}`,
        effectType,
      });
    }
  }

  // Packs
  for (const [packKey, pack] of Object.entries(cosmetics.currencyPacks ?? {})) {
    // NEVER gate this on `pack.product`. That block is the Stripe
    // {productId, priceId} pair and it is null for every Steam-only listing,
    // so gating rendered those packs as blocked and their buy button never
    // appeared. A listed currency pack is buyable; if a rail cannot sell it,
    // the checkout call is what says so.
    const rel = "purchasable";
    result.push({
      type: "pack",
      cosmetic: pack,
      colorPalette: null,
      relationship: rel,
      key: `pack:${packKey}`,
    });
  }

  // Cosmetic packs. Items reference cosmetics resolved above (findPackItem).
  for (const [packKey, pack] of Object.entries(cosmetics.packs ?? {})) {
    const packItems = pack.items.flatMap((item) => {
      const found = findPackItem(item, result);
      return found ? [found] : [];
    });
    result.push({
      type: "cosmeticPack",
      cosmetic: pack,
      colorPalette: null,
      relationship: cosmeticPackRelationship(
        pack,
        userMeResponse,
        affiliateCode,
      ),
      key: `cosmeticPack:${packKey}`,
      packItems,
    });
  }

  // Subscriptions
  const flares =
    userMeResponse === false ? [] : (userMeResponse.player.flares ?? []);
  // A grant beside a paid subscription leaves the paid tier as the one owned.
  const currentSub =
    userMeResponse === false
      ? null
      : (paidSubscriptionOf(userMeResponse.player) ??
        giftSubscriptionOf(userMeResponse.player));
  const currentSubTier = currentSub?.tier ?? null;
  // OPE-440. A grant is free access nobody is billing, not something the
  // player bought, and the tier it confers is the one they are likeliest to
  // buy. Calling it "owned" is what rendered a dead "Subscribed" box where
  // the buy button goes, so a granted player had no way to pay us for the
  // tier they were already enjoying. `owned` is read by the store and nowhere
  // else, so this changes the buy affordance and nothing about what the grant
  // currently entitles them to.
  //
  // A flare is untouched by this: it is a permanent unlock, not a month, and
  // there is genuinely nothing to sell someone who holds one.
  const grantIsCurrent = isGrantedSubscription(currentSub);
  // infra adds a `subscription:<tier>` flare for every row held, gift rows
  // included, so for a held tier the flare says nothing the rows don't.
  const heldTiers = new Set(
    userMeResponse === false
      ? []
      : subscriptionsOf(userMeResponse.player).map((s) => s.tier),
  );
  for (const [subKey, sub] of Object.entries(cosmetics.subscriptions ?? {})) {
    const key = `subscription:${subKey}`;
    // `subscriptions` is this rail's storefront, so every tier in it is for
    // sale. NEVER gate on `sub.product`: that is the Stripe listing, null for
    // a tier only Steam sells, and gating on it hid such tiers from the store
    // (see currency packs above). If a rail cannot sell it, checkout says so.
    const isCurrentTier = subKey === currentSubTier;
    const demoteGrant = grantIsCurrent && isCurrentTier;
    const isCurrent =
      (flares.includes(key) && !heldTiers.has(subKey)) ||
      (isCurrentTier && !demoteGrant);
    const rel: ResolvedCosmetic["relationship"] = isCurrent
      ? "owned"
      : "purchasable";
    result.push({
      type: "subscription",
      cosmetic: sub,
      colorPalette: null,
      relationship: rel,
      key,
    });
  }
  const heldUnlisted =
    currentSubTier !== null && !cosmetics.subscriptions?.[currentSubTier]
      ? cosmetics.unlistedSubscriptions?.[currentSubTier]
      : undefined;
  if (heldUnlisted) {
    result.push({
      type: "subscription",
      cosmetic: heldUnlisted,
      colorPalette: null,
      relationship: "owned",
      key: `subscription:${currentSubTier}`,
    });
  }

  return result;
}

/**
 * Groups resolved cosmetics so that colour-palette variants of the same pattern
 * collapse into a single entry. Returns an array of groups in first-seen order
 */
export function groupCosmeticVariants(
  items: ResolvedCosmetic[],
): ResolvedCosmetic[][] {
  const groups: ResolvedCosmetic[][] = [];
  const patternGroupByName = new Map<string, number>();
  for (const item of items) {
    if (item.type === "pattern" && item.cosmetic !== null) {
      const name = item.cosmetic.name;
      const existing = patternGroupByName.get(name);
      if (existing !== undefined) {
        groups[existing].push(item);
        continue;
      }
      patternGroupByName.set(name, groups.length);
    }
    groups.push([item]);
  }
  return groups;
}

export function resolvedToPlayerPattern(
  resolved: ResolvedCosmetic,
): PlayerPattern | null {
  if (resolved.type !== "pattern") return null;
  const c = resolved.cosmetic;
  if (c === null) return null;
  return {
    name: c.name,
    patternData: (c as Pattern).pattern,
    colorPalette: resolved.colorPalette ?? undefined,
  };
}

// `verified` is passed in rather than looked up: the caller has already
// resolved what name the player is joining under (see resolvePlayerName), and
// the badge has to agree with that exact decision. Reading it back out of the
// DOM here was the same missing seam.
export async function getPlayerCosmeticsRefs(
  opts: { verified?: boolean } = {},
): Promise<PlayerCosmeticRefs> {
  const userSettings = new UserSettings();
  // Resolve the profile first: getUserMe activates the per-player cosmetics
  // scope (UserSettings.setPlayerId), which must happen before selections are
  // read below.
  await getUserMe();
  const cosmetics = await fetchCosmetics();
  let pattern: PlayerPattern | null =
    userSettings.getSelectedPatternName(cosmetics);
  let patternDenied = false;

  if (pattern) {
    const userMe = await getUserMe();
    if (userMe) {
      const flareName =
        pattern.colorPalette?.name === undefined
          ? `pattern:${pattern.name}`
          : `pattern:${pattern.name}:${pattern.colorPalette.name}`;
      const flares = userMe.player.flares ?? [];
      const hasWildcard = flares.includes("pattern:*");
      if (!hasWildcard && !flares.includes(flareName)) {
        pattern = null;
        patternDenied = true;
      }
    } else {
      // Unknown profile: keep the selection in settings, but do not send it.
      pattern = null;
    }
    if (patternDenied) {
      userSettings.setSelectedPatternName(undefined);
    }
  }

  let flag = userSettings.getFlag();
  // Dropping a flag from this join and erasing the player's saved selection
  // are two different decisions, and only one of them is reversible. Erase
  // only on a definite answer — the catalog no longer lists the flag, or the
  // profile says the player is not entitled. "We could not ask" is not an
  // answer: getUserMe() returns the same `false` for "signed out" and for a
  // refused connection, a timed-out request or an expired session, so
  // treating it as "not entitled" erased saved flags over network failures.
  let flagDenied = false;
  if (flag?.startsWith("flag:")) {
    const key = flag.slice("flag:".length);
    const flagData = cosmetics?.flags?.[key];
    if (!flagData) {
      // Only clear if cosmetics loaded successfully but the key is missing
      if (cosmetics) {
        flag = null;
        flagDenied = true;
      }
    } else {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("flag:*");
        if (!hasWildcard && !flares.includes(`flag:${flagData.name}`)) {
          flag = null;
          flagDenied = true;
        }
      } else {
        // Unknown profile: keep the selection, but do not send it. An
        // entitlement we cannot verify is not one to claim — the server does
        // not strip an unowned cosmetic ref, it refuses the connection
        // (Privilege returns "forbidden", Worker.ts closes the socket with
        // CosmeticsForbidden), so sending it would trade a lost flag for an
        // unjoinable multiplayer.
        flag = null;
      }
    }
  }
  if (flagDenied) {
    userSettings.clearFlag();
  }

  let skinName = userSettings.getSelectedSkinName() ?? undefined;
  let skinDenied = false;
  if (skinName) {
    const skin = cosmetics?.skins?.[skinName];
    if (!skin) {
      skinName = undefined;
      if (cosmetics) {
        // Cosmetics loaded but the saved skin no longer exists.
        skinDenied = true;
      }
    } else {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("skin:*");
        if (!hasWildcard && !flares.includes(`skin:${skin.name}`)) {
          skinName = undefined;
          skinDenied = true;
        }
      } else {
        // Unknown profile: keep the selection, but do not send it.
        skinName = undefined;
      }
    }
    if (skinDenied) {
      userSettings.setSelectedPatternName(undefined);
    }
  }

  let crownName = userSettings.getSelectedCrownName() ?? undefined;
  let crownDenied = false;
  if (crownName) {
    const crown = cosmetics?.crowns?.[crownName];
    if (!crown) {
      crownName = undefined;
      if (cosmetics) {
        // Cosmetics loaded but the saved crown no longer exists.
        crownDenied = true;
      }
    } else {
      const userMe = await getUserMe();
      if (userMe) {
        const flares = userMe.player.flares ?? [];
        const hasWildcard = flares.includes("crown:*");
        if (!hasWildcard && !flares.includes(`crown:${crown.name}`)) {
          crownName = undefined;
          crownDenied = true;
        }
      } else {
        // Unknown profile: keep the selection, but do not send it.
        crownName = undefined;
      }
    }
    if (crownDenied) {
      userSettings.setSelectedCrownName(undefined);
    }
  }

  // Effects: a per-slot map (slot -> effect name). A slot is the effectType for
  // trails and the nukeType for nuke explosions (see effectTypeForSlot). Drop any
  // entry whose effect no longer exists, doesn't fit the slot, or the user can't
  // access. Like skins/flags/patterns above, a selection is kept in settings (and
  // omitted from join refs) when cosmetics or userMe fail to load.
  const selectedEffects = userSettings.getSelectedEffects();
  const effects: Record<string, string> = {};
  for (const [slot, name] of Object.entries(selectedEffects)) {
    const effect = findEffectForSlot(cosmetics, slot, name);
    if (!effect) {
      if (cosmetics) {
        userSettings.setSelectedEffectName(slot, undefined);
      }
      continue;
    }
    const userMe = await getUserMe();
    if (userMe) {
      const flares = userMe.player.flares ?? [];
      const hasWildcard = flares.includes("effect:*");
      if (!hasWildcard && !flares.includes(`effect:${effect.name}`)) {
        userSettings.setSelectedEffectName(slot, undefined);
        continue;
      }
    } else {
      // Unknown profile: keep the selection in settings, but do not send it.
      continue;
    }
    effects[slot] = name;
  }

  return {
    flag: flag ?? undefined,
    patternName: pattern?.name ?? undefined,
    patternColorPaletteName: pattern?.colorPalette?.name ?? undefined,
    skinName,
    crownName,
    effects: Object.keys(effects).length > 0 ? effects : undefined,
    verified: opts.verified ? true : undefined,
  };
}

export async function getPlayerCosmetics(
  opts: { verified?: boolean } = {},
): Promise<PlayerCosmetics> {
  const refs = await getPlayerCosmeticsRefs(opts);
  const cosmetics = await fetchCosmetics();

  const result: PlayerCosmetics = {};

  if (refs.flag) {
    result.flag = await resolveFlagUrl(refs.flag);
  }

  const devPattern = new UserSettings().getDevOnlyPattern();

  if (devPattern) {
    result.pattern = {
      name: devPattern.name,
      patternData: devPattern.patternData,
      colorPalette: devPattern.colorPalette,
    };
  } else if (refs.patternName && cosmetics) {
    const pattern = cosmetics.patterns[refs.patternName];

    if (pattern) {
      result.pattern = {
        name: refs.patternName,
        patternData: pattern.pattern,
        colorPalette: refs.patternColorPaletteName
          ? cosmetics.colorPalettes?.[refs.patternColorPaletteName]
          : undefined,
      };
    }
  }

  if (refs.skinName && cosmetics) {
    const skin = cosmetics.skins?.[refs.skinName];
    if (skin) {
      result.skin = { name: refs.skinName, url: skin.url };
    }
  }

  const devCrown = new UserSettings().getDevOnlyCrown();

  if (devCrown) {
    result.crown = { name: "dev_crown", url: devCrown };
  } else if (refs.crownName && cosmetics) {
    const crown = cosmetics.crowns?.[refs.crownName];
    if (crown) {
      result.crown = { name: refs.crownName, url: crown.url };
    }
  }

  if (refs.effects && cosmetics) {
    const effects: Record<string, PlayerEffect> = {};
    for (const [slot, name] of Object.entries(refs.effects)) {
      const effect = findEffectForSlot(cosmetics, slot, name);
      if (effect) {
        effects[slot] = { name: effect.name, effectType: effect.effectType };
      }
    }
    if (Object.keys(effects).length > 0) result.effects = effects;
  }

  if (refs.verified) {
    result.verified = true;
  }

  return result;
}

export function translateCosmetic(prefix: string, name: string): string {
  const translation = translateText(`${prefix}.${name}`);
  if (translation.startsWith(prefix)) {
    return name
      .split("_")
      .filter((word) => word.length > 0)
      .map((word) => word[0].toUpperCase() + word.substring(1))
      .join(" ");
  }
  return translation;
}
