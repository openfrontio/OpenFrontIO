import {
  DismissLobbyInviteInput,
  LobbyInvite,
  LobbyInviteSchema,
  LobbyInvitesResponseSchema,
  SendLobbyInviteInput,
} from "@openfront/shared/LobbyInviteSchemas";
import { getPlayToken } from "./Auth";
import { ClientEnv } from "./ClientEnv";
import { ensureServerList } from "./ServerList";

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

export type SendLobbyInviteResult = {
  ok: boolean;
  retryAfterSeconds?: number;
  retryAfterMs?: number;
};

/**
 * Sends a private lobby invitation to `input.targetPublicId` via the lobby's owning server deployment.
 */
export async function sendLobbyInvite(
  input: SendLobbyInviteInput,
): Promise<SendLobbyInviteResult> {
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
    let res = await fetch(primary, requestInit);
    if (!res.ok && masterFallback && (await isUnroutedWorkerResponse(res))) {
      res = await fetch(masterFallback, requestInit);
    }
    if (res.ok) {
      return { ok: true };
    }
    if (res.status === 429) {
      try {
        const body = (await res.json()) as {
          retryAfterSeconds?: number;
          retryAfterMs?: number;
        };
        const retryAfterHeader = res.headers.get("Retry-After");
        const parsedHeader = retryAfterHeader
          ? parseInt(retryAfterHeader, 10)
          : undefined;
        const retryAfterSeconds =
          typeof body?.retryAfterSeconds === "number"
            ? body.retryAfterSeconds
            : typeof parsedHeader === "number" && !isNaN(parsedHeader)
              ? parsedHeader
              : 30;
        const retryAfterMs =
          typeof body?.retryAfterMs === "number"
            ? body.retryAfterMs
            : retryAfterSeconds * 1000;
        return { ok: false, retryAfterSeconds, retryAfterMs };
      } catch {
        return { ok: false, retryAfterSeconds: 30, retryAfterMs: 30_000 };
      }
    }
    return { ok: false };
  } catch (err) {
    console.error("sendLobbyInvite failed:", err);
    return { ok: false };
  }
}

/**
 * Fetches the server-validated visible member `publicId`s for `lobbyId`, respecting lobby anonymity rules.
 */
export async function fetchLobbyMemberPublicIds(
  lobbyId: string,
  signal?: AbortSignal,
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
      signal,
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
 * Polls active lobby invitations for the authenticated user from the connected server deployment, returning `false` on failure.
 */
export async function fetchLobbyInvites(
  publicId?: string,
): Promise<FetchLobbyInvitesResult | false> {
  try {
    await ensureServerList().catch(() => {});
    const token = await getPlayToken();
    const base = ClientEnv.serverHttpBase();
    if (!base) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const url = new URL(`${base}/api/lobby/invites`);
      if (publicId) {
        url.searchParams.set("publicId", publicId);
      }
      const res = await fetch(url.toString(), {
        signal: controller.signal,
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
    } finally {
      clearTimeout(timer);
    }
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
