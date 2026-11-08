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
import { getUserMe, verifyClientToken } from "./jwt";
import { ServerEnv } from "./ServerEnv";

export type VerifiedCallerIdentity = {
  publicId: string;
  username: string | null;
  friends: string[];
  clanTags: string[];
};

export type LobbyInviteRouteOptions = {
  isLobbyActive?: (lobbyId: string) => boolean;
  isPlayerInLobby?: (
    lobbyId: string,
    persistentId: string,
    publicId: string,
  ) => boolean;
  resolveCaller?: (
    token: string,
    persistentId: string,
  ) => Promise<VerifiedCallerIdentity | null>;
  isTargetEligible?: (
    caller: VerifiedCallerIdentity,
    targetPublicId: string,
    token: string,
  ) => Promise<boolean>;
};

const CALLER_CACHE_TTL_MS = 30_000;
const callerCache = new Map<
  string,
  { caller: VerifiedCallerIdentity; expiresAt: number }
>();

/**
 * Resolves the authenticated caller's public identity, friend list, and clan tags via `/users/@me`.
 */
async function defaultResolveCaller(
  token: string,
): Promise<VerifiedCallerIdentity | null> {
  const now = Date.now();
  const cached = callerCache.get(token);
  if (cached && cached.expiresAt > now) {
    return cached.caller;
  }
  const me = await getUserMe(token);
  if (me.type !== "success") {
    return null;
  }
  const player = me.response.player;
  const user = me.response.user;
  const caller: VerifiedCallerIdentity = {
    publicId: player.publicId,
    username:
      player.username ??
      user.discord?.global_name ??
      user.discord?.username ??
      user.steam?.personaName ??
      null,
    friends: player.friends ?? [],
    clanTags: (player.clans ?? []).map((c) => c.tag),
  };
  callerCache.set(token, { caller, expiresAt: now + CALLER_CACHE_TTL_MS });
  return caller;
}

const ClanMembersLookupSchema = z.object({
  members: z.array(z.object({ publicId: z.string() })),
  total: z.number().optional(),
});

/**
 * Checks whether the target player is in the caller's friends list or shares a clan with the caller.
 */
async function defaultIsTargetEligible(
  caller: VerifiedCallerIdentity,
  targetPublicId: string,
  token: string,
): Promise<boolean> {
  if (!targetPublicId || caller.publicId === targetPublicId) {
    return false;
  }
  if (caller.friends.includes(targetPublicId)) {
    return true;
  }
  for (const tag of caller.clanTags) {
    let offset = 0;
    const limit = 100;
    while (true) {
      try {
        const res = await fetch(
          `${ServerEnv.jwtIssuer()}/clans/${encodeURIComponent(tag)}/members?limit=${limit}&offset=${offset}`,
          {
            headers: {
              authorization: `Bearer ${token}`,
              "x-api-key": ServerEnv.apiKey(),
            },
          },
        );
        if (!res.ok) break;
        const parsed = ClanMembersLookupSchema.safeParse(await res.json());
        if (!parsed.success) break;
        if (parsed.data.members.some((m) => m.publicId === targetPublicId)) {
          return true;
        }
        offset += parsed.data.members.length;
        const total = parsed.data.total ?? parsed.data.members.length;
        if (parsed.data.members.length < limit || offset >= total) {
          break;
        }
      } catch {
        break;
      }
    }
  }
  return false;
}

/**
 * Ephemeral in-memory store and synchronization coordinator for private lobby invitations.
 */
export class LobbyInviteService {
  private static _instance: LobbyInviteService | null = null;

  /**
   * Returns the singleton LobbyInviteService instance.
   */
  public static get instance(): LobbyInviteService {
    return (this._instance ??= new LobbyInviteService());
  }

  // Keyed by invite id
  private invites = new Map<string, LobbyInvite>();
  // Tracks the latest dismissal timestamp per invite id so stale IPC refreshes cannot resurrect dismissed invites
  private dismissedAtByInviteId = new Map<string, number>();

  private onInviteAdded?: (invite: LobbyInvite) => void;
  private onInviteDismissed?: (inviteId: string, dismissedAt: number) => void;

  /**
   * Registers IPC broadcaster callbacks invoked when invites are created, refreshed, or dismissed.
   */
  setBroadcasters(
    onInviteAdded: (invite: LobbyInvite) => void,
    onInviteDismissed: (inviteId: string, dismissedAt: number) => void,
  ): void {
    this.onInviteAdded = onInviteAdded;
    this.onInviteDismissed = onInviteDismissed;
  }

  /**
   * Creates a new lobby invite or refreshes an existing active invite for the same sender, target, and lobby.
   */
  createInvite(
    input: SendLobbyInviteInput & {
      senderPublicId: string;
      senderUsername?: string | null;
    },
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
        existing.senderUsername = input.senderUsername ?? null;
        existing.gameMode = input.gameMode;
        existing.map = input.map;
        this.dismissedAtByInviteId.delete(existing.id);
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
    this.dismissedAtByInviteId.delete(invite.id);
    this.onInviteAdded?.(invite);
    return invite;
  }

  /**
   * Adds or updates an invite received from another worker or master process, rejecting expired or stale dismissed refreshes.
   */
  addExternalInvite(invite: LobbyInvite): boolean {
    if (invite.expiresAt <= Date.now()) {
      return false;
    }
    const dismissedAt = this.dismissedAtByInviteId.get(invite.id);
    if (dismissedAt !== undefined) {
      if (invite.createdAt <= dismissedAt) {
        return false;
      }
      this.dismissedAtByInviteId.delete(invite.id);
    }
    const existing = this.invites.get(invite.id);
    if (existing && existing.createdAt > invite.createdAt) {
      return false;
    }
    this.invites.set(invite.id, invite);
    return true;
  }

  /**
   * Dismisses an invite owned by `targetPublicId` and broadcasts the dismissal.
   */
  dismissInvite(targetPublicId: string, inviteId: string): boolean {
    const invite = this.invites.get(inviteId);
    if (!invite) return false;
    if (invite.targetPublicId !== targetPublicId) return false;
    const now = Date.now();
    this.invites.delete(inviteId);
    this.dismissedAtByInviteId.set(inviteId, now);
    this.onInviteDismissed?.(inviteId, now);
    return true;
  }

  /**
   * Records an external invite dismissal from IPC so stale refreshes older than `dismissedAt` are ignored.
   */
  dismissExternalInvite(
    inviteId: string,
    dismissedAt: number = Date.now(),
  ): void {
    const prev = this.dismissedAtByInviteId.get(inviteId) ?? 0;
    const effectiveDismissedAt = Math.max(prev, dismissedAt);
    this.dismissedAtByInviteId.set(inviteId, effectiveDismissedAt);
    const existing = this.invites.get(inviteId);
    if (!existing || existing.createdAt <= effectiveDismissedAt) {
      this.invites.delete(inviteId);
    }
  }

  /**
   * Removes all invites targeting a specific lobby when that lobby starts or closes.
   */
  removeInvitesForLobby(lobbyId: string): void {
    const now = Date.now();
    for (const [id, invite] of this.invites.entries()) {
      if (invite.lobbyId === lobbyId) {
        this.invites.delete(id);
        this.dismissedAtByInviteId.set(id, now);
        this.onInviteDismissed?.(id, now);
      }
    }
  }

  /**
   * Returns all active, non-expired invites for `targetPublicId` whose lobbies are still open.
   */
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

  /**
   * Removes expired invites and stale dismissal tombstones from memory.
   */
  pruneExpired(): void {
    const now = Date.now();
    for (const [id, invite] of this.invites.entries()) {
      if (invite.expiresAt <= now) {
        this.invites.delete(id);
      }
    }
    for (const [id, dismissedAt] of this.dismissedAtByInviteId.entries()) {
      if (now - dismissedAt > LOBBY_INVITE_TTL_MS * 2) {
        this.dismissedAtByInviteId.delete(id);
      }
    }
  }

  /**
   * Clears all stored invites and dismissal tombstones (used in tests).
   */
  reset(): void {
    this.invites.clear();
    this.dismissedAtByInviteId.clear();
    callerCache.clear();
  }
}

/**
 * Registers the HTTP routes for creating, polling, and dismissing private lobby invites.
 */
export function registerLobbyInviteRoutes(
  app: express.Express,
  optionsOrIsLobbyActive?:
    | ((lobbyId: string) => boolean)
    | LobbyInviteRouteOptions,
): void {
  const options: LobbyInviteRouteOptions =
    typeof optionsOrIsLobbyActive === "function"
      ? { isLobbyActive: optionsOrIsLobbyActive }
      : (optionsOrIsLobbyActive ?? {});
  const isLobbyActive = options.isLobbyActive;
  const isPlayerInLobby = options.isPlayerInLobby;
  const resolveCaller = options.resolveCaller ?? defaultResolveCaller;
  const isTargetEligible = options.isTargetEligible ?? defaultIsTargetEligible;

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

    const caller = await resolveCaller(token, auth.persistentId);
    if (!caller) {
      return res.status(401).json({ error: "Unable to verify caller" });
    }

    if (caller.publicId === parsed.data.targetPublicId) {
      return res.status(400).json({ error: "Cannot invite yourself" });
    }

    if (isLobbyActive && !isLobbyActive(parsed.data.lobbyId)) {
      return res.status(404).json({ error: "Lobby is not open" });
    }

    if (
      isPlayerInLobby &&
      !isPlayerInLobby(parsed.data.lobbyId, auth.persistentId, caller.publicId)
    ) {
      return res.status(403).json({ error: "Caller is not in lobby" });
    }

    const eligible = await isTargetEligible(
      caller,
      parsed.data.targetPublicId,
      token,
    );
    if (!eligible) {
      return res
        .status(403)
        .json({ error: "Target is not an eligible friend or clan member" });
    }

    const invite = LobbyInviteService.instance.createInvite({
      ...parsed.data,
      senderPublicId: caller.publicId,
      senderUsername: caller.username,
    });
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

    const caller = await resolveCaller(token, auth.persistentId);
    if (!caller) {
      return res.status(401).json({ error: "Unable to verify caller" });
    }

    const invites = LobbyInviteService.instance.getInvitesForUser(
      caller.publicId,
      isLobbyActive,
    );
    res.json({ invites, serverTime: Date.now() });
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

    const caller = await resolveCaller(token, auth.persistentId);
    if (!caller) {
      return res.status(401).json({ error: "Unable to verify caller" });
    }

    const ok = LobbyInviteService.instance.dismissInvite(
      caller.publicId,
      parsed.data.inviteId,
    );
    res.json({ ok });
  });
}
