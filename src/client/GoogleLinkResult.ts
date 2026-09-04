import { showInGameAlert } from "./InGameModal";
import { translateText } from "./Utils";

/**
 * Handle the `link=<result>` router arg the Google link callback returns with.
 *
 * `linkGoogle()` sends the current URL as the redirect target, so the result
 * lands on whichever modal started the flow — the account modal or the
 * standalone account-settings modal. Both call this on open: surface the
 * outcome, then strip the one-shot param so a refresh or re-open can't replay
 * it.
 */
export function consumeGoogleLinkResult(args?: Record<string, unknown>): void {
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

  // "cancel" needs no feedback — the user chose to back out.
  const messageKey =
    link === "google"
      ? "account_modal.link_google_success"
      : link === "already_linked"
        ? "account_modal.link_google_already_linked"
        : link === "error"
          ? "account_modal.link_google_error"
          : null;
  if (messageKey === null) return;
  void showInGameAlert(translateText(messageKey));
}
