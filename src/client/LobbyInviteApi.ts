import {
  DismissLobbyInviteInput,
  LobbyInvite,
  LobbyInvitesResponseSchema,
  SendLobbyInviteInput,
} from "@openfront/shared/LobbyInviteSchemas";
import { getPlayToken } from "./Auth";
import { ClientEnv } from "./ClientEnv";
import { ensureServerList } from "./ServerList";

/**
 * Resolves the target HTTP base and optional worker path for a lobby ID so invites can reach the lobby's owning deployment.
 */
function resolveLobbyInviteEndpoints(lobbyId: string): string[] {
  const defaultEndpoint = `${ClientEnv.serverHttpBase()}/api/lobby/invite`;
  try {
    const gameBase = ClientEnv.gameHttpBase(lobbyId);
    let workerPrefix = "";
    try {
      const wp = ClientEnv.gameWorkerPath(lobbyId);
      if (wp) workerPrefix = `/${wp}`;
    } catch {
      // numWorkers may not be configured in unit tests
    }
    const gameEndpoint = `${gameBase}${workerPrefix}/api/lobby/invite`;
    if (gameEndpoint === defaultEndpoint) {
      return [defaultEndpoint];
    }
    if (gameBase !== ClientEnv.serverHttpBase()) {
      // Post to the lobby's deployment and mirror to the current serverHttpBase so recipients polling either deployment see the invite.
      return [gameEndpoint, defaultEndpoint];
    }
    return [gameEndpoint, defaultEndpoint];
  } catch {
    return [defaultEndpoint];
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
    const endpoints = resolveLobbyInviteEndpoints(input.lobbyId);
    const primaryRes = await fetch(endpoints[0], {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    if (
      endpoints.length > 1 &&
      ClientEnv.gameHttpBase(input.lobbyId) !== ClientEnv.serverHttpBase()
    ) {
      void fetch(endpoints[1], {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      }).catch(() => {});
    }
    return primaryRes.ok;
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
      return {
        invites: data.invites as LobbyInvite[],
        serverTime:
          typeof data.serverTime === "number" ? data.serverTime : Date.now(),
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
