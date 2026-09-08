import { showInGameAlert } from "./InGameModal";
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

  const messageKey = LINK_RESULT_KEYS[link];
  if (messageKey === undefined) return;
  void showInGameAlert(translateText(messageKey));
}
