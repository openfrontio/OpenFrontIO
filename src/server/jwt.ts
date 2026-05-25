import { jwtVerify } from "jose";
import { z } from "zod";
import {
  clanExistsApiPath,
  ClanExistsResponseSchema,
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { GameEnv } from "../core/configuration/Config";
import { PersistentIdSchema } from "../core/Schemas";
import { logger } from "./Logger";
import { ServerEnv } from "./ServerEnv";

const log = logger.child({ comp: "jwt" });

const CLAN_EXISTS_FETCH_TIMEOUT_MS = 3000;
const CLAN_EXISTS_CACHE_TTL_MS = 60_000;

type TokenVerificationResult =
  | {
      type: "success";
      persistentId: string;
      claims: TokenPayload | null;
    }
  | { type: "error"; message: string };

export async function verifyClientToken(
  token: string,
): Promise<TokenVerificationResult> {
  if (PersistentIdSchema.safeParse(token).success) {
    if (ServerEnv.env() === GameEnv.Dev) {
      return { type: "success", persistentId: token, claims: null };
    } else {
      return {
        type: "error",
        message: "persistent ID not allowed in production",
      };
    }
  }
  try {
    const issuer = ServerEnv.jwtIssuer();
    const audience = ServerEnv.jwtAudience();
    const key = await ServerEnv.jwkPublicKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer,
      audience,
    });
    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      return {
        type: "error",
        message: z.prettifyError(result.error),
      };
    }
    const claims = result.data;
    const persistentId = claims.sub;
    return { type: "success", persistentId, claims };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "An unknown error occurred";

    return { type: "error", message };
  }
}

export async function getUserMe(
  token: string,
): Promise<
  | { type: "success"; response: UserMeResponse }
  | { type: "error"; message: string }
> {
  try {
    const response = await fetch(ServerEnv.jwtIssuer() + "/users/@me", {
      headers: {
        Accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    if (response.status !== 200) {
      return {
        type: "error",
        message: `Failed to fetch user me: ${response.statusText}`,
      };
    }
    const body = await response.json();
    const result = UserMeResponseSchema.safeParse(body);
    if (!result.success) {
      return {
        type: "error",
        message: `Invalid response: ${z.prettifyError(result.error)}`,
      };
    }
    return { type: "success", response: result.data };
  } catch (e) {
    return {
      type: "error",
      message: `Failed to fetch user me: ${e}`,
    };
  }
}

// Module-level TTL cache. Clan existence is stable, so a short cache prevents
// repeated upstream calls during lobby-start surges.
const clanExistsCache = new Map<
  string,
  { result: boolean; expiresAt: number }
>();

function cacheGet(key: string): boolean | undefined {
  const entry = clanExistsCache.get(key);
  if (entry === undefined) return undefined;
  if (Date.now() >= entry.expiresAt) {
    clanExistsCache.delete(key);
    return undefined;
  }
  return entry.result;
}

function cacheSet(key: string, result: boolean) {
  clanExistsCache.set(key, {
    result,
    expiresAt: Date.now() + CLAN_EXISTS_CACHE_TTL_MS,
  });
}

// For tests.
export function _clearClanExistsCacheForTest() {
  clanExistsCache.clear();
}

// Best-effort check: does a clan with this tag exist?
// Returns null on transport errors, timeouts, or unexpected statuses so callers
// can fail open — the goal is impersonation prevention, not an availability
// blocker. Logs a warn on unexpected statuses so outages are observable.
export async function clanExistsByTag(tag: string): Promise<boolean | null> {
  const cacheKey = tag.toUpperCase();
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const url = `${ServerEnv.jwtIssuer()}${clanExistsApiPath(tag)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(CLAN_EXISTS_FETCH_TIMEOUT_MS),
    });
    if (response.status === 200) {
      // The upstream may eventually start returning a body; tolerate either.
      try {
        const text = await response.text();
        if (text.length > 0) {
          const parsed = ClanExistsResponseSchema.safeParse(JSON.parse(text));
          if (parsed.success && parsed.data?.exists === false) {
            cacheSet(cacheKey, false);
            return false;
          }
        }
      } catch {
        // Body parsing is forward-compat only; ignore failures.
      }
      cacheSet(cacheKey, true);
      return true;
    }
    if (response.status === 404) {
      cacheSet(cacheKey, false);
      return false;
    }
    log.warn("clanExistsByTag: unexpected status, failing open", {
      tag: cacheKey,
      status: response.status,
    });
    return null;
  } catch (e) {
    log.warn("clanExistsByTag: fetch failed, failing open", {
      tag: cacheKey,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
