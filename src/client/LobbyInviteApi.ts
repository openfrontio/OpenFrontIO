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
 * Resolves the target HTTP base and optional worker path for a lobby ID so invites reach the lobby's owning deployment, with a same-deployment master fallback when a worker prefix is not routed.
 */
function resolveLobbyInviteEndpoints(lobbyId: string): {
  primary: string;
  masterFallback?: string;
} {
  const defaultEndpoint = `${ClientEnv.serverHttpBase()}/api/lobby/invite`;
  try {
    const gameBase = ClientEnv.gameHttpBase(lobbyId);
    const masterEndpoint = `${gameBase}/api/lobby/invite`;
    let workerPrefix = "";
    try {
      const wp = ClientEnv.gameWorkerPath(lobbyId);
      if (wp) workerPrefix = `/${wp}`;
    } catch {
      // numWorkers may not be configured in unit tests
    }
    const primary = `${gameBase}${workerPrefix}/api/lobby/invite`;
    if (primary === masterEndpoint) {
      return { primary };
    }
    return { primary, masterFallback: masterEndpoint };
  } catch {
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

export type FetchLobbyInvitesResult = {
  invites: LobbyInvite[];
  serverTime: number;
};

/**
 * Polls active lobby invitations for the authenticated user, returning `false` on network or HTTP failure.
 */
export async function fetchLobbyInvites(
  publicId?: string,
): Promise<FetchLobbyInvitesResult | false> {
  try {
    const token = await getPlayToken();
    const url = new URL(`${ClientEnv.serverHttpBase()}/api/lobby/invites`);
    if (publicId) {
      url.searchParams.set("publicId", publicId);
    }
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return false;
    const contentType = res.headers.get("content-type");
    if (!contentType?.includes("application/json")) return false;
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
          return false;
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
    return false;
  } catch (err) {
    console.warn("fetchLobbyInvites failed:", err);
    return false;
  }
}

/**
 * Dismisses a lobby invitation for the authenticated user.
 */
export async function dismissLobbyInvite(
  publicId: string,
  inviteId: string,
): Promise<boolean> {
  try {
    const token = await getPlayToken();
    const res = await fetch(
      `${ClientEnv.serverHttpBase()}/api/lobby/invites/dismiss`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          publicId,
          inviteId,
        } satisfies DismissLobbyInviteInput),
      },
    );
    return res.ok;
  } catch (err) {
    console.error("dismissLobbyInvite failed:", err);
    return false;
  }
}
