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
  fromCache?: boolean;
};

export type LobbyInviteRouteOptions = {
  isLobbyActive?: (lobbyId: string) => boolean;
  isPlayerInLobby?: (
    lobbyId: string,
    persistentId: string,
    publicId: string,
  ) => boolean;
  getLobbyMeta?: (lobbyId: string) => {
    gameMode?: string;
    map?: string;
    allowedPublicIds?: string[];
    memberPublicIds?: string[];
    isPublic?: boolean;
  } | null;
  isTargetAllowedInLobby?: (
    lobbyId: string,
    targetPublicId: string,
    targetRole?: string | null,
  ) => boolean;
  getLobbyMemberPublicIds?: (
    lobbyId: string,
    callerPersistentId: string,
    callerPublicId: string,
  ) => string[];
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

const CALLER_CACHE_TTL_MS = 600_000; // 10 minutes, avoids frequent /users/@me round-trips for menu-sitting clients
const MAX_CALLER_CACHE_SIZE = 2_000;
const PRUNE_INTERVAL_MS = 30_000;
const callerCache = new Map<
  string,
  { caller: VerifiedCallerIdentity; expiresAt: number }
>();

function pruneCallerCache(now: number = Date.now()): void {
  for (const [key, entry] of callerCache.entries()) {
    if (entry.expiresAt <= now) {
      callerCache.delete(key);
    }
  }
}

/**
 * Resolves the authenticated caller's public identity, friend list, and clan tags via `/users/@me`.
 */
export async function defaultResolveCaller(
  token: string,
): Promise<VerifiedCallerIdentity | null> {
  const now = Date.now();
  const cached = callerCache.get(token);
  if (cached) {
    if (cached.expiresAt > now) {
      callerCache.delete(token);
      callerCache.set(token, cached);
      return { ...cached.caller, fromCache: true };
    }
    callerCache.delete(token);
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
  pruneCallerCache(now);
  while (callerCache.size >= MAX_CALLER_CACHE_SIZE) {
    const oldestKey = callerCache.keys().next().value;
    if (oldestKey === undefined) break;
    callerCache.delete(oldestKey);
  }
  callerCache.set(token, { caller, expiresAt: now + CALLER_CACHE_TTL_MS });
  return caller;
}

const ClanMembersLookupSchema = z
  .object({
    results: z.array(z.object({ publicId: z.string() })).optional(),
    members: z.array(z.object({ publicId: z.string() })).optional(),
    total: z.number().optional(),
    page: z.number().optional(),
    limit: z.number().optional(),
  })
  .refine((data) => data.results !== undefined || data.members !== undefined, {
    message: "Expected results or members array",
  });

/**
 * Fetches all member publicIds for the caller's clans in batch.
 */
async function fetchCallerClanMemberIds(
  caller: VerifiedCallerIdentity,
  token: string,
): Promise<Set<string> | null> {
  const clanMemberIds = new Set<string>();
  for (const tag of caller.clanTags) {
    let page = 1;
    const limit = 50;
    while (true) {
      try {
        const res = await fetch(
          `${ServerEnv.jwtIssuer()}/clans/${encodeURIComponent(tag)}/members?page=${page}&limit=${limit}`,
          {
            headers: {
              authorization: `Bearer ${token}`,
              "x-api-key": ServerEnv.apiKey(),
            },
          },
        );
        if (!res.ok) return null;
        const parsed = ClanMembersLookupSchema.safeParse(await res.json());
        if (!parsed.success) return null;
        const list = parsed.data.results ?? parsed.data.members;
        if (!list) return null;
        for (const m of list) {
          if (m.publicId) {
            clanMemberIds.add(m.publicId);
          }
        }
        const total = parsed.data.total ?? list.length;
        if (list.length < limit || page * limit >= total) {
          break;
        }
        page += 1;
      } catch {
        return null;
      }
    }
  }
  return clanMemberIds;
}

/**
 * Error indicating that an upstream service failed while verifying clan membership.
 */
export class ClanLookupError extends Error {
  constructor(message: string = "Failed to verify clan membership") {
    super(message);
    this.name = "ClanLookupError";
  }
}

/**
 * Checks whether the target player is in any of the caller's clans, stopping pagination
 * as soon as the target is found. Throws ClanLookupError if upstream requests fail before
 * membership can be determined.
 */
async function isTargetInCallerClans(
  caller: VerifiedCallerIdentity,
  targetPublicId: string,
  token: string,
): Promise<boolean> {
  if (caller.clanTags.length === 0) {
    return false;
  }
  for (const tag of caller.clanTags) {
    let page = 1;
    const limit = 50;
    while (true) {
      let res: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        res = await fetch(
          `${ServerEnv.jwtIssuer()}/clans/${encodeURIComponent(tag)}/members?page=${page}&limit=${limit}`,
          {
            signal: controller.signal,
            headers: {
              authorization: `Bearer ${token}`,
              "x-api-key": ServerEnv.apiKey(),
            },
          },
        );
      } catch (err) {
        throw new ClanLookupError(
          `Network error fetching clan members: ${String(err)}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        throw new ClanLookupError(
          `Upstream clan service returned HTTP ${res.status}`,
        );
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        throw new ClanLookupError(
          `Invalid JSON from clan service: ${String(err)}`,
        );
      }

      const parsed = ClanMembersLookupSchema.safeParse(json);
      if (!parsed.success) {
        throw new ClanLookupError("Invalid clan members response schema");
      }

      const list = parsed.data.results ?? parsed.data.members;
      if (!list) {
        throw new ClanLookupError("Missing clan members list in response");
      }

      if (list.some((m) => m.publicId === targetPublicId)) {
        return true;
      }

      const total = parsed.data.total ?? list.length;
      if (list.length < limit || page * limit >= total) {
        break;
      }
      page += 1;
    }
  }
  return false;
}

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
  return isTargetInCallerClans(caller, targetPublicId, token);
}

function isLobbyInviteForbidden(
  lobbyMeta: { isPublic?: boolean; gameMode?: string } | null,
): boolean {
  return Boolean(lobbyMeta?.isPublic && lobbyMeta?.gameMode !== "Team");
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
  // Secondary index mapping lobbyId -> active invite IDs for O(k) lobby cleanup
  private invitesByLobbyId = new Map<string, Set<string>>();
  // Maps logical invite key (lobbyId:senderPublicId:targetPublicId) -> active invite id
  private inviteIdByLogicalKey = new Map<string, string>();
  // Maps any known invite id -> logical invite key so dismissals by either id resolve the logical invite
  private logicalKeyByInviteId = new Map<string, string>();
  // Tracks the latest dismissal timestamp per invite id and per logical key so stale IPC refreshes cannot resurrect dismissed invites
  private dismissedAtByInviteId = new Map<string, number>();
  private dismissedAtByLogicalKey = new Map<string, number>();
  // Tracks explicit player dismissal timestamp per logical key for cooldown enforcement (distinguished from cleanup tombstones)
  private explicitDismissCooldownByLogicalKey = new Map<string, number>();
  // Retains target-scoped dismissals that arrive before the invite itself, keyed by inviteId -> targetPublicId -> dismissedAt
  private pendingDismissalsByInviteId = new Map<string, Map<string, number>>();
  private targetPublicIdByInviteId = new Map<string, string>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  private onInviteAdded?: (invite: LobbyInvite) => void;
  private onInviteDismissed?: (inviteId: string, dismissedAt: number) => void;
  private onUnresolvedInviteDismissed?: (
    inviteId: string,
    dismissedAt: number,
    targetPublicId: string,
  ) => void;

  constructor() {
    this.startPruning();
  }

  /**
   * Starts a background timer that periodically prunes expired invites, tombstones, and caller cache entries.
   */
  startPruning(intervalMs: number = PRUNE_INTERVAL_MS): void {
    if (this.pruneTimer !== null) return;
    this.pruneTimer = setInterval(() => {
      this.pruneExpired();
    }, intervalMs);
    this.pruneTimer.unref?.();
  }

  private logicalKey(
    invite: Pick<LobbyInvite, "lobbyId" | "senderPublicId" | "targetPublicId">,
  ): string {
    return `${invite.lobbyId}:${invite.senderPublicId}:${invite.targetPublicId}`;
  }

  private indexInvite(invite: LobbyInvite): void {
    let lobbySet = this.invitesByLobbyId.get(invite.lobbyId);
    if (!lobbySet) {
      lobbySet = new Set<string>();
      this.invitesByLobbyId.set(invite.lobbyId, lobbySet);
    }
    lobbySet.add(invite.id);
    const key = this.logicalKey(invite);
    this.inviteIdByLogicalKey.set(key, invite.id);
    this.logicalKeyByInviteId.set(invite.id, key);
    this.targetPublicIdByInviteId.set(invite.id, invite.targetPublicId);
  }

  getInviteTarget(inviteId: string): string | undefined {
    return (
      this.invites.get(inviteId)?.targetPublicId ??
      this.targetPublicIdByInviteId.get(inviteId)
    );
  }

  private unindexInvite(invite: LobbyInvite): void {
    const lobbySet = this.invitesByLobbyId.get(invite.lobbyId);
    if (lobbySet) {
      lobbySet.delete(invite.id);
      if (lobbySet.size === 0) {
        this.invitesByLobbyId.delete(invite.lobbyId);
      }
    }
    const key = this.logicalKey(invite);
    if (this.inviteIdByLogicalKey.get(key) === invite.id) {
      this.inviteIdByLogicalKey.delete(key);
    }
    if (
      !this.inviteIdByLogicalKey.has(key) &&
      !this.dismissedAtByInviteId.has(invite.id)
    ) {
      this.logicalKeyByInviteId.delete(invite.id);
    }
  }

  /**
   * Registers IPC broadcaster callbacks invoked when invites are created, refreshed, or dismissed.
   */
  setBroadcasters(
    onInviteAdded: (invite: LobbyInvite) => void,
    onInviteDismissed: (inviteId: string, dismissedAt: number) => void,
    onUnresolvedInviteDismissed?: (
      inviteId: string,
      dismissedAt: number,
      targetPublicId: string,
    ) => void,
  ): void {
    this.onInviteAdded = onInviteAdded;
    this.onInviteDismissed = onInviteDismissed;
    this.onUnresolvedInviteDismissed = onUnresolvedInviteDismissed;
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
  ): LobbyInvite | null {
    this.pruneExpired();

    const now = Date.now();
    const key = this.logicalKey(input);

    const dismissedAt = this.explicitDismissCooldownByLogicalKey.get(key);
    if (dismissedAt !== undefined && now < dismissedAt + ttlMs) {
      return null;
    }

    const existingId = this.inviteIdByLogicalKey.get(key);
    const existing = existingId ? this.invites.get(existingId) : undefined;
    if (existing && existing.expiresAt > now) {
      return existing;
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
    this.dismissedAtByLogicalKey.delete(key);
    this.explicitDismissCooldownByLogicalKey.delete(key);
    this.pendingDismissalsByInviteId.delete(invite.id);
    this.indexInvite(invite);
    this.onInviteAdded?.(invite);
    return invite;
  }

  /**
   * Returns remaining cooldown in milliseconds if an invite between sender and target for lobby is on dismissal cooldown, or 0.
   */
  getInviteCooldownRemainingMs(
    input: SendLobbyInviteInput & { senderPublicId: string },
    now = Date.now(),
    ttlMs: number = LOBBY_INVITE_TTL_MS,
  ): number {
    const key = this.logicalKey(input);
    const dismissedAt = this.explicitDismissCooldownByLogicalKey.get(key);
    if (dismissedAt !== undefined && now < dismissedAt + ttlMs) {
      return dismissedAt + ttlMs - now;
    }
    return 0;
  }

  /**
   * Adds or updates an invite received from another worker or master process, reconciling concurrent logical creates and rejecting expired or stale dismissed refreshes.
   */
  addExternalInvite(invite: LobbyInvite): boolean {
    const key = this.logicalKey(invite);

    const pendingTargets = this.pendingDismissalsByInviteId.get(invite.id);
    if (pendingTargets !== undefined) {
      const pendingDismissedAt = pendingTargets.get(invite.targetPublicId);
      if (pendingDismissedAt !== undefined) {
        pendingTargets.delete(invite.targetPublicId);
        if (pendingTargets.size === 0) {
          this.pendingDismissalsByInviteId.delete(invite.id);
        }
        const prevId = this.dismissedAtByInviteId.get(invite.id) ?? 0;
        this.dismissedAtByInviteId.set(
          invite.id,
          Math.max(prevId, pendingDismissedAt),
        );
        const prevKey = this.dismissedAtByLogicalKey.get(key) ?? 0;
        this.dismissedAtByLogicalKey.set(
          key,
          Math.max(prevKey, pendingDismissedAt),
        );

        // Also clean up any active invite for the same logical key if predated
        const existingLogicalId = this.inviteIdByLogicalKey.get(key);
        const existingLogical = existingLogicalId
          ? this.invites.get(existingLogicalId)
          : undefined;
        let removedActiveId: string | undefined;
        if (
          existingLogical &&
          existingLogical.createdAt <= pendingDismissedAt
        ) {
          removedActiveId = existingLogical.id;
          this.unindexInvite(existingLogical);
          this.invites.delete(existingLogical.id);
          this.onInviteDismissed?.(existingLogical.id, pendingDismissedAt);
        }
        if (removedActiveId !== invite.id) {
          this.onInviteDismissed?.(invite.id, pendingDismissedAt);
        }
      }
    }

    if (invite.expiresAt <= Date.now()) {
      return false;
    }

    const dismissedById = this.dismissedAtByInviteId.get(invite.id);
    const dismissedByKey = this.dismissedAtByLogicalKey.get(key);
    const dismissedAt =
      dismissedById !== undefined && dismissedByKey !== undefined
        ? Math.max(dismissedById, dismissedByKey)
        : (dismissedById ?? dismissedByKey);
    if (dismissedAt !== undefined) {
      if (invite.createdAt <= dismissedAt) {
        return false;
      }
      this.dismissedAtByInviteId.delete(invite.id);
      this.dismissedAtByLogicalKey.delete(key);
    }

    const existingById = this.invites.get(invite.id);
    if (existingById && existingById.createdAt > invite.createdAt) {
      return false;
    }

    const existingLogicalId = this.inviteIdByLogicalKey.get(key);
    const existingLogical =
      existingLogicalId && existingLogicalId !== invite.id
        ? this.invites.get(existingLogicalId)
        : undefined;
    if (existingLogical) {
      const incomingWins =
        invite.createdAt > existingLogical.createdAt ||
        (invite.createdAt === existingLogical.createdAt &&
          invite.id > existingLogical.id);
      if (!incomingWins) {
        this.logicalKeyByInviteId.set(invite.id, key);
        return false;
      }
      this.unindexInvite(existingLogical);
      this.invites.delete(existingLogical.id);
    }

    if (existingById) {
      this.unindexInvite(existingById);
    }
    this.invites.set(invite.id, invite);
    this.indexInvite(invite);
    if (existingLogical) {
      this.logicalKeyByInviteId.set(existingLogical.id, key);
    }
    return true;
  }

  /**
   * Dismisses an invite owned by `targetPublicId` and broadcasts the dismissal.
   */
  dismissInvite(targetPublicId: string, inviteId: string): boolean {
    const key = this.logicalKeyByInviteId.get(inviteId);
    const logicalActiveId = key
      ? this.inviteIdByLogicalKey.get(key)
      : undefined;
    const invite =
      this.invites.get(inviteId) ??
      (logicalActiveId ? this.invites.get(logicalActiveId) : undefined);

    if (!invite) {
      if (key && targetPublicId) {
        let targets = this.pendingDismissalsByInviteId.get(inviteId);
        if (!targets) {
          targets = new Map<string, number>();
          this.pendingDismissalsByInviteId.set(inviteId, targets);
        }
        const now = Date.now();
        const prev = targets.get(targetPublicId) ?? 0;
        targets.set(targetPublicId, Math.max(prev, now));
        this.onUnresolvedInviteDismissed?.(inviteId, now, targetPublicId);
        return true;
      }
      return false;
    }

    if (invite.targetPublicId !== targetPublicId) return false;
    const now = Date.now();
    const effectiveKey = this.logicalKey(invite);
    this.unindexInvite(invite);
    this.invites.delete(invite.id);
    this.invites.delete(inviteId);
    this.dismissedAtByInviteId.set(invite.id, now);
    this.dismissedAtByInviteId.set(inviteId, now);
    this.dismissedAtByLogicalKey.set(effectiveKey, now);
    this.explicitDismissCooldownByLogicalKey.set(effectiveKey, now);
    this.onInviteDismissed?.(inviteId, now);
    if (invite.id !== inviteId) {
      this.onInviteDismissed?.(invite.id, now);
    }
    return true;
  }

  /**
   * Records an external invite dismissal from IPC so stale refreshes older than `dismissedAt` are ignored, returning the resolved active invite ID or `false` if rejected.
   */
  dismissExternalInvite(
    inviteId: string,
    dismissedAt: number = Date.now(),
    targetPublicId?: string,
    isExplicit = false,
  ): string | false {
    const key = this.logicalKeyByInviteId.get(inviteId);
    const logicalActiveId = key
      ? this.inviteIdByLogicalKey.get(key)
      : undefined;
    const existing =
      this.invites.get(inviteId) ??
      (logicalActiveId ? this.invites.get(logicalActiveId) : undefined);

    if (targetPublicId !== undefined) {
      if (existing) {
        if (existing.targetPublicId !== targetPublicId) {
          return false;
        }
      } else {
        let targets = this.pendingDismissalsByInviteId.get(inviteId);
        if (!targets) {
          targets = new Map<string, number>();
          this.pendingDismissalsByInviteId.set(inviteId, targets);
        }
        const prev = targets.get(targetPublicId) ?? 0;
        targets.set(targetPublicId, Math.max(prev, dismissedAt));
        return inviteId;
      }
    }

    const resolvedInviteId = existing ? existing.id : inviteId;
    const prev = this.dismissedAtByInviteId.get(inviteId) ?? 0;
    const effectiveDismissedAt = Math.max(prev, dismissedAt);
    this.dismissedAtByInviteId.set(inviteId, effectiveDismissedAt);
    this.dismissedAtByInviteId.set(resolvedInviteId, effectiveDismissedAt);

    const effectiveKey = existing ? this.logicalKey(existing) : key;
    if (effectiveKey) {
      const prevKey = this.dismissedAtByLogicalKey.get(effectiveKey) ?? 0;
      this.dismissedAtByLogicalKey.set(
        effectiveKey,
        Math.max(prevKey, effectiveDismissedAt),
      );
      if (isExplicit) {
        const prevCooldown =
          this.explicitDismissCooldownByLogicalKey.get(effectiveKey) ?? 0;
        this.explicitDismissCooldownByLogicalKey.set(
          effectiveKey,
          Math.max(prevCooldown, effectiveDismissedAt),
        );
      }
    }

    if (existing && existing.createdAt <= effectiveDismissedAt) {
      this.unindexInvite(existing);
      this.invites.delete(existing.id);
      this.dismissedAtByInviteId.set(existing.id, effectiveDismissedAt);
    }
    return resolvedInviteId;
  }

  /**
   * Removes all invites targeting a specific lobby when that lobby starts or closes.
   */
  removeInvitesForLobby(lobbyId: string): void {
    const ids = this.invitesByLobbyId.get(lobbyId);
    if (!ids || ids.size === 0) {
      return;
    }
    const now = Date.now();
    for (const id of [...ids]) {
      const invite = this.invites.get(id);
      if (invite) {
        const key = this.logicalKey(invite);
        this.unindexInvite(invite);
        this.invites.delete(id);
        this.dismissedAtByLogicalKey.set(key, now);
      }
      this.dismissedAtByInviteId.set(id, now);
      this.onInviteDismissed?.(id, now);
    }
    this.invitesByLobbyId.delete(lobbyId);
  }

  /**
   * Removes all active invites whose lobby is owned by `workerId` (e.g. when that worker process exits).
   */
  removeInvitesForWorker(workerId: number): void {
    for (const lobbyId of [...this.invitesByLobbyId.keys()]) {
      if (ServerEnv.workerIndex(lobbyId) === workerId) {
        this.removeInvitesForLobby(lobbyId);
      }
    }
  }

  /**
   * Returns whether there is at least one non-expired invite targeting `lobbyId` created after `minCreatedAt`.
   */
  hasActiveInviteForLobby(lobbyId: string, minCreatedAt?: number): boolean {
    const ids = this.invitesByLobbyId.get(lobbyId);
    if (!ids || ids.size === 0) {
      return false;
    }
    const now = Date.now();
    for (const id of ids) {
      const invite = this.invites.get(id);
      if (
        invite &&
        invite.expiresAt > now &&
        (minCreatedAt === undefined || invite.createdAt > minCreatedAt)
      ) {
        return true;
      }
    }
    return false;
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
          this.unindexInvite(invite);
          this.invites.delete(id);
          continue;
        }
        result.push(invite);
      }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Removes expired invites, stale dismissal tombstones, and expired caller cache entries from memory.
   */
  pruneExpired(): void {
    const now = Date.now();
    pruneCallerCache(now);
    for (const [id, invite] of this.invites.entries()) {
      if (invite.expiresAt <= now) {
        this.unindexInvite(invite);
        this.invites.delete(id);
      }
    }
    for (const [id, dismissedAt] of this.dismissedAtByInviteId.entries()) {
      if (now - dismissedAt > LOBBY_INVITE_TTL_MS * 2) {
        this.dismissedAtByInviteId.delete(id);
        const key = this.logicalKeyByInviteId.get(id);
        if (key && !this.inviteIdByLogicalKey.has(key)) {
          this.logicalKeyByInviteId.delete(id);
        }
      }
    }
    for (const [key, dismissedAt] of this.dismissedAtByLogicalKey.entries()) {
      if (now - dismissedAt > LOBBY_INVITE_TTL_MS * 2) {
        this.dismissedAtByLogicalKey.delete(key);
      }
    }
    for (const [
      key,
      dismissedAt,
    ] of this.explicitDismissCooldownByLogicalKey.entries()) {
      if (now - dismissedAt > LOBBY_INVITE_TTL_MS * 2) {
        this.explicitDismissCooldownByLogicalKey.delete(key);
      }
    }
    for (const [id, targets] of this.pendingDismissalsByInviteId.entries()) {
      for (const [targetPublicId, dismissedAt] of targets.entries()) {
        if (now - dismissedAt > LOBBY_INVITE_TTL_MS * 2) {
          targets.delete(targetPublicId);
        }
      }
      if (targets.size === 0) {
        this.pendingDismissalsByInviteId.delete(id);
      }
    }
    for (const [id, key] of this.logicalKeyByInviteId.entries()) {
      if (
        !this.invites.has(id) &&
        !this.dismissedAtByInviteId.has(id) &&
        !this.inviteIdByLogicalKey.has(key)
      ) {
        this.logicalKeyByInviteId.delete(id);
      }
    }
    for (const id of this.targetPublicIdByInviteId.keys()) {
      if (!this.invites.has(id) && !this.dismissedAtByInviteId.has(id)) {
        this.targetPublicIdByInviteId.delete(id);
      }
    }
  }

  /**
   * Clears all stored invites and dismissal tombstones (used in tests).
   */
  reset(): void {
    this.invites.clear();
    this.invitesByLobbyId.clear();
    this.inviteIdByLogicalKey.clear();
    this.logicalKeyByInviteId.clear();
    this.dismissedAtByInviteId.clear();
    this.dismissedAtByLogicalKey.clear();
    this.explicitDismissCooldownByLogicalKey.clear();
    this.pendingDismissalsByInviteId.clear();
    this.targetPublicIdByInviteId.clear();
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
  const getLobbyMeta = options.getLobbyMeta;
  const isTargetAllowedInLobby = options.isTargetAllowedInLobby;
  const getLobbyMemberPublicIds = options.getLobbyMemberPublicIds;
  const resolveCaller = options.resolveCaller ?? defaultResolveCaller;
  const isTargetEligible = options.isTargetEligible ?? defaultIsTargetEligible;

  const isTargetPermittedByLobby = (
    lobbyId: string,
    targetPublicId: string,
    lobbyMeta?: {
      gameMode?: string;
      map?: string;
      allowedPublicIds?: string[];
      memberPublicIds?: string[];
    } | null,
  ): boolean => {
    if (isTargetAllowedInLobby) {
      return isTargetAllowedInLobby(lobbyId, targetPublicId);
    }
    const meta =
      lobbyMeta !== undefined ? lobbyMeta : (getLobbyMeta?.(lobbyId) ?? null);
    return (
      !meta?.allowedPublicIds?.length ||
      meta.allowedPublicIds.includes(targetPublicId)
    );
  };

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

    let caller = await resolveCaller(token, auth.persistentId);
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

    const initialLobbyMeta = getLobbyMeta?.(parsed.data.lobbyId) ?? null;
    if (isLobbyInviteForbidden(initialLobbyMeta)) {
      return res
        .status(403)
        .json({ error: "Invites are not available for public FFA lobbies" });
    }
    if (
      !isTargetPermittedByLobby(
        parsed.data.lobbyId,
        parsed.data.targetPublicId,
        initialLobbyMeta,
      )
    ) {
      return res
        .status(403)
        .json({ error: "Target is not allowed in this lobby" });
    }

    let eligible: boolean;
    try {
      eligible = await isTargetEligible(
        caller,
        parsed.data.targetPublicId,
        token,
      );
    } catch {
      return res
        .status(502)
        .json({ error: "Failed to verify clan membership" });
    }
    if (!eligible && caller.fromCache) {
      callerCache.delete(token);
      const freshCaller = await resolveCaller(token, auth.persistentId);
      if (freshCaller) {
        caller = freshCaller;
        try {
          eligible = await isTargetEligible(
            caller,
            parsed.data.targetPublicId,
            token,
          );
        } catch {
          return res
            .status(502)
            .json({ error: "Failed to verify clan membership" });
        }
      }
    }
    if (!eligible) {
      return res
        .status(403)
        .json({ error: "Target is not an eligible friend or clan member" });
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

    const lobbyMeta = getLobbyMeta?.(parsed.data.lobbyId) ?? null;
    if (isLobbyInviteForbidden(lobbyMeta)) {
      return res
        .status(403)
        .json({ error: "Invites are not available for public FFA lobbies" });
    }
    if (
      !isTargetPermittedByLobby(
        parsed.data.lobbyId,
        parsed.data.targetPublicId,
        lobbyMeta,
      )
    ) {
      return res
        .status(403)
        .json({ error: "Target is not allowed in this lobby" });
    }

    const invite = LobbyInviteService.instance.createInvite({
      ...parsed.data,
      gameMode: lobbyMeta?.gameMode ?? parsed.data.gameMode,
      map: lobbyMeta?.map ?? parsed.data.map,
      senderPublicId: caller.publicId,
      senderUsername: caller.username,
    });
    if (!invite) {
      const remainingMs =
        LobbyInviteService.instance.getInviteCooldownRemainingMs({
          ...parsed.data,
          senderPublicId: caller.publicId,
        });
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "Invite was recently dismissed or is on cooldown",
        retryAfterMs: remainingMs,
        retryAfterSeconds,
      });
    }
    res.json({ ok: true, invite });
  });

  app.get("/api/lobby/members", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }
    const token = authHeader.substring("Bearer ".length);
    const auth = await verifyClientToken(token);
    if (auth.type !== "success") {
      return res.status(401).json({ error: "Invalid token" });
    }

    const lobbyId =
      typeof req.query?.lobbyId === "string" ? req.query.lobbyId.trim() : "";
    if (!lobbyId) {
      return res
        .status(400)
        .json({ error: "lobbyId query parameter required" });
    }

    const caller = await resolveCaller(token, auth.persistentId);
    if (!caller) {
      return res.status(401).json({ error: "Unable to verify caller" });
    }

    if (isLobbyActive && !isLobbyActive(lobbyId)) {
      return res.status(404).json({ error: "Lobby is not open" });
    }

    if (
      isPlayerInLobby &&
      !isPlayerInLobby(lobbyId, auth.persistentId, caller.publicId)
    ) {
      return res.status(403).json({ error: "Caller is not in lobby" });
    }

    const lobbyMeta = getLobbyMeta?.(lobbyId) ?? null;
    if (isLobbyInviteForbidden(lobbyMeta)) {
      return res.status(403).json({
        error: "Lobby member queries are not available for public FFA lobbies",
      });
    }

    const rawMemberPublicIds = getLobbyMemberPublicIds
      ? getLobbyMemberPublicIds(lobbyId, auth.persistentId, caller.publicId)
      : (lobbyMeta?.memberPublicIds ?? []);

    const nonFriendNonCallerIds = rawMemberPublicIds.filter(
      (id) => id !== caller.publicId && !caller.friends.includes(id),
    );

    let clanMemberIds: Set<string> | null = null;
    if (nonFriendNonCallerIds.length > 0 && caller.clanTags.length > 0) {
      clanMemberIds = await fetchCallerClanMemberIds(caller, token);
      if (clanMemberIds === null) {
        return res
          .status(502)
          .json({ error: "Failed to resolve clan membership" });
      }
    }

    const eligibleMemberPublicIds: string[] = [];
    for (const memberId of rawMemberPublicIds) {
      let isEligible =
        memberId === caller.publicId ||
        caller.friends.includes(memberId) ||
        (clanMemberIds !== null && clanMemberIds.has(memberId));
      if (!isEligible && options.isTargetEligible) {
        try {
          isEligible = await isTargetEligible(caller, memberId, token);
        } catch {
          return res
            .status(502)
            .json({ error: "Failed to resolve clan membership" });
        }
      }
      if (isEligible) {
        eligibleMemberPublicIds.push(memberId);
      }
    }
    res.json({ memberPublicIds: eligibleMemberPublicIds });
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
    if (!ok) {
      return res
        .status(404)
        .json({ error: "Invite not found or not authorized" });
    }
    res.json({ ok: true });
  });
}
