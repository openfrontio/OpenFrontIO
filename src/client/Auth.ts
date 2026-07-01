import { decodeJwt } from "jose";
import { UserSettings } from "src/core/game/UserSettings";
import { z } from "zod";
import { TokenPayload, TokenPayloadSchema } from "../core/ApiSchemas";
import { base64urlToUuid } from "../core/Base64";
import { getApiBase, getAudience } from "./Api";
import { generateCryptoRandomUUID } from "./Utils";

export type UserAuth = { jwt: string; claims: TokenPayload } | false;

const PERSISTENT_ID_KEY = "player_persistent_id";
// Remembers whether the signed-in user had a linked account, so a later
// session-expiry can prompt re-login (linked users) vs. stay silent (guests)
// even when /users/@me can't be reached at that moment. Persisted (not just
// in-memory) so it survives a reload and an @me outage; cleared on logout.
export const LINKED_ACCOUNT_KEY = "was_linked_account";

let __jwt: string | null = null;
let __refreshPromise: Promise<void> | null = null;
let __expiresAt: number = 0;

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

export interface LogOutOptions {
  /** Revoke every session (/auth/revoke) instead of just the current one. */
  allSessions?: boolean;
  /**
   * Set only for an explicit, user-initiated logout — the one case where we
   * also wipe the local persistent identity + cosmetics. Error-path callers
   * must leave this false, or a transient failure becomes a permanent new
   * guest account.
   */
  userInitiated?: boolean;
}

export async function logOut({
  allSessions = false,
  userInitiated = false,
}: LogOutOptions = {}): Promise<boolean> {
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
    __jwt = null;
    // Only destroy the local persistent identity / cosmetics on an explicit
    // user logout. Error-path callers must NOT wipe identity, or a transient
    // failure turns into a permanent brand-new guest account.
    if (userInitiated) {
      localStorage.removeItem(PERSISTENT_ID_KEY);
      localStorage.removeItem(LINKED_ACCOUNT_KEY);
      new UserSettings().clearFlag();
      new UserSettings().setSelectedPatternName(undefined);
    }
  }
}

export async function isLoggedIn(): Promise<boolean> {
  const userAuthResult = await userAuth();
  return userAuthResult !== false;
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

// Outcome of the most recent authentication check — a /auth/refresh attempt or
// a /users/@me call — so callers (e.g. ranked matchmaking) can tell "your
// session expired" apart from "we couldn't reach the auth server right now". It
// spans both layers because either can be the call that just failed.
export type AuthOutcome = "ok" | "expired" | "transient";
let __lastAuthOutcome: AuthOutcome = "ok";

export function getLastAuthOutcome(): AuthOutcome {
  return __lastAuthOutcome;
}

// Lets the /users/@me path (Api.ts) record its own outcome into the same signal,
// so the transient-vs-expired distinction reflects whichever call last ran.
export function markAuthOutcome(outcome: AuthOutcome): void {
  __lastAuthOutcome = outcome;
}

const REFRESH_MAX_ATTEMPTS = 3;
// Backoff between attempts, indexed by (attempt - 1): 500ms, then 1000ms.
const REFRESH_BACKOFF_MS = [500, 1000];
const REFRESH_TIMEOUT_MS = 10_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fetch() with a per-attempt timeout, so a stalled connection can't hang the
// shared refresh promise (and every caller awaiting it) indefinitely.
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function notifySessionExpired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("auth-session-expired"));
}

async function doRefreshJwt(): Promise<void> {
  // Whether an authenticated session was active before this attempt. Only a
  // session that dies mid-use should surface the "signed out" UI.
  const hadSession = __jwt !== null;

  for (let attempt = 1; attempt <= REFRESH_MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `Refreshing jwt (attempt ${attempt}/${REFRESH_MAX_ATTEMPTS})`,
      );
      const response = await fetchWithTimeout(
        getApiBase() + "/auth/refresh",
        { method: "POST", credentials: "include" },
        REFRESH_TIMEOUT_MS,
      );

      if (response.status === 200) {
        const json = await response.json();
        const { jwt, expiresIn } = json;
        // A 200 with an unusable body would otherwise corrupt our state
        // (undefined jwt makes hadSession lie; NaN expiry disables future
        // refresh). Treat it as a transient failure and retry instead.
        if (typeof jwt === "string" && typeof expiresIn === "number") {
          __expiresAt = Date.now() + expiresIn * 1000;
          __jwt = jwt;
          __lastAuthOutcome = "ok";
          console.log("Refresh succeeded");
          return;
        }
        console.error("Refresh returned 200 with an invalid body");
      } else if (response.status === 401 || response.status === 403) {
        // 401/403 are definitive: the refresh token is genuinely invalid or
        // expired, so retrying can't help. Do a "soft" logout — clear the
        // in-memory JWT but preserve the session cookie + persistent identity —
        // and let a previously-signed-in user be prompted to log in again.
        console.error("Refresh rejected — session expired", response.status);
        __jwt = null;
        __lastAuthOutcome = "expired";
        if (hadSession) notifySessionExpired();
        return;
      } else {
        // Everything else (5xx, 429, ...) is transient — fall through to retry.
        console.error(
          `Refresh failed (status ${response.status}), attempt ${attempt}/${REFRESH_MAX_ATTEMPTS}`,
        );
      }
    } catch (e) {
      // Network error / timeout / server unreachable — transient, retry.
      console.error(
        `Refresh failed (network), attempt ${attempt}/${REFRESH_MAX_ATTEMPTS}`,
        e,
      );
    }

    if (attempt < REFRESH_MAX_ATTEMPTS) {
      await delay(REFRESH_BACKOFF_MS[attempt - 1] ?? 1000);
    }
  }

  // Transient failures exhausted. Clear the in-memory JWT only — keep the
  // session cookie and persistent identity so the next refresh can recover.
  console.error("Refresh failed after retries; staying recoverable");
  __jwt = null;
  __lastAuthOutcome = "transient";
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
