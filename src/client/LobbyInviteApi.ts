import {
  DismissLobbyInviteInput,
  LobbyInvite,
  SendLobbyInviteInput,
} from "@openfront/shared/LobbyInviteSchemas";
import { getPlayToken } from "./Auth";
import { ClientEnv } from "./ClientEnv";

export async function sendLobbyInvite(
  input: SendLobbyInviteInput,
): Promise<boolean> {
  try {
    const token = await getPlayToken();
    const res = await fetch(`${ClientEnv.serverHttpBase()}/api/lobby/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    return res.ok;
  } catch (err) {
    console.error("sendLobbyInvite failed:", err);
    return false;
  }
}

export async function fetchLobbyInvites(
  publicId: string,
): Promise<LobbyInvite[]> {
  try {
    const token = await getPlayToken();
    const url = new URL(`${ClientEnv.serverHttpBase()}/api/lobby/invites`);
    url.searchParams.set("publicId", publicId);
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.invites as LobbyInvite[]) ?? [];
  } catch (err) {
    console.warn("fetchLobbyInvites failed:", err);
    return [];
  }
}

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
