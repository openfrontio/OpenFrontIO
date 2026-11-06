import {
  DismissLobbyInviteInputSchema,
  LOBBY_INVITE_TTL_MS,
  LobbyInvite,
  SendLobbyInviteInput,
  SendLobbyInviteInputSchema,
} from "@openfront/shared/LobbyInviteSchemas";
import type express from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { verifyClientToken } from "./jwt";

export class LobbyInviteService {
  private static _instance: LobbyInviteService | null = null;
  public static get instance(): LobbyInviteService {
    return (this._instance ??= new LobbyInviteService());
  }

  // Keyed by invite id
  private invites = new Map<string, LobbyInvite>();

  private onInviteAdded?: (invite: LobbyInvite) => void;
  private onInviteDismissed?: (inviteId: string) => void;

  setBroadcasters(
    onInviteAdded: (invite: LobbyInvite) => void,
    onInviteDismissed: (inviteId: string) => void,
  ) {
    this.onInviteAdded = onInviteAdded;
    this.onInviteDismissed = onInviteDismissed;
  }

  createInvite(
    input: SendLobbyInviteInput,
    ttlMs: number = LOBBY_INVITE_TTL_MS,
  ): LobbyInvite {
    this.pruneExpired();

    const now = Date.now();
    for (const [, existing] of this.invites.entries()) {
      if (
        existing.targetPublicId === input.targetPublicId &&
        existing.senderPublicId === input.senderPublicId &&
        existing.lobbyId === input.lobbyId
      ) {
        existing.createdAt = now;
        existing.expiresAt = now + ttlMs;
        existing.senderUsername = input.senderUsername;
        existing.gameMode = input.gameMode;
        existing.map = input.map;
        this.onInviteAdded?.(existing);
        return existing;
      }
    }

    const invite: LobbyInvite = {
      id: nanoid(16),
      lobbyId: input.lobbyId,
      senderPublicId: input.senderPublicId,
      senderUsername: input.senderUsername ?? null,
      targetPublicId: input.targetPublicId,
      gameMode: input.gameMode,
      map: input.map,
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    this.invites.set(invite.id, invite);
    this.onInviteAdded?.(invite);
    return invite;
  }

  addExternalInvite(invite: LobbyInvite): void {
    if (invite.expiresAt > Date.now()) {
      this.invites.set(invite.id, invite);
    }
  }

  dismissInvite(targetPublicId: string, inviteId: string): boolean {
    const invite = this.invites.get(inviteId);
    if (!invite) return false;
    if (invite.targetPublicId !== targetPublicId) return false;
    this.invites.delete(inviteId);
    this.onInviteDismissed?.(inviteId);
    return true;
  }

  dismissExternalInvite(inviteId: string): void {
    this.invites.delete(inviteId);
  }

  getInvitesForUser(
    targetPublicId: string,
    isLobbyActive?: (lobbyId: string) => boolean,
  ): LobbyInvite[] {
    this.pruneExpired();
    const result: LobbyInvite[] = [];
    const now = Date.now();
    for (const [id, invite] of this.invites.entries()) {
      if (invite.targetPublicId === targetPublicId && invite.expiresAt > now) {
        if (isLobbyActive && !isLobbyActive(invite.lobbyId)) {
          this.invites.delete(id);
          continue;
        }
        result.push(invite);
      }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  pruneExpired(): void {
    const now = Date.now();
    for (const [id, invite] of this.invites.entries()) {
      if (invite.expiresAt <= now) {
        this.invites.delete(id);
      }
    }
  }

  reset(): void {
    this.invites.clear();
  }
}

export function registerLobbyInviteRoutes(
  app: express.Express,
  isLobbyActive?: (lobbyId: string) => boolean,
): void {
  app.post("/api/lobby/invite", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }
    const token = authHeader.substring("Bearer ".length);
    const auth = await verifyClientToken(token);
    if (auth.type !== "success") {
      return res.status(401).json({ error: "Invalid token" });
    }

    const parsed = SendLobbyInviteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }

    const invite = LobbyInviteService.instance.createInvite(parsed.data);
    res.json({ ok: true, invite });
  });

  app.get("/api/lobby/invites", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }
    const token = authHeader.substring("Bearer ".length);
    const auth = await verifyClientToken(token);
    if (auth.type !== "success") {
      return res.status(401).json({ error: "Invalid token" });
    }

    const publicId = req.query.publicId;
    if (typeof publicId !== "string" || !publicId) {
      return res
        .status(400)
        .json({ error: "publicId query parameter required" });
    }

    const invites = LobbyInviteService.instance.getInvitesForUser(
      publicId,
      isLobbyActive,
    );
    res.json({ invites });
  });

  app.post("/api/lobby/invites/dismiss", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }
    const token = authHeader.substring("Bearer ".length);
    const auth = await verifyClientToken(token);
    if (auth.type !== "success") {
      return res.status(401).json({ error: "Invalid token" });
    }

    const parsed = DismissLobbyInviteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }

    const ok = LobbyInviteService.instance.dismissInvite(
      parsed.data.publicId,
      parsed.data.inviteId,
    );
    res.json({ ok });
  });
}
