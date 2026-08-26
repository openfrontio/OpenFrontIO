import { createHash } from "crypto";
import ipAnonymize from "ip-anonymize";
import { Logger } from "winston";
import WebSocket from "ws";
import { z } from "zod";
import { ZbContext } from "../../zbin";
import { isAdminRole } from "../core/ApiSchemas";
import { GameEnv } from "../core/configuration/Config";
import { GameType, RankedType } from "../core/game/Game";
import {
  ClientID,
  ClientMessage,
  ClientMessageSchema,
  ClientSendLiveStatsMessage,
  ClientSendWinnerMessage,
  FEATURED_LOBBY_AUTO_START_MS,
  GameConfig,
  GameID,
  GameInfo,
  GameStartInfo,
  GameStartInfoSchema,
  HOSTED_LOBBY_AUTO_START_MS,
  Intent,
  LiveStats,
  LobbyAccent,
  PartialGameRecord,
  PlayerLiveStats,
  PlayerRecord,
  PublicGameType,
  ServerDesyncSchema,
  ServerErrorMessage,
  ServerLobbyInfoMessage,
  ServerNewLobbyMessage,
  ServerPrestartMessageSchema,
  ServerStartGameMessage,
  ServerTurnMessage,
  StampedIntent,
  Tribe,
  Turn,
} from "../core/Schemas";
import { createPartialGameRecord, sanitizeLobbyLabel } from "../core/Util";
import {
  createGameWireContext,
  decodeClientMessageUnvalidated,
  encodeServerMessage,
} from "../core/ZbinWire";
import { archive, finalizeGameRecord } from "./Archive";
import { Client } from "./Client";
import { ClientMsgRateLimiter } from "./ClientMsgRateLimiter";
import { applyGameConfigPatch, hostCheatsEnabled } from "./ConfigPatch";
import { fetchCustomTribes } from "./CustomTribes";
import { friendsLookup, NameVisibility } from "./NameVisibility";
import { ServerEnv } from "./ServerEnv";
import {
  noopMatchTelemetryEmitter,
  type MatchTelemetryEmitter,
  type MatchTelemetryEvent,
  type MatchTelemetryPayloads,
  type MatchTelemetryType,
  type TelemetryPlayerIdentity,
} from "./telemetry/MatchTelemetry";
import { VoteRound } from "./VoteTally";
export enum GamePhase {
  Lobby = "LOBBY",
  Active = "ACTIVE",
  Finished = "FINISHED",
}

// Identity + authority for an intent, supplied by whoever dispatched it: a
// per-connection websocket client, or the trusted admin-bot HTTP API.
export interface IntentActor {
  clientID: ClientID; // stamped onto the intent
  isLobbyCreator: boolean;
  isAdmin: boolean; // role-based admin/root (also true for the admin bot)
  isAdminBot: boolean; // the trusted admin-bot HTTP API
}

// Outcome of dispatching an intent. `status` is an HTTP-style code: 200 on
// success. The admin-bot route maps a non-200 straight to its response; the
// websocket path logs it and drops the message.
export interface IntentOutcome {
  status: number;
  error?: string;
}

export function hashPersistentID(persistentID: string): string {
  return createHash("sha256").update(persistentID).digest("hex");
}

const KICK_REASON_DUPLICATE_SESSION = "kick_reason.duplicate_session";
const KICK_REASON_LOBBY_CREATOR = "kick_reason.lobby_creator";
const KICK_REASON_ADMIN = "kick_reason.admin";
const KICK_REASON_HOST_LEFT = "kick_reason.host_left";
const KICK_REASON_MATCH_CANCELLED = "kick_reason.match_cancelled";
const KICK_REASON_TOO_MUCH_DATA = "kick_reason.too_much_data";

// Messages that speak for a player in the simulation, so a spectator may not
// send them — including hash, which feeds desync agreement. Ping and rejoin
// remain connection housekeeping.
const SPECTATOR_BLOCKED_MESSAGES = new Set([
  "intent",
  "winner",
  "live_stats",
  "hash",
]);
const KICK_REASON_INVALID_MESSAGE = "kick_reason.invalid_message";

export interface GameServerOptions {
  id: string;
  log: Logger;
  createdAt: number;
  gameConfig: GameConfig;
  creatorPersistentID?: string;
  startsAt?: number;
  publicGameType?: PublicGameType;
  // Matchmade team split from the matchmaking assignment: publicIds per
  // team. At start each client is stamped with its team's index.
  matchmakingTeams?: string[][];
}

// Everything a GameServer reaches outside itself for. Production takes the
// defaults; tests substitute the pieces they need to observe or control
// (the archive upload, the tribe fetch, the environment) without mocking
// modules. env and turnIntervalMs are thunks so the value is read when it
// is used, not when the game is created.
export interface GameServerDeps {
  // Hand a finished game's record on for upload. The default stamps the
  // deployment (finalizeGameRecord) first; a test receives the record as the
  // game built it.
  archive: (record: PartialGameRecord) => Promise<void>;
  fetchTribes: typeof fetchCustomTribes;
  env: () => GameEnv;
  turnIntervalMs: () => number;
  telemetry: MatchTelemetryEmitter;
  telemetryBuildHash: string;
}

export function defaultGameServerDeps(): GameServerDeps {
  return {
    archive: (record) => archive(finalizeGameRecord(record)),
    fetchTribes: fetchCustomTribes,
    env: () => ServerEnv.env(),
    turnIntervalMs: () => ServerEnv.turnIntervalMs(),
    telemetry: noopMatchTelemetryEmitter,
    telemetryBuildHash: "DEV",
  };
}

export class GameServer {
  private sentDesyncMessageClients = new Set<ClientID>();

  private intentRateLimiter = new ClientMsgRateLimiter();

  private maxGameDuration = 3 * 60 * 60 * 1000; // 3 hours

  private disconnectedTimeout = 1 * 30 * 1000; // 30 seconds

  private turns: Turn[] = [];
  private intents: StampedIntent[] = [];
  public activeClients: Client[] = [];
  private allClients: Map<ClientID, Client> = new Map();
  // Map persistentID to clientID for reconnection lookup
  private persistentIdToClientId: Map<string, ClientID> = new Map();
  // persistentIDs that have passed authorization (incl. Turnstile) for this
  // game at least once. Survives lobby-phase disconnects, unlike
  // persistentIdToClientId (which is cleared to free up player slots). Lets a
  // reconnecting player skip the single-use Turnstile re-check.
  private admittedPersistentIds: Set<string> = new Set();
  private clientsDisconnectedStatus: Map<ClientID, boolean> = new Map();
  private _hasStarted = false;
  private _startTime: number | null = null;
  private hasReachedMaxPlayerCount: boolean = false;

  private endTurnIntervalID: ReturnType<typeof setInterval> | undefined;

  private lastPingUpdate = 0;

  private winner: ClientSendWinnerMessage | null = null;

  // Note: This can be undefined if accessed before the game starts.
  private gameStartInfo!: GameStartInfo;
  // Wire-only copy of gameStartInfo sent to clients. Identical to
  // gameStartInfo unless disableClanTags is set, in which case clan tags
  // are stripped from players. Archive uses the original gameStartInfo.
  private wireGameStartInfo!: GameStartInfo;

  // clientID dictionary for the binary wire, seeded from gameStartInfo.players
  // at start (clients seed theirs from the same array in the start message).
  // Undefined until the game starts, which is also the last moment either peer
  // can send a dictionary-encoded field.
  private zbinCtx: ZbContext | undefined;

  private log: Logger;

  private _hasPrestarted = false;

  // Purchased bot tribe names drawn for this game, set when the prestart
  // fetch lands (undefined until then / on fetch failure / non-public games).
  private tribes?: Tribe[];

  private kickedPersistentIds: Set<string> = new Set();
  private outOfSyncClients: Set<ClientID> = new Set();

  private isPaused = false;

  private websockets: Set<WebSocket> = new Set();

  private winnerVotes = new VoteRound<ClientSendWinnerMessage>();

  // Per-turn consensus on the live stats snapshot (see handleLiveStats).
  // Tallies are keyed by turn number; an entry is removed once consensus is
  // reached for that turn (or a later one) so the map stays small.
  private liveStatsVotes: Map<
    number,
    { round: VoteRound<LiveStats>; voters: Set<ClientID> }
  > = new Map();
  private latestLiveStats: LiveStats | null = null;
  private static readonly MAX_PENDING_LIVE_STATS_ROUNDS = 20;

  private _hasEnded = false;

  // Whether this private lobby is visible in the public lobby browser.
  // Deliberately kept out of gameConfig so update_game_config can't set it;
  // only the authenticated /api/game/:id/listing endpoint may (it verifies
  // the creator's subscription).
  private listed = false;
  // When the lobby was listed; drives the auto-start deadline. Cleared on
  // delist, so relisting starts a fresh deadline.
  private listedAt?: number;

  // Featured lobbies: a label shown instead of the map name, an accent for the
  // row, and a longer auto-start deadline. Set once at create_game by an
  // authenticated admin bot; deliberately unreachable from update_game_config,
  // like `listed` itself.
  private label?: string;
  private accent?: LobbyAccent;
  private featured = false;

  private lobbyInfoIntervalId: ReturnType<typeof setInterval> | null = null;

  private visibleAt?: number;

  // The successor lobby this game has already spawned, if any. Kept so a
  // repeated create_game?previous= call (e.g. a double click) reuses the same
  // id instead of minting another lobby.
  private successorLobbyId: GameID | null = null;

  private telemetrySequence = 0;
  private telemetryTickCounts = new Map<
    number,
    { observed: number; enqueued: number; dropped: number }
  >();
  private replayArchiveAttempted = false;
  private telemetryFinished = false;

  public readonly id: string;
  public readonly createdAt: number;
  public gameConfig: GameConfig;
  private creatorPersistentID?: string;
  private startsAt?: number;
  private publicGameType?: PublicGameType;
  // Matchmade team split from the matchmaking assignment: publicIds per
  // team. At start each client is stamped with its team's index.
  private matchmakingTeams?: string[][];
  private readonly deps: GameServerDeps;
  // Who may see whose real identity (anonymizeNames / pinned teams / admin
  // clan-tag reveal); shapes the per-viewer lobby roster and start message.
  private readonly names: NameVisibility;

  constructor(opts: GameServerOptions, deps: Partial<GameServerDeps> = {}) {
    this.id = opts.id;
    this.createdAt = opts.createdAt;
    this.gameConfig = opts.gameConfig;
    this.creatorPersistentID = opts.creatorPersistentID;
    this.startsAt = opts.startsAt;
    this.publicGameType = opts.publicGameType;
    this.matchmakingTeams = opts.matchmakingTeams;
    this.deps = { ...defaultGameServerDeps(), ...deps };
    this.names = new NameVisibility({
      gameID: opts.id,
      config: () => this.gameConfig,
      clients: () => this.allClients,
      teamIndex: (c) => this.matchmakingTeamIndex(c),
    });
    this.log = opts.log.child({ gameID: opts.id });
    if (opts.startsAt !== undefined) {
      this.visibleAt = Date.now();
    }
    this.emitTelemetry("match_opened", {
      lobbyCreatedAt: opts.createdAt,
      config: opts.gameConfig,
      publicGameType: opts.publicGameType,
      buildHash: this.deps.telemetryBuildHash,
      instanceId: ServerEnv.instanceId(),
      workerId: ServerEnv.workerId(),
      turnIntervalMs: this.deps.turnIntervalMs(),
    });
  }

  private emitTelemetry<K extends MatchTelemetryType>(
    type: K,
    payload: MatchTelemetryPayloads[K],
    serverTick: number = this.turns.length,
  ): "enqueued" | "dropped" {
    const event = {
      schemaVersion: 1,
      type,
      matchId: this.id,
      sequence: this.telemetrySequence++,
      observedAt: Date.now(),
      serverTick,
      payload,
    } as MatchTelemetryEvent;
    try {
      return this.deps.telemetry.emit(event);
    } catch {
      return "dropped";
    }
  }

  private identityFor(client: Client): TelemetryPlayerIdentity {
    // persistentID is deliberately excluded from telemetry identity.
    return {
      clientId: client.clientID,
      publicId: client.publicId,
    };
  }

  private emitIntentObserved(
    client: Client,
    intent: unknown,
    intentType: string | null,
    outcome: "accepted" | "rejected",
    serverTick: number,
    reasonCode?: string,
    reasonDetail?: string,
  ): void {
    const counts = this.telemetryTickCounts.get(serverTick) ?? {
      observed: 0,
      enqueued: 0,
      dropped: 0,
    };
    counts.observed++;
    const result = this.emitTelemetry(
      "intent_observed",
      {
        identity: this.identityFor(client),
        intentType,
        outcome,
        reasonCode,
        reasonDetail,
        intent,
      },
      serverTick,
    );
    counts[result === "enqueued" ? "enqueued" : "dropped"]++;
    this.telemetryTickCounts.set(serverTick, counts);
  }

  private emitMatchFinished(): void {
    if (this.telemetryFinished) {
      return;
    }
    this.telemetryFinished = true;
    this.emitTelemetry("match_finished", {
      endedAt: Date.now(),
      totalTurns: this.turns.length,
      buildHash: this.deps.telemetryBuildHash,
      replayArchiveAttempted: this.replayArchiveAttempted,
    });
  }

  private get lobbyCreatorID(): ClientID | undefined {
    return this.creatorPersistentID
      ? this.persistentIdToClientId.get(this.creatorPersistentID)
      : undefined;
  }

  public updateGameConfig(gameConfig: Partial<GameConfig>): void {
    applyGameConfigPatch(this.gameConfig, gameConfig);
    // A join whitelist and public listing are mutually exclusive: a listed
    // lobby must be joinable by anyone who finds it in the lobby browser.
    if (
      gameConfig.allowedPublicIds !== undefined &&
      this.listed &&
      this.hasJoinWhitelist()
    ) {
      this.setListed(false);
      this.log.info("delisted lobby: join whitelist enabled");
    }
  }

  // Dispatch a control/gameplay intent from either a websocket client or the
  // trusted admin-bot HTTP API. `actor` carries the authority; the per-intent
  // actions and game-state guards live here. Returns an HTTP-style outcome the
  // caller maps (the bot route -> response, the websocket path -> a log).
  public handleIntent(intent: Intent, actor: IntentActor): IntentOutcome {
    const serverTick = this.turns.length;
    const stamped: StampedIntent = { ...intent, clientID: actor.clientID };
    const finish = (
      outcome: IntentOutcome,
      acceptedReasonCode?: string,
    ): IntentOutcome => {
      if (!actor.isAdminBot) {
        const client = this.allClients.get(actor.clientID);
        if (client !== undefined) {
          const accepted = outcome.status === 200;
          this.emitIntentObserved(
            client,
            stamped,
            stamped.type,
            accepted ? "accepted" : "rejected",
            serverTick,
            accepted ? acceptedReasonCode : String(outcome.status),
            accepted ? undefined : outcome.error,
          );
        }
      }
      return outcome;
    };

    // The admin bot only manages private games.
    if (actor.isAdminBot && this.isPublic()) {
      return finish({
        status: 403,
        error: "admin bot cannot act on public games",
      });
    }

    switch (stamped.type) {
      case "mark_disconnected":
        return finish({
          status: 400,
          error: "mark_disconnected is server-internal",
        });

      case "kick_player": {
        if (!actor.isLobbyCreator && !actor.isAdmin) {
          return finish({
            status: 403,
            error: "only the lobby creator or an admin can kick players",
          });
        }
        // A listed lobby recruits strangers from the public browser; letting
        // the host kick them is a griefing vector. Admins keep the power for
        // moderation. The listed flag survives game start on purpose, so a
        // publicly recruited game stays kick-free like a real public game.
        if (this.isListed() && !actor.isAdmin) {
          return finish({
            status: 403,
            error: "the host cannot kick players in a publicly listed lobby",
          });
        }
        // Resolve the target to a clientID: an explicit clientID, or an account
        // publicId matched against allClients (a superset of activeClients that
        // retains disconnected players), so a disconnected account can still be
        // kicked — its persistentID is banned, blocking rejoin/reconnect.
        let target = stamped.targetClientID;
        if (target === undefined && stamped.targetPublicID !== undefined) {
          target = [...this.allClients.values()].find(
            (c) => c.publicId === stamped.targetPublicID,
          )?.clientID;
        }
        if (target === undefined) {
          return finish({ status: 404, error: "no matching player to kick" });
        }
        if (stamped.clientID === target) {
          return finish({ status: 400, error: "cannot kick yourself" });
        }
        const reason =
          actor.isAdmin && !actor.isLobbyCreator
            ? KICK_REASON_ADMIN
            : KICK_REASON_LOBBY_CREATOR;
        this.log.info("player kicked", {
          kicker: stamped.clientID,
          target,
          isAdmin: actor.isAdmin,
          isAdminBot: actor.isAdminBot,
          gameID: this.id,
        });
        this.kickClient(target, reason);
        return finish({ status: 200 });
      }

      case "update_game_config": {
        if (!actor.isLobbyCreator && !actor.isAdminBot) {
          return finish({
            status: 403,
            error: "only the lobby creator can update game config",
          });
        }
        if (this.isPublic()) {
          return finish({ status: 403, error: "cannot update a public game" });
        }
        if (this.hasStarted()) {
          return finish({ status: 409, error: "game already started" });
        }
        if (stamped.config.gameType === GameType.Public) {
          return finish({
            status: 400,
            error: "cannot change a game to public",
          });
        }
        // Host cheats give the host an asymmetric advantage over players
        // recruited from the lobby browser. Listing is likewise rejected
        // while cheats are on (Worker's listing endpoint), so a listed
        // lobby can never have them.
        if (this.isListed() && hostCheatsEnabled(stamped.config.hostCheats)) {
          return finish({
            status: 409,
            error: "cannot enable host cheats in a publicly listed lobby",
          });
        }
        this.updateGameConfig(stamped.config);
        return finish({ status: 200 });
      }

      case "toggle_game_start_timer": {
        if (!actor.isLobbyCreator && !actor.isAdminBot) {
          return finish({
            status: 403,
            error: "only the lobby creator can start",
          });
        }
        if (this.isPublic()) {
          return finish({ status: 403, error: "cannot start a public game" });
        }
        if (this.hasStarted()) {
          return finish({ status: 409, error: "game already started" });
        }
        if (this.startsAt) {
          this.startsAt = undefined;
        } else {
          this.setStartsAt(
            Date.now() + (this.gameConfig.startDelay ?? 0) * 1000,
          );
        }
        return finish({ status: 200 });
      }

      case "toggle_pause": {
        if (!actor.isLobbyCreator && !actor.isAdminBot) {
          return finish({
            status: 403,
            error: "only the lobby creator can pause",
          });
        }
        if (this.isListed() && !actor.isAdminBot) {
          return finish({
            status: 403,
            error: "the host cannot pause a publicly listed game",
          });
        }
        // Pausing only makes sense once the game is running.
        if (!this.hasStarted()) {
          return finish({ status: 409, error: "game not started" });
        }
        const outcome = finish({ status: 200 });
        // Pausing: flush the intent into a turn before isPaused short-circuits
        // endTurn(). Unpausing: clear the flag first so the next turn runs.
        if (stamped.paused) {
          this.addIntent(stamped);
          this.endTurn();
          this.isPaused = true;
        } else {
          this.isPaused = false;
          this.addIntent(stamped);
          this.endTurn();
        }
        return outcome;
      }

      default: {
        // Gameplay intents: websocket players only, into the turn queue.
        if (actor.isAdminBot) {
          return finish({
            status: 400,
            error: "intent not permitted for admin bot",
          });
        }
        // While paused the intent is accepted at ingress but not queued into a
        // turn; tag it so telemetry can tell it apart from a queued intent.
        const paused = this.isPaused;
        const outcome = finish({ status: 200 }, paused ? "paused" : undefined);
        if (!paused) this.addIntent(stamped);
        return outcome;
      }
    }
  }

  private isKicked(clientID: ClientID): boolean {
    const persistentID = this.allClients.get(clientID)?.persistentID;
    return (
      persistentID !== undefined && this.kickedPersistentIds.has(persistentID)
    );
  }

  // Get existing clientID for this persistentID, or null if new player
  public getClientIdForPersistentId(persistentID: string): ClientID | null {
    const clientID = this.persistentIdToClientId.get(persistentID);
    if (!clientID) return null;
    if (this.kickedPersistentIds.has(persistentID)) return null;
    return clientID;
  }

  // Whether this persistentID has already been admitted (passed Turnstile and
  // other join authorization) for this game. Used to skip the single-use
  // Turnstile re-check when an already-admitted player reconnects. Kicked
  // players are excluded so a kick still forces them back through the gate.
  public wasAdmitted(persistentID: string): boolean {
    if (this.kickedPersistentIds.has(persistentID)) return false;
    return this.admittedPersistentIds.has(persistentID);
  }

  // Screened identity stored for this player's client record, or null if
  // the record (or its reconnect mapping) is gone. Lets the join path skip
  // re-screening a reconnect whose submitted identity is unchanged.
  public storedIdentity(
    persistentID: string,
  ): { username: string; clanTag: string | null } | null {
    const clientID = this.getClientIdForPersistentId(persistentID);
    if (clientID === null) return null;
    const client = this.allClients.get(clientID);
    if (client === undefined) return null;
    return { username: client.username, clanTag: client.clanTag };
  }

  public joinClient(
    client: Client,
  ): "joined" | "kicked" | "rejected" | "not_allowlisted" {
    // e.g. the host left an unstarted lobby and GameManager hasn't pruned
    // it yet.
    if (this._hasEnded) {
      return "rejected";
    }
    if (this.kickedPersistentIds.has(client.persistentID)) {
      return "kicked";
    }

    // OFM: if an allowlist is set, only those publicIds may join. Re-checked on
    // every join attempt. Admins/root bypass it so moderation can reach any
    // private lobby; a kick still applies (checked above).
    if (!this.passesAllowlist(client)) {
      this.log.warn("client not on allowlist, rejecting", {
        clientID: client.clientID,
      });
      return "not_allowlisted";
    }

    // gameStartInfo.players is frozen at start, so a late arrival could never
    // spawn. They used to join as a player anyway; watching is what actually
    // happened to them, so it is what they join as.
    if (this._hasStarted) {
      client.spectator = true;
    }

    // Spectators take no slot: they never spawn, so a full lobby is still
    // watchable and a caster can never displace a player.
    if (
      !client.spectator &&
      this.gameConfig.maxPlayers &&
      this.playerCount() >= this.gameConfig.maxPlayers
    ) {
      this.log.warn(`cannot add client, game full`, {
        clientID: client.clientID,
      });

      client.ws.send(
        encodeServerMessage(
          {
            type: "error",
            error: "full-lobby",
          } satisfies ServerErrorMessage,
          this.zbinCtx,
        ),
      );
      return "rejected";
    }

    this.log.info("client joining game", {
      clientID: client.clientID,
      persistentID: client.persistentID,
      clientIP: ipAnonymize(client.ip),
    });

    // Skipped in dev: local testing (multi-tab, the matchmaking e2e) is
    // inherently same-IP.
    if (
      this.deps.env() !== GameEnv.Dev &&
      this.gameConfig.gameType === GameType.Public &&
      this.activeClients.filter(
        (c) => c.ip === client.ip && c.clientID !== client.clientID,
      ).length >= 3
    ) {
      this.log.warn("cannot add client, already have 3 ips", {
        clientID: client.clientID,
        clientIP: ipAnonymize(client.ip),
      });
      return "rejected";
    }

    if (this.deps.env() === GameEnv.Prod) {
      // Prevent multiple clients from using the same account in prod
      const conflicting = this.activeClients.find(
        (c) =>
          c.persistentID === client.persistentID &&
          c.clientID !== client.clientID,
      );
      if (conflicting !== undefined) {
        this.log.warn("client ids do not match", {
          clientID: client.clientID,
          clientIP: ipAnonymize(client.ip),
          clientPersistentID: client.persistentID,
          existingIP: ipAnonymize(conflicting.ip),
          existingPersistentID: conflicting.persistentID,
        });
        // Kick the existing client instead of the new one, because this was causing issues when
        // a client wanted to replay the game afterwards.
        this.kickClient(conflicting.clientID, KICK_REASON_DUPLICATE_SESSION);
      }
    }

    // Client connection accepted
    this.websockets.add(client.ws);
    this.persistentIdToClientId.set(client.persistentID, client.clientID);
    this.admittedPersistentIds.add(client.persistentID);
    this.activeClients.push(client);
    client.lastPing = Date.now();
    // Registered before the first markClientDisconnected: that call consults the
    // registry to tell a spectator from a player.
    this.allClients.set(client.clientID, client);
    this.markClientDisconnected(client.clientID, false);
    this.emitTelemetry("player_joined", {
      identity: this.identityFor(client),
      joinedAt: Date.now(),
      username: client.username,
      playerType: "human",
      teamIndex: this.matchmakingTeamIndex(client),
    });
    this.addListeners(client);
    this.startLobbyInfoBroadcast();

    if (this.playerCount() >= (this.gameConfig.maxPlayers ?? Infinity)) {
      this.hasReachedMaxPlayerCount = true;
    }

    // In case a client joined the game late and missed the start message.
    if (this._hasStarted) {
      this.sendStartGameMsg(client.ws, 0);
    }

    return "joined";
  }

  // Attempt to reconnect a client by persistentID. Returns true if successful.
  // WebSocket is always updated. Identity updates — already screened by the
  // caller (join_verify, or the local fallback censor) — are applied only
  // before the game has started.
  public rejoinClient(
    ws: WebSocket,
    persistentID: string,
    lastTurn: number = 0,
    identityUpdate?: { username: string; clanTag: string | null },
  ): boolean {
    const clientID = this.getClientIdForPersistentId(persistentID);
    if (!clientID) return false;
    const client = this.allClients.get(clientID);
    if (!client) return false;

    this.websockets.add(ws);
    this.log.info("client rejoining", { clientID, lastTurn });

    // Close old WebSocket to prevent resource leaks
    if (client.ws !== ws) {
      this.websockets.delete(client.ws);
      client.ws.removeAllListeners();
      client.ws.close();
    }

    this.activeClients = this.activeClients.filter(
      (c) => c.clientID !== client.clientID,
    );
    this.activeClients.push(client);
    if (identityUpdate && !this.hasStarted()) {
      // The verified badge vouches for the exact join name — a pre-start
      // identity change under it must drop the badge (the rejoin path skips
      // the Worker's join-time badge validation).
      if (
        identityUpdate.username !== client.username &&
        client.cosmetics?.verified
      ) {
        delete client.cosmetics.verified;
      }
      client.username = identityUpdate.username;
      client.clanTag = identityUpdate.clanTag;
    }
    client.lastPing = Date.now();
    this.markClientDisconnected(client.clientID, false);

    client.ws = ws;
    this.addListeners(client);
    this.startLobbyInfoBroadcast();

    if (this._hasStarted) {
      this.sendStartGameMsg(client.ws, lastTurn);
    }
    return true;
  }

  private addListeners(client: Client) {
    client.ws.removeAllListeners("message");
    client.ws.on("message", async (message: Buffer) => {
      try {
        // Decode and validate in two steps (instead of one parseBytes) so a
        // message that is structurally sound but fails validation — the
        // signature of a buggy or cheating client — can still be attributed
        // to its intent in telemetry, exactly like the JSON path did.
        let raw: ClientMessage;
        try {
          // A Buffer is a Uint8Array and zbin honours its byteOffset.
          raw = decodeClientMessageUnvalidated(message, this.zbinCtx);
        } catch (e) {
          // Corrupt bytes: no readable type, nothing to attribute.
          this.log.warn(`Failed to decode client message, kicking`, {
            clientID: client.clientID,
            error: String(e),
          });
          this.kickClient(client.clientID, KICK_REASON_INVALID_MESSAGE);
          return;
        }
        const parsed = ClientMessageSchema.safeParse(raw);
        if (!parsed.success) {
          const reasonDetail = z.prettifyError(parsed.error);
          if (raw.type === "intent") {
            this.emitIntentObserved(
              client,
              raw.intent,
              typeof raw.intent?.type === "string" ? raw.intent.type : null,
              "rejected",
              this.turns.length,
              KICK_REASON_INVALID_MESSAGE,
              reasonDetail,
            );
          }
          this.log.warn(`Failed to parse client message, kicking`, {
            clientID: client.clientID,
            error: reasonDetail,
          });
          this.kickClient(client.clientID, KICK_REASON_INVALID_MESSAGE);
          return;
        }
        const clientMsg = parsed.data;
        const bytes = message.length;
        const rateResult = this.intentRateLimiter.check(
          client.clientID,
          clientMsg.type,
          bytes,
        );
        if (rateResult === "kick") {
          if (clientMsg.type === "intent") {
            this.emitIntentObserved(
              client,
              { ...clientMsg.intent, clientID: client.clientID },
              clientMsg.intent.type,
              "rejected",
              this.turns.length,
              KICK_REASON_TOO_MUCH_DATA,
            );
          }
          this.log.warn(`Client rate limit exceeded, kicking`, {
            clientID: client.clientID,
            type: clientMsg.type,
          });
          this.kickClient(client.clientID, KICK_REASON_TOO_MUCH_DATA);
          return;
        }
        if (rateResult === "limit") {
          if (clientMsg.type === "intent") {
            this.emitIntentObserved(
              client,
              { ...clientMsg.intent, clientID: client.clientID },
              clientMsg.intent.type,
              "rejected",
              this.turns.length,
              "limit",
            );
          }
          this.log.warn(`Client message rate limit exceeded, dropping`, {
            clientID: client.clientID,
            type: clientMsg.type,
          });
          return;
        }
        // A spectator is not in the simulation, so none of what it sends can be
        // game state. Without this, claiming to spectate is a way past the lobby
        // cap and into the intent stream.
        if (
          client.spectator &&
          SPECTATOR_BLOCKED_MESSAGES.has(clientMsg.type)
        ) {
          this.log.warn(`dropping ${clientMsg.type} from spectator`, {
            clientID: client.clientID,
          });
          return;
        }
        switch (clientMsg.type) {
          case "rejoin": {
            // Client is already connected, no auth required, send start game message if game has started
            if (this._hasStarted) {
              this.sendStartGameMsg(client.ws, clientMsg.lastTurn);
            }
            break;
          }
          case "intent": {
            // Server stamps clientID from the authenticated connection.
            const outcome = this.handleIntent(clientMsg.intent, {
              clientID: client.clientID,
              isLobbyCreator: client.clientID === this.lobbyCreatorID,
              isAdmin: isAdminRole(client.role),
              isAdminBot: false,
            });
            if (outcome.status !== 200) {
              this.log.warn(`intent rejected`, {
                type: clientMsg.intent.type,
                clientID: client.clientID,
                gameID: this.id,
                reason: outcome.error,
              });
            }
            break;
          }
          case "ping": {
            this.lastPingUpdate = Date.now();
            client.lastPing = Date.now();
            break;
          }
          case "hash": {
            client.hashes.set(clientMsg.turnNumber, clientMsg.hash);
            break;
          }
          case "spectate": {
            this.setSpectator(client, clientMsg.spectator);
            break;
          }
          case "winner": {
            this.handleWinner(client, clientMsg);
            break;
          }
          case "live_stats": {
            this.handleLiveStats(client, clientMsg);
            break;
          }
          default: {
            this.log.warn(`Unknown message type: ${(clientMsg as any).type}`, {
              clientID: client.clientID,
            });
            break;
          }
        }
      } catch (error) {
        this.log.info(
          `error handling websocket request in game server: ${error}`,
          {
            clientID: client.clientID,
          },
        );
      }
    });
    client.ws.on("close", () => {
      this.log.info("client disconnected", {
        clientID: client.clientID,
        persistentID: client.persistentID,
      });
      this.handleClientDisconnect(client);
    });
    client.ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        client.ws.close(1002, "WS_ERR_UNEXPECTED_RSV_1");
      }
    });

    // Check if WebSocket already closed before we added the listener (race
    // condition) — the 'close' event has already fired, so the handler above
    // will never run for this client.
    if (client.ws.readyState >= 2) {
      this.log.info("client WebSocket already closing/closed, removing", {
        clientID: client.clientID,
        readyState: client.ws.readyState,
      });
      this.handleClientDisconnect(client);
    }
  }

  private handleClientDisconnect(client: Client) {
    this.websockets.delete(client.ws);
    this.activeClients = this.activeClients.filter(
      (c) => c.clientID !== client.clientID,
    );
    this.checkWinnerAfterElectorateShrink();

    // hasStarted() includes prestart: during the lobby -> game transition
    // clients reconnect, and a host socket closing then must not tear the
    // starting game down.
    if (this.hasStarted()) {
      return;
    }
    // Remove persistentId if the game has not started to prevent going over max players
    this.persistentIdToClientId.delete(client.persistentID);
    // Close lobby when host leaves before game starts: without a host it can
    // never start, and a listed one would haunt the lobby browser and hold
    // the creator's one-listing quota. phase() reports Finished once ended,
    // so GameManager's next tick prunes it.
    if (!this.isPublic() && client.persistentID === this.creatorPersistentID) {
      this.log.info("Host left, closing lobby", {
        gameID: this.id,
      });
      for (const c of [...this.activeClients]) {
        this.kickClient(c.clientID, KICK_REASON_HOST_LEFT);
      }
      this._hasEnded = true;
    }
  }

  public setStartsAt(startsAt: number) {
    this.startsAt = startsAt;
    // Record when the lobby first became visible to players, used to measure lobby fill time.
    this.visibleAt ??= Date.now();
  }

  public numClients(): number {
    return this.activeClients.length;
  }

  public numDesyncedClients(): number {
    return this.outOfSyncClients.size;
  }

  // Matchmade ranked games (1v1/2v2) must start with full attendance: the
  // roster freezes at start(), so a game missing a player would run
  // short-handed only to be voided by the sim (2v2) or hand out a walkover
  // the absent player never contested (1v1). Called at the start deadline;
  // cancels the game and returns true when a matched player never connected.
  public cancelShortHandedMatch(): boolean {
    // Explicitly 1v1/2v2 only — a future ranked type must opt in rather
    // than inherit pre-start cancellation.
    const rankedType = this.gameConfig.rankedType;
    if (
      rankedType !== RankedType.OneVOne &&
      rankedType !== RankedType.TwoVTwo
    ) {
      return false;
    }
    const expected = this.gameConfig.maxPlayers;
    if (expected === undefined || this.playerCount() >= expected) {
      return false;
    }
    this.log.info("cancelling matchmade game, missing players at deadline", {
      gameID: this.id,
      connected: this.playerCount(),
      expected,
    });
    for (const c of [...this.activeClients]) {
      this.kickClient(c.clientID, KICK_REASON_MATCH_CANCELLED);
    }
    // phase() reports Finished once ended, so GameManager's next tick prunes.
    this._hasEnded = true;
    return true;
  }

  public prestart() {
    if (this.hasStarted()) {
      return;
    }
    this._hasPrestarted = true;
    this.fetchTribes();

    const prestartMsg = ServerPrestartMessageSchema.safeParse({
      type: "prestart",
      gameMap: this.gameConfig.gameMap,
      gameMapSize: this.gameConfig.gameMapSize,
    });

    if (!prestartMsg.success) {
      this.log.error("error creating prestart message", {
        error: z.prettifyError(prestartMsg.error).substring(0, 250),
      });
      return;
    }

    const msg = encodeServerMessage(prestartMsg.data, this.zbinCtx);
    this.activeClients.forEach((c) => {
      this.log.info("sending prestart message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  // Public games draw purchased bot tribe names from the API at prestart —
  // its 1.5s timeout fits the 2s prestart->start gap, so the pool is
  // normally in hand when start() builds the game start info. Best effort:
  // on timeout/error the game starts with organic bot names.
  private fetchTribes(): void {
    if (!this.isPublic() || this.gameConfig.bots === 0) {
      return;
    }
    // Logged-in humans only — guests can't own tribe names.
    const players = this.activeClients.flatMap((c) =>
      c.publicId !== undefined
        ? [{ clientId: c.clientID, publicId: c.publicId }]
        : [],
    );
    this.deps
      .fetchTribes(players)
      .then((tribes) => {
        // One tribe per bot: with fewer bots than tribes, drop from the
        // tail (the global-pool slice).
        const used = tribes.slice(0, this.gameConfig.bots);
        if (used.length > 0) {
          this.tribes = used;
        }
      })
      .catch((error) => {
        this.log.warn(`failed to fetch custom tribes: ${error}`);
      });
  }

  private startLobbyInfoBroadcast() {
    if (this._hasStarted || this._hasEnded) {
      return;
    }
    if (this.lobbyInfoIntervalId !== null) {
      return;
    }
    this.broadcastLobbyInfo();
    this.lobbyInfoIntervalId = setInterval(() => {
      if (
        this._hasStarted ||
        this._hasEnded ||
        this.activeClients.length === 0
      ) {
        this.stopLobbyInfoBroadcast();
        return;
      }
      this.broadcastLobbyInfo();
    }, 1000);
  }

  private stopLobbyInfoBroadcast() {
    if (this.lobbyInfoIntervalId === null) {
      return;
    }
    clearInterval(this.lobbyInfoIntervalId);
    this.lobbyInfoIntervalId = null;
  }

  private broadcastLobbyInfo() {
    // Off: same payload for everyone (build once). On: per-recipient.
    const shared = this.gameConfig.anonymizeNames ? null : this.gameInfo();
    this.activeClients.forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        const msg = encodeServerMessage(
          {
            type: "lobby_info",
            lobby: shared ?? this.gameInfo(c.clientID),
            myClientID: c.clientID,
          } satisfies ServerLobbyInfoMessage,
          this.zbinCtx,
        );
        c.ws.send(msg);
      }
    });
  }

  // The worker created a successor lobby for this game (the host asked to
  // reuse the private lobby via create_game?previous=). Remember it so repeat
  // requests reuse the same lobby, and tell everyone still connected its id so
  // they can hop over without re-sharing a link.
  public setSuccessorLobby(gameID: GameID) {
    this.successorLobbyId = gameID;
    this.log.info("successor lobby created", {
      gameID: this.id,
      successorID: gameID,
    });
    this.broadcastNewLobby(gameID);
  }

  public successorLobby(): GameID | null {
    return this.successorLobbyId;
  }

  private broadcastNewLobby(gameID: GameID) {
    const msg = encodeServerMessage(
      {
        type: "new_lobby",
        gameID,
      } satisfies ServerNewLobbyMessage,
      this.zbinCtx,
    );
    this.activeClients.forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  public start() {
    if (this._hasStarted || this._hasEnded) {
      return;
    }
    this._hasStarted = true;
    this._startTime = Date.now();
    // Set last ping to start so we don't immediately stop the game
    // if no client connects/pings.
    this.lastPingUpdate = Date.now();

    const friendsFor = friendsLookup(this.activeClients);

    // allowedPublicIds / nameRevealPublicIds hold account publicIds and are
    // enforced server-side against this.gameConfig (joinClient / seesReal).
    // Keep them out of gameStartInfo: its config goes to every client in the
    // start message and into the publicly downloadable game record.
    const config = { ...this.gameConfig };
    delete config.allowedPublicIds;
    delete config.nameRevealPublicIds;

    const result = GameStartInfoSchema.safeParse({
      gameID: this.id,
      lobbyCreatedAt: this.createdAt,
      visibleAt: this.visibleAt,
      config,
      players: this.activeClients
        .filter((c) => !c.spectator)
        .map((c) => ({
          username: c.username,
          clanTag: c.clanTag ?? null,
          clientID: c.clientID,
          cosmetics: c.cosmetics,
          isLobbyCreator: this.lobbyCreatorID === c.clientID,
          friends: friendsFor(c),
          teamIndex: this.matchmakingTeamIndex(c),
        })),
      tribes: this.tribes,
    });
    if (!result.success) {
      const error = z.prettifyError(result.error);
      this.log.error("Error parsing game start info", { message: error });
      return;
    }
    this.gameStartInfo = result.data satisfies GameStartInfo;
    this.emitTelemetry("match_started", {
      startedAt: this._startTime,
      gameStartInfo: this.gameStartInfo,
      buildHash: this.deps.telemetryBuildHash,
      turnIntervalMs: this.deps.turnIntervalMs(),
    });
    const wireGameStartInfo = {
      ...this.gameStartInfo,
      listed: this.listed,
    };
    this.wireGameStartInfo = this.gameConfig.disableClanTags
      ? {
          ...wireGameStartInfo,
          players: this.gameStartInfo.players.map((p) => ({
            ...p,
            clanTag: null,
          })),
        }
      : wireGameStartInfo;
    // Seed the dictionary from the same players array, in the same order,
    // every client receives in the start message.
    this.zbinCtx = createGameWireContext(this.gameStartInfo.players);

    this.endTurnIntervalID = setInterval(
      () => this.endTurn(),
      this.deps.turnIntervalMs(),
    );
    this.activeClients.forEach((c) => {
      this.log.info("sending start message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      this.sendStartGameMsg(c.ws, 0);
    });
  }

  // Connected clients who will actually play. Spectators are excluded
  // everywhere a "player" is meant: the lobby cap, and gameStartInfo.
  private playerCount(): number {
    return this.activeClients.filter((c) => !c.spectator).length;
  }

  // ONE definition of who the allowlist admits, shared by every path that can
  // put someone in (or seat someone into) this game — joinClient and the lobby
  // Play/Spectate toggle. Admins bypass it so moderation can reach any lobby.
  private passesAllowlist(client: Client): boolean {
    const allowed = this.gameConfig.allowedPublicIds;
    if (allowed === undefined || allowed.length === 0) return true;
    if (isAdminRole(client.role)) return true;
    return client.publicId !== undefined && allowed.includes(client.publicId);
  }

  // Switch a client between playing and watching from the lobby screen. Seating
  // is refused once the game has started (the player list is frozen), when the
  // lobby is full, or when the allowlist does not name them — the toggle must
  // not be a way past either. The allowlist can gain entries AFTER people are in
  // the lobby (update_game_config replaces it), so someone admitted before it
  // was set is not proof they may hold a seat now.
  private setSpectator(client: Client, spectator: boolean): void {
    if (client.spectator === spectator) return;
    if (!spectator) {
      if (this._hasStarted || this._hasEnded) return;
      if (!this.passesAllowlist(client)) return;
      const max = this.gameConfig.maxPlayers;
      if (max !== undefined && this.playerCount() >= max) return;
    }
    client.spectator = spectator;
    // The lobby list is derived from this flag, so everyone's view of who is
    // playing has to be refreshed rather than waiting out the next tick.
    this.broadcastLobbyInfo();
  }

  // The electorate for the winner and live-stats votes. Spectators run the
  // simulation but may not vote, so counting them would raise the bar for a
  // majority without anyone able to meet it: five spectators watching four
  // players make a strict majority of nine unreachable, and the game would
  // never reach consensus, never archive, and never be scored.
  private votingUniqueIPs(): number {
    return new Set(
      this.activeClients.filter((c) => !c.spectator).map((c) => c.ip),
    ).size;
  }

  // Pin a publicId to a team slot after the lobby exists, so a lobby that fills
  // over time can still seat late joiners with their partners.
  // matchmakingTeamIndex resolves against this array live and is only read when
  // gameStartInfo is built at start, so nothing needs recomputing.
  public addMatchmakingPin(
    publicId: string,
    teamIndex: number,
  ):
    | { ok: true; teams: string[][] }
    | { ok: false; status: number; error: string } {
    if (this.matchmakingTeams === undefined) {
      return { ok: false, status: 400, error: "game_not_matchmade" };
    }
    if (this.hasStarted()) {
      return { ok: false, status: 409, error: "game_already_started" };
    }
    if (
      !Number.isInteger(teamIndex) ||
      teamIndex < 0 ||
      teamIndex >= this.matchmakingTeams.length
    ) {
      return { ok: false, status: 400, error: "team_index_out_of_range" };
    }
    const existing = this.matchmakingTeams.findIndex((team) =>
      team.includes(publicId),
    );
    // Idempotent, so a caller retrying after a dropped response converges.
    if (existing === teamIndex) {
      return { ok: true, teams: this.matchmakingTeams };
    }
    if (existing !== -1) {
      return { ok: false, status: 409, error: "player_already_pinned" };
    }
    this.matchmakingTeams[teamIndex].push(publicId);
    return { ok: true, teams: this.matchmakingTeams };
  }

  // Resolves a client to its matchmade team slot (index into
  // matchmakingTeams), or undefined when the game isn't matchmade / the
  // client isn't in the assignment.
  private matchmakingTeamIndex(c: Client): number | undefined {
    const publicId = c.publicId;
    if (this.matchmakingTeams === undefined || publicId === undefined) {
      return undefined;
    }
    const idx = this.matchmakingTeams.findIndex((team) =>
      team.includes(publicId),
    );
    return idx === -1 ? undefined : idx;
  }

  private addIntent(intent: StampedIntent) {
    this.intents.push(intent);
  }

  private sendStartGameMsg(ws: WebSocket, lastTurn: number) {
    // Find which client this websocket belongs to
    const client = this.activeClients.find((c) => c.ws === ws);
    if (!client) {
      this.log.warn("Could not find client for websocket in sendStartGameMsg");
      return;
    }

    this.log.info(`Sending start message to client`, {
      clientID: client.clientID,
      lobbyCreatorID: this.lobbyCreatorID,
      isLobbyCreator: this.lobbyCreatorID === client.clientID,
    });

    try {
      if (ws.readyState !== WebSocket.OPEN) {
        this.log.warn(`WebSocket not open, skipping start message`, {
          clientID: client.clientID,
          readyState: ws.readyState,
        });
        return;
      }
      ws.send(
        encodeServerMessage(
          {
            type: "start",
            turns: this.turns.slice(lastTurn),
            gameStartInfo: this.names.startInfoFor(
              client.clientID,
              isAdminRole(client.role),
              this.gameStartInfo,
              this.wireGameStartInfo,
            ),
            lobbyCreatedAt: this.createdAt,
            myClientID: client.clientID,
          } satisfies ServerStartGameMessage,
          this.zbinCtx,
        ),
      );
    } catch (error) {
      this.log.error(`error sending start message for game ${this.id}`, {
        clientID: client.clientID,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private endTurn() {
    // Skip turn execution if game is paused
    if (this.isPaused) {
      return;
    }

    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];
    const counts = this.telemetryTickCounts.get(pastTurn.turnNumber) ?? {
      observed: 0,
      enqueued: 0,
      dropped: 0,
    };
    this.telemetryTickCounts.delete(pastTurn.turnNumber);
    this.emitTelemetry(
      "turn_committed",
      {
        turnNumber: pastTurn.turnNumber,
        replayIntentCount: pastTurn.intents.length,
        ...counts,
      },
      this.turns.length,
    );

    this.handleSynchronization();
    this.checkDisconnectedStatus();

    const msg = encodeServerMessage(
      {
        type: "turn",
        turn: pastTurn,
      } satisfies ServerTurnMessage,
      this.zbinCtx,
    );
    this.activeClients.forEach((c) => {
      if (c.ws.readyState === c.ws.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  async end() {
    this._hasEnded = true;
    // Close all WebSocket connections
    if (this.endTurnIntervalID) {
      clearInterval(this.endTurnIntervalID);
      this.endTurnIntervalID = undefined;
    }
    this.websockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "game has ended");
      }
    });
    if (!this._hasPrestarted && !this._hasStarted) {
      this.log.info(`game not started, not archiving game`);
      this.emitMatchFinished();
      return;
    }
    this.log.info(`ending game with ${this.turns.length} turns`);
    try {
      if (this.allClients.size === 0) {
        this.log.info("no clients joined, not archiving game", {
          gameID: this.id,
        });
      } else if (this.winner !== null) {
        this.log.info("game already archived", {
          gameID: this.id,
        });
      } else {
        this.archiveGame();
      }
    } catch (error) {
      let errorDetails;
      if (error instanceof Error) {
        errorDetails = {
          message: error.message,
          stack: error.stack,
        };
      } else if (Array.isArray(error)) {
        errorDetails = error; // Now we'll actually see the array contents
      } else {
        try {
          errorDetails = JSON.stringify(error, null, 2);
        } catch (e) {
          errorDetails = String(error);
        }
      }

      this.log.error("Error archiving game record details:", {
        gameId: this.id,
        errorType: typeof error,
        error: errorDetails,
      });
    }
    this.emitMatchFinished();
  }

  phase(): GamePhase {
    // An ended game (e.g. an unstarted lobby whose host left) must report
    // Finished: GameManager prunes on Finished, and a ghost that kept
    // reporting Lobby would stay advertised in the lobby browser and hold
    // the creator's one-listing quota until the max-duration cutoff.
    if (this._hasEnded) {
      return GamePhase.Finished;
    }
    const now = Date.now();
    const alive: Client[] = [];
    for (const client of this.activeClients) {
      if (now - client.lastPing > 60_000) {
        this.log.info("no pings received, terminating connection", {
          clientID: client.clientID,
          persistentID: client.persistentID,
        });
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close(1000, "no heartbeats received, closing connection");
        }
      } else {
        alive.push(client);
      }
    }
    // On an abrupt network drop the ws 'close' event can lag far behind this
    // ping prune, so re-check the winner vote here too.
    const pruned = alive.length < this.activeClients.length;
    this.activeClients = alive;
    if (pruned) {
      this.checkWinnerAfterElectorateShrink();
    }
    if (now > this.createdAt + this.maxGameDuration) {
      this.log.warn("game past max duration", {
        gameID: this.id,
      });
      return GamePhase.Finished;
    }

    const noRecentPings = now > this.lastPingUpdate + 20 * 1000;
    const noActive = this.activeClients.length === 0;

    const lessThanLifetime = this.startsAt ? Date.now() < this.startsAt : true;
    if (
      lessThanLifetime &&
      !this.hasStarted() &&
      !this.hasReachedMaxPlayerCount
    ) {
      return GamePhase.Lobby;
    }
    const warmupOver = now > this.startsAt! + 30 * 1000;
    if (noActive && warmupOver && noRecentPings) {
      return GamePhase.Finished;
    }

    return GamePhase.Active;
  }

  hasStarted(): boolean {
    return this._hasStarted || this._hasPrestarted;
  }

  // Omitting viewer (e.g. the HTTP /api/game/:id and link-preview routes)
  // anonymizes all names when the option is on.
  public gameInfo(viewer?: ClientID): GameInfo {
    return {
      gameID: this.id,
      clients: this.names.lobbyClients(viewer, this.activeClients),
      lobbyCreatorClientID: this.lobbyCreatorID,
      gameConfig: this.gameConfig,
      startsAt: this.startsAt,
      serverTime: Date.now(),
      publicGameType: this.publicGameType,
      listed: this.isPublic() ? undefined : this.listed,
      autoStartAt: this.autoStartAt(),
      label: this.label,
      accent: this.accent,
      featured: this.featured ? true : undefined,
    };
  }

  public isPublic(): boolean {
    return this.gameConfig.gameType === GameType.Public;
  }

  public isListed(): boolean {
    return this.listed;
  }

  /** Who joined, and the account behind each one.
   *
   *  The public game record is PII-stripped, so a clientID can only be tied back
   *  to an account by whoever ran the lobby. Without this a host can see that 96
   *  people played and identify none of them. Restricted to lobbies the admin bot
   *  created — never a public or matchmade game.
   *
   *  allClients, not activeClients: someone who joined and left still appears in
   *  the record the host has to reconcile against. */
  public roster(): {
    clientID: ClientID;
    publicId: string | undefined;
    username: string;
  }[] {
    return [...this.allClients.values()].map((c) => ({
      clientID: c.clientID,
      publicId: c.publicId,
      username: c.username,
    }));
  }

  public setListed(listed: boolean): void {
    if (this.listed === listed) {
      // Duplicate toggles must not extend the auto-start deadline.
      return;
    }
    this.listed = listed;
    this.listedAt = listed ? Date.now() : undefined;
  }

  // Deadline after which a listed lobby starts automatically, so hosts
  // can't sit on a public listing indefinitely.
  public autoStartAt(): number | undefined {
    if (!this.listed || this.listedAt === undefined) return undefined;
    return (
      this.listedAt +
      (this.featured
        ? FEATURED_LOBBY_AUTO_START_MS
        : HOSTED_LOBBY_AUTO_START_MS)
    );
  }

  public isFeatured(): boolean {
    return this.featured;
  }

  public lobbyLabel(): string | undefined {
    return this.label;
  }

  public lobbyAccent(): LobbyAccent | undefined {
    return this.accent;
  }

  // Only create_game calls this. A label is sanitised at the boundary so no
  // unsanitised text can exist on a GameServer at all.
  public setFeatured(opts: { label?: string; accent?: LobbyAccent }): void {
    this.featured = true;
    const label = opts.label ? sanitizeLobbyLabel(opts.label) : "";
    this.label = label.length > 0 ? label : undefined;
    this.accent = opts.accent;
  }

  // Called from GameManager's tick while in the Lobby phase: once the
  // listed deadline passes, arm the normal start countdown (same path as
  // the host's Start button). Cancelling the countdown re-arms it on the
  // next tick, so the only way out is to unlist.
  public maybeAutoStartListed(): void {
    if (this.hasStarted() || this.startsAt !== undefined) {
      return;
    }
    const deadline = this.autoStartAt();
    if (deadline === undefined || Date.now() < deadline) {
      return;
    }
    this.log.info("listed lobby reached auto-start deadline, starting", {
      gameID: this.id,
    });
    this.setStartsAt(Date.now() + (this.gameConfig.startDelay ?? 0) * 1000);
  }

  // Whether joining is restricted to an allowlist of publicIds. A lobby with
  // a join whitelist must not be publicly listed (it would advertise a lobby
  // that rejects every joiner).
  public hasJoinWhitelist(): boolean {
    return (this.gameConfig.allowedPublicIds?.length ?? 0) > 0;
  }

  // Whether any host-only cheat is actually granted. A lobby with host
  // cheats must not be publicly listed.
  public hasHostCheats(): boolean {
    return hostCheatsEnabled(this.gameConfig.hostCheats);
  }

  public isCreator(persistentId: string): boolean {
    return (
      this.creatorPersistentID !== undefined &&
      this.creatorPersistentID === persistentId
    );
  }

  // Hash of the creator's persistentID, safe to share between master and
  // workers (never sent to browsers) for the one-listed-lobby-per-creator
  // check. The raw persistentID must not leave this class.
  public hashedCreatorID(): string | undefined {
    return this.creatorPersistentID === undefined
      ? undefined
      : hashPersistentID(this.creatorPersistentID);
  }

  public kickClient(
    clientID: ClientID,
    reasonKey: string = KICK_REASON_DUPLICATE_SESSION,
  ): void {
    if (this.isKicked(clientID)) {
      this.log.warn(`cannot kick client, already kicked`, {
        clientID,
        reasonKey,
      });
      return;
    }

    const clientToKick = this.allClients.get(clientID);
    if (!clientToKick) {
      this.log.warn(`cannot kick client, not found in game`, {
        clientID,
        reasonKey,
      });
      return;
    }

    this.kickedPersistentIds.add(clientToKick.persistentID);

    const client = this.activeClients.find((c) => c.clientID === clientID);
    if (client) {
      this.log.info("Kicking client from game", {
        clientID: client.clientID,
        persistentID: client.persistentID,
        reasonKey,
      });
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          encodeServerMessage(
            {
              type: "error",
              error: reasonKey,
            } satisfies ServerErrorMessage,
            this.zbinCtx,
          ),
        );
        client.ws.close(1000, reasonKey);
      }
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID !== clientID,
      );
    } else {
      this.log.warn(`cannot kick client, not found in game`, {
        clientID,
        reasonKey,
      });
    }
  }

  private checkDisconnectedStatus() {
    if (this.turns.length % 5 !== 0) {
      return;
    }

    const now = Date.now();
    for (const [clientID, client] of this.allClients) {
      const isDisconnected = this.isClientDisconnected(clientID);
      if (!isDisconnected && now - client.lastPing > this.disconnectedTimeout) {
        this.markClientDisconnected(clientID, true);
      } else if (
        isDisconnected &&
        now - client.lastPing < this.disconnectedTimeout
      ) {
        this.markClientDisconnected(clientID, false);
      }
    }
  }

  public isClientDisconnected(clientID: string): boolean {
    return this.clientsDisconnectedStatus.get(clientID) ?? true;
  }

  private markClientDisconnected(clientID: string, isDisconnected: boolean) {
    this.clientsDisconnectedStatus.set(clientID, isDisconnected);
    // Connection status is tracked for every client, but only a player's reaches
    // the simulation: a spectator has no entry in gameStartInfo.players, so an
    // intent naming them refers to nobody — and it is kept in the archived turn
    // log, where readers take mark_disconnected as a player having dropped.
    if (this.allClients.get(clientID)?.spectator) return;
    this.addIntent({
      type: "mark_disconnected",
      clientID: clientID,
      isDisconnected: isDisconnected,
    });
  }

  private archiveGame() {
    this.log.info("archiving game", {
      gameID: this.id,
      winner: this.winner?.winner,
    });

    // Players must stay in the same order as the game start info.
    const playerRecords: PlayerRecord[] = this.gameStartInfo.players.map(
      (player) => {
        const stats = this.winner?.allPlayersStats[player.clientID];
        if (stats === undefined) {
          this.log.warn(`Unable to find stats for clientID ${player.clientID}`);
        }
        return {
          clientID: player.clientID,
          username: player.username,
          clanTag: player.clanTag,
          persistentID:
            this.allClients.get(player.clientID)?.persistentID ?? "",
          stats,
          cosmetics: player.cosmetics,
          // Simulation inputs: teamIndex pins matchmade teams, friends bias
          // team grouping, isLobbyCreator gates host cheats. Replays rebuild
          // GameStartInfo from these records, so dropping any of them makes
          // the replay diverge from the recorded hashes (desync errors).
          teamIndex: player.teamIndex,
          friends: player.friends,
          isLobbyCreator: player.isLobbyCreator,
        } satisfies PlayerRecord;
      },
    );
    this.replayArchiveAttempted = true;
    this.deps.archive(
      createPartialGameRecord(
        this.id,
        this.gameStartInfo.config,
        playerRecords,
        this.turns,
        this._startTime ?? 0,
        Date.now(),
        this.winner?.winner,
        this.createdAt,
        this.visibleAt,
        this.gameStartInfo.tribes,
      ),
    );
  }

  private handleSynchronization() {
    if (this.activeClients.length <= 1) {
      return;
    }
    if (this.turns.length % 10 !== 0 || this.turns.length < 10) {
      // Check hashes every 10 turns
      return;
    }

    const lastHashTurn = this.turns.length - 10;

    const { mostCommonHash, outOfSyncClients } =
      this.findOutOfSyncClients(lastHashTurn);

    if (outOfSyncClients.length === 0) {
      this.turns[lastHashTurn].hash = mostCommonHash;
      return;
    }

    const serverDesync = ServerDesyncSchema.safeParse({
      type: "desync",
      turn: lastHashTurn,
      correctHash: mostCommonHash,
      clientsWithCorrectHash:
        this.activeClients.length - outOfSyncClients.length,
      totalActiveClients: this.activeClients.length,
    });
    if (!serverDesync.success) {
      this.log.warn("failed to create desync message", {
        gameID: this.id,
        error: serverDesync.error,
      });
      return;
    }

    const desyncMsg = encodeServerMessage(serverDesync.data, this.zbinCtx);
    for (const c of outOfSyncClients) {
      this.outOfSyncClients.add(c.clientID);
      if (this.sentDesyncMessageClients.has(c.clientID)) {
        continue;
      }
      this.sentDesyncMessageClients.add(c.clientID);
      this.log.info("sending desync to client", {
        gameID: this.id,
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(desyncMsg);
      }
    }
  }

  findOutOfSyncClients(turnNumber: number): {
    mostCommonHash: number | null;
    outOfSyncClients: Client[];
  } {
    const counts = new Map<number, number>();

    // Count occurrences of each hash
    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const clientHash = client.hashes.get(turnNumber)!;
        counts.set(clientHash, (counts.get(clientHash) ?? 0) + 1);
      }
    }

    // Find the most common hash
    let mostCommonHash: number | null = null;
    let maxCount = 0;

    for (const [hash, count] of counts.entries()) {
      if (count > maxCount) {
        mostCommonHash = hash;
        maxCount = count;
      }
    }

    // Create a list of clients whose hash doesn't match the most common one
    let outOfSyncClients: Client[] = [];

    for (const client of this.activeClients) {
      if (client.hashes.has(turnNumber)) {
        const clientHash = client.hashes.get(turnNumber)!;
        if (clientHash !== mostCommonHash) {
          outOfSyncClients.push(client);
        }
      }
    }

    // If strict majority clients out of sync assume all are out of sync.
    if (outOfSyncClients.length > Math.floor(this.activeClients.length / 2)) {
      outOfSyncClients = this.activeClients;
    }

    return {
      mostCommonHash,
      outOfSyncClients,
    };
  }

  private handleWinner(client: Client, clientMsg: ClientSendWinnerMessage) {
    if (
      this.outOfSyncClients.has(client.clientID) ||
      this.isKicked(client.clientID) ||
      this.winner !== null ||
      client.reportedWinner !== null
    ) {
      return;
    }
    client.reportedWinner = clientMsg.winner;

    // Add client vote. A cancelled match ends with winner omitted;
    // JSON.stringify(undefined) is not a string, so key those votes as "null".
    const winnerKey = JSON.stringify(clientMsg.winner ?? null);
    const activeUniqueIPs = this.votingUniqueIPs();
    const votes = this.winnerVotes.add(winnerKey, clientMsg, client.ip);

    this.log.info(
      `received winner vote ${clientMsg.winner}, ${votes}/${activeUniqueIPs} votes for this winner`,
      {
        clientID: client.clientID,
      },
    );

    const result = this.winnerVotes.result(activeUniqueIPs);
    if (result === null) {
      return;
    }

    // Vote succeeded
    this.winner = result.value;
    this.log.info(
      `Winner determined by ${result.votes}/${activeUniqueIPs} active IPs`,
      {
        winnerKey,
      },
    );
    this.archiveGame();
  }

  // Votes are otherwise only tallied when one arrives (handleWinner), so a
  // vote stuck short of a majority would never resolve once the rest of the
  // electorate is gone. In a 1v1 the loser often disconnects within a second
  // of being eliminated — before their own client simulates the win tick and
  // votes — leaving the winner's vote wedged at 1 of 2 and the game archived
  // winnerless (e.g. game s5bcKtj8). Re-tally whenever the electorate
  // shrinks, counting only votes from still-active IPs (see resultAmong).
  private checkWinnerAfterElectorateShrink() {
    if (this.winner !== null || this._hasEnded) {
      return;
    }
    const activeIPs = new Set(this.activeClients.map((c) => c.ip));
    const result = this.winnerVotes.resultAmong(activeIPs);
    if (result === null) {
      return;
    }
    this.winner = result.value;
    this.log.info(
      `Winner determined by ${result.votes}/${activeIPs.size} active IPs after electorate shrank`,
    );
    this.archiveGame();
  }

  // Clients each send a live stats snapshot every ~10s tagged with the turn it
  // was taken at. In-sync clients produce an identical snapshot for a given
  // turn, so we reach majority consensus (same IP-weighted vote as the winner)
  // and keep the latest agreed snapshot for the admin bot to read.
  private handleLiveStats(
    client: Client,
    clientMsg: ClientSendLiveStatsMessage,
  ) {
    if (
      this.outOfSyncClients.has(client.clientID) ||
      this.isKicked(client.clientID)
    ) {
      return;
    }
    const stats = clientMsg.stats;
    const turn = stats.turn;
    // Ignore turns we've already reached consensus on (or older ones).
    if (this.latestLiveStats !== null && turn <= this.latestLiveStats.turn) {
      return;
    }

    let entry = this.liveStatsVotes.get(turn);
    if (entry === undefined) {
      entry = { round: new VoteRound<LiveStats>(), voters: new Set() };
      this.liveStatsVotes.set(turn, entry);
      this.pruneLiveStatsVotes();
    }
    // One vote per client per turn.
    if (entry.voters.has(client.clientID)) {
      return;
    }
    entry.voters.add(client.clientID);

    const activeUniqueIPs = this.votingUniqueIPs();
    entry.round.add(JSON.stringify(stats), stats, client.ip);
    const result = entry.round.result(activeUniqueIPs);
    if (result === null) {
      return;
    }

    this.latestLiveStats = result.value;
    // This turn (and any older still-pending ones) are now settled.
    for (const t of this.liveStatsVotes.keys()) {
      if (t <= turn) {
        this.liveStatsVotes.delete(t);
      }
    }
  }

  // Bound the pending-vote map in case consensus is never reached for some
  // turns (e.g. a persistent desync). Maps iterate in insertion order and turns
  // arrive ascending, so this drops the oldest pending rounds.
  private pruneLiveStatsVotes() {
    while (
      this.liveStatsVotes.size > GameServer.MAX_PENDING_LIVE_STATS_ROUNDS
    ) {
      const oldest = this.liveStatsVotes.keys().next().value;
      if (oldest === undefined) break;
      this.liveStatsVotes.delete(oldest);
    }
  }

  // Latest majority-agreed live stats snapshot, with players enriched with
  // server-authoritative info the clients don't vote on: the username and
  // current connection status. null until the first consensus.
  public liveStats(): {
    turn: number;
    // The winner's clientID once the game is decided (player win), else null.
    // Server-side (from the winner vote), so the live board can seat the winner
    // without waiting for the post-game record.
    winner: string | null;
    players: (PlayerLiveStats & {
      username: string | null;
      publicID: string | null;
      connected: boolean;
    })[];
  } | null {
    if (this.latestLiveStats === null) {
      return null;
    }
    const w = this.winner?.winner;
    return {
      turn: this.latestLiveStats.turn,
      winner: w?.[0] === "player" ? w[1] : null,
      players: this.latestLiveStats.players.map((p) => {
        const client = this.allClients.get(p.clientID);
        return {
          ...p,
          username: client?.username ?? null,
          publicID: client?.publicId ?? null,
          connected: !this.isClientDisconnected(p.clientID),
        };
      }),
    };
  }
}
