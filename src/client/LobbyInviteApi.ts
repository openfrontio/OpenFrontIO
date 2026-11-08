import {
  DismissLobbyInviteInput,
  LobbyInvite,
  LobbyInviteSchema,
  LobbyInvitesResponseSchema,
  SendLobbyInviteInput,
} from "@openfront/shared/LobbyInviteSchemas";
import { getPlayToken } from "./Auth";
import { ClientEnv } from "./ClientEnv";
import { cachedServerList, ensureServerList } from "./ServerList";

/**
 * Resolves the target HTTP base and optional worker path for a lobby ID so requests reach the lobby's owning deployment, with a same-deployment master fallback when a worker prefix is not routed.
 */
function resolveLobbyInviteEndpoints(
  lobbyId: string,
  routePath = "/api/lobby/invite",
): {
  primary: string;
  masterFallback?: string;
} {
  try {
    const gameBase = ClientEnv.gameHttpBase(lobbyId);
    const masterEndpoint = `${gameBase}${routePath}`;
    let workerPrefix = "";
    try {
      const wp = ClientEnv.gameWorkerPath(lobbyId);
      if (wp) workerPrefix = `/${wp}`;
    } catch {
      // numWorkers may not be configured in unit tests
    }
    const primary = `${gameBase}${workerPrefix}${routePath}`;
    if (primary === masterEndpoint) {
      return { primary };
    }
    return { primary, masterFallback: masterEndpoint };
  } catch {
    const defaultEndpoint = `${ClientEnv.serverHttpBase()}${routePath}`;
    return { primary: defaultEndpoint };
  }
}

/**
 * Returns true only when `res` indicates the worker prefix route itself was not mounted/routed (e.g. non-JSON 404 from a proxy or dev server), as opposed to a handler validation/state response.
 */
async function isUnroutedWorkerResponse(res: Response): Promise<boolean> {
  if (res.status !== 404) {
    return false;
  }
  const contentType = res.headers?.get?.("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return true;
  }
  try {
    const body = (await res.clone().json()) as { error?: unknown } | null;
    return typeof body?.error !== "string";
  } catch {
    return true;
  }
}

/**
 * Sends a private lobby invitation to `input.targetPublicId` via the lobby's owning server deployment.
 */
export async function sendLobbyInvite(
  input: SendLobbyInviteInput,
): Promise<boolean> {
  try {
    await ensureServerList().catch(() => {});
    const token = await getPlayToken();
    const { primary, masterFallback } = resolveLobbyInviteEndpoints(
      input.lobbyId,
    );
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    };
    const primaryRes = await fetch(primary, requestInit);
    if (primaryRes.ok) {
      return true;
    }
    if (masterFallback && (await isUnroutedWorkerResponse(primaryRes))) {
      const fallbackRes = await fetch(masterFallback, requestInit);
      return fallbackRes.ok;
    }
    return false;
  } catch (err) {
    console.error("sendLobbyInvite failed:", err);
    return false;
  }
}

/**
 * Fetches the server-validated visible member `publicId`s for `lobbyId`, respecting lobby anonymity rules.
 */
export async function fetchLobbyMemberPublicIds(
  lobbyId: string,
): Promise<string[] | false> {
  if (!lobbyId) return false;
  try {
    await ensureServerList().catch(() => {});
    const token = await getPlayToken();
    const routePath = `/api/lobby/members?lobbyId=${encodeURIComponent(lobbyId)}`;
    const { primary, masterFallback } = resolveLobbyInviteEndpoints(
      lobbyId,
      routePath,
    );
    const requestInit: RequestInit = {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
    let res = await fetch(primary, requestInit);
    if (!res.ok && masterFallback && (await isUnroutedWorkerResponse(res))) {
      res = await fetch(masterFallback, requestInit);
    }
    if (!res.ok) return false;
    const contentType = res.headers?.get?.("content-type") ?? "";
    if (!contentType.includes("application/json")) return false;
    const data = (await res.json()) as { memberPublicIds?: unknown } | null;
    if (!Array.isArray(data?.memberPublicIds)) return false;
    const ids: string[] = [];
    for (const item of data.memberPublicIds) {
      if (typeof item !== "string" || item.length === 0) return false;
      ids.push(item);
    }
    return ids;
  } catch (err) {
    console.warn("fetchLobbyMemberPublicIds failed:", err);
    return false;
  }
}

export type FetchLobbyInvitesResult = {
  invites: LobbyInvite[];
  serverTime: number;
};

/**
 * Collects known server HTTP deployment origins from the cached server list, cluster config, and own server base.
 */
function getTargetServerHttpBases(): string[] {
  const bases = new Set<string>();
  try {
    bases.add(ClientEnv.serverHttpBase());
  } catch {
    // serverHttpBase may throw NoServerError before list applied on static apex
  }
  const list = cachedServerList();
  if (list?.servers) {
    for (const server of Object.values(list.servers)) {
      if (server?.host) {
        bases.add(`https://${server.host}`);
      }
    }
  }
  const cluster = ClientEnv.cluster();
  if (cluster) {
    for (const entry of Object.values(cluster)) {
      if (entry?.host) {
        bases.add(`https://${entry.host}`);
      }
    }
  }
  return Array.from(bases);
}

/**
 * Polls active lobby invitations for the authenticated user across known server deployments, deduplicating by ID and returning `false` on complete failure.
 */
export async function fetchLobbyInvites(
  publicId?: string,
): Promise<FetchLobbyInvitesResult | false> {
  try {
    await ensureServerList().catch(() => {});
    const token = await getPlayToken();
    const bases = getTargetServerHttpBases();
    if (bases.length === 0) return false;

    const fetchFromBase = async (
      base: string,
    ): Promise<FetchLobbyInvitesResult> => {
      const url = new URL(`${base}/api/lobby/invites`);
      if (publicId) {
        url.searchParams.set("publicId", publicId);
      }
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        throw new Error("Not JSON");
      }
      const data = await res.json();
      const parsed = LobbyInvitesResponseSchema.safeParse(data);
      if (parsed.success) {
        return parsed.data;
      }
      if (Array.isArray(data?.invites)) {
        const validatedInvites: LobbyInvite[] = [];
        for (const item of data.invites) {
          const itemParsed = LobbyInviteSchema.safeParse(item);
          if (!itemParsed.success) {
            throw new Error("Invalid invite item");
          }
          validatedInvites.push(itemParsed.data);
        }
        return {
          invites: validatedInvites,
          serverTime:
            typeof data.serverTime === "number" &&
            Number.isFinite(data.serverTime)
              ? data.serverTime
              : Date.now(),
        };
      }
      throw new Error("Invalid payload");
    };

    const settled = await Promise.allSettled(
      bases.map((base) => fetchFromBase(base)),
    );
    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<FetchLobbyInvitesResult> =>
        r.status === "fulfilled",
    );
    if (fulfilled.length === 0) {
      return false;
    }

    const inviteMap = new Map<string, LobbyInvite>();
    let maxServerTime = 0;
    for (const { value } of fulfilled) {
      if (value.serverTime > maxServerTime) {
        maxServerTime = value.serverTime;
      }
      for (const invite of value.invites) {
        if (!inviteMap.has(invite.id)) {
          inviteMap.set(invite.id, invite);
        }
      }
    }

    return {
      invites: Array.from(inviteMap.values()),
      serverTime: maxServerTime > 0 ? maxServerTime : Date.now(),
    };
  } catch (err) {
    console.warn("fetchLobbyInvites failed:", err);
    return false;
  }
}

/**
 * Dismisses a lobby invitation for the authenticated user on the owning deployment and default server fallback.
 */
export async function dismissLobbyInvite(
  publicId: string,
  inviteId: string,
  lobbyId?: string,
): Promise<boolean> {
  try {
    await ensureServerList().catch(() => {});
    const token = await getPlayToken();
    const payload = JSON.stringify({
      publicId,
      inviteId,
    } satisfies DismissLobbyInviteInput);

    const endpoints: string[] = [];
    if (lobbyId) {
      try {
        endpoints.push(
          `${ClientEnv.gameHttpBase(lobbyId)}/api/lobby/invites/dismiss`,
        );
      } catch {
        // ignore
      }
    }
    try {
      const defaultEndpoint = `${ClientEnv.serverHttpBase()}/api/lobby/invites/dismiss`;
      if (!endpoints.includes(defaultEndpoint)) {
        endpoints.push(defaultEndpoint);
      }
    } catch {
      // ignore
    }

    if (endpoints.length === 0) return false;

    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: payload,
    };

    let anyOk = false;
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, requestInit);
        if (res.ok) {
          anyOk = true;
          break;
        }
      } catch {
        // continue to next endpoint
      }
    }
    return anyOk;
  } catch (err) {
    console.error("dismissLobbyInvite failed:", err);
    return false;
  }
}
