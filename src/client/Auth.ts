import { decodeJwt } from "jose";
import { z } from "zod";
import { TokenPayload, TokenPayloadSchema } from "../core/ApiSchemas";
import { base64urlToUuid } from "../core/Base64";
import { getApiBase, getAudience } from "./Api";
import {
  isLikelyApiUnavailableError,
  isLocalExternalApiBase,
  localApiUnavailableMessage,
} from "./ExternalApi";
import {
  getUiSessionStorageCachedValue,
  removeUiSessionStorage,
  writeUiSessionStorage,
} from "./runtime/UiSessionRuntime";
import { generateCryptoRandomUUID } from "./Utils";

export type UserAuth = { jwt: string; claims: TokenPayload } | false;

const PERSISTENT_ID_KEY = "player_persistent_id";

let __jwt: string | null = null;
let hasWarnedLocalAuthUnavailable = false;

function warnLocalAuthUnavailableOnce(context: string): void {
  if (hasWarnedLocalAuthUnavailable) return;
  hasWarnedLocalAuthUnavailable = true;
  console.warn(
    `[Auth] ${context}: ${localApiUnavailableMessage("Authentication")}`,
  );
}

export function discordLogin() {
  const redirectUri = encodeURIComponent(window.location.href);
  window.location.href = `${getApiBase()}/auth/login/discord?redirect_uri=${redirectUri}`;
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
    __jwt = null;
    void removeUiSessionStorage(PERSISTENT_ID_KEY);
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
    const { iss, aud, exp } = payload;

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
    const now = Math.floor(Date.now() / 1000);
    if (exp !== undefined && now >= exp - 3 * 60) {
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
  const apiBase = getApiBase();
  try {
    console.log("Refreshing jwt");
    const response = await fetch(apiBase + "/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (response.status !== 200) {
      if (isLocalExternalApiBase(apiBase)) {
        warnLocalAuthUnavailableOnce("refresh");
      } else {
        console.error("Refresh failed", response);
      }
      logOut();
      return;
    }
    const json = await response.json();
    const { jwt } = json;
    console.log("Refresh succeeded");
    __jwt = jwt;
  } catch (e) {
    if (isLocalExternalApiBase(apiBase) && isLikelyApiUnavailableError(e)) {
      warnLocalAuthUnavailableOnce("refresh");
    } else {
      console.error("Refresh failed", e);
    }
    // If server is unreachable, keep client session logged out.
    __jwt = null;
    return;
  }
}

export async function sendMagicLink(email: string): Promise<boolean> {
  const apiBase = getApiBase();
  try {
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
      if (isLocalExternalApiBase(apiBase)) {
        warnLocalAuthUnavailableOnce("magic-link");
      } else {
        console.error(
          "Failed to send recovery email:",
          response.status,
          response.statusText,
        );
      }
      return false;
    }
  } catch (error) {
    if (isLocalExternalApiBase(apiBase) && isLikelyApiUnavailableError(error)) {
      warnLocalAuthUnavailableOnce("magic-link");
    } else {
      console.error("Error sending recovery email:", error);
    }
    return false;
  }
}

// WARNING: DO NOT EXPOSE THIS ID
export async function getPlayToken(): Promise<string> {
  const result = await userAuth();
  if (result !== false) return result.jwt;
  return getPersistentIDFromSessionStorage();
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  const jwt = __jwt;
  if (!jwt) return getPersistentIDFromSessionStorage();
  const payload = decodeJwt(jwt);
  const sub = payload.sub;
  if (!sub) return getPersistentIDFromSessionStorage();
  return base64urlToUuid(sub);
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromSessionStorage(): string {
  const value = getUiSessionStorageCachedValue(PERSISTENT_ID_KEY);
  if (value) return value;

  const newID = generateCryptoRandomUUID();
  void writeUiSessionStorage(PERSISTENT_ID_KEY, newID);

  return newID;
}
