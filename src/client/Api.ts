import newsItemsFallback from "resources/news.json";
import { z } from "zod";
import type { NewsItem } from "../core/ApiSchemas";
import {
  ClaimAllRewardsResponse,
  ClaimAllRewardsResponseSchema,
  ClaimRewardResponse,
  ClaimRewardResponseSchema,
  NewsItemSchema,
  PlayerGameModeFilter,
  PlayerGameTypeFilter,
  PlayerProfile,
  PlayerProfileSchema,
  PublicPlayerGamesResponse,
  PublicPlayerGamesResponseSchema,
  RankedLeaderboardResponse,
  RankedLeaderboardResponseSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import {
  AnalyticsRecord,
  AnalyticsRecordSchema,
  GameInfo,
} from "../core/Schemas";
import { getAuthHeader, getPlayToken, logOut, userAuth } from "./Auth";
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
export async function getUserMe(): Promise<UserMeResponse | false> {
  if (__userMe !== null) {
    return __userMe;
  }
  __userMe = (async () => {
    try {
      const userAuthResult = await userAuth();
      if (!userAuthResult) return false;
      const { jwt } = userAuthResult;

      // Get the user object
      const response = await fetch(getApiBase() + "/users/@me", {
        headers: {
          authorization: `Bearer ${jwt}`,
        },
      });
      if (response.status === 401) {
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
): Promise<boolean> {
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
      `/${ClientEnv.workerPath(gameID)}/api/game/${gameID}`,
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
      `/${ClientEnv.workerPath(gameID)}/api/game/${gameID}/listing`,
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
    `/${ClientEnv.workerPath(previousGameID)}/api/create_game?previous=${previousGameID}`,
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
    const apiDomain = process?.env?.API_DOMAIN;
    if (apiDomain) {
      return `https://${apiDomain}`;
    }
    return localStorage.getItem("apiHost") ?? "http://localhost:8787";
  }

  return `https://api.${domainname}`;
}

export function getAudience() {
  const { hostname } = new URL(window.location.href);
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname;
}

// Check if the user's account is linked to a Discord, Google, or email account.
export function hasLinkedAccount(
  userMeResponse: UserMeResponse | false,
): boolean {
  return (
    userMeResponse !== false &&
    (userMeResponse.user?.discord !== undefined ||
      userMeResponse.user?.google !== undefined ||
      userMeResponse.user?.email !== undefined)
  );
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
    const parsed = AnalyticsRecordSchema.safeParse(json);
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
      console.warn(
        "fetchPlayerLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = RankedLeaderboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      // Handle "Page must be between X and Y" error as end of list
      if (json?.message?.includes?.("Page must be between")) {
        return "reached_limit";
      }
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
