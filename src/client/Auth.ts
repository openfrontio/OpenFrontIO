import { decodeJwt } from "jose";
import { UserSettings } from "src/core/game/UserSettings";
import { z } from "zod";
import { TokenPayload, TokenPayloadSchema } from "../core/ApiSchemas";
import { base64urlToUuid } from "../core/Base64";
import { getApiBase, getAudience } from "./Api";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import type { DesktopSessionState, SessionFailureKind } from "./DesktopShell";
import type { SteamTicketResult } from "./SteamSDK";
import { steamSDK } from "./SteamSDK";
import { generateCryptoRandomUUID } from "./Utils";

export type UserAuth = { jwt: string; claims: TokenPayload } | false;

const PERSISTENT_ID_KEY = "player_persistent_id";

let __jwt: string | null = null;
let __refreshPromise: Promise<void> | null = null;
let __expiresAt: number = 0;

let __sessionState: DesktopSessionState = { status: "unknown" };

/**
 * The shell's current session state. Exported for components that mount after
 * the first transition has already been published, so they are not left blank
 * waiting for the next change -- the same reason the update bridge delivers
 * its current state on subscribe.
 */
export function getDesktopSessionState(): DesktopSessionState {
  return __sessionState;
}

function setSessionState(state: DesktopSessionState): void {
  __sessionState = state;
  document.dispatchEvent(
    new CustomEvent("desktop-session-state", { detail: state }),
  );
}

export function discordLogin() {
  const redirectUri = encodeURIComponent(window.location.href);
  window.location.href = `${getApiBase()}/auth/login/discord?redirect_uri=${redirectUri}`;
}

export function googleLogin() {
  const redirectUri = encodeURIComponent(window.location.href);
  window.location.href = `${getApiBase()}/auth/login/google?redirect_uri=${redirectUri}`;
}

// Link a Google account to the currently logged-in player. Unlike login this is
// an authenticated request, so we fetch the Google authorize URL with the
// Bearer token (a top-level navigation can't carry it) and then navigate to it.
// Returns false if the user isn't logged in or the request fails.
export async function linkGoogle(): Promise<boolean> {
  const authHeader = await getAuthHeader();
  if (authHeader === "") return false;
  const redirectUri = encodeURIComponent(window.location.href);
  try {
    const response = await fetch(
      `${getApiBase()}/auth/link/google?redirect_uri=${redirectUri}`,
      {
        headers: { Authorization: authHeader },
        credentials: "include",
      },
    );
    if (!response.ok) {
      console.error("Failed to start Google link", response);
      return false;
    }
    const { url } = await response.json();
    if (typeof url !== "string") return false;
    window.location.href = url;
    return true;
  } catch (e) {
    console.error("Failed to start Google link", e);
    return false;
  }
}

export async function tempTokenLogin(token: string): Promise<string | null> {
  const response = await fetch(
    `${getApiBase()}/auth/login/token?login-token=${token}`,
    {
      credentials: "include",
    },
  );
  if (response.status !== 200) {
    console.error("Token login failed", response);
    return null;
  }
  const json = await response.json();
  const { email } = json;
  return email;
}

export async function getAuthHeader(): Promise<string> {
  const userAuthResult = await userAuth();
  if (!userAuthResult) return "";
  const { jwt } = userAuthResult;
  return `Bearer ${jwt}`;
}

export async function logOut(allSessions: boolean = false): Promise<boolean> {
  try {
    const response = await fetch(
      getApiBase() + (allSessions ? "/auth/revoke" : "/auth/logout"),
      {
        method: "POST",
        credentials: "include",
      },
    );

    if (response.ok === false) {
      console.error("Logout failed", response);
      return false;
    }

    return true;
  } catch (e) {
    console.error("Logout failed", e);
    return false;
  } finally {
    clearLocalSession();
  }
}

// Drop all client-side auth state without calling the API. Used after account
// deletion (DELETE /users/@me), where the server has already revoked every
// session and cleared the refresh cookie, so /auth/logout must not be called.
// Announce a logout that nothing asked for. Consumers holding account state
// can't infer it: every failing call just resolves false, which is also what a
// transient network error looks like. Dispatched from clearLocalSession so it
// covers all of them — an expired refresh token, a JWT issued for another
// origin, a 401 on any endpoint — rather than the one branch that prompted it.
//
// Distinct from userMeResponse, which Main dispatches: account state lives
// partly outside that event (the nav button's imperative avatar and its cached
// profile, window.adsEnabled), so Main answers this by running the same
// no-session path it runs at startup, which broadcasts userMeResponse itself.
function announceLoggedOut(): void {
  document.dispatchEvent(
    new CustomEvent("session-cleared", { bubbles: true, cancelable: true }),
  );
}

export function clearLocalSession(): void {
  const hadSession = __jwt !== null;
  __jwt = null;
  localStorage.removeItem(PERSISTENT_ID_KEY);
  // Switch cosmetics back to the logged-out scope. The player's own
  // selections stay stored under their publicId and are restored on the
  // next login (#4955).
  UserSettings.setPlayerId(null);
  // Keep the desktop bar's session state in sync: without this, a 401-driven
  // logOut() (or any other clearLocalSession caller) leaves __sessionState at
  // "signed-in" with no JWT behind it, so the bar hides and multiplayer
  // unlocks with nothing backing it until the next join self-heals it.
  // Guarded to Steam only -- web/CrazyGames have no bar and no session-gating
  // to desync. Skipped while a retry is legitimately in flight (status
  // "retrying"): retrySteamSignIn already owns that transition end-to-end via
  // its own userAuth() call, and this must not race ahead of it with a stale
  // state that the retry is about to overwrite anyway.
  //
  // Publish "unknown" rather than a failure reason: logOut() runs on ANY 401
  // from /users/@me, on key rotation, and on an iss/aud claim mismatch --
  // none of which mean Steam sign-in failed. Asserting "signed-out" with a
  // Steam reason here would gate multiplayer and show a Steam-specific error
  // for an unrelated auth event that used to self-heal invisibly. "unknown"
  // does not gate (see multiplayerAllowedForSession), and the next
  // userAuth() call re-establishes the real state.
  if (steamSDK.isOnSteam() && __sessionState.status !== "retrying") {
    setSessionState({ status: "unknown" });
  }
  if (hadSession) announceLoggedOut();
}

export async function isLoggedIn(): Promise<boolean> {
  const userAuthResult = await userAuth();
  return userAuthResult !== false;
}

// True when the in-memory session still belongs to the given JWT subject.
// Lets callers of authenticated endpoints discard a response that arrived
// after a logout or session change invalidated the request's session.
export function isSessionActive(sub: string): boolean {
  if (__jwt === null) return false;
  try {
    return decodeJwt(__jwt).sub === sub;
  } catch {
    return false;
  }
}

export async function userAuth(
  shouldRefresh: boolean = true,
): Promise<UserAuth> {
  try {
    const jwt = __jwt;
    if (!jwt) {
      if (!shouldRefresh) {
        console.warn("No JWT found and shouldRefresh is false");
        return false;
      }
      console.log("No JWT found");
      await refreshJwt();
      return userAuth(false);
    }

    // Verify the JWT (requires browser support)
    // const jwks = createRemoteJWKSet(
    //   new URL(getApiBase() + "/.well-known/jwks.json"),
    // );
    // const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    //   issuer: getApiBase(),
    //   audience: getAudience(),
    // });

    const payload = decodeJwt(jwt);
    const { iss, aud } = payload;

    if (iss !== getApiBase()) {
      // JWT was not issued by the correct server
      console.error('unexpected "iss" claim value');
      logOut();
      return false;
    }
    const myAud = getAudience();
    if (myAud !== "localhost" && aud !== myAud) {
      // JWT was not issued for this website
      console.error('unexpected "aud" claim value');
      logOut();
      return false;
    }
    if (Date.now() >= __expiresAt - 3 * 60 * 1000) {
      console.log("jwt expired or about to expire");
      if (!shouldRefresh) {
        console.error("jwt expired and shouldRefresh is false");
        return false;
      }
      await refreshJwt();

      // Try to get login info again after refreshing
      return userAuth(false);
    }

    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid payload", error);
      return false;
    }

    const claims = result.data;
    return { jwt, claims };
  } catch (e) {
    console.error("isLoggedIn failed", e);
    return false;
  }
}

async function refreshJwt(): Promise<void> {
  if (__refreshPromise) {
    return __refreshPromise;
  }
  __refreshPromise = doRefreshJwt();
  try {
    await __refreshPromise;
  } finally {
    __refreshPromise = null;
  }
}

async function doRefreshJwt(): Promise<void> {
  if (steamSDK.isOnSteam()) {
    const result = await steamSDK.getTicket();
    if (result.ok) {
      // On Steam we exchange a Steam Web-API ticket for our session.
      return doSteamLogin(result.ticket);
    }
    // TERMINAL, deliberately: this used to fall through to /auth/refresh,
    // which cannot succeed in the shell (the Electron profile has no refresh
    // cookie). That was a guaranteed 401 followed by logOut(), costing two
    // pointless round trips and the player's stored persistent ID every time
    // Steam hiccuped. Record why and stop.
    __jwt = null;
    setSessionState({ status: "signed-out", reason: ticketReason(result) });
    return;
  }
  if (crazyGamesSDK.isOnCrazyGames()) {
    const token = await crazyGamesSDK.getUserToken();
    if (token) {
      // Signed-in CrazyGames account: exchange their token for our session.
      // No CrazyGames account / not signed in falls through to the guest flow
      // below.
      return doCrazyGamesLogin(token);
    }
  }
  try {
    console.log("Refreshing jwt");
    const response = await fetch(getApiBase() + "/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (response.status !== 200) {
      console.error("Refresh failed", response);
      logOut();
      return;
    }
    const json = await response.json();
    const { jwt, expiresIn } = json;
    __expiresAt = Date.now() + expiresIn * 1000;
    console.log("Refresh succeeded");
    __jwt = jwt;
  } catch (e) {
    console.error("Refresh failed", e);
    // if server unreachable, just clear jwt
    __jwt = null;
    return;
  }
}

// Total mapping from the shell's three ticket failures. Kept exhaustive by
// the parameter type: adding a SteamTicketFailure value fails the build here.
// The `default` is not reachable through that exhaustive type, but the shell
// lives in a separate repo and the bridge shape reaches us as `unknown` at
// the boundary (see SteamSDK.getTicket's normalisation) -- a malformed
// `reason` from an old or misbehaving shell must still map to something
// rather than return `undefined` at runtime despite the non-optional return
// type.
function ticketReason(
  result: Extract<SteamTicketResult, { ok: false }>,
): SessionFailureKind {
  switch (result.reason) {
    case "unavailable":
      return "steam-unavailable";
    case "timeout":
      return "steam-wedged";
    case "error":
      return "steam-error";
    default:
      return "steam-error";
  }
}

// Exchange a CrazyGames user token for our session. On CrazyGames the refresh
// cookie isn't usable (SameSite=Lax, cross-site iframe), so we re-exchange on
// expiry instead of hitting /auth/refresh.
async function doCrazyGamesLogin(token: string): Promise<void> {
  try {
    console.log("Logging in with CrazyGames");
    const response = await fetch(getApiBase() + "/auth/crazygames", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (response.status !== 200) {
      console.error("CrazyGames login failed", response);
      __jwt = null;
      return;
    }
    const json = await response.json();
    const { jwt, expiresIn } = json;
    __expiresAt = Date.now() + expiresIn * 1000;
    console.log("CrazyGames login succeeded");
    __jwt = jwt;
  } catch (e) {
    console.error("CrazyGames login failed", e);
    __jwt = null;
  }
}

// Exchange a Steam Web-API ticket for our session. Like CrazyGames, the
// refresh cookie isn't usable from app://openfront (cross-site), so we
// re-exchange a fresh ticket on expiry rather than hitting /auth/refresh.
async function doSteamLogin(ticket: string): Promise<void> {
  try {
    console.log("Logging in with Steam");
    // Bounded so a response that never settles can't leave the session
    // pinned at "retrying" forever (it gates multiplayer and the status bar
    // renders no button for that state -- see DesktopStatusBar.sessionAction).
    // An abort throws, which the catch below already maps to "network", so
    // this also means the initial sign-in can no longer hang at "unknown".
    // 10s is generous headroom over a healthy web-api round trip (~1.3s).
    const response = await fetch(getApiBase() + "/auth/steam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) {
      console.error("Steam login failed", response);
      __jwt = null;
      // 401 is infra's unauthorized("Invalid Steam ticket"); 5xx is its
      // internalServerError for "steam unreachable" / "steam auth error",
      // which is Steam's backend rather than anything the player did. Any
      // other status (a Cloudflare WAF 403, a 429) still reached the server
      // -- it is not a transport failure, so it must not render "Can't reach
      // OpenFront. Check your connection." Fold it into "steam-error", the
      // generic bucket, rather than "network".
      setSessionState({
        status: "signed-out",
        reason:
          response.status === 401
            ? "steam-ticket-rejected"
            : response.status >= 500
              ? "steam-backend"
              : "steam-error",
      });
      return;
    }
    const json = await response.json();
    const { jwt, expiresIn } = json;
    __expiresAt = Date.now() + expiresIn * 1000;
    console.log("Steam login succeeded");
    __jwt = jwt;
    setSessionState({ status: "signed-in" });
  } catch (e) {
    console.error("Steam login failed", e);
    __jwt = null;
    setSessionState({ status: "signed-out", reason: "network" });
  }
}

// Called when the CrazyGames auth state changes mid-session (e.g. the player
// signs in): drop the cached session so userAuth() re-exchanges the new token.
// Single-flight: Main's auth listener and the account modal's sign-in handler
// can both react to the same sign-in; sharing one exchange keeps them from
// racing on __jwt. Any refresh already in flight is allowed to settle first so
// its stale result can't satisfy the reauth.
let __reauthPromise: Promise<UserAuth> | null = null;
export async function reauthAfterCrazyGamesChange(): Promise<UserAuth> {
  __reauthPromise ??= (async () => {
    try {
      if (__refreshPromise) {
        await __refreshPromise.catch(() => {});
      }
      __jwt = null;
      __expiresAt = 0;
      return await userAuth();
    } finally {
      __reauthPromise = null;
    }
  })();
  return __reauthPromise;
}

// The Retry action on the desktop status bar. Single-flight for the same
// reason reauthAfterCrazyGamesChange is: the bar and any other caller must
// share one exchange rather than race on __jwt. A refresh already in flight
// is allowed to settle first so its stale result cannot satisfy the retry.
//
// There is no automatic retry anywhere: a wedged Steam session does not
// self-heal (only a Steam restart cleared it in both observed cases), so a
// silent retry would buy nothing and delay the message.
let __steamRetryPromise: Promise<UserAuth> | null = null;
export async function retrySteamSignIn(): Promise<UserAuth> {
  __steamRetryPromise ??= (async () => {
    try {
      if (__refreshPromise) {
        await __refreshPromise.catch(() => {});
      }
      __jwt = null;
      __expiresAt = 0;
      setSessionState({ status: "retrying" });
      return await userAuth();
    } finally {
      // Guarantee, not a duplicate of the happy path: userAuth() is expected
      // to publish a terminal state itself via doSteamLogin/doRefreshJwt's
      // Steam branch. But refreshJwt()'s finally has no catch, so an
      // exception inside doRefreshJwt() (e.g. steamSDK.getTicket() throwing
      // synchronously, or doSteamLogin throwing before it can call
      // setSessionState) propagates straight to userAuth()'s top-level catch,
      // which logs and returns false without touching session state --
      // leaving "retrying" published forever. That is a lockout:
      // multiplayerAllowedForSession gates on every non-signed-in status
      // including "retrying", and DesktopStatusBar.sessionAction renders no
      // button for it. If nothing moved us off "retrying" by the time this
      // settles, force a terminal, actionable state instead.
      if (__sessionState.status === "retrying") {
        setSessionState({ status: "signed-out", reason: "steam-error" });
      }
      __steamRetryPromise = null;
    }
  })();
  return __steamRetryPromise;
}

export async function sendMagicLink(email: string): Promise<boolean> {
  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/auth/magic-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        redirectDomain: window.location.origin,
        email: email,
      }),
    });

    if (response.ok) {
      return true;
    } else {
      console.error(
        "Failed to send recovery email:",
        response.status,
        response.statusText,
      );
      return false;
    }
  } catch (error) {
    console.error("Error sending recovery email:", error);
    return false;
  }
}

// WARNING: DO NOT EXPOSE THIS ID
export async function getPlayToken(): Promise<string> {
  const result = await userAuth();
  if (result !== false) return result.jwt;
  return getPersistentIDFromLocalStorage();
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  const jwt = __jwt;
  if (!jwt) return getPersistentIDFromLocalStorage();
  const payload = decodeJwt(jwt);
  const sub = payload.sub;
  if (!sub) return getPersistentIDFromLocalStorage();
  return base64urlToUuid(sub);
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromLocalStorage(): string {
  // Try to get existing localStorage
  const value = localStorage.getItem(PERSISTENT_ID_KEY);
  if (value) return value;

  // If no localStorage exists, create new ID and set localStorage
  const newID = generateCryptoRandomUUID();
  localStorage.setItem(PERSISTENT_ID_KEY, newID);

  return newID;
}
