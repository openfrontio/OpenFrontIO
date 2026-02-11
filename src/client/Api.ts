import { z } from "zod";
import {
  ClanLeaderboardResponse,
  ClanLeaderboardResponseSchema,
  PlayerProfile,
  PlayerProfileSchema,
  RankedLeaderboardResponse,
  RankedLeaderboardResponseSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { AnalyticsRecord, AnalyticsRecordSchema } from "../core/Schemas";
import { getAuthHeader, logOut, userAuth } from "./Auth";

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

export async function createCheckoutSession(
  priceId: string,
  colorPaletteName: string | null,
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

export async function grantTemporaryFlare(flare: string): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/flares_granted/temporary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({ flare }),
    });
    if (!response.ok) {
      console.error(
        "grantTemporaryFlare: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("grantTemporaryFlare: request failed", e);
    return false;
  }
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

// Check if the user's account is linked to a Discord or email account.
export function hasLinkedAccount(
  userMeResponse: UserMeResponse | false,
): boolean {
  return (
    userMeResponse !== false &&
    (userMeResponse.user?.discord !== undefined ||
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

export async function fetchClanLeaderboard(): Promise<
  ClanLeaderboardResponse | false
> {
  try {
    const res = await fetch(`${getApiBase()}/public/clans/leaderboard`, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(
        "fetchClanLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = ClanLeaderboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(
        "fetchClanLeaderboard: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchClanLeaderboard: request failed", err);
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
      // Handle "Page must be between X and Y" error as end of list
      if (res.status === 400) {
        const errorJson = await res.json().catch(() => null);
        if (errorJson?.message?.includes("Page must be between")) {
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

    const json = await res.json();
    const parsed = RankedLeaderboardResponseSchema.safeParse(json);
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
