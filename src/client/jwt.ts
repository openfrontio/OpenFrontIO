import { decodeJwt } from "jose";
import { z } from "zod/v4";
import {
  RefreshResponseSchema,
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";

function getAudience() {
  const { hostname } = new URL(window.location.href);
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname;
}

function getApiBase() {
  const domainname = getAudience();
  return domainname === "localhost"
    ? (localStorage.getItem("apiHost") ?? "http://localhost:8787")
    : `https://api.${domainname}`;
}

function getToken(): string | null {
  const { hash } = window.location;
  if (hash.startsWith("#")) {
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get("token");
    if (token) {
      localStorage.setItem("token", token);
    }
    // Clean the URL
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }
  return localStorage.getItem("token");
}

export function discordLogin() {
  window.location.href = `${getApiBase()}/login/discord?redirect_uri=${window.location.href}`;
}

export async function logOut(allSessions: boolean = false) {
  const token = localStorage.getItem("token");
  if (token === null) return;
  localStorage.removeItem("token");
  __isLoggedIn = false;

  const response = await fetch(
    getApiBase() + (allSessions ? "/revoke" : "/logout"),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.ok === false) {
    console.error("Logout failed", response);
    return false;
  }
  return true;
}

export type IsLoggedInResponse =
  | { token: string; claims: TokenPayload }
  | false;
let __isLoggedIn: IsLoggedInResponse | undefined = undefined;
export function isLoggedIn(): IsLoggedInResponse {
  if (__isLoggedIn === undefined) {
    __isLoggedIn = _isLoggedIn();
  }
  return __isLoggedIn;
}
function _isLoggedIn(): IsLoggedInResponse {
  try {
    const token = getToken();
    if (!token) {
      // console.log("No token found");
      return false;
    }

    // Verify the JWT (requires browser support)
    // const jwks = createRemoteJWKSet(
    //   new URL(getApiBase() + "/.well-known/jwks.json"),
    // );
    // const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    //   issuer: getApiBase(),
    //   audience: getAudience(),
    // });

    // Decode the JWT
    const payload = decodeJwt(token);
    const { iss, aud, exp, iat } = payload;

    if (iss !== getApiBase()) {
      // JWT was not issued by the correct server
      console.error(
        'unexpected "iss" claim value',
        // JSON.stringify(payload, null, 2),
      );
      logOut();
      return false;
    }
    if (aud !== getAudience()) {
      // JWT was not issued for this website
      console.error(
        'unexpected "aud" claim value',
        // JSON.stringify(payload, null, 2),
      );
      logOut();
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    if (exp !== undefined && now >= exp) {
      // JWT expired
      console.error(
        'after "exp" claim value',
        // JSON.stringify(payload, null, 2),
      );
      logOut();
      return false;
    }
    const refreshAge: number = 6 * 3600; // 6 hours
    if (iat !== undefined && now >= iat + refreshAge) {
      console.log("Refreshing access token...");
      postRefresh().then((success) => {
        if (success) {
          console.log("Refreshed access token successfully.");
        } else {
          console.error("Failed to refresh access token.");
        }
      });
    }

    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      // Invalid response
      console.error("Invalid payload", error);
      return false;
    }

    const claims = result.data;
    return { token, claims };
  } catch (e) {
    console.log(e);
    return false;
  }
}

export async function postRefresh(): Promise<boolean> {
  try {
    const token = getToken();
    if (!token) return false;

    // Refresh the JWT
    const response = await fetch(getApiBase() + "/refresh", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status !== 200) return false;
    const body = await response.json();
    const result = RefreshResponseSchema.safeParse(body);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid response", error);
      return false;
    }
    localStorage.setItem("token", result.data.token);
    return true;
  } catch (e) {
    __isLoggedIn = false;
    return false;
  }
}

export async function getUserMe(): Promise<UserMeResponse | false> {
  try {
    const token = getToken();
    if (!token) return false;

    // Get the user object
    const response = await fetch(getApiBase() + "/users/@me", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status !== 200) return false;
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid response", error);
      return false;
    }
    return result.data;
  } catch (e) {
    __isLoggedIn = false;
    return false;
  }
}
