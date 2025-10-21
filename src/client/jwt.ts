import { decodeJwt } from "jose";
import { z } from "zod";
import {
  PlayerProfile,
  PlayerProfileSchema,
  RefreshResponseSchema,
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";

// ============================================================================
// Configuration & Utilities
// ============================================================================

function _getAudience() {
  const { hostname } = new URL(window.location.href);
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname;
}

export function getApiBase() {
  const domainname = _getAudience();

  if (domainname === "localhost") {
    const apiDomain = process?.env?.API_DOMAIN;
    if (apiDomain) {
      return `https://${apiDomain}`;
    }
    return localStorage.getItem("apiHost") ?? "http://localhost:8787";
  }

  return `https://api.${domainname}`;
}

// ============================================================================
// Token Storage & Retrieval
// ============================================================================

function _extractTokenFromHash(): string | null {
  const { hash } = window.location;
  if (!hash.startsWith("#")) return null;

  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("token");

  if (!token) return null;

  localStorage.setItem("token", token);
  params.delete("token");

  // Clean the URL
  history.replaceState(
    null,
    "",
    window.location.pathname +
      window.location.search +
      (params.size > 0 ? "#" + params.toString() : ""),
  );

  return token;
}

function _extractTokenFromCookie(): string | null {
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith("token="))
    ?.trim()
    .substring(6);

  if (cookie !== undefined) return cookie;

  return null;
}

function _getToken(): string | null {
  const hashToken = _extractTokenFromHash();
  if (hashToken !== null) return hashToken;

  const cookie = _extractTokenFromCookie();
  if (cookie !== null) return cookie;

  return localStorage.getItem("token");
}

async function _clearToken() {
  localStorage.removeItem("token");
  const config = await getServerConfigFromClient();
  const audience = config.jwtAudience();
  const isSecure = window.location.protocol === "https:";
  const secure = isSecure ? "; Secure" : "";
  document.cookie = `token=logged_out; Path=/; Max-Age=0; Domain=${audience}${secure}`;
}

export function getAuthHeader(): string {
  const token = _getToken();
  if (!token) return "";
  return `Bearer ${token}`;
}

// ============================================================================
// Authentication & Session Management
// ============================================================================

export function discordLogin() {
  window.location.href = `${getApiBase()}/login/discord?redirect_uri=${window.location.href}`;
}

export async function tokenLogin(token: string): Promise<string | null> {
  const response = await _fetchFromApi({
    endpoint: `/login/token?login-token=${encodeURIComponent(token)}`,
    requiresAuth: false,
    handleUnauthorized: false,
  });

  if (!response) return null;

  if (response.status !== 200) {
    console.error("Token login failed", response);
    return null;
  }
  const json = await response.json();
  const { jwt, email } = json;
  const payload = decodeJwt(jwt);
  const result = TokenPayloadSchema.safeParse(payload);
  if (!result.success) {
    console.error("Invalid token", result.error, result.error.message);
    return null;
  }
  await _clearToken();
  localStorage.setItem("token", jwt);
  return email;
}

export async function logOut(allSessions: boolean = false) {
  const token = _getToken();
  if (token === null) return;
  await _clearToken();

  const response = await _fetchFromApi({
    endpoint: allSessions ? "/revoke" : "/logout",
    requiresAuth: true,
    method: "POST",
  });

  if (!response) return;

  if (response.ok === false) {
    console.error("Logout failed", response);
    return false;
  }
  return true;
}

async function _refreshTokenFrom(response: Response): Promise<boolean> {
  if (response.status === 401) {
    await _clearToken();
    return false;
  }
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
}

export async function postRefresh(): Promise<boolean> {
  const response = await _fetchFromApi({
    endpoint: "/refresh",
    method: "POST",
    requiresAuth: true,
    handleUnauthorized: false,
  });

  if (!response) {
    return false;
  }

  return await _refreshTokenFrom(response);
}

// ============================================================================
// Login Status & Token Validation
// ============================================================================

export type IsLoggedInResponse =
  | { token: string; claims: TokenPayload }
  | false;

export async function isLoggedIn(): Promise<IsLoggedInResponse> {
  return await _isLoggedIn();
}

async function _validateTokenIssuer(payload: any): Promise<boolean> {
  const { iss } = payload;
  if (iss !== getApiBase()) {
    console.error('unexpected "iss" claim value');
    await logOut();
    return false;
  }
  return true;
}

async function _validateTokenAudience(payload: any): Promise<boolean> {
  const { aud } = payload;
  const myAud = _getAudience();
  if (myAud !== "localhost" && aud !== myAud) {
    console.error('unexpected "aud" claim value');
    await logOut();
    return false;
  }
  return true;
}

async function _validateTokenExpiration(payload: any): Promise<boolean> {
  const { exp } = payload;
  const now = Math.floor(Date.now() / 1000);
  if (exp !== undefined && now >= exp) {
    console.error('after "exp" claim value');
    await logOut();
    return false;
  }
  return true;
}

async function _shouldRefreshToken(payload: any): Promise<boolean> {
  const { iat } = payload;
  const now = Math.floor(Date.now() / 1000);
  const refreshAge: number = 3 * 24 * 3600; // 3 days

  return iat !== undefined && now >= iat + refreshAge;
}

async function _attemptTokenRefresh(): Promise<{
  token: string;
  claims: TokenPayload;
} | null> {
  console.log("Refreshing access token...");
  const success = await postRefresh();

  if (!success) {
    console.error("Failed to refresh access token.");
    return null;
  }

  console.log("Refreshed access token successfully.");
  const newToken = _getToken();
  if (!newToken) {
    return null;
  }

  const newPayload = decodeJwt(newToken);
  const newResult = TokenPayloadSchema.safeParse(newPayload);
  if (!newResult.success) {
    return null;
  }

  return { token: newToken, claims: newResult.data };
}

function _parseAndValidateTokenPayload(payload: any): TokenPayload | null {
  const result = TokenPayloadSchema.safeParse(payload);
  if (!result.success) {
    const error = z.prettifyError(result.error);
    console.error("Invalid payload", error);
    return null;
  }
  return result.data;
}

async function _isLoggedIn(): Promise<IsLoggedInResponse> {
  try {
    const token = _getToken();
    if (!token) return false;

    const payload = decodeJwt(token);

    if (!(await _validateTokenIssuer(payload))) {
      return false;
    }

    if (!(await _validateTokenAudience(payload))) {
      return false;
    }

    if (!(await _validateTokenExpiration(payload))) {
      return false;
    }

    if (await _shouldRefreshToken(payload)) {
      const refreshResult = await _attemptTokenRefresh();
      if (refreshResult) return refreshResult;
      return false;
    }

    const claims = _parseAndValidateTokenPayload(payload);
    if (!claims) return false;

    return { token: token, claims: claims };
  } catch (e) {
    console.log(e);
    return false;
  }
}

// ============================================================================
// API Requests
// ============================================================================

let __userMeCache: UserMeResponse | null = null;
let __userMeCacheTimestamp: number = 0;
const __USER_ME_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

function _isUserMeCacheValid(): boolean {
  if (__userMeCache === null) return false;
  const now = Date.now();
  return now - __userMeCacheTimestamp < __USER_ME_CACHE_TTL;
}

function _setUserMeCache(data: UserMeResponse): void {
  __userMeCache = data;
  __userMeCacheTimestamp = Date.now();
}

function _clearUserMeCache(): void {
  __userMeCache = null;
  __userMeCacheTimestamp = 0;
}

async function _handleUnauthorizedResponse(): Promise<void> {
  await _clearToken();
  _clearUserMeCache();
}

function _parseUserMeResponse(body: any): UserMeResponse | null {
  const result = UserMeResponseSchema.safeParse(body);
  if (!result.success) {
    const error = z.prettifyError(result.error);
    console.error("Invalid response", error);
    return null;
  }
  return result.data;
}

interface FetchFromApiOptions {
  endpoint: string;
  method?: string;
  requiresAuth?: boolean;
  handleUnauthorized?: boolean;
}

async function _fetchFromApi(
  options: FetchFromApiOptions,
): Promise<Response | null> {
  const {
    endpoint,
    method = "GET",
    requiresAuth = true,
    handleUnauthorized = true,
  } = options;

  try {
    const token = requiresAuth ? _getToken() : null;
    if (requiresAuth && !token) return null;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(getApiBase() + endpoint, {
      method,
      headers,
    });

    if (response.status === 401 && handleUnauthorized) {
      await _handleUnauthorizedResponse();
      return null;
    }

    return response;
  } catch (err) {
    console.warn(`_fetchFromApi: request failed for ${endpoint}`, err);
    return null;
  }
}

export async function getUserMe(
  forceRefresh: boolean = false,
): Promise<UserMeResponse | false> {
  // Return cached data if valid and not forcing refresh
  if (!forceRefresh && _isUserMeCacheValid() && __userMeCache !== null) {
    return __userMeCache;
  }

  const response = await _fetchFromApi({ endpoint: "/users/@me" });
  if (!response) {
    _clearUserMeCache();
    return false;
  }

  if (response.status !== 200) return false;

  const body = await response.json();
  const userData = _parseUserMeResponse(body);

  if (!userData) return false;

  _setUserMeCache(userData);
  return userData;
}

export async function fetchPlayerById(
  playerId: string,
): Promise<PlayerProfile | false> {
  const endpoint = `/player/${encodeURIComponent(playerId)}`;
  const response = await _fetchFromApi({ endpoint });

  if (!response) return false;

  if (response.status !== 200) {
    console.warn(
      "fetchPlayerById: unexpected status",
      response.status,
      response.statusText,
    );
    return false;
  }

  const json = await response.json();
  const parsed = PlayerProfileSchema.safeParse(json);
  if (!parsed.success) {
    console.warn("fetchPlayerById: Zod validation failed", parsed.error);
    return false;
  }

  return parsed.data;
}
