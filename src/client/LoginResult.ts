/**
 * One-shot login outcomes the auth callbacks hand back on the URL they
 * redirect to, as `#login=<result>`.
 *
 * `email_exists` means the sign-in was rejected because the provider's
 * verified email already belongs to an account: we never auto-merge by email,
 * so the user has to sign into the account they have and link this provider
 * from settings.
 *
 * `cancel` is also sent (the user backed out at the provider) but needs no
 * feedback, so it is deliberately not a recognised result here.
 */
export type LoginResult = "email_exists";

const KNOWN_RESULTS: readonly string[] = ["email_exists"];

/**
 * Read the one-shot `login=<result>` router arg and strip it from the URL so a
 * refresh or re-open doesn't replay it. Returns undefined when the param is
 * absent or isn't a result we surface.
 */
export function consumeLoginResult(
  args?: Record<string, unknown>,
): LoginResult | undefined {
  const login = typeof args?.login === "string" ? args.login : undefined;
  if (login === undefined) return undefined;

  // replaceState doesn't fire hashchange, so removing the param won't re-route.
  const params = new URLSearchParams(window.location.hash.slice(1));
  params.delete("login");
  const rest = params.toString();
  history.replaceState(
    null,
    "",
    rest ? `#${rest}` : window.location.pathname + window.location.search,
  );

  return KNOWN_RESULTS.includes(login) ? (login as LoginResult) : undefined;
}
