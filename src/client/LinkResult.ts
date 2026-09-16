import { showInGameAlert } from "./InGameModal";
import { fetchSteamLinkConflict, type SteamConflictAccount } from "./SteamLink";
import { translateText } from "./Utils";

/**
 * Message for each `link=<result>` the auth callbacks redirect back with.
 *
 * The Steam refusals reuse the vocabulary and the strings the desktop link
 * flow already established in SteamLinkModal — the outcomes are literally the
 * same server-side collision matrix, reached from the website instead of from
 * the game, so a second set of wordings would only be a way for the two to
 * disagree.
 *
 * `cancel` is deliberately absent: the user chose to back out at the provider
 * and needs no feedback. Anything unrecognised is likewise silent.
 */
const LINK_RESULT_KEYS: Record<string, string> = {
  // Google
  google: "account_modal.link_google_success",
  already_linked: "account_modal.link_google_already_linked",

  // Steam
  steam: "account_modal.link_steam_success",
  account_already_has_steam:
    "steam_link_modal.reason_account_already_has_steam",
  steam_linked_elsewhere: "steam_link_modal.reason_steam_linked_elsewhere",
  steam_has_progress: "steam_link_modal.reason_steam_has_progress",

  // The generic "could not complete this" for each provider. Two values rather
  // than one because this handler cannot tell which provider a returning
  // redirect came from, and a Steam failure must not be reported as "couldn't
  // link your Google account". Neither says WHY: the callback cannot, without
  // leaking whether a given account exists.
  error: "account_modal.link_google_error",
  steam_error: "account_modal.link_steam_error",
};

/**
 * Handle the `link=<result>` router arg an account-link callback returns with.
 *
 * `linkGoogle()` / `linkSteam()` send the current URL as the redirect target,
 * so the result lands on whichever modal started the flow — the account modal
 * or the standalone account-settings modal. Both call this on open: surface the
 * outcome, then strip the one-shot param so a refresh or re-open can't replay
 * it.
 */
/**
 * The one link outcome that is a QUESTION rather than a verdict.
 *
 * `steam_has_progress` means the Steam account is already attached to an
 * OpenFront account that holds it and nothing else — the account the desktop
 * login creates for a player who launched on Steam before ever linking. Until
 * now that was a dead end a player could only escape by asking support to
 * delete the account for them; the server may now offer to do exactly that,
 * and this is where the website picks the offer up.
 *
 * The offer is NOT in the URL. The callback is a redirect, so anything it
 * handed back would travel in the hash and outlive the request in history and
 * session restore — a capability to delete an account has no business there.
 * The server keeps it against the session instead, and this asks for it.
 *
 * Every failure falls back to the alert this function used to show: no offer,
 * an unreachable endpoint, or a missing modal element all degrade to the
 * refusal the player would have seen before any of this existed.
 */
interface ConflictModal {
  openForConflict(account: SteamConflictAccount): Promise<void>;
}

async function offerSteamConflictDiscard(): Promise<void> {
  const deadEnd = () =>
    void showInGameAlert(
      translateText("steam_link_modal.reason_steam_has_progress"),
    );

  const lookup = await fetchSteamLinkConflict();
  if (!lookup.ok) {
    // The one failure with a better message than the dead end: a throttled
    // read is not a refusal, and "can't be merged" would be wrong for it.
    if (lookup.reason === "rate_limited") {
      return void showInGameAlert(
        translateText("steam_link_modal.reason_rate_limited", {
          seconds: lookup.retryAfterSeconds ?? 0,
        }),
      );
    }
    return deadEnd();
  }
  const conflict = lookup.conflict;
  if (conflict === null) return deadEnd();
  if (!conflict.discardable) {
    // There is genuinely no way through, and saying WHICH is what keeps the
    // player from opening a ticket to ask.
    return void showInGameAlert(
      translateText(
        conflict.block === "paid"
          ? "steam_link_modal.reason_discard_blocked_paid"
          : "steam_link_modal.reason_discard_blocked",
      ),
    );
  }

  // Structural, not the SteamLinkModal class: this module is otherwise free of
  // Lit and of the modal's own dependencies, and the same
  // small-interface-over-import convention already governs SteamLink.ts's
  // PendingLinkModal.
  const modal = document.querySelector<HTMLElement & ConflictModal>(
    "steam-link-modal",
  );
  if (modal === null || typeof modal.openForConflict !== "function") {
    console.warn("offerSteamConflictDiscard: steam-link-modal unavailable");
    return deadEnd();
  }
  await modal.openForConflict(conflict.account);
}

export function consumeLinkResult(args?: Record<string, unknown>): void {
  const link = typeof args?.link === "string" ? args.link : undefined;
  if (link === undefined) return;

  // replaceState doesn't fire hashchange, so removing the param won't re-route.
  const params = new URLSearchParams(window.location.hash.slice(1));
  params.delete("link");
  const rest = params.toString();
  history.replaceState(
    null,
    "",
    rest ? `#${rest}` : window.location.pathname + window.location.search,
  );

  // An own-property check, not an `=== undefined` check on the lookup. `link`
  // comes straight off the URL hash, so it is fully attacker-chosen, and a
  // plain object literal inherits from Object.prototype: `link=toString`
  // resolves to the inherited function rather than undefined, sails past an
  // undefined guard, and translateText hands it back unchanged for the alert
  // to display. Cosmetic only — lit renders the alert as an escaped text node,
  // so there is no injection — but the deleted GoogleLinkResult used an
  // explicit === ladder and had no such hole, so this would be a regression.
  //
  // hasOwnProperty.call rather than Object.hasOwn: the latter needs an es2022
  // lib target and this project builds below that.
  if (!Object.prototype.hasOwnProperty.call(LINK_RESULT_KEYS, link)) return;

  // Handled after the own-property check above, so an attacker-chosen hash
  // still cannot reach it by any name other than this exact one.
  if (link === "steam_has_progress") {
    void offerSteamConflictDiscard();
    return;
  }

  const messageKey = LINK_RESULT_KEYS[link]!;
  void showInGameAlert(translateText(messageKey));
}
