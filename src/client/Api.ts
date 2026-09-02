import newsItemsFallback from "resources/news.json";
import streamsFallback from "resources/streams.json";
import { z } from "zod";
import type { NewsItem, StreamsFeed } from "../core/ApiSchemas";
import {
  ClaimAllRewardsResponse,
  ClaimAllRewardsResponseSchema,
  ClaimRewardResponse,
  ClaimRewardResponseSchema,
  GetMyTribeNamesResponse,
  GetMyTribeNamesResponseSchema,
  NewsItemSchema,
  PlayerGameModeFilter,
  PlayerGameTypeFilter,
  PlayerProfile,
  PlayerProfileSchema,
  PostTribeBoostResponse,
  PostTribeBoostResponseSchema,
  PostTribeNameResponse,
  PostTribeNameResponseSchema,
  PublicPlayerGamesResponse,
  PublicPlayerGamesResponseSchema,
  PurchasePackResponse,
  PurchasePackResponseSchema,
  PutUsernameResponse,
  PutUsernameResponseSchema,
  RankedLeaderboardResponse,
  RankedLeaderboardResponseSchema,
  StreamsFeedSchema,
  TribeLeaderboardResponse,
  TribeLeaderboardResponseSchema,
  TribeStatsResponse,
  TribeStatsResponseSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import {
  AnalyticsRecord,
  ArchivedAnalyticsRecordSchema,
  GameInfo,
} from "../core/Schemas";
import { UserSettings } from "../core/game/UserSettings";
import {
  getAuthHeader,
  getPlayToken,
  isSessionActive,
  logOut,
  userAuth,
} from "./Auth";
import { ClientEnv } from "./ClientEnv";

export async function fetchPlayerById(
  playerId: string,
): Promise<PlayerProfile | false> {
  try {
    const userAuthResult = await userAuth();
    if (!userAuthResult) return false;
    const { jwt } = userAuthResult;

    const url = `${getApiBase()}/player/${encodeURIComponent(playerId)}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchPlayerById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = PlayerProfileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchPlayerById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchPlayerById: request failed", err);
    return false;
  }
}

// GET /public/player/:publicId — public player profile (stats tree). No auth,
// so logged-out visitors can view shared profiles.
export async function fetchPublicPlayerProfile(
  publicId: string,
): Promise<PlayerProfile | false> {
  try {
    const url = `${getApiBase()}/public/player/${encodeURIComponent(publicId)}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchPublicPlayerProfile: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = PlayerProfileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        "fetchPublicPlayerProfile: Zod validation failed",
        parsed.error,
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchPublicPlayerProfile: request failed", err);
    return false;
  }
}

// GET /public/player/:publicId/games — keyset-paginated personal game history.
// Public (no auth). `filter` (mode bucket) and `type` (game-type split) are
// orthogonal; `cursor` is the opaque token from the previous response's
// nextCursor — round-trip verbatim, never construct it.
export async function fetchPublicPlayerGames(
  publicId: string,
  opts: {
    filter?: PlayerGameModeFilter;
    type?: PlayerGameTypeFilter;
    cursor?: string;
  } = {},
): Promise<PublicPlayerGamesResponse | { error: "failed" }> {
  try {
    const url = new URL(
      `${getApiBase()}/public/player/${encodeURIComponent(publicId)}/games`,
    );
    if (opts.filter) url.searchParams.set("filter", opts.filter);
    if (opts.type) url.searchParams.set("type", opts.type);
    if (opts.cursor) url.searchParams.set("cursor", opts.cursor);

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(
        "fetchPublicPlayerGames: unexpected status",
        res.status,
        res.statusText,
      );
      return { error: "failed" };
    }

    const json = await res.json();
    const parsed = PublicPlayerGamesResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        "fetchPublicPlayerGames: Zod validation failed",
        parsed.error,
      );
      return { error: "failed" };
    }
    return parsed.data;
  } catch (err) {
    console.warn("fetchPublicPlayerGames: request failed", err);
    return { error: "failed" };
  }
}

let __userMe: Promise<UserMeResponse | false> | null = null;

// The profile outlives the session it describes unless this is dropped with
// it: getUserMe answers from the cache before it checks authentication, so a
// consumer calling it after a background logout would read the expired
// account straight back. Handled here rather than in Auth, which cannot
// import this module — the dependency runs the other way.
document.addEventListener("session-cleared", () => invalidateUserMe());
export async function getUserMe(): Promise<UserMeResponse | false> {
  if (__userMe !== null) {
    return __userMe;
  }
  __userMe = (async () => {
    try {
      const userAuthResult = await userAuth();
      if (!userAuthResult) return false;
      const { jwt, claims } = userAuthResult;

      // Get the user object
      const response = await fetch(getApiBase() + "/users/@me", {
        headers: {
          authorization: `Bearer ${jwt}`,
        },
      });
      if (response.status === 401) {
        // Clearing the session announces itself (see clearLocalSession), so
        // consumers holding account state don't mistake this for the
        // transient failure the `false` below also represents.
        await logOut();
        return false;
      }
      if (response.status !== 200) return false;
      const body = await response.json();
      const result = UserMeResponseSchema.safeParse(body);
      if (!result.success) {
        const error = z.prettifyError(result.error);
        console.error("Invalid response", error);
        return false;
      }
      // Activate this player's cosmetic selections (and adopt any made while
      // logged out) before the profile is handed to callers — but not if the
      // session changed (logout, account switch) while the request was in
      // flight: a stale response must not reactivate the old player's scope.
      if (isSessionActive(claims.sub)) {
        UserSettings.setPlayerId(result.data.player.publicId);
      }
      return result.data;
    } catch (e) {
      return false;
    }
  })();
  return __userMe;
}

export function invalidateUserMe() {
  __userMe = null;
}

export type DeleteAccountResult =
  // 204: deletion queued — the server deletes the account 24 hours later.
  | { ok: true }
  // 401: missing/unknown/expired refresh token — already logged out, and the
  // server cleared the cookie.
  | { ok: false; code: "logged_out" }
  // 403: refused by policy. `message` is the server's player-facing reason
  // (root player / banned account), shown as-is.
  | { ok: false; code: "forbidden"; message?: string }
  // 429: the global deletion rate limit (one per 20 minutes across all
  // players) — nothing was queued, try again later.
  | { ok: false; code: "rate_limited" }
  // Anything else: the client shows a "contact support" failure.
  | { ok: false; code: "failed" };

// DELETE /users/@me — queues the account for deletion; the server performs it
// 24 hours later, and only support can cancel in the meantime (there is no
// self-service cancel endpoint). The HttpOnly refresh cookie is the credential
// (same as /auth/logout), so no Authorization header. On 204 every session on
// every device is invalidated and the cookie is cleared — callers drop local
// auth state themselves and must NOT call /auth/logout afterwards. Signing in
// again during the 24 hours works but does not cancel the deletion.
export async function deleteAccount(): Promise<DeleteAccountResult> {
  try {
    const response = await fetch(`${getApiBase()}/users/@me`, {
      method: "DELETE",
      credentials: "include",
    });
    if (response.status === 401) {
      return { ok: false, code: "logged_out" };
    }
    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      return {
        ok: false,
        code: "forbidden",
        message: typeof body?.message === "string" ? body.message : undefined,
      };
    }
    if (response.status === 429) {
      return { ok: false, code: "rate_limited" };
    }
    if (!response.ok) {
      console.error(
        "deleteAccount: request failed",
        response.status,
        response.statusText,
      );
      return { ok: false, code: "failed" };
    }
    return { ok: true };
  } catch (e) {
    console.error("deleteAccount: request failed", e);
    return { ok: false, code: "failed" };
  }
}

// POST /marketing/consent — record the player's marketing-email choice
// (client-driven consent). Called by the consent toast and account settings.
// Invalidates the cached /users/@me so the new decision is reflected on the
// next read. Returns true on success.
export async function setMarketingConsent(
  consented: boolean,
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/marketing/consent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ consented }),
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "setMarketingConsent: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    invalidateUserMe();
    return true;
  } catch (e) {
    console.error("setMarketingConsent: request failed", e);
    return false;
  }
}

export type UpdateUsernameResult =
  | { ok: true; data: PutUsernameResponse }
  | { ok: false; code: "invalid"; message?: string }
  | { ok: false; code: "profane" }
  | { ok: false; code: "taken" }
  | { ok: false; code: "cooldown"; retryAfterSeconds: number | null }
  | { ok: false; code: "failed" };

// PUT /users/@me/username — renames the account username. Every failure is
// atomic (no name change, no cooldown consumed). The surviving 409 bodies
// ("name equals an existing public id" and "suffix space exhausted") map to
// "taken": the user remedy is the same — pick another name. Invalidates the
// cached /users/@me on success so the next read reflects the new name.
//
// A premium player whose chosen bare name is already held no longer 409s: the
// API grants the suffixed form and returns 200 with `bareClaim:
// "unavailable"`. That is a real rename and it consumes the cooldown, so `ok:
// true` alone is not enough to act on — callers must read `data.bareClaim`
// and tell the player (see UsernamePanel).
export async function updateUsername(
  username: string,
): Promise<UpdateUsernameResult> {
  try {
    const response = await fetch(`${getApiBase()}/users/@me/username`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ username }),
    });
    if (response.status === 401) {
      await logOut();
      return { ok: false, code: "failed" };
    }
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      if (body?.code === "USERNAME_PROFANE") {
        return { ok: false, code: "profane" };
      }
      return {
        ok: false,
        code: "invalid",
        message: typeof body?.reason === "string" ? body.reason : undefined,
      };
    }
    if (response.status === 409) {
      return { ok: false, code: "taken" };
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      return {
        ok: false,
        code: "cooldown",
        retryAfterSeconds: Number.isFinite(seconds) ? seconds : null,
      };
    }
    if (!response.ok) {
      console.error(
        "updateUsername: request failed",
        response.status,
        response.statusText,
      );
      return { ok: false, code: "failed" };
    }
    const parsed = PutUsernameResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error("updateUsername: Zod validation failed", parsed.error);
      return { ok: false, code: "failed" };
    }
    invalidateUserMe();
    return { ok: true, data: parsed.data };
  } catch (e) {
    console.error("updateUsername: request failed", e);
    return { ok: false, code: "failed" };
  }
}

// GET /users/@me/tribe_names — the player's purchased custom tribe names plus
// the current purchase price. Auth required; returns false when logged out or
// on any error (callers show a login/empty state rather than a hard failure).
export async function getMyTribeNames(): Promise<
  GetMyTribeNamesResponse | false
> {
  try {
    const response = await fetch(`${getApiBase()}/users/@me/tribe_names`, {
      headers: {
        Authorization: await getAuthHeader(),
      },
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "getMyTribeNames: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const parsed = GetMyTribeNamesResponseSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success) {
      console.error("getMyTribeNames: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch (e) {
    console.error("getMyTribeNames: request failed", e);
    return false;
  }
}

export type PurchaseTribeNameResult =
  | { ok: true; data: PostTribeNameResponse }
  // 400: invalid, disallowed, or insufficient balance. `message` is the
  // server's player-facing reason (already English, shown as-is).
  | { ok: false; code: "invalid"; message?: string }
  // 409: the name is already taken (names are globally unique).
  | { ok: false; code: "duplicate" }
  // 429: buying names too fast. `retryAfterSeconds` from the Retry-After
  // header (null when absent/unparseable).
  | { ok: false; code: "rate_limited"; retryAfterSeconds: number | null }
  | { ok: false; code: "failed" };

// POST /users/@me/tribe_names — buy a custom tribe name (200 plutonium). The
// name is screened, charged, and goes live right away as `pending`; review is
// post-hoc and only takes bad names down. Spends hard currency, so callers
// should invalidate the cached /users/@me afterwards.
export async function purchaseTribeName(
  name: string,
): Promise<PurchaseTribeNameResult> {
  try {
    const response = await fetch(`${getApiBase()}/users/@me/tribe_names`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ name }),
    });
    if (response.status === 401) {
      await logOut();
      return { ok: false, code: "failed" };
    }
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      return {
        ok: false,
        code: "invalid",
        message: typeof body?.reason === "string" ? body.reason : undefined,
      };
    }
    if (response.status === 409) {
      return { ok: false, code: "duplicate" };
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      return {
        ok: false,
        code: "rate_limited",
        retryAfterSeconds: Number.isFinite(seconds) ? seconds : null,
      };
    }
    if (!response.ok) {
      console.error(
        "purchaseTribeName: request failed",
        response.status,
        response.statusText,
      );
      return { ok: false, code: "failed" };
    }
    const parsed = PostTribeNameResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error("purchaseTribeName: Zod validation failed", parsed.error);
      return { ok: false, code: "failed" };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    console.error("purchaseTribeName: request failed", e);
    return { ok: false, code: "failed" };
  }
}

export type BoostTribeNameResult =
  | { ok: true; data: PostTribeBoostResponse }
  // 400 with a player-facing reason — today that's only "Insufficient
  // balance" (the balance moved since the client's pre-check).
  | { ok: false; code: "insufficient_balance" }
  // 404: not the caller's name, or it's no longer active (rejected/revoked).
  // Deliberately indistinguishable server-side — refresh the list.
  | { ok: false; code: "not_found" }
  | { ok: false; code: "failed" };

// POST /users/@me/tribe_names/:id/boosts — buy a 30-day boost for an active
// tribe name. Boosts stack without limit and the endpoint has no rate limit,
// so the Idempotency-Key is what stops a double-submit from charging twice:
// callers generate a fresh UUID per user-initiated click. Nothing is charged
// on any error. Spends hard currency — callers refresh /users/@me and the
// name list afterwards (boost state is only served by the list endpoint).
export async function boostTribeName(
  id: string,
  idempotencyKey: string,
): Promise<BoostTribeNameResult> {
  try {
    const response = await fetch(
      `${getApiBase()}/users/@me/tribe_names/${encodeURIComponent(id)}/boosts`,
      {
        method: "POST",
        headers: {
          Authorization: await getAuthHeader(),
          "Idempotency-Key": idempotencyKey,
        },
      },
    );
    if (response.status === 401) {
      await logOut();
      return { ok: false, code: "failed" };
    }
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      // {"reason": "..."} is the player-facing 400 (insufficient balance);
      // {"resource": "id"} means a malformed id — a client bug, not a
      // player error, so it falls through to the generic failure.
      if (typeof body?.reason === "string") {
        return { ok: false, code: "insufficient_balance" };
      }
      console.error("boostTribeName: bad request", body);
      return { ok: false, code: "failed" };
    }
    if (response.status === 404) {
      return { ok: false, code: "not_found" };
    }
    if (!response.ok) {
      console.error(
        "boostTribeName: request failed",
        response.status,
        response.statusText,
      );
      return { ok: false, code: "failed" };
    }
    const parsed = PostTribeBoostResponseSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success) {
      console.error("boostTribeName: Zod validation failed", parsed.error);
      return { ok: false, code: "failed" };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    console.error("boostTribeName: request failed", e);
    return { ok: false, code: "failed" };
  }
}

// GET /public/tribe/:name — live stats for one custom tribe name. Public
// (no auth), so it works for any name, but 404s for names that are unknown,
// rejected/revoked, or whose owner is banned — that folds into false along
// with every other failure, since callers can't act on the difference.
export async function fetchTribeStats(
  name: string,
): Promise<TribeStatsResponse | false> {
  try {
    const res = await fetch(
      `${getApiBase()}/public/tribe/${encodeURIComponent(name)}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.status !== 200) {
      console.warn(
        "fetchTribeStats: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }
    const parsed = TribeStatsResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("fetchTribeStats: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch (err) {
    console.warn("fetchTribeStats: request failed", err);
    return false;
  }
}

export async function purchaseWithCurrency(
  cosmeticType: "pattern" | "skin" | "flag" | "crown" | "effect",
  cosmeticName: string,
  currencyType: "hard" | "soft",
  colorPaletteName?: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/shop/purchase`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({
        cosmeticType,
        cosmeticName,
        currencyType,
        colorPaletteName,
      }),
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "purchaseWithCurrency: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("purchaseWithCurrency: request failed", e);
    return false;
  }
}

export type PurchaseCosmeticPackResult =
  | { ok: true; data: PurchasePackResponse }
  // 400 "Insufficient balance": the balance moved since the client's
  // pre-check. Nothing charged.
  | { ok: false; code: "insufficient_balance" }
  // 400 insufficient_balance_debt: a refund/chargeback left the wallet
  // negative; `debt` (bigint string) must be settled before anything is
  // spendable. Nothing charged.
  | { ok: false; code: "debt"; debt: string }
  // 400 for a stale listing: pack not found / not for sale / zero price /
  // all items deleted.
  | { ok: false; code: "unavailable" }
  // 409: the player already owns one or more items (`ownedFlareNames` says
  // which). Also what a retry after a timed-out success returns — treat it as
  // "already bought" and refetch /users/@me. Nothing charged.
  | { ok: false; code: "already_owned"; ownedFlareNames: string[] }
  | { ok: false; code: "failed" };

const PACK_UNAVAILABLE_REASONS = [
  "Pack not found",
  "Pack is not for sale",
  "Pack not available for hard currency",
  "Pack has no items",
  // A pattern item predating pack colours; an admin has to pick one.
  "Pack item is missing its color palette",
];

// POST /shop/purchase/pack — buy a cosmetic pack (see CosmeticPackSchema) for
// its hard-currency price, granting every item's flare in one transaction.
// Any error means no debit and no grants.
export async function purchaseCosmeticPack(
  packName: string,
): Promise<PurchaseCosmeticPackResult> {
  try {
    const response = await fetch(`${getApiBase()}/shop/purchase/pack`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ packName }),
    });
    if (response.status === 401) {
      await logOut();
      return { ok: false, code: "failed" };
    }
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      const reason = typeof body?.reason === "string" ? body.reason : "";
      if (reason === "Insufficient balance") {
        return { ok: false, code: "insufficient_balance" };
      }
      if (reason === "insufficient_balance_debt") {
        return { ok: false, code: "debt", debt: String(body.debt ?? "") };
      }
      if (PACK_UNAVAILABLE_REASONS.includes(reason)) {
        return { ok: false, code: "unavailable" };
      }
      console.error("purchaseCosmeticPack: bad request", body);
      return { ok: false, code: "failed" };
    }
    if (response.status === 409) {
      const body = await response.json().catch(() => null);
      const owned: unknown = body?.ownedFlareNames;
      return {
        ok: false,
        code: "already_owned",
        ownedFlareNames: Array.isArray(owned)
          ? owned.filter((f): f is string => typeof f === "string")
          : [],
      };
    }
    if (!response.ok) {
      console.error(
        "purchaseCosmeticPack: request failed",
        response.status,
        response.statusText,
      );
      return { ok: false, code: "failed" };
    }
    const parsed = PurchasePackResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error(
        "purchaseCosmeticPack: Zod validation failed",
        parsed.error,
      );
      return { ok: false, code: "failed" };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    console.error("purchaseCosmeticPack: request failed", e);
    return { ok: false, code: "failed" };
  }
}

// POST /rewards/:rewardId/claim — claims a single unclaimed reward and
// credits the balance atomically. "not_found" covers unknown, already-claimed
// and other players' rewards (indistinguishable by design); the usual cause is
// a double-click or a second device claiming first, so callers should re-fetch
// /users/@me and re-render rather than surface an error.
export async function claimReward(
  rewardId: string,
): Promise<ClaimRewardResponse | "not_found" | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/rewards/${encodeURIComponent(rewardId)}/claim`,
      {
        method: "POST",
        headers: {
          Authorization: await getAuthHeader(),
        },
      },
    );
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (response.status === 404) return "not_found";
    if (!response.ok) {
      console.error(
        "claimReward: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const parsed = ClaimRewardResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.error("claimReward: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch (e) {
    console.error("claimReward: request failed", e);
    return false;
  }
}

// POST /rewards/claim-all — claims all pending rewards in one transaction.
// Succeeds (with an empty `claimed`) even when nothing is pending.
export async function claimAllRewards(): Promise<
  ClaimAllRewardsResponse | false
> {
  try {
    const response = await fetch(`${getApiBase()}/rewards/claim-all`, {
      method: "POST",
      headers: {
        Authorization: await getAuthHeader(),
      },
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "claimAllRewards: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const parsed = ClaimAllRewardsResponseSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success) {
      console.error("claimAllRewards: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch (e) {
    console.error("claimAllRewards: request failed", e);
    return false;
  }
}

export async function createCheckoutSession(
  priceId: string,
  colorPaletteName?: string,
): Promise<string | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/stripe/create-checkout-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({
          priceId: priceId,
          hostname: window.location.origin,
          colorPaletteName: colorPaletteName,
        }),
      },
    );
    if (!response.ok) {
      console.error(
        "createCheckoutSession: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("createCheckoutSession: request failed", e);
    return false;
  }
}

export async function createCustomCurrencyCheckout(
  hardAmount: number,
): Promise<string | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/stripe/create-custom-currency-checkout`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({
          hardAmount: hardAmount,
          hostname: window.location.origin,
        }),
      },
    );
    if (!response.ok) {
      console.error(
        "createCustomCurrencyCheckout: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("createCustomCurrencyCheckout: request failed", e);
    return false;
  }
}

export async function cancelSubscription(): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/subscriptions/@me/cancel`, {
      method: "POST",
      headers: {
        Authorization: await getAuthHeader(),
      },
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "cancelSubscription: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("cancelSubscription: request failed", e);
    return false;
  }
}

export async function changeSubscriptionTier(
  tierName: string,
): Promise<boolean | "rate_limited"> {
  try {
    const response = await fetch(
      `${getApiBase()}/subscriptions/@me/change-tier`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({ tierName }),
      },
    );
    if (response.status === 401) {
      await logOut();
      return false;
    }
    // The API allows one tier change per minute per player.
    if (response.status === 429) {
      return "rate_limited";
    }
    if (!response.ok) {
      console.error(
        "changeSubscriptionTier: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("changeSubscriptionTier: request failed", e);
    return false;
  }
}

export async function openSubscriptionPortal(): Promise<string | false> {
  try {
    const response = await fetch(`${getApiBase()}/subscriptions/@me/portal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({
        returnUrl: window.location.origin,
      }),
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "openSubscriptionPortal: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("openSubscriptionPortal: request failed", e);
    return false;
  }
}

// GET /api/game/:id on the game server (worker) — whether the game is a
// publicly listed lobby. False on any failure: callers use this to hide
// host powers that the server blocks in listed games anyway, so the safe
// default is to change nothing.
export async function fetchLobbyListed(gameID: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${ClientEnv.serverHttpBase()}/${ClientEnv.workerPath(gameID)}/api/game/${gameID}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return false;
    const json = await res.json();
    return json?.listed === true;
  } catch (e) {
    console.warn("fetchLobbyListed: request failed", e);
    return false;
  }
}

// POST /api/game/:id/listing on the game server (worker) — toggles whether a
// private lobby appears in the public lobby browser. Creator-only and
// server-authoritative (subscription, whitelist/cheat and quota checks).
// On failure, `error` is the server's rejection code when available (e.g.
// "subscription_required", "listing_limit_reached", "listing_full").
export async function setLobbyListed(
  gameID: string,
  listed: boolean,
): Promise<{ ok: true; listed: boolean } | { ok: false; error?: string }> {
  try {
    const token = await getPlayToken();
    const response = await fetch(
      `${ClientEnv.serverHttpBase()}/${ClientEnv.workerPath(gameID)}/api/game/${gameID}/listing`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ listed }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: body?.error };
    }
    return {
      ok: true,
      listed: typeof body?.listed === "boolean" ? body.listed : listed,
    };
  } catch (e) {
    console.error("setLobbyListed: request failed", e);
    return { ok: false };
  }
}

// POST /api/create_game on the game server — mints a fresh private lobby with
// the caller as creator. Deliberately has no worker prefix and no id: the edge
// (nginx in prod, the vite dev proxy locally) picks a worker, which mints a
// self-owned id and returns it.
export async function createLobby(): Promise<GameInfo> {
  // Send JWT token for creator identification - server extracts persistentID from it
  // persistentID should never be exposed to other clients
  const token = await getPlayToken();
  try {
    const response = await fetch(
      `${ClientEnv.serverHttpBase()}/api/create_game`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Server error response:", errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Success:", data);

    return data as GameInfo;
  } catch (error) {
    console.error("Error creating lobby:", error);
    throw error;
  }
}

// POST /wX/api/create_game?previous=<gameID>, targeted at the worker that owns
// the finished game — mints a successor private lobby (same creator, default
// settings) and has the old game broadcast the new id to everyone still
// connected. Returns the successor's info; the caller navigates the host there.
// Idempotent server-side: repeat calls return the same successor.
export async function createNextLobby(
  previousGameID: string,
): Promise<GameInfo> {
  const token = await getPlayToken();
  const response = await fetch(
    `${ClientEnv.serverHttpBase()}/${ClientEnv.workerPath(previousGameID)}/api/create_game?previous=${previousGameID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("createNextLobby: server error response:", errorText);
    throw new Error(`create next lobby failed: HTTP ${response.status}`);
  }
  return (await response.json()) as GameInfo;
}

export function getApiBase() {
  const domainname = getAudience();

  if (domainname === "localhost") {
    const apiDomain = process.env.API_DOMAIN;
    if (apiDomain) {
      return `https://${apiDomain}`;
    }
    return localStorage.getItem("apiHost") ?? "http://localhost:8787";
  }

  return `https://api.${domainname}`;
}

export function getAudience() {
  // Sourced from BOOTSTRAP_CONFIG (server/desktop-injected) rather than
  // window.location, so the desktop app (app://openfront) targets real infra.
  return ClientEnv.jwtAudience();
}

export async function fetchGameById(
  gameId: string,
): Promise<AnalyticsRecord | false> {
  try {
    const url = `${getApiBase()}/game/${encodeURIComponent(gameId)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchGameById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    // Lenient schema: archives written by older builds predate several
    // schema changes (see ArchivedAnalyticsRecordSchema).
    const parsed = ArchivedAnalyticsRecordSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchGameById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchGameById: request failed", err);
    return false;
  }
}

// The API answers a page past the end of the ranked leaderboard with a 400
// instead of an empty list, so the end is only detectable from the error body.
// Its wording is part of the contract; the bounds vary with the page cap.
const PAGE_BOUNDS_MESSAGE = /^Page must be between \d+ and \d+$/;

export function isPageBoundsMessage(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string" &&
    PAGE_BOUNDS_MESSAGE.test(body.message)
  );
}

export async function fetchPlayerLeaderboard(
  page: number,
): Promise<RankedLeaderboardResponse | "reached_limit" | false> {
  try {
    const url = new URL(`${getApiBase()}/leaderboard/ranked`);
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      if (res.status === 400) {
        const body = await res.json().catch(() => null);
        if (isPageBoundsMessage(body)) {
          return "reached_limit";
        }
      }
      console.warn(
        "fetchPlayerLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const parsed = RankedLeaderboardResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(
        "fetchPlayerLeaderboard: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.error("fetchPlayerLeaderboard: request failed", err);
    return false;
  }
}

const TRIBE_LEADERBOARD_PAGE_SIZE = 50;

async function fetchTribeLeaderboardPage(
  page: number,
): Promise<TribeLeaderboardResponse | false> {
  try {
    const url = new URL(`${getApiBase()}/leaderboard/tribes`);
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(
        "fetchTribeLeaderboardPage: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const parsed = TribeLeaderboardResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(
        "fetchTribeLeaderboardPage: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.error("fetchTribeLeaderboardPage: request failed", err);
    return false;
  }
}

// Fetches the whole tribe-name board. It caps at two 50-entry pages and the
// response carries no total or hasMore, so a full first page is the only
// signal that a second one exists — and the common case early on is one
// short page, i.e. a single request.
export async function fetchTribeLeaderboard(): Promise<
  TribeLeaderboardResponse | false
> {
  const first = await fetchTribeLeaderboardPage(1);
  if (first === false) return false;
  if (first.tribes.length < TRIBE_LEADERBOARD_PAGE_SIZE) return first;

  // A truncated board beats an error screen, so keep page 1 if the tail fails.
  const second = await fetchTribeLeaderboardPage(2);
  if (second === false) return first;

  return { ...first, tribes: [...first.tribes, ...second.tribes] };
}

export async function getNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch(`${getApiBase()}/news.json`, {
      headers: { Accept: "application/json" },
    });
    if (res.status !== 200) {
      console.warn("getNews: unexpected status", res.status);
      return newsItemsFallback as NewsItem[];
    }
    const json = await res.json();
    const parsed = z.array(NewsItemSchema).safeParse(json);
    if (!parsed.success) {
      console.warn("getNews: Zod validation failed", parsed.error);
      return newsItemsFallback as NewsItem[];
    }
    return parsed.data;
  } catch (err) {
    console.warn("getNews: request failed, using fallback", err);
    return newsItemsFallback as NewsItem[];
  }
}

// Fetch an API-served JSON config (news.json-style: served file + bundled fallback).
// Any error, non-200, or invalid payload falls back, parsed through the same schema so
// the fallback is validated too. The timeout guards recurring callers (StreamsFeed polls
// every 60s) from a fetch that never settles.
async function getServedConfig<T>(
  name: string,
  schema: z.ZodType<T>,
  fallback: unknown,
): Promise<T> {
  try {
    const res = await fetch(`${getApiBase()}/${name}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200) {
      console.warn(`${name}: unexpected status`, res.status);
      return schema.parse(fallback);
    }
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(`${name}: Zod validation failed`, parsed.error);
      return schema.parse(fallback);
    }
    return parsed.data;
  } catch (err) {
    console.warn(`${name}: request failed, using fallback`, err);
    return schema.parse(fallback);
  }
}

// The single verified-live feed behind both homepage streaming features (API-hosted JSON
// + bundled fallback). Every entry has already been confirmed live server-side, so
// callers render what this returns without probing Twitch or YouTube themselves.
//
// Fails closed: any error, non-200, or legacy payload lands on the bundled empty feed.
export async function getStreams(): Promise<StreamsFeed> {
  return getServedConfig("streams.json", StreamsFeedSchema, streamsFallback);
}
