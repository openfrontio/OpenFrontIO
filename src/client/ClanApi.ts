import {
  type ClanBansResponse,
  ClanBansResponseSchema,
  type ClanBrowseResponse,
  ClanBrowseResponseSchema,
  type ClanGameFilter,
  type ClanGamesResponse,
  ClanGamesResponseSchema,
  type ClanInfo,
  ClanInfoSchema,
  type ClanLeaderboardResponse,
  ClanLeaderboardResponseSchema,
  type ClanMembersResponse,
  ClanMembersResponseSchema,
  type ClanRequestsResponse,
  ClanRequestsResponseSchema,
  JoinClanResponseSchema,
} from "../core/ClanApiSchemas";
import { getApiBase, getUserMe } from "./Api";
import { getAuthHeader } from "./Auth";

const CLAN_EXISTS_FETCH_TIMEOUT_MS = 3000;
export type {
  ClanBan,
  ClanBansResponse,
  ClanBrowseResponse,
  ClanGame,
  ClanGameFilter,
  ClanGamePlayer,
  ClanGameResult,
  ClanGamesResponse,
  ClanInfo,
  ClanJoinRequest,
  ClanMember,
  ClanMembersResponse,
  ClanMemberStats,
  ClanMemberWL,
  ClanRequestsResponse,
} from "../core/ClanApiSchemas";

async function clanFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const url = `${getApiBase()}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options?.headers,
      Authorization: await getAuthHeader(),
    },
  });
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

export async function fetchClans(
  search?: string,
  page = 1,
  limit = 20,
): Promise<ClanBrowseResponse | false> {
  try {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (search && search.length >= 2) params.set("search", search);
    const res = await clanFetch(`/clans?${params}`);
    if (!res.ok) return false;
    const json = await res.json();
    const parsed = ClanBrowseResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchClans: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

export async function fetchClanDetail(tag: string): Promise<ClanInfo | false> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}`);
    if (!res.ok) return false;
    const json = await res.json();
    const parsed = ClanInfoSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchClanDetail: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

// Public existence probe (no auth). null = inconclusive (timeout / error /
// unexpected status); the caller decides how to handle it. The tag is
// uppercased to the canonical form so it matches the server's route.
export async function fetchClanExists(tag: string): Promise<boolean | null> {
  try {
    const path = `/public/clan/${encodeURIComponent(tag.toUpperCase())}/exists`;
    const res = await fetch(`${getApiBase()}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(CLAN_EXISTS_FETCH_TIMEOUT_MS),
    });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Client-side mirror of the server's clan-tag ownership rule (resolveClanTag in
 * Privilege.ts), for instant inline feedback. Returns the tag to submit (null
 * if dropped) and an i18n error key. The server re-checks authoritatively.
 */
export async function checkClanTagOwnership(
  tag: string,
): Promise<{ tag: string | null; error: string | null }> {
  const me = await getUserMe();
  const myTags = me
    ? (me.player.clans ?? []).map((c) => c.tag.toUpperCase())
    : [];
  if (myTags.includes(tag.toUpperCase())) {
    return { tag, error: null };
  }

  const exists = await fetchClanExists(tag);
  if (exists === true) return { tag: null, error: "username.tag_not_member" };
  // Tag doesn't exist (fictional) or the check was inconclusive (API
  // unavailable, e.g. during development) — fail open and keep the tag;
  // the server re-checks authoritatively.
  return { tag, error: null };
}

export type ClanMemberSort =
  | "default"
  | "winsTotal"
  | "lossesTotal"
  | "winsFfa"
  | "lossesFfa"
  | "winsTeam"
  | "lossesTeam"
  | "winsHvn"
  | "lossesHvn"
  | "winsRanked"
  | "lossesRanked"
  | "wins1v1"
  | "losses1v1";
export type ClanMemberOrder = "asc" | "desc";

export async function fetchClanMembers(
  tag: string,
  page = 1,
  limit = 20,
  sort: ClanMemberSort = "default",
  order?: ClanMemberOrder,
): Promise<ClanMembersResponse | false> {
  try {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (sort !== "default") params.set("sort", sort);
    if (order) params.set("order", order);
    const res = await clanFetch(
      `/clans/${encodeURIComponent(tag)}/members?${params}`,
    );
    if (!res.ok) return false;
    const json = await res.json();
    const parsed = ClanMembersResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchClanMembers: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}

export async function joinClan(
  tag: string,
): Promise<
  { status: "joined" | "requested" } | { error: string; reason?: string }
> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/join`, {
      method: "POST",
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const msg = (body as { message?: string }).message ?? "";
      return {
        error: msg.toLowerCase().includes("request")
          ? "clan_modal.error_request_pending"
          : "clan_modal.error_already_member",
      };
    }
    if (res.status === 429) {
      return { error: "clan_modal.error_rate_limited_generic" };
    }
    if (res.status === 401) {
      return { error: "clan_modal.sign_in_for_clans" };
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      const b = body as { code?: string; reason?: string | null };
      if (b.code === "BANNED") {
        return {
          error: b.reason
            ? "clan_modal.error_banned_reason"
            : "clan_modal.error_banned",
          ...(b.reason ? { reason: b.reason } : {}),
        };
      }
      return {
        error: "clan_modal.error_failed",
      };
    }
    if (!res.ok) {
      return {
        error: "clan_modal.error_failed",
      };
    }
    const json = await res.json();
    const parsed = JoinClanResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("joinClan: Zod validation failed", parsed.error);
      return { error: "clan_modal.error_failed" };
    }
    return parsed.data;
  } catch {
    return { error: "clan_modal.error_network" };
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
      return {
        error: "clan_modal.error_failed",
      };
    }
    return true;
  } catch {
    return { error: "clan_modal.error_network" };
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
      return {
        error: "clan_modal.error_failed",
      };
    }
    const json = await res.json();
    const parsed = ClanInfoSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("updateClan: Zod validation failed", parsed.error);
      return { error: "clan_modal.error_failed" };
    }
    return parsed.data;
  } catch {
    return { error: "clan_modal.error_network" };
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
      return {
        error: "clan_modal.error_failed",
      };
    }
    return true;
  } catch {
    return { error: "clan_modal.error_network" };
  }
}

async function memberAction(
  tag: string,
  targetPublicId: string,
  action: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPublicId }),
    });
    if (!res.ok) {
      return { error: "clan_modal.error_failed" };
    }
    return true;
  } catch {
    return { error: "clan_modal.error_network" };
  }
}

export const kickMember = (tag: string, targetPublicId: string) =>
  memberAction(tag, targetPublicId, "kick");

export const promoteMember = (tag: string, targetPublicId: string) =>
  memberAction(tag, targetPublicId, "promote");

export const demoteMember = (tag: string, targetPublicId: string) =>
  memberAction(tag, targetPublicId, "demote");

export const transferLeadership = (tag: string, targetPublicId: string) =>
  memberAction(tag, targetPublicId, "transfer");

export async function fetchClanRequests(
  tag: string,
  page = 1,
  limit = 20,
): Promise<ClanRequestsResponse | false> {
  try {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    const res = await clanFetch(
      `/clans/${encodeURIComponent(tag)}/requests?${params}`,
    );
    if (!res.ok) return false;
    const json = await res.json();
    const parsed = ClanRequestsResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchClanRequests: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
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
      return {
        error: "clan_modal.error_failed",
      };
    }
    return true;
  } catch {
    return { error: "clan_modal.error_network" };
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
      return {
        error: "clan_modal.error_failed",
      };
    }
    return true;
  } catch {
    return { error: "clan_modal.error_network" };
  }
}

export async function withdrawClanRequest(
  tag: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(
      `/clans/${encodeURIComponent(tag)}/requests/withdraw`,
      { method: "POST" },
    );
    if (!res.ok) {
      return {
        error: "clan_modal.error_failed",
      };
    }
    return true;
  } catch {
    return { error: "clan_modal.error_network" };
  }
}

export async function banClanMember(
  tag: string,
  targetPublicId: string,
  reason?: string,
): Promise<true | { error: string }> {
  try {
    const body: { targetPublicId: string; reason?: string } = {
      targetPublicId,
    };
    if (reason) body.reason = reason;
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { error: "clan_modal.error_failed" };
    }
    return true;
  } catch {
    return { error: "clan_modal.error_network" };
  }
}

export async function unbanClanMember(
  tag: string,
  targetPublicId: string,
): Promise<true | { error: string }> {
  try {
    const res = await clanFetch(`/clans/${encodeURIComponent(tag)}/unban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPublicId }),
    });
    if (!res.ok) {
      return { error: "clan_modal.error_failed" };
    }
    return true;
  } catch {
    return { error: "clan_modal.error_network" };
  }
}

export type ClanGamesFetchError = "forbidden" | "failed";

export async function fetchClanGames(
  tag: string,
  opts: { filter?: ClanGameFilter; cursor?: string } = {},
): Promise<ClanGamesResponse | { error: ClanGamesFetchError }> {
  try {
    const params = new URLSearchParams();
    if (opts.filter) params.set("filter", opts.filter);
    // `cursor` is an opaque continuation token issued by the previous
    // response's `nextCursor`. Round-trip verbatim; never construct.
    if (opts.cursor) params.set("cursor", opts.cursor);
    const qs = params.toString();
    const res = await clanFetch(
      `/clans/${encodeURIComponent(tag)}/games${qs ? `?${qs}` : ""}`,
    );
    if (res.status === 403) return { error: "forbidden" };
    if (!res.ok) return { error: "failed" };
    const json = await res.json();
    const parsed = ClanGamesResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchClanGames: Zod validation failed", parsed.error);
      return { error: "failed" };
    }
    return parsed.data;
  } catch {
    return { error: "failed" };
  }
}

export async function fetchClanBans(
  tag: string,
  page = 1,
  limit = 20,
): Promise<ClanBansResponse | false> {
  try {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    const res = await clanFetch(
      `/clans/${encodeURIComponent(tag)}/bans?${params}`,
    );
    if (!res.ok) return false;
    const json = await res.json();
    const parsed = ClanBansResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchClanBans: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch {
    return false;
  }
}
