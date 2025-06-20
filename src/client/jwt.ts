import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { decodeJwt } from "jose";
import { z } from "zod/v4";
import {
  RefreshResponseSchema,
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";

type Platform = {
  kind: "capacitor" | "browser";
  getRedirectUri(): string;
  setLocation(url: string): void;
  getApiBaseForLocalhost(): string;
  initializeAuthListener(): void;
};

const browserPlatform: Platform = {
  kind: "browser",
  getRedirectUri(): string {
    return window.location.href.split("#")[0];
  },
  setLocation(url: string): void {
    window.location.href = url;
  },
  getApiBaseForLocalhost(): string {
    return (
      localStorage.getItem("apiHost") ??
      process.env.LOCAL_API_BASE_URL ??
      "http://localhost:8787"
    );
  },
  initializeAuthListener(): void {
    // No-op for web
  },
};

const capacitorPlatform: Platform = {
  kind: "capacitor",
  getRedirectUri(): string {
    return "com.openfront.app://auth";
  },
  setLocation(url: string) {
    Browser.open({ url });
  },
  getApiBaseForLocalhost(): string {
    return process.env.LOCAL_API_BASE_URL ?? "http://localhost:8787";
  },
  initializeAuthListener(): void {
    App.addListener("appUrlOpen", async (data) => {
      try {
        const url = new URL(data.url);
        if (handleToken(url, false)) {
          __isLoggedIn = undefined; // Force re-evaluation
          await Browser.close();
          window.location.assign(window.location.origin || "/");
          return;
        }

        const error = url.search;
        if (error) {
          console.error(`Error from auth provider: ${error}`);
        }
        await Browser.close();
      } catch (e) {
        console.error("Error handling appUrlOpen", e);
        await Browser.close();
      }
    });
  },
};

const platform: Platform =
  Capacitor.getPlatform() !== "web" ? capacitorPlatform : browserPlatform;

function getAudience() {
  const hostname =
    process.env.CAPACITOR_PRODUCTION_HOSTNAME ??
    new URL(window.location.href).hostname;
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname;
}

function getApiBase() {
  const domainname = getAudience();
  return domainname === "localhost"
    ? platform.getApiBaseForLocalhost()
    : `https://api.${domainname}`;
}

function handleToken(url: URL, isFromHash: boolean): boolean {
  let token: string | null = null;
  if (isFromHash) {
    if (url.hash.startsWith("#")) {
      const params = new URLSearchParams(url.hash.slice(1));
      token = params.get("token");
    }
  } else {
    token = url.searchParams.get("token");
  }

  if (token) {
    localStorage.setItem("token", token);
    return true;
  }
  return false;
}

function getToken(): string | null {
  const url = new URL(window.location.href);
  if (handleToken(url, true)) {
    // Clean the URL
    const params = new URLSearchParams(url.hash.slice(1));
    params.delete("token");
    history.replaceState(
      null,
      "",
      window.location.pathname +
        window.location.search +
        (params.size > 0 ? "#" + params.toString() : ""),
    );
  }
  return localStorage.getItem("token");
}

export async function discordLogin() {
  const redirectUri = platform.getRedirectUri();
  const url = `${getApiBase()}/login/discord?redirect_uri=${encodeURIComponent(
    redirectUri,
  )}`;
  platform.setLocation(url);
}

export async function logOut(allSessions: boolean = false) {
  const token = localStorage.getItem("token");
  if (token === null) return;
  localStorage.removeItem("token");
  __isLoggedIn = false;

  const response = await CapacitorHttp.post({
    url: getApiBase() + (allSessions ? "/revoke" : "/logout"),
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (response.status !== 200) {
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
    const refreshAge: number = 3 * 24 * 3600; // 3 days
    if (iat !== undefined && now >= iat + refreshAge) {
      console.log("Refreshing access token...");
      postRefresh().then((success) => {
        if (success) {
          console.log("Refreshed access token successfully.");
        } else {
          console.error("Failed to refresh access token.");
          // TODO: Update the UI to show logged out state
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

export function initializeAuthListener() {
  platform.initializeAuthListener();
}

export async function postRefresh(): Promise<boolean> {
  try {
    const token = getToken();
    if (!token) return false;

    // Refresh the JWT
    const response = await CapacitorHttp.post({
      url: getApiBase() + "/refresh",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status === 401) {
      localStorage.removeItem("token");
      __isLoggedIn = false;
      return false;
    }
    if (response.status !== 200) return false;
    const body = response.data;
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
    const response = await CapacitorHttp.get({
      url: getApiBase() + "/users/@me",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    if (response.status === 401) {
      localStorage.removeItem("token");
      __isLoggedIn = false;
      return false;
    }
    if (response.status !== 200) return false;
    const body = response.data;
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
