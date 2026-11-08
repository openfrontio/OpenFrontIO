import {
  DismissLobbyInviteInput,
  LobbyInvite,
  SendLobbyInviteInput,
} from "@openfront/shared/LobbyInviteSchemas";
import { getPlayToken } from "./Auth";
import { ClientEnv } from "./ClientEnv";

let useWorkerFallback = false;

function inviteApiBase(): string {
  const base = ClientEnv.serverHttpBase();
  return useWorkerFallback ? `${base}/w0` : base;
}

export async function sendLobbyInvite(
  input: SendLobbyInviteInput,
): Promise<boolean> {
  try {
    const token = await getPlayToken();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const body = JSON.stringify(input);
    const res = await fetch(`${inviteApiBase()}/api/lobby/invite`, {
      method: "POST",
      headers,
      body,
    });
    if (!useWorkerFallback) {
      // Also mirror to /w0 if Master was started before route registration
      void fetch(`${ClientEnv.serverHttpBase()}/w0/api/lobby/invite`, {
        method: "POST",
        headers,
        body,
      }).catch(() => {});
    }
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
    const url = new URL(`${inviteApiBase()}/api/lobby/invites`);
    url.searchParams.set("publicId", publicId);
    let res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return [];
    let contentType = res.headers.get("content-type");
    if (!contentType?.includes("application/json") && !useWorkerFallback) {
      useWorkerFallback = true;
      const workerUrl = new URL(
        `${ClientEnv.serverHttpBase()}/w0/api/lobby/invites`,
      );
      workerUrl.searchParams.set("publicId", publicId);
      res = await fetch(workerUrl.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) return [];
      contentType = res.headers.get("content-type");
      if (!contentType?.includes("application/json")) return [];
    }
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
    const res = await fetch(`${inviteApiBase()}/api/lobby/invites/dismiss`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        publicId,
        inviteId,
      } satisfies DismissLobbyInviteInput),
    });
    return res.ok;
  } catch (err) {
    console.error("dismissLobbyInvite failed:", err);
    return false;
  }
}
