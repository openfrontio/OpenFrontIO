import ipAnonymize from "ip-anonymize";
import { Logger } from "winston";
import WebSocket from "ws";
import { z } from "zod";
import { isAdminRole } from "../core/ApiSchemas";
import { GameEnv } from "../core/configuration/Config";
import { GameType } from "../core/game/Game";
import {
  ClientID,
  ClientMessageSchema,
  ClientSendLiveStatsMessage,
  ClientSendWinnerMessage,
  GameConfig,
  GameInfo,
  GameStartInfo,
  GameStartInfoSchema,
  Intent,
  LiveStats,
  PlayerLiveStats,
  PlayerRecord,
  PublicGameType,
  ServerDesyncSchema,
  ServerErrorMessage,
  ServerLobbyInfoMessage,
  ServerPrestartMessageSchema,
  ServerStartGameMessage,
  ServerTurnMessage,
  StampedIntent,
  Turn,
} from "../core/Schemas";
import { anonymousUsername, createPartialGameRecord } from "../core/Util";
import { archive, finalizeGameRecord } from "./Archive";
import { Client } from "./Client";
import { ClientMsgRateLimiter } from "./ClientMsgRateLimiter";
import { ServerEnv } from "./ServerEnv";
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

const KICK_REASON_DUPLICATE_SESSION = "kick_reason.duplicate_session";
const KICK_REASON_LOBBY_CREATOR = "kick_reason.lobby_creator";
const KICK_REASON_ADMIN = "kick_reason.admin";
const KICK_REASON_HOST_LEFT = "kick_reason.host_left";
const KICK_REASON_TOO_MUCH_DATA = "kick_reason.too_much_data";
const KICK_REASON_INVALID_MESSAGE = "kick_reason.invalid_message";

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

  private log: Logger;

  private _hasPrestarted = false;

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

  private lobbyInfoIntervalId: ReturnType<typeof setInterval> | null = null;

  private visibleAt?: number;

  constructor(
    public readonly id: string,
    readonly log_: Logger,
    public readonly createdAt: number,
    public gameConfig: GameConfig,
    private creatorPersistentID?: string,
    private startsAt?: number,
    private publicGameType?: PublicGameType,
  ) {
    this.log = log_.child({ gameID: id });
    if (startsAt !== undefined) {
      this.visibleAt = Date.now();
    }
  }

  private get lobbyCreatorID(): ClientID | undefined {
    return this.creatorPersistentID
      ? this.persistentIdToClientId.get(this.creatorPersistentID)
      : undefined;
  }

  // anonymizeNames: only players the host granted (nameReveals, or by account via
  // nameRevealPublicIds) see real names. Nobody is exempt by default, not even the
  // host, until he grants them.
  private viewerSeesAllNames(viewer: ClientID | undefined): boolean {
    if (viewer === undefined) return false;
    if (this.gameConfig.nameReveals?.includes(viewer) ?? false) return true;
    // Resolve the per-game clientID to its stable account publicId so a host that
    // only knows publicIds (the admin bot) can grant reveal access at create_game.
    const publicId = this.allClients.get(viewer)?.publicId;
    return (
      publicId !== undefined &&
      (this.gameConfig.nameRevealPublicIds?.includes(publicId) ?? false)
    );
  }

  // Same (viewer, target) -> same name in the lobby and in-game.
  private anonName(viewer: ClientID | undefined, target: ClientID): string {
    return anonymousUsername(target + (viewer ?? ""));
  }

  // Whether `viewer` should see `target`'s real identity: when names aren't
  // anonymized, when looking at themselves, or when the host granted the
  // viewer reveal access (nameReveals).
  private seesReal(viewer: ClientID | undefined, target: ClientID): boolean {
    return (
      !this.gameConfig.anonymizeNames ||
      target === viewer ||
      this.viewerSeesAllNames(viewer)
    );
  }

  public updateGameConfig(gameConfig: Partial<GameConfig>): void {
    if (gameConfig.gameMap !== undefined) {
      this.gameConfig.gameMap = gameConfig.gameMap;
    }
    if (gameConfig.gameMapSize !== undefined) {
      this.gameConfig.gameMapSize = gameConfig.gameMapSize;
    }
    if (gameConfig.difficulty !== undefined) {
      this.gameConfig.difficulty = gameConfig.difficulty;
    }
    if (gameConfig.nations !== undefined) {
      this.gameConfig.nations = gameConfig.nations;
    }
    if (gameConfig.bots !== undefined) {
      this.gameConfig.bots = gameConfig.bots;
    }
    if (gameConfig.infiniteGold !== undefined) {
      this.gameConfig.infiniteGold = gameConfig.infiniteGold;
    }
    if (gameConfig.donateGold !== undefined) {
      this.gameConfig.donateGold = gameConfig.donateGold;
    }
    if (gameConfig.infiniteTroops !== undefined) {
      this.gameConfig.infiniteTroops = gameConfig.infiniteTroops;
    }
    if (gameConfig.donateTroops !== undefined) {
      this.gameConfig.donateTroops = gameConfig.donateTroops;
    }
    if (gameConfig.maxTimerValue !== undefined) {
      this.gameConfig.maxTimerValue = gameConfig.maxTimerValue ?? undefined;
    }
    if (gameConfig.startDelay !== undefined) {
      this.gameConfig.startDelay = gameConfig.startDelay ?? undefined;
    }
    if (gameConfig.instantBuild !== undefined) {
      this.gameConfig.instantBuild = gameConfig.instantBuild;
    }
    if (gameConfig.randomSpawn !== undefined) {
      this.gameConfig.randomSpawn = gameConfig.randomSpawn;
    }
    if (gameConfig.spawnImmunityDuration !== undefined) {
      this.gameConfig.spawnImmunityDuration =
        gameConfig.spawnImmunityDuration ?? undefined;
    }
    if (gameConfig.gameMode !== undefined) {
      this.gameConfig.gameMode = gameConfig.gameMode;
    }
    if (gameConfig.disabledUnits !== undefined) {
      this.gameConfig.disabledUnits = gameConfig.disabledUnits;
    }
    if (gameConfig.playerTeams !== undefined) {
      this.gameConfig.playerTeams = gameConfig.playerTeams;
    }
    if (gameConfig.goldMultiplier !== undefined) {
      this.gameConfig.goldMultiplier = gameConfig.goldMultiplier ?? undefined;
    }
    if (gameConfig.startingGold !== undefined) {
      this.gameConfig.startingGold = gameConfig.startingGold ?? undefined;
    }
    if (gameConfig.disableAlliances !== undefined) {
      this.gameConfig.disableAlliances =
        gameConfig.disableAlliances ?? undefined;
    }
    if (gameConfig.customAllianceDuration !== undefined) {
      this.gameConfig.customAllianceDuration =
        gameConfig.customAllianceDuration ?? undefined;
    }
    if (gameConfig.allowedPublicIds !== undefined) {
      this.gameConfig.allowedPublicIds = gameConfig.allowedPublicIds;
    }
    if (gameConfig.waterNukes !== undefined) {
      this.gameConfig.waterNukes = gameConfig.waterNukes ?? undefined;
    }
    if (gameConfig.doomsdayClock !== undefined) {
      this.gameConfig.doomsdayClock = gameConfig.doomsdayClock;
    }
    if (gameConfig.anonymizeNames !== undefined) {
      this.gameConfig.anonymizeNames = gameConfig.anonymizeNames;
    }
    if (gameConfig.nameReveals !== undefined) {
      this.gameConfig.nameReveals = gameConfig.nameReveals;
    }
    if (gameConfig.nameRevealPublicIds !== undefined) {
      this.gameConfig.nameRevealPublicIds = gameConfig.nameRevealPublicIds;
    }
    // Unconditional on purpose: the host clears cheats by omitting hostCheats
    // (the full config it sends has hostCheats: undefined when the toggle is
    // off), so `undefined` here means "clear", not "leave unchanged".
    this.gameConfig.hostCheats = gameConfig.hostCheats;
  }

  // Dispatch a control/gameplay intent from either a websocket client or the
  // trusted admin-bot HTTP API. `actor` carries the authority; the per-intent
  // actions and game-state guards live here. Returns an HTTP-style outcome the
  // caller maps (the bot route -> response, the websocket path -> a log).
  public handleIntent(intent: Intent, actor: IntentActor): IntentOutcome {
    const stamped: StampedIntent = { ...intent, clientID: actor.clientID };

    // The admin bot only manages private games.
    if (actor.isAdminBot && this.isPublic()) {
      return { status: 403, error: "admin bot cannot act on public games" };
    }

    switch (stamped.type) {
      case "mark_disconnected":
        return { status: 400, error: "mark_disconnected is server-internal" };

      case "kick_player": {
        if (!actor.isLobbyCreator && !actor.isAdmin) {
          return {
            status: 403,
            error: "only the lobby creator or an admin can kick players",
          };
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
          return { status: 404, error: "no matching player to kick" };
        }
        if (stamped.clientID === target) {
          return { status: 400, error: "cannot kick yourself" };
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
        return { status: 200 };
      }

      case "update_game_config": {
        if (!actor.isLobbyCreator && !actor.isAdminBot) {
          return {
            status: 403,
            error: "only the lobby creator can update game config",
          };
        }
        if (this.isPublic()) {
          return { status: 403, error: "cannot update a public game" };
        }
        if (this.hasStarted()) {
          return { status: 409, error: "game already started" };
        }
        if (stamped.config.gameType === GameType.Public) {
          return { status: 400, error: "cannot change a game to public" };
        }
        this.updateGameConfig(stamped.config);
        return { status: 200 };
      }

      case "toggle_game_start_timer": {
        if (!actor.isLobbyCreator && !actor.isAdminBot) {
          return { status: 403, error: "only the lobby creator can start" };
        }
        if (this.isPublic()) {
          return { status: 403, error: "cannot start a public game" };
        }
        if (this.hasStarted()) {
          return { status: 409, error: "game already started" };
        }
        if (this.startsAt) {
          this.startsAt = undefined;
        } else {
          this.setStartsAt(
            Date.now() + (this.gameConfig.startDelay ?? 0) * 1000,
          );
        }
        return { status: 200 };
      }

      case "toggle_pause": {
        if (!actor.isLobbyCreator && !actor.isAdminBot) {
          return { status: 403, error: "only the lobby creator can pause" };
        }
        // Pausing only makes sense once the game is running.
        if (!this.hasStarted()) {
          return { status: 409, error: "game not started" };
        }
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
        return { status: 200 };
      }

      default: {
        // Gameplay intents: websocket players only, into the turn queue.
        if (actor.isAdminBot) {
          return { status: 400, error: "intent not permitted for admin bot" };
        }
        if (!this.isPaused) {
          this.addIntent(stamped);
        }
        return { status: 200 };
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

  public joinClient(
    client: Client,
  ): "joined" | "kicked" | "rejected" | "not_allowlisted" {
    if (this.kickedPersistentIds.has(client.persistentID)) {
      return "kicked";
    }

    // OFM: if an allowlist is set, only those publicIds may join. Re-checked on
    // every join attempt
    const allowedPublicIds = this.gameConfig.allowedPublicIds;
    if (
      allowedPublicIds !== undefined &&
      allowedPublicIds.length > 0 &&
      (client.publicId === undefined ||
        !allowedPublicIds.includes(client.publicId))
    ) {
      this.log.warn("client not on allowlist, rejecting", {
        clientID: client.clientID,
      });
      return "not_allowlisted";
    }

    if (
      this.gameConfig.maxPlayers &&
      this.activeClients.length >= this.gameConfig.maxPlayers
    ) {
      this.log.warn(`cannot add client, game full`, {
        clientID: client.clientID,
      });

      client.ws.send(
        JSON.stringify({
          type: "error",
          error: "full-lobby",
        } satisfies ServerErrorMessage),
      );
      return "rejected";
    }

    this.log.info("client joining game", {
      clientID: client.clientID,
      persistentID: client.persistentID,
      clientIP: ipAnonymize(client.ip),
    });

    if (
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

    if (ServerEnv.env() === GameEnv.Prod) {
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
    this.markClientDisconnected(client.clientID, false);
    this.allClients.set(client.clientID, client);
    this.addListeners(client);
    this.startLobbyInfoBroadcast();

    if (this.activeClients.length >= (this.gameConfig.maxPlayers ?? Infinity)) {
      this.hasReachedMaxPlayerCount = true;
    }

    // In case a client joined the game late and missed the start message.
    if (this._hasStarted) {
      this.sendStartGameMsg(client.ws, 0);
    }

    return "joined";
  }

  // Attempt to reconnect a client by persistentID. Returns true if successful.
  // WebSocket is always updated. Optional identity updates are applied only
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
      client.ws.removeAllListeners();
      client.ws.close();
    }

    this.activeClients = this.activeClients.filter(
      (c) => c.clientID !== client.clientID,
    );
    this.activeClients.push(client);
    if (identityUpdate && !this.hasStarted()) {
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
    client.ws.on("message", async (message: string) => {
      try {
        let json: unknown;
        try {
          json = JSON.parse(message);
        } catch (e) {
          this.log.warn(`Failed to parse client message JSON, kicking`, {
            clientID: client.clientID,
            error: String(e),
          });
          this.kickClient(client.clientID, KICK_REASON_INVALID_MESSAGE);
          return;
        }
        const parsed = ClientMessageSchema.safeParse(json);
        if (!parsed.success) {
          this.log.warn(`Failed to parse client message, kicking`, {
            clientID: client.clientID,
            error: z.prettifyError(parsed.error),
          });
          this.kickClient(client.clientID, KICK_REASON_INVALID_MESSAGE);
          return;
        }
        const clientMsg = parsed.data;
        const bytes = Buffer.byteLength(message, "utf8");
        const rateResult = this.intentRateLimiter.check(
          client.clientID,
          clientMsg.type,
          bytes,
        );
        if (rateResult === "kick") {
          this.log.warn(`Client rate limit exceeded, kicking`, {
            clientID: client.clientID,
            type: clientMsg.type,
          });
          this.kickClient(client.clientID, KICK_REASON_TOO_MUCH_DATA);
          return;
        }
        if (rateResult === "limit") {
          this.log.warn(`Client message rate limit exceeded, dropping`, {
            clientID: client.clientID,
            type: clientMsg.type,
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
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID !== client.clientID,
      );

      if (!this._hasStarted) {
        // Remove persistentId if the game has not started to prevent going over max players
        this.persistentIdToClientId.delete(client.persistentID);
        // Close lobby when host leaves before game starts
        if (
          !this.isPublic() &&
          client.persistentID === this.creatorPersistentID
        ) {
          this.log.info("Host left, closing lobby", {
            gameID: this.id,
          });
          for (const c of [...this.activeClients]) {
            this.kickClient(c.clientID, KICK_REASON_HOST_LEFT);
          }
          this._hasEnded = true;
        }
      }
    });
    client.ws.on("error", (error: Error) => {
      if ((error as any).code === "WS_ERR_UNEXPECTED_RSV_1") {
        client.ws.close(1002, "WS_ERR_UNEXPECTED_RSV_1");
      }
    });

    // Check if WebSocket already closed before we added the listener (race condition)
    if (client.ws.readyState >= 2) {
      this.log.info("client WebSocket already closing/closed, removing", {
        clientID: client.clientID,
        readyState: client.ws.readyState,
      });
      this.activeClients = this.activeClients.filter(
        (c) => c.clientID !== client.clientID,
      );
      // Remove persistentId if the game has not started to prevent going over max players
      if (!this._hasStarted) {
        this.persistentIdToClientId.delete(client.persistentID);
      }
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

  public prestart() {
    if (this.hasStarted()) {
      return;
    }
    this._hasPrestarted = true;

    const prestartMsg = ServerPrestartMessageSchema.safeParse({
      type: "prestart",
      gameMap: this.gameConfig.gameMap,
      gameMapSize: this.gameConfig.gameMapSize,
    });

    if (!prestartMsg.success) {
      console.error(
        `error creating prestart message for game ${this.id}, ${prestartMsg.error}`.substring(
          0,
          250,
        ),
      );
      return;
    }

    const msg = JSON.stringify(prestartMsg.data);
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
        const msg = JSON.stringify({
          type: "lobby_info",
          lobby: shared ?? this.gameInfo(c.clientID),
          myClientID: c.clientID,
        } satisfies ServerLobbyInfoMessage);
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

    const friendsFor = this.buildFriendsLookup();

    const result = GameStartInfoSchema.safeParse({
      gameID: this.id,
      lobbyCreatedAt: this.createdAt,
      visibleAt: this.visibleAt,
      config: this.gameConfig,
      players: this.activeClients.map((c) => ({
        username: c.username,
        clanTag: c.clanTag ?? null,
        clientID: c.clientID,
        cosmetics: c.cosmetics,
        isLobbyCreator: this.lobbyCreatorID === c.clientID,
        friends: friendsFor(c),
      })),
    });
    if (!result.success) {
      const error = z.prettifyError(result.error);
      this.log.error("Error parsing game start info", { message: error });
      return;
    }
    this.gameStartInfo = result.data satisfies GameStartInfo;
    this.wireGameStartInfo = this.gameConfig.disableClanTags
      ? {
          ...this.gameStartInfo,
          players: this.gameStartInfo.players.map((p) => ({
            ...p,
            clanTag: null,
          })),
        }
      : this.gameStartInfo;

    this.endTurnIntervalID = setInterval(
      () => this.endTurn(),
      ServerEnv.turnIntervalMs(),
    );
    this.activeClients.forEach((c) => {
      this.log.info("sending start message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      this.sendStartGameMsg(c.ws, 0);
    });
  }

  private addIntent(intent: StampedIntent) {
    this.intents.push(intent);
  }

  // Per-viewer start info. The real gameStartInfo is untouched, so the
  // archived record keeps real identities. clanTag and friends feed the
  // deterministic team assignment (TeamAssignment.ts), so they are blanked
  // for every player here, identical on every client, never per-viewer, or
  // clients desync. Only the username of players this viewer can't see is
  // anonymized, and their cosmetics hidden, neither of which the simulation
  // reads.
  private startInfoFor(viewer: ClientID): GameStartInfo {
    if (!this.gameConfig.anonymizeNames) return this.wireGameStartInfo;
    return {
      ...this.wireGameStartInfo,
      players: this.wireGameStartInfo.players.map((p) => {
        const real = this.seesReal(viewer, p.clientID);
        return {
          ...p,
          username: real ? p.username : this.anonName(viewer, p.clientID),
          clanTag: null,
          friends: undefined,
          cosmetics: real ? p.cosmetics : undefined,
        };
      }),
    };
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
        JSON.stringify({
          type: "start",
          turns: this.turns.slice(lastTurn),
          gameStartInfo: this.startInfoFor(client.clientID),
          lobbyCreatedAt: this.createdAt,
          myClientID: client.clientID,
        } satisfies ServerStartGameMessage),
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

    this.handleSynchronization();
    this.checkDisconnectedStatus();

    const msg = JSON.stringify({
      type: "turn",
      turn: pastTurn,
    } satisfies ServerTurnMessage);
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
  }

  phase(): GamePhase {
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
    this.activeClients = alive;
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
    const friendsFor = this.buildFriendsLookup();
    const hideClanTags = this.gameConfig.disableClanTags ?? false;
    return {
      gameID: this.id,
      clients: this.activeClients.map((c) =>
        this.seesReal(viewer, c.clientID)
          ? {
              username: c.username,
              clanTag: hideClanTags ? null : (c.clanTag ?? null),
              clientID: c.clientID,
              friends: friendsFor(c),
            }
          : {
              username: this.anonName(viewer, c.clientID),
              clanTag: null,
              clientID: c.clientID,
            },
      ),
      lobbyCreatorClientID: this.lobbyCreatorID,
      gameConfig: this.gameConfig,
      startsAt: this.startsAt,
      serverTime: Date.now(),
      publicGameType: this.publicGameType,
    };
  }

  // Maps each active client's publicId-based friends list to in-game
  // clientIDs, dropping friends not present in this game. Returns undefined
  // when no friends are present so the field can be omitted from the wire
  // payload.
  private buildFriendsLookup(): (client: Client) => ClientID[] | undefined {
    const publicIdToClientID = new Map<string, ClientID>();
    for (const c of this.activeClients) {
      if (c.publicId) publicIdToClientID.set(c.publicId, c.clientID);
    }
    return (client: Client) => {
      const friendClientIDs = client.friends
        .map((pid) => publicIdToClientID.get(pid))
        .filter((id): id is ClientID => id !== undefined);
      return friendClientIDs.length > 0 ? friendClientIDs : undefined;
    };
  }

  public isPublic(): boolean {
    return this.gameConfig.gameType === GameType.Public;
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
          JSON.stringify({
            type: "error",
            error: reasonKey,
          } satisfies ServerErrorMessage),
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
        } satisfies PlayerRecord;
      },
    );
    archive(
      finalizeGameRecord(
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
        ),
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

    const desyncMsg = JSON.stringify(serverDesync.data);
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

    // Add client vote
    const winnerKey = JSON.stringify(clientMsg.winner);
    const activeUniqueIPs = new Set(this.activeClients.map((c) => c.ip)).size;
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

    const activeUniqueIPs = new Set(this.activeClients.map((c) => c.ip)).size;
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
    players: (PlayerLiveStats & {
      username: string | null;
      publicID: string | null;
      connected: boolean;
    })[];
  } | null {
    if (this.latestLiveStats === null) {
      return null;
    }
    return {
      turn: this.latestLiveStats.turn,
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
