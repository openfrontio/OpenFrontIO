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

// ── Clan API types ──────────────────────────────────────────────────

export interface ClanInfo {
  name: string;
  tag: string;
  description: string;
  isOpen: boolean;
  createdAt: string;
  memberCount: number;
}

export interface ClanBrowseResponse {
  results: ClanInfo[];
  total: number;
  page: number;
  limit: number;
}

export interface ClanMember {
  role: "leader" | "officer" | "member";
  joinedAt: string;
  publicId: string | null;
}

export interface ClanMembersResponse {
  results: ClanMember[];
  total: number;
  page: number;
  limit: number;
  pendingRequests?: number;
}

export interface ClanJoinRequest {
  publicId: string;
  createdAt: string;
}

export interface ClanRequestsResponse {
  results: ClanJoinRequest[];
  total: number;
  page: number;
  limit: number;
}

// ── Clan API functions ──────────────────────────────────────────────

async function clanFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: await getAuthHeader(),
      ...options?.headers,
    },
  });
}

export async function fetchClans(
  search?: string,
  page = 1,
  limit = 20,
): Promise<ClanBrowseResponse | false> {
  try {
    const url = new URL(`${getApiBase()}/clans`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (search && search.length >= 3) url.searchParams.set("search", search);
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: await getAuthHeader(),
      },
    });
    if (!res.ok) return false;
    return (await res.json()) as ClanBrowseResponse;
  } catch {
    return false;
  }
}

export async function fetchClanDetail(tag: string): Promise<ClanInfo | false> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}`);
    if (!res.ok) return false;
    return (await res.json()) as ClanInfo;
  } catch {
    return false;
  }
}

export async function fetchClanMembers(
  tag: string,
  page = 1,
  limit = 20,
): Promise<ClanMembersResponse | false> {
  try {
    const url = new URL(
      `${getApiBase()}/clans/${encodeURIComponent(tag)}/members`,
    );
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: await getAuthHeader(),
      },
    });
    if (res.status === 403) return false;
    if (!res.ok) return false;
    return (await res.json()) as ClanMembersResponse;
  } catch {
    return false;
  }
}

export async function joinClan(
  tag: string,
): Promise<{ status: "joined" | "requested" } | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/join`, {
      method: "POST",
    });
    if (res.status === 409) return { error: "Already a member" };
    if (res.status === 429) return { error: "Please wait before trying again" };
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return (await res.json()) as { status: "joined" | "requested" };
  } catch {
    return { error: "Network error" };
  }
}

export async function leaveClan(
  tag: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/leave`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return true;
  } catch {
    return { error: "Network error" };
  }
}

export async function updateClan(
  tag: string,
  patch: { name?: string; description?: string; isOpen?: boolean },
): Promise<ClanInfo | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return (await res.json()) as ClanInfo;
  } catch {
    return { error: "Network error" };
  }
}

export async function disbandClan(
  tag: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return true;
  } catch {
    return { error: "Network error" };
  }
}

export async function kickMember(
  tag: string,
  targetPublicId: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/kick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPublicId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return true;
  } catch {
    return { error: "Network error" };
  }
}

export async function promoteMember(
  tag: string,
  targetPublicId: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPublicId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return true;
  } catch {
    return { error: "Network error" };
  }
}

export async function demoteMember(
  tag: string,
  targetPublicId: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/demote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPublicId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return true;
  } catch {
    return { error: "Network error" };
  }
}

export async function transferLeadership(
  tag: string,
  targetPublicId: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPublicId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return true;
  } catch {
    return { error: "Network error" };
  }
}

export async function fetchClanRequests(
  tag: string,
  page = 1,
  limit = 20,
): Promise<ClanRequestsResponse | false> {
  try {
    const url = new URL(
      `${getApiBase()}/clans/${encodeURIComponent(tag)}/requests`,
    );
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: await getAuthHeader(),
      },
    });
    if (!res.ok) return false;
    return (await res.json()) as ClanRequestsResponse;
  } catch {
    return false;
  }
}

export async function approveClanRequest(
  tag: string,
  targetPublicId: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(
      `/clans/${encodeURIComponent(tag)}/requests/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPublicId }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return true;
  } catch {
    return { error: "Network error" };
  }
}

export async function denyClanRequest(
  tag: string,
  targetPublicId: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(
      `/clans/${encodeURIComponent(tag)}/requests/deny`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPublicId }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { message?: string }).message ?? "Failed" };
    }
    return true;
  } catch {
    return { error: "Network error" };
  }
}
