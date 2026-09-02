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
  ClientReportMessage,
  ClientSendLiveStatsMessage,
  ClientSendWinnerMessage,
  GameConfig,
  GameID,
  GameInfo,
  GameStartInfo,
  GameStartInfoSchema,
  Intent,
  LobbyAccent,
  PartialGameRecord,
  PlayerLiveStats,
  PlayerRecord,
  PlayerReport,
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
import { createPartialGameRecord } from "../core/Util";
import { createGameWireContext, encodeServerMessage } from "../core/ZbinWire";
import { archive, finalizeGameRecord } from "./Archive";
import { Client } from "./Client";
import { applyGameConfigPatch, hostCheatsEnabled } from "./ConfigPatch";
import { LiveStatsVote, WinnerVote } from "./Consensus";
import { fetchCustomTribes } from "./CustomTribes";
import { DesyncDetector } from "./DesyncDetector";
import {
  authorizeIntent,
  IntentActor,
  IntentOutcome,
} from "./IntentAuthorization";
import { ListingState } from "./ListingState";
import { identityFor, MatchTelemetryRecorder } from "./MatchTelemetryRecorder";
import { friendsLookup, NameVisibility } from "./NameVisibility";
import { Roster } from "./Roster";
import { ServerEnv } from "./ServerEnv";
import { SocketIngress } from "./SocketIngress";
import {
  noopMatchTelemetryEmitter,
  type MatchTelemetryEmitter,
} from "./telemetry/MatchTelemetry";
export enum GamePhase {
  Lobby = "LOBBY",
  Active = "ACTIVE",
  Finished = "FINISHED",
}

// Identity + authority for an intent, supplied by whoever dispatched it: a
// per-connection websocket client, or the trusted admin-bot HTTP API.
export function hashPersistentID(persistentID: string): string {
  return createHash("sha256").update(persistentID).digest("hex");
}

const KICK_REASON_DUPLICATE_SESSION = "kick_reason.duplicate_session";
const KICK_REASON_LOBBY_CREATOR = "kick_reason.lobby_creator";
const KICK_REASON_ADMIN = "kick_reason.admin";
const KICK_REASON_HOST_LEFT = "kick_reason.host_left";
const KICK_REASON_MATCH_CANCELLED = "kick_reason.match_cancelled";

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
  // Compares the per-turn state hashes clients report; a disagreeing client
  // is told once and its votes are ignored from then on.
  private readonly desync = new DesyncDetector();

  // Socket listeners and the decode / validate / rate-limit / spectator-block
  // pipeline every frame goes through before handleClientMessage.
  private readonly ingress: SocketIngress;

  private maxGameDuration = 3 * 60 * 60 * 1000; // 3 hours

  private disconnectedTimeout = 1 * 30 * 1000; // 30 seconds

  // Backstop for reaping a started game nobody is connected to. The usual
  // reap (see phase()) also needs the game-wide ping clock to go quiet; this
  // one goes on the roster being empty and nothing else.
  private emptyGameTimeout = 10 * 60 * 1000; // 10 minutes
  private emptySince: number | null = null;

  private turns: Turn[] = [];
  private intents: StampedIntent[] = [];
  // Who joined, who is connected, and the per-account reconnect, admission
  // and kick flags (see Roster.ts). The join policy stays here.
  private readonly clients = new Roster();
  // The lobby -> prestart -> started progression. `ended` is orthogonal to
  // it: a lobby can end without ever starting (host left, match cancelled),
  // and a started game is still a started game once it has ended — end()
  // archives on that, and the socket close events that follow end() still
  // go through hasStarted() in handleClientDisconnect.
  private stage: "lobby" | "prestart" | "started" = "lobby";
  // Set when the delayed start found an empty roster (see deferStart).
  private startDeferred = false;
  private ended = false;
  private paused = false;
  private _startTime: number | null = null;
  private hasReachedMaxPlayerCount: boolean = false;

  private endTurnIntervalID: ReturnType<typeof setInterval> | undefined;

  private lastPingUpdate = 0;

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

  // Purchased bot tribe names drawn for this game, set when the prestart
  // fetch lands (undefined until then / on fetch failure / non-public games).
  private tribes?: Tribe[];

  // The end-of-game winner vote and the running live-stats vote: both
  // IP-weighted majorities among the players (see Consensus.ts).
  private readonly winnerVote = new WinnerVote();
  private readonly liveStatsVote = new LiveStatsVote();

  // Player reports filed this game, keyed "<reportedBy>:<reported>" so each
  // pair counts once. Never in the turn log (who reported whom is staff-only);
  // emitted as info.reports of the archived record (see handleReport).
  private readonly reports = new Map<string, PlayerReport>();

  // This private lobby's presence in the public lobby browser (see
  // ListingState.ts).
  private readonly listing = new ListingState();

  private lobbyInfoIntervalId: ReturnType<typeof setInterval> | null = null;

  private visibleAt?: number;

  // The successor lobby this game has already spawned, if any. Kept so a
  // repeated create_game?previous= call (e.g. a double click) reuses the same
  // id instead of minting another lobby.
  private successorLobbyId: GameID | null = null;

  // This match's telemetry stream: envelopes, sequence, per-tick intent
  // counters, finished-once (see MatchTelemetryRecorder.ts).
  private readonly telemetry: MatchTelemetryRecorder;

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
    this.telemetry = new MatchTelemetryRecorder(
      this.deps.telemetry,
      opts.id,
      this.deps.telemetryBuildHash,
    );
    this.names = new NameVisibility({
      gameID: opts.id,
      config: () => this.gameConfig,
      clients: () => this.clients.all(),
      teamIndex: (c) => this.matchmakingTeamIndex(c),
    });
    this.log = opts.log.child({ gameID: opts.id });
    this.ingress = new SocketIngress(this.log, this.telemetry, {
      zbinCtx: () => this.zbinCtx,
      serverTick: () => this.turns.length,
      onMessage: (client, msg) => this.handleClientMessage(client, msg),
      onClose: (client) => this.handleClientDisconnect(client),
      kick: (clientID, reasonKey) => this.kickClient(clientID, reasonKey),
    });
    if (opts.startsAt !== undefined) {
      this.visibleAt = Date.now();
    }
    this.telemetry.emit(
      "match_opened",
      {
        lobbyCreatedAt: opts.createdAt,
        config: opts.gameConfig,
        publicGameType: opts.publicGameType,
        buildHash: this.deps.telemetryBuildHash,
        instanceId: ServerEnv.instanceId(),
        workerId: ServerEnv.workerId(),
        turnIntervalMs: this.deps.turnIntervalMs(),
      },
      this.turns.length,
    );
  }

  private get lobbyCreatorID(): ClientID | undefined {
    return this.creatorPersistentID
      ? this.clients.byPersistentId(this.creatorPersistentID)?.clientID
      : undefined;
  }

  public updateGameConfig(gameConfig: Partial<GameConfig>): void {
    applyGameConfigPatch(this.gameConfig, gameConfig);
  }

  // Dispatch a control/gameplay intent from either a websocket client or the
  // trusted admin-bot HTTP API. `actor` carries the authority; the guards are
  // authorizeIntent, the per-intent actions live here. Returns an HTTP-style
  // outcome the caller maps (the bot route -> response, the websocket path ->
  // a log).
  public handleIntent(intent: Intent, actor: IntentActor): IntentOutcome {
    const serverTick = this.turns.length;
    const stamped: StampedIntent = { ...intent, clientID: actor.clientID };
    const finish = (
      outcome: IntentOutcome,
      acceptedReasonCode?: string,
    ): IntentOutcome => {
      if (!actor.isAdminBot) {
        const client = this.clients.get(actor.clientID);
        if (client !== undefined) {
          const accepted = outcome.status === 200;
          this.telemetry.intentObserved(
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

    const denied = authorizeIntent(intent, actor, {
      isPublic: this.isPublic(),
      isListed: this.isListed(),
      hasStarted: this.hasStarted(),
    });
    if (denied !== null) {
      return finish(denied);
    }

    switch (stamped.type) {
      case "kick_player": {
        // Resolve the target to a clientID: an explicit clientID, or an account
        // publicId matched against everyone who ever joined (a superset of the
        // connected that retains disconnected players), so a disconnected
        // account can still be kicked — its persistentID is banned, blocking
        // rejoin/reconnect.
        let target = stamped.targetClientID;
        if (target === undefined && stamped.targetPublicID !== undefined) {
          target = [...this.clients.all().values()].find(
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
        this.updateGameConfig(stamped.config);
        return finish({ status: 200 });
      }

      case "toggle_game_start_timer": {
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
        const outcome = finish({ status: 200 });
        // Pausing: flush the intent into a turn before isPaused short-circuits
        // endTurn(). Unpausing: clear the flag first so the next turn runs.
        if (stamped.paused) {
          this.addIntent(stamped);
          this.endTurn();
          this.paused = true;
        } else {
          this.paused = false;
          this.addIntent(stamped);
          this.endTurn();
        }
        return outcome;
      }

      default: {
        // Gameplay intents, into the turn queue.
        // While paused the intent is accepted at ingress but not queued into a
        // turn; tag it so telemetry can tell it apart from a queued intent.
        const paused = this.paused;
        const outcome = finish({ status: 200 }, paused ? "paused" : undefined);
        if (!paused) this.addIntent(stamped);
        return outcome;
      }
    }
  }

  private isKicked(clientID: ClientID): boolean {
    const persistentID = this.clients.get(clientID)?.persistentID;
    return persistentID !== undefined && this.clients.isKicked(persistentID);
  }

  // Get existing clientID for this persistentID, or null if new player
  public getClientIdForPersistentId(persistentID: string): ClientID | null {
    if (this.clients.isKicked(persistentID)) return null;
    return this.clients.byPersistentId(persistentID)?.clientID ?? null;
  }

  // Whether this persistentID has already been admitted (passed Turnstile and
  // other join authorization) for this game. Used to skip the single-use
  // Turnstile re-check when an already-admitted player reconnects. Kicked
  // players are excluded so a kick still forces them back through the gate.
  public wasAdmitted(persistentID: string): boolean {
    return this.clients.wasAdmitted(persistentID);
  }

  // Screened identity stored for this player's client record, or null if
  // the record (or its reconnect mapping) is gone. Lets the join path skip
  // re-screening a reconnect whose submitted identity is unchanged.
  public storedIdentity(
    persistentID: string,
  ): { username: string; clanTag: string | null } | null {
    const clientID = this.getClientIdForPersistentId(persistentID);
    if (clientID === null) return null;
    const client = this.clients.get(clientID);
    if (client === undefined) return null;
    return { username: client.username, clanTag: client.clanTag };
  }

  public joinClient(
    client: Client,
  ): "joined" | "kicked" | "rejected" | "not_allowlisted" | "not_trusted" {
    // e.g. the host left an unstarted lobby and GameManager hasn't pruned
    // it yet.
    if (this.ended) {
      return "rejected";
    }
    if (this.clients.isKicked(client.persistentID)) {
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

    if (!this.passesTrustGate(client)) {
      this.log.warn("client not trusted, rejecting", {
        clientID: client.clientID,
      });
      return "not_trusted";
    }

    // gameStartInfo.players is frozen at start, so a late arrival could never
    // spawn. They used to join as a player anyway; watching is what actually
    // happened to them, so it is what they join as.
    if (this.stage === "started") {
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
      this.clients
        .active()
        .filter((c) => c.ip === client.ip && c.clientID !== client.clientID)
        .length >= 3
    ) {
      this.log.warn("cannot add client, already have 3 ips", {
        clientID: client.clientID,
        clientIP: ipAnonymize(client.ip),
      });
      return "rejected";
    }

    if (this.deps.env() === GameEnv.Prod) {
      // Prevent multiple clients from using the same account in prod
      const conflicting = this.clients
        .active()
        .find(
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

    // Client connection accepted. Added before the first
    // markClientDisconnected: that call consults the roster to tell a
    // spectator from a player.
    this.clients.add(client);
    client.lastPing = Date.now();
    this.markClientDisconnected(client.clientID, false);
    this.telemetry.emit(
      "player_joined",
      {
        identity: identityFor(client),
        joinedAt: Date.now(),
        username: client.username,
        playerType: "human",
        teamIndex: this.matchmakingTeamIndex(client),
      },
      this.turns.length,
    );
    this.ingress.attach(client);
    this.startLobbyInfoBroadcast();

    if (this.playerCount() >= (this.gameConfig.maxPlayers ?? Infinity)) {
      this.hasReachedMaxPlayerCount = true;
    }

    // In case a client joined the game late and missed the start message.
    if (this.stage === "started") {
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
    // As in joinClient: an ended game may still be in GameManager until its
    // next tick, and the roster still holds the reconnect mapping.
    if (this.ended) return false;
    const clientID = this.getClientIdForPersistentId(persistentID);
    if (!clientID) return false;
    const client = this.clients.get(clientID);
    if (!client) return false;

    this.log.info("client rejoining", { clientID, lastTurn });
    // Also closes the old WebSocket, to prevent resource leaks.
    this.clients.reconnect(client, ws);
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

    this.ingress.attach(client);
    this.startLobbyInfoBroadcast();

    if (this.stage === "started") {
      this.sendStartGameMsg(client.ws, lastTurn);
    }
    return true;
  }

  // A validated message from a connected client, after SocketIngress has
  // applied the rate limit and the spectator block.
  private handleClientMessage(client: Client, clientMsg: ClientMessage) {
    // Nothing from a socket that is no longer on the roster reaches the game.
    // Dropping a client (a kick, the stale-ping prune, a close) leaves its
    // listener attached and the socket able to deliver frames — close() is a
    // handshake, and the prune only calls it on an OPEN socket at all — so
    // without this a kicked player could still land intents and votes, and a
    // ghost's pings could hold the empty-game reap off forever.
    if (!this.clients.isConnected(client)) {
      return;
    }
    switch (clientMsg.type) {
      case "rejoin": {
        // Client is already connected, no auth required, send start game message if game has started
        if (this.stage === "started") {
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
        // Only a roster member reaches here, so this is also the game-wide
        // "someone is still out there" clock the empty-game reap waits on.
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
      case "report": {
        this.handleReport(client, clientMsg);
        break;
      }
      default: {
        this.log.warn(`Unknown message type: ${(clientMsg as any).type}`, {
          clientID: client.clientID,
        });
        break;
      }
    }
  }

  private handleClientDisconnect(client: Client) {
    this.clients.markLeft(client);
    this.checkWinnerAfterElectorateShrink();

    // hasStarted() includes prestart: during the lobby -> game transition
    // clients reconnect, and a host socket closing then must not tear the
    // starting game down.
    if (this.hasStarted()) {
      return;
    }
    // Remove persistentId if the game has not started to prevent going over max players
    this.clients.forgetReconnect(client);
    // Close lobby when host leaves before game starts: without a host it can
    // never start, and a listed one would haunt the lobby browser and hold
    // the creator's one-listing quota. phase() reports Finished once ended,
    // so GameManager's next tick prunes it.
    if (!this.isPublic() && client.persistentID === this.creatorPersistentID) {
      this.log.info("Host left, closing lobby", {
        gameID: this.id,
      });
      for (const c of [...this.clients.active()]) {
        this.kickClient(c.clientID, KICK_REASON_HOST_LEFT);
      }
      this.ended = true;
    }
  }

  public setStartsAt(startsAt: number) {
    this.startsAt = startsAt;
    // Record when the lobby first became visible to players, used to measure lobby fill time.
    this.visibleAt ??= Date.now();
  }

  public numClients(): number {
    return this.clients.active().length;
  }

  public numDesyncedClients(): number {
    return this.desync.count();
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
    for (const c of [...this.clients.active()]) {
      this.kickClient(c.clientID, KICK_REASON_MATCH_CANCELLED);
    }
    // phase() reports Finished once ended, so GameManager's next tick prunes.
    this.ended = true;
    return true;
  }

  // Nobody was connected when the delayed start came due. An empty roster at
  // that moment is not proof the game is abandoned: handleClientDisconnect
  // drops a client the instant its socket closes, blip or not, and the client
  // is normally reconnecting already. Ending the game there would be
  // permanent and silent — rejoinClient refuses an ended game, the worker
  // closes that socket with 1002, and the client treats 1002 as terminal
  // rather than retrying. So hold the start instead of cancelling it.
  public deferStart(): void {
    if (this.stage !== "prestart") {
      return;
    }
    this.log.info("deferring start, no clients connected", {
      gameID: this.id,
    });
    this.startDeferred = true;
  }

  // Runs a held start once someone is connected again. Nobody comes back ->
  // the game stays empty and phase() reaps it on the usual rules, so a truly
  // abandoned game still never reaches start(). Returns whether it started.
  public resumeDeferredStart(): boolean {
    if (!this.startDeferred || this.ended || this.numClients() === 0) {
      return false;
    }
    this.startDeferred = false;
    this.start();
    return true;
  }

  public prestart() {
    if (this.ended || this.hasStarted()) {
      return;
    }
    this.stage = "prestart";
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
    this.clients.active().forEach((c) => {
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
    const players = this.clients
      .active()
      .flatMap((c) =>
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
    if (this.stage === "started" || this.ended) {
      return;
    }
    if (this.lobbyInfoIntervalId !== null) {
      return;
    }
    this.broadcastLobbyInfo();
    this.lobbyInfoIntervalId = setInterval(() => {
      if (
        this.stage === "started" ||
        this.ended ||
        this.clients.active().length === 0
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
    this.clients.active().forEach((c) => {
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
    this.clients.active().forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  public start() {
    if (this.stage === "started" || this.ended) {
      return;
    }
    this.stage = "started";
    this._startTime = Date.now();
    // Set last ping to start so we don't immediately stop the game
    // if no client connects/pings.
    this.lastPingUpdate = Date.now();

    const friendsFor = friendsLookup(this.clients.active());

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
      players: this.clients.players().map((c) => ({
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
    this.telemetry.emit(
      "match_started",
      {
        startedAt: this._startTime,
        gameStartInfo: this.gameStartInfo,
        buildHash: this.deps.telemetryBuildHash,
        turnIntervalMs: this.deps.turnIntervalMs(),
      },
      this.turns.length,
    );
    const wireGameStartInfo = {
      ...this.gameStartInfo,
      listed: this.listing.isListed(),
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
    this.clients.active().forEach((c) => {
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
    return this.clients.players().length;
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

  // Trusted-only lobbies (GameConfig.trusted) admit only accounts the API
  // reported as trusted at join time. Shared by joinClient and the seat toggle
  // for the same reason as passesAllowlist; admins bypass it the same way.
  private passesTrustGate(client: Client): boolean {
    if (this.gameConfig.trusted !== true) return true;
    if (isAdminRole(client.role)) return true;
    return client.trusted;
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
      if (this.stage === "started" || this.ended) return;
      if (!this.passesAllowlist(client)) return;
      if (!this.passesTrustGate(client)) return;
      const max = this.gameConfig.maxPlayers;
      if (max !== undefined && this.playerCount() >= max) return;
    }
    client.spectator = spectator;
    // The lobby list is derived from this flag, so everyone's view of who is
    // playing has to be refreshed rather than waiting out the next tick.
    this.broadcastLobbyInfo();
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
    const client = this.clients.active().find((c) => c.ws === ws);
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
    if (this.paused) {
      return;
    }

    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];
    const counts = this.telemetry.takeTickCounts(pastTurn.turnNumber);
    this.telemetry.emit(
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
    this.clients.active().forEach((c) => {
      if (c.ws.readyState === c.ws.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  async end() {
    this.ended = true;
    // Close all WebSocket connections
    if (this.endTurnIntervalID) {
      clearInterval(this.endTurnIntervalID);
      this.endTurnIntervalID = undefined;
    }
    this.clients.closeAll("game has ended");
    // The lobby broadcast would stop itself on its next tick; do not leave a
    // timer holding an ended game until then.
    this.stopLobbyInfoBroadcast();
    // Only a started game has a record to archive: gameStartInfo is built by
    // start(), so a game that ends during prestart has nothing to upload.
    if (this.stage !== "started") {
      this.log.info(`game not started, not archiving game`);
      this.telemetry.matchFinished(this.turns.length);
      return;
    }
    this.log.info(`ending game with ${this.turns.length} turns`);
    try {
      if (this.clients.all().size === 0) {
        this.log.info("no clients joined, not archiving game", {
          gameID: this.id,
        });
      } else if (this.winnerVote.winner() !== null) {
        this.log.info("game already archived", {
          gameID: this.id,
        });
      } else {
        // Not awaited: the upload handles its own failures (Archive.ts), and
        // waiting would only hold up GameManager's prune of this game.
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
    this.telemetry.matchFinished(this.turns.length);
  }

  // Drops the clients that have not pinged for 60s. GameManager calls this
  // once per tick, just before phase(); it is the one lifecycle step with a
  // side effect, and keeping it out of phase() lets the lobby browser read
  // the phase as often as it likes without closing anyone's socket.
  public pruneStaleClients(): void {
    if (this.ended) {
      return;
    }
    const stale = this.clients.pruneStale(Date.now(), 60_000);
    for (const client of stale) {
      this.log.info("no pings received, terminating connection", {
        clientID: client.clientID,
        persistentID: client.persistentID,
      });
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1000, "no heartbeats received, closing connection");
      }
    }
    // On an abrupt network drop the ws 'close' event can lag far behind this
    // ping prune, so re-check the winner vote here too.
    if (stale.length > 0) {
      this.checkWinnerAfterElectorateShrink();
    }
    // Since when has nobody been connected? Tracked here rather than in
    // phase() so phase() stays a pure read, and so emptiness accrues on the
    // tick loop instead of on however often the lobby browser asks.
    this.emptySince =
      this.clients.active().length === 0
        ? (this.emptySince ?? Date.now())
        : null;
  }

  // A pure read of the lifecycle; pruneStaleClients() is the side effect.
  phase(): GamePhase {
    // An ended game (e.g. an unstarted lobby whose host left) must report
    // Finished: GameManager prunes on Finished, and a ghost that kept
    // reporting Lobby would stay advertised in the lobby browser and hold
    // the creator's one-listing quota until the max-duration cutoff.
    if (this.ended) {
      return GamePhase.Finished;
    }
    const now = Date.now();
    if (now > this.createdAt + this.maxGameDuration) {
      this.log.warn("game past max duration", {
        gameID: this.id,
      });
      return GamePhase.Finished;
    }

    const lessThanLifetime = this.startsAt ? Date.now() < this.startsAt : true;
    if (
      lessThanLifetime &&
      !this.hasStarted() &&
      !this.hasReachedMaxPlayerCount
    ) {
      return GamePhase.Lobby;
    }

    // Anyone still on the roster keeps the game running. Everything below is
    // about reaping a game nobody is connected to.
    if (this.clients.active().length > 0) {
      return GamePhase.Active;
    }

    // Grace period before an empty game is reaped, measured from whenever it
    // committed to starting. startsAt is not always set: a lobby that
    // auto-starts by filling to maxPlayers, and admin bot games, never get one
    // — and `undefined + 30_000` is NaN, so every comparison against it is
    // false. Those games could never be reaped and lived on (still ticking
    // turns, with nobody connected) until the maxGameDuration cutoff above.
    const warmupFrom = this.startsAt ?? this._startTime ?? this.createdAt;
    const warmupOver = now > warmupFrom + 30 * 1000;
    const noRecentPings = now > this.lastPingUpdate + 20 * 1000;
    if (warmupOver && noRecentPings) {
      return GamePhase.Finished;
    }

    // Backstop: an empty game whose ping clock never goes quiet. Only a client
    // on the roster refreshes lastPingUpdate now, but a game that manages to
    // keep that clock warm with nobody connected must still not outlive the
    // players by hours — sustained emptiness is enough on its own.
    if (
      this.hasStarted() &&
      this.emptySince !== null &&
      now > this.emptySince + this.emptyGameTimeout
    ) {
      this.log.warn("game had no connected clients past timeout, ending", {
        gameID: this.id,
      });
      return GamePhase.Finished;
    }

    return GamePhase.Active;
  }

  hasStarted(): boolean {
    return this.stage !== "lobby";
  }

  isPaused(): boolean {
    return this.paused;
  }

  // Omitting viewer (e.g. the HTTP /api/game/:id and link-preview routes)
  // anonymizes all names when the option is on.
  public gameInfo(viewer?: ClientID): GameInfo {
    return {
      gameID: this.id,
      clients: this.names.lobbyClients(viewer, this.clients.active()),
      lobbyCreatorClientID: this.lobbyCreatorID,
      gameConfig: this.gameConfig,
      startsAt: this.startsAt,
      serverTime: Date.now(),
      publicGameType: this.publicGameType,
      listed: this.isPublic() ? undefined : this.listing.isListed(),
      autoStartAt: this.listing.autoStartAt(),
      label: this.listing.lobbyLabel(),
      accent: this.listing.lobbyAccent(),
      featured: this.listing.isFeatured() ? true : undefined,
    };
  }

  public isPublic(): boolean {
    return this.gameConfig.gameType === GameType.Public;
  }

  public isListed(): boolean {
    return this.listing.isListed();
  }

  /** Who joined, and the account behind each one.
   *
   *  The public game record is PII-stripped, so a clientID can only be tied back
   *  to an account by whoever ran the lobby. Without this a host can see that 96
   *  people played and identify none of them. Restricted to lobbies the admin bot
   *  created — never a public or matchmade game.
   *
   *  Everyone who joined, not only the connected: someone who joined and left
   *  still appears in the record the host has to reconcile against. */
  public roster(): {
    clientID: ClientID;
    publicId: string | undefined;
    username: string;
  }[] {
    return [...this.clients.all().values()].map((c) => ({
      clientID: c.clientID,
      publicId: c.publicId,
      username: c.username,
    }));
  }

  public setListed(listed: boolean): void {
    this.listing.setListed(listed);
  }

  public autoStartAt(): number | undefined {
    return this.listing.autoStartAt();
  }

  public isFeatured(): boolean {
    return this.listing.isFeatured();
  }

  public lobbyLabel(): string | undefined {
    return this.listing.lobbyLabel();
  }

  public lobbyAccent(): LobbyAccent | undefined {
    return this.listing.lobbyAccent();
  }

  // Only create_game calls this.
  public setFeatured(opts: { label?: string; accent?: LobbyAccent }): void {
    this.listing.setFeatured(opts);
  }

  // Called from GameManager's tick while in the Lobby phase: once the
  // listed deadline passes, arm the normal start countdown (same path as
  // the host's Start button). Cancelling the countdown re-arms it on the
  // next tick, so the only way out is to unlist.
  public maybeAutoStartListed(): void {
    if (this.hasStarted() || this.startsAt !== undefined) {
      return;
    }
    const deadline = this.listing.autoStartAt();
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

    const client = this.clients.get(clientID);
    if (!client) {
      this.log.warn(`cannot kick client, not found in game`, {
        clientID,
        reasonKey,
      });
      return;
    }

    // The persistentID is banned whether or not the client is still
    // connected; only a connected one is told and cut off.
    if (this.clients.kick(client)) {
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
    for (const [clientID, client] of this.clients.all()) {
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
    return this.clients.isDisconnected(clientID);
  }

  private markClientDisconnected(clientID: string, isDisconnected: boolean) {
    this.clients.setDisconnected(clientID, isDisconnected);
    // Connection status is tracked for every client, but only a player's reaches
    // the simulation: a spectator has no entry in gameStartInfo.players, so an
    // intent naming them refers to nobody — and it is kept in the archived turn
    // log, where readers take mark_disconnected as a player having dropped.
    if (this.clients.get(clientID)?.spectator) return;
    this.addIntent({
      type: "mark_disconnected",
      clientID: clientID,
      isDisconnected: isDisconnected,
    });
  }

  private archiveGame() {
    const winner = this.winnerVote.winner();
    this.log.info("archiving game", {
      gameID: this.id,
      winner: winner?.winner,
    });

    // Players must stay in the same order as the game start info.
    const playerRecords: PlayerRecord[] = this.gameStartInfo.players.map(
      (player) => {
        const stats = winner?.allPlayersStats[player.clientID];
        if (stats === undefined) {
          this.log.warn(`Unable to find stats for clientID ${player.clientID}`);
        }
        return {
          clientID: player.clientID,
          username: player.username,
          clanTag: player.clanTag,
          persistentID: this.clients.get(player.clientID)?.persistentID ?? "",
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
    this.telemetry.noteArchiveAttempted();
    this.deps.archive(
      createPartialGameRecord(
        this.id,
        this.gameStartInfo.config,
        playerRecords,
        this.turns,
        this._startTime ?? 0,
        Date.now(),
        winner?.winner,
        this.createdAt,
        this.visibleAt,
        this.gameStartInfo.tribes,
        [...this.reports.values()],
      ),
    );
  }

  // A player reporting another. The API resolves both clientIDs through this
  // game's player sessions and drops anything else, so only a started game's
  // players are accepted here. One report per (reporter, reported) pair: the
  // API dedupes per account anyway, and it bounds what one player can file
  // at the number of other players — no separate rate limit needed. Rejects
  // are dropped without a log line: the message is not rate limited, so a
  // logged reject would let one client flood the logs.
  //
  // The record is archived once, when the winner vote resolves (or at
  // end() if it never does), and reports only travel with it — so anything
  // filed after that has nowhere to go and is refused rather than kept.
  private handleReport(client: Client, clientMsg: ClientReportMessage) {
    const { reported, reason } = clientMsg;
    if (
      this.stage !== "started" ||
      this.ended ||
      this.winnerVote.winner() !== null ||
      reported === client.clientID ||
      !this.gameStartInfo.players.some((p) => p.clientID === reported)
    ) {
      return;
    }
    const key = `${client.clientID}:${reported}`;
    if (this.reports.has(key)) return;
    this.reports.set(key, { reportedBy: client.clientID, reported, reason });
    this.log.info("player reported", {
      clientID: client.clientID,
      reported,
      reason,
      gameID: this.id,
    });
  }

  private handleSynchronization() {
    const check = this.desync.check(this.turns.length, this.clients.active());
    if (check === null) {
      return;
    }
    const { turn, mostCommonHash, outOfSyncClients } = check;

    if (outOfSyncClients.length === 0) {
      this.turns[turn].hash = mostCommonHash;
      return;
    }

    const serverDesync = ServerDesyncSchema.safeParse({
      type: "desync",
      turn,
      correctHash: mostCommonHash,
      clientsWithCorrectHash:
        this.clients.active().length - outOfSyncClients.length,
      totalActiveClients: this.clients.active().length,
    });
    if (!serverDesync.success) {
      this.log.warn("failed to create desync message", {
        gameID: this.id,
        error: serverDesync.error,
      });
      return;
    }

    const desyncMsg = encodeServerMessage(serverDesync.data, this.zbinCtx);
    for (const c of this.desync.record(outOfSyncClients)) {
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

  private handleWinner(client: Client, clientMsg: ClientSendWinnerMessage) {
    if (
      this.desync.isDesynced(client.clientID) ||
      this.isKicked(client.clientID) ||
      this.winnerVote.winner() !== null ||
      client.reportedWinner !== null
    ) {
      return;
    }
    client.reportedWinner = clientMsg.winner;

    const activeUniqueIPs = this.clients.votingUniqueIPs();
    const { key: winnerKey, votes } = this.winnerVote.cast(
      clientMsg,
      client.ip,
    );

    this.log.info(
      `received winner vote ${clientMsg.winner}, ${votes}/${activeUniqueIPs} votes for this winner`,
      {
        clientID: client.clientID,
      },
    );

    const result = this.winnerVote.tally(activeUniqueIPs);
    if (result === null) {
      return;
    }

    // Vote succeeded
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
    if (this.winnerVote.winner() !== null || this.ended) {
      return;
    }
    const activeIPs = new Set(this.clients.active().map((c) => c.ip));
    const result = this.winnerVote.tallyAmong(activeIPs);
    if (result === null) {
      return;
    }
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
      this.desync.isDesynced(client.clientID) ||
      this.isKicked(client.clientID)
    ) {
      return;
    }
    this.liveStatsVote.cast(
      client.clientID,
      client.ip,
      clientMsg.stats,
      this.clients.votingUniqueIPs(),
    );
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
    const latest = this.liveStatsVote.latest();
    if (latest === null) {
      return null;
    }
    const w = this.winnerVote.winner()?.winner;
    return {
      turn: latest.turn,
      winner: w?.[0] === "player" ? w[1] : null,
      players: latest.players.map((p) => {
        const client = this.clients.get(p.clientID);
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
