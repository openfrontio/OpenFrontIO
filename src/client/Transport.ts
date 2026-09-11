import { ClientEnv } from "src/client/ClientEnv";
import { ZbContext } from "../../zbin";
import {
  CloseCode,
  CloseReason,
  isCloseReason,
  isTerminalClose,
} from "../core/CloseCodes";
import { EventBus, GameEvent } from "../core/EventBus";
import {
  AllPlayers,
  GameType,
  Gold,
  PlayerID,
  Tick,
  UnitType,
} from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";
import {
  AllPlayersStats,
  ClientHashMessage,
  ClientID,
  ClientIntentMessage,
  ClientJoinMessage,
  ClientMessage,
  ClientPingMessage,
  ClientRejoinMessage,
  ClientReportMessage,
  ClientSendLiveStatsMessage,
  ClientSendWinnerMessage,
  ClientSpectateMessage,
  GameConfig,
  Intent,
  LiveStats,
  ReportReason,
  ServerMessage,
  Winner,
} from "../core/Schemas";
import {
  createGameWireContext,
  decodeServerMessage,
  encodeClientMessage,
} from "../core/ZbinWire";
import { getPlayToken } from "./Auth";
import { LobbyConfig } from "./ClientGameRunner";
import { isDesktopShell } from "./DesktopShell";
import { showInGameConfirm } from "./InGameModal";
import { LocalServer } from "./LocalServer";
import { homeHref, translateText } from "./Utils";
import { PlayerView } from "./view";

export class PauseGameIntentEvent implements GameEvent {
  constructor(public readonly paused: boolean) {}
}

export class SendAllianceRequestIntentEvent implements GameEvent {
  constructor(
    public readonly requestor: PlayerView,
    public readonly recipient: PlayerView,
  ) {}
}

export class SendBreakAllianceIntentEvent implements GameEvent {
  constructor(
    public readonly requestor: PlayerView,
    public readonly recipient: PlayerView,
  ) {}
}

export class SendUpgradeStructureIntentEvent implements GameEvent {
  constructor(
    public readonly unitId: number,
    public readonly unitType: UnitType,
    public readonly amount: number = 1,
  ) {}
}

export class SendAllianceRejectIntentEvent implements GameEvent {
  constructor(public readonly requestor: PlayerView) {}
}

export class SendAllianceExtensionIntentEvent implements GameEvent {
  constructor(public readonly recipient: PlayerView) {}
}

export class SendSpawnIntentEvent implements GameEvent {
  constructor(public readonly tile: TileRef) {}
}

export class SendAttackIntentEvent implements GameEvent {
  constructor(
    public readonly targetID: PlayerID | null,
    public readonly troops: number,
  ) {}
}

export class SendBoatAttackIntentEvent implements GameEvent {
  constructor(
    public readonly dst: TileRef,
    public readonly troops: number,
  ) {}
}

export class BuildUnitIntentEvent implements GameEvent {
  constructor(
    public readonly unit: UnitType,
    public readonly tile: TileRef,
    public readonly rocketDirectionUp?: boolean,
    public readonly amount?: number,
  ) {}
}

export class SendTargetPlayerIntentEvent implements GameEvent {
  constructor(public readonly targetID: PlayerID) {}
}

export class SendEmojiIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView | typeof AllPlayers,
    public readonly emoji: number,
  ) {}
}

export class SendDonateGoldIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly gold: Gold | null,
  ) {}
}

export class SendDonateTroopsIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly troops: number | null,
  ) {}
}

export class SendQuickChatEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly quickChatKey: string,
    public readonly target?: PlayerID,
  ) {}
}

export class SendEmbargoIntentEvent implements GameEvent {
  constructor(
    public readonly target: PlayerView,
    public readonly action: "start" | "stop",
  ) {}
}

export class SendEmbargoAllIntentEvent implements GameEvent {
  constructor(public readonly action: "start" | "stop") {}
}

export class SendDeleteUnitIntentEvent implements GameEvent {
  constructor(public readonly unitId: number) {}
}

export class CancelAttackIntentEvent implements GameEvent {
  constructor(public readonly attackID: string) {}
}

export class CancelBoatIntentEvent implements GameEvent {
  constructor(public readonly unitID: number) {}
}

export class SendWinnerEvent implements GameEvent {
  constructor(
    public readonly winner: Winner,
    public readonly allPlayersStats: AllPlayersStats,
  ) {}
}
export class SendLiveStatsEvent implements GameEvent {
  constructor(public readonly stats: LiveStats) {}
}
export class SendPlayerReportEvent implements GameEvent {
  constructor(
    public readonly reported: ClientID,
    public readonly reason: ReportReason,
  ) {}
}
// Emitted once a report has actually gone to the server, so the UI only
// marks a player as reported when it has been.
export class PlayerReportedEvent implements GameEvent {
  constructor(public readonly reported: ClientID) {}
}
export class SendHashEvent implements GameEvent {
  constructor(
    public readonly tick: Tick,
    public readonly hash: number,
  ) {}
}

// Emitted when the server tells us the host started a successor lobby, carrying
// the new game id to move the group to.
export class NewLobbyEvent implements GameEvent {
  constructor(public readonly gameID: string) {}
}

export class MoveWarshipIntentEvent implements GameEvent {
  constructor(
    public readonly unitIds: number[],
    public readonly tile: number,
  ) {}
}

export class SendKickPlayerIntentEvent implements GameEvent {
  constructor(public readonly target: string) {}
}

export class SendUpdateGameConfigIntentEvent implements GameEvent {
  constructor(public readonly config: Partial<GameConfig>) {}
}

export class SendToggleGameStartTimer implements GameEvent {
  constructor() {}
}

// Switch between playing and watching from the lobby screen.
export class SendSpectateEvent implements GameEvent {
  constructor(public readonly spectator: boolean) {}
}

export class Transport {
  // Retry budget for a dropped game socket. The first retry is immediate (a
  // blip should not cost a second), then exponential from the base to the
  // cap with +/-25% jitter: about 90s nominal over ten attempts, 68-113s with
  // jitter — enough to ride out a router reboot or a worker restart, short
  // enough not to leave a frozen map on screen for minutes. Every requester
  // (onclose, ClientGameRunner's silence watchdog, a send on a closed
  // socket) goes through scheduleReconnect, so this is the only budget.
  static readonly RECONNECT_MAX_ATTEMPTS = 10;
  static readonly RECONNECT_BASE_DELAY_MS = 1000;
  static readonly RECONNECT_MAX_DELAY_MS = 15_000;

  private socket: WebSocket | null = null;

  private localServer: LocalServer;

  private buffer: ClientMessage[] = [];

  private onconnect: () => void;
  private onmessage: (msg: ServerMessage) => void;

  private pingInterval: number | null = null;
  private reconnectTimeout: number | null = null;
  // Consecutive retries that have not yet produced a server frame.
  private reconnectAttempts = 0;
  public readonly isLocal: boolean;
  // Latched by a terminal close (a rejection the server will repeat), by
  // exhausting the reconnect budget, and by leaving the game. Blocks
  // scheduleReconnect and connectRemote so nothing reopens the socket.
  private connectionRefused = false;

  // True once the server has responded to join/rejoin (via start or lobby_info),
  // proving the session is admitted and ready to accept gameplay intents.
  private isSessionReady = false;

  // clientID dictionary for the binary wire (see ZbinWire.ts), seeded from
  // the roster in the start message. Null until the game starts, which is
  // also the last moment a peer can send a dictionary-encoded field.
  private zbinCtx: ZbContext | null = null;

  constructor(
    private lobbyConfig: LobbyConfig,
    private eventBus: EventBus,
  ) {
    // If gameRecord is not null, we are replaying an archived game.
    // For multiplayer games, GameConfig is not known until game starts.
    this.isLocal =
      lobbyConfig.gameRecord !== undefined ||
      lobbyConfig.gameStartInfo?.config.gameType === GameType.Singleplayer;

    this.eventBus.on(SendAllianceRequestIntentEvent, (e) =>
      this.onSendAllianceRequest(e),
    );
    this.eventBus.on(SendAllianceRejectIntentEvent, (e) =>
      this.onAllianceRejectUIEvent(e),
    );
    this.eventBus.on(SendAllianceExtensionIntentEvent, (e) =>
      this.onSendAllianceExtensionIntent(e),
    );
    this.eventBus.on(SendBreakAllianceIntentEvent, (e) =>
      this.onBreakAllianceRequestUIEvent(e),
    );
    this.eventBus.on(SendSpawnIntentEvent, (e) =>
      this.onSendSpawnIntentEvent(e),
    );
    this.eventBus.on(SendAttackIntentEvent, (e) => this.onSendAttackIntent(e));
    this.eventBus.on(SendUpgradeStructureIntentEvent, (e) =>
      this.onSendUpgradeStructureIntent(e),
    );
    this.eventBus.on(SendBoatAttackIntentEvent, (e) =>
      this.onSendBoatAttackIntent(e),
    );
    this.eventBus.on(SendTargetPlayerIntentEvent, (e) =>
      this.onSendTargetPlayerIntent(e),
    );
    this.eventBus.on(SendEmojiIntentEvent, (e) => this.onSendEmojiIntent(e));
    this.eventBus.on(SendDonateGoldIntentEvent, (e) =>
      this.onSendDonateGoldIntent(e),
    );
    this.eventBus.on(SendDonateTroopsIntentEvent, (e) =>
      this.onSendDonateTroopIntent(e),
    );
    this.eventBus.on(SendQuickChatEvent, (e) => this.onSendQuickChatIntent(e));
    this.eventBus.on(SendEmbargoIntentEvent, (e) =>
      this.onSendEmbargoIntent(e),
    );
    this.eventBus.on(SendEmbargoAllIntentEvent, (e) =>
      this.onSendEmbargoAllIntent(e),
    );
    this.eventBus.on(BuildUnitIntentEvent, (e) => this.onBuildUnitIntent(e));

    this.eventBus.on(PauseGameIntentEvent, (e) => this.onPauseGameIntent(e));
    this.eventBus.on(SendWinnerEvent, (e) => this.onSendWinnerEvent(e));
    this.eventBus.on(SendLiveStatsEvent, (e) => this.onSendLiveStatsEvent(e));
    this.eventBus.on(SendPlayerReportEvent, (e) =>
      this.onSendPlayerReportEvent(e),
    );
    this.eventBus.on(SendHashEvent, (e) => this.onSendHashEvent(e));
    this.eventBus.on(CancelAttackIntentEvent, (e) =>
      this.onCancelAttackIntentEvent(e),
    );
    this.eventBus.on(CancelBoatIntentEvent, (e) =>
      this.onCancelBoatIntentEvent(e),
    );

    this.eventBus.on(MoveWarshipIntentEvent, (e) => {
      this.onMoveWarshipEvent(e);
    });

    this.eventBus.on(SendDeleteUnitIntentEvent, (e) =>
      this.onSendDeleteUnitIntent(e),
    );

    this.eventBus.on(SendKickPlayerIntentEvent, (e) =>
      this.onSendKickPlayerIntent(e),
    );

    this.eventBus.on(SendUpdateGameConfigIntentEvent, (e) =>
      this.onSendUpdateGameConfigIntent(e),
    );

    this.eventBus.on(SendToggleGameStartTimer, (e) =>
      this.onSendToggleGameStartTimer(e),
    );
    this.eventBus.on(SendSpectateEvent, (e) => {
      this.lobbyConfig.spectator = e.spectator;
      this.sendMsg({
        type: "spectate",
        spectator: e.spectator,
      } satisfies ClientSpectateMessage);
    });
  }

  private startPing() {
    if (this.isLocal) return;
    this.pingInterval ??= window.setInterval(() => {
      if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
        this.sendMsg({
          type: "ping",
        } satisfies ClientPingMessage);
      }
    }, 5 * 1000);
  }

  private stopPing() {
    if (this.pingInterval) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public connect(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.isLocal) {
      this.connectLocal(onconnect, onmessage);
    } else {
      this.connectRemote(onconnect, onmessage);
    }
  }

  public updateCallback(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.isLocal) {
      this.localServer.updateCallback(onconnect, onmessage);
    } else {
      this.onconnect = onconnect;
      this.onmessage = onmessage;
    }
  }

  private connectLocal(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.localServer = new LocalServer(
      this.lobbyConfig,
      this.lobbyConfig.gameRecord !== undefined,
      this.eventBus,
    );
    this.localServer.updateCallback(onconnect, onmessage);
    this.localServer.start();
  }

  private connectRemote(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.connectionRefused) {
      return;
    }
    this.isSessionReady = false;
    this.startPing();
    this.killExistingSocket();
    // WS origin comes from ClientEnv, resolved per game: the id's letter
    // names the hosting deployment, so a shared lobby link or rejoin works
    // from any shell in the fleet. Own/legacy ids keep the historical
    // behavior (same-origin on web, serverHost on the desktop app).
    const workerPath = ClientEnv.gameWorkerPath(this.lobbyConfig.gameID);
    this.socket = new WebSocket(
      `${ClientEnv.gameWsBase(this.lobbyConfig.gameID)}/${workerPath}`,
    );
    // Every frame is a zbin payload; without this they would arrive as Blobs.
    this.socket.binaryType = "arraybuffer";
    this.onconnect = onconnect;
    this.onmessage = onmessage;
    this.socket.onopen = () => {
      console.log("Connected to game server!");
      if (this.socket === null) {
        console.error("socket is null");
        return;
      }
      onconnect();
    };
    this.socket.onmessage = (event: MessageEvent) => {
      // A frame from the server is the proof the connection is real; onopen
      // is not (a proxy can accept and drop us in a loop). It resets the
      // budget and settles any retry the watchdog scheduled while this
      // socket was silent — left armed, it would tear down the socket that
      // just recovered.
      this.reconnectAttempts = 0;
      this.cancelReconnect();
      try {
        const msg = decodeServerMessage(
          new Uint8Array(event.data as ArrayBuffer),
          this.zbinCtx ?? undefined,
        );
        if (msg.type === "start") {
          // Seed the dictionary from the same players array, in the same
          // order, that the server seeded its own from.
          this.zbinCtx = createGameWireContext(msg.gameStartInfo.players);
        }
        this.isSessionReady = true;
        this.flushBuffer();
        this.onmessage(msg);
      } catch (e) {
        // Deliberately NOT the frame. This catch wraps the downstream
        // handler as well as the decode, so it fires on ordinary
        // application errors too — and the desktop shell persists
        // console.error by default, while a lobby_info or start frame
        // carries the game's group token in the clear. For a decode failure
        // the size is the part that actually helps.
        //
        // The size goes in its own argument rather than interpolated into
        // the first one: console.* treats argument one as a format string
        // (%s, %d, %o), so building it from anything that came off the wire
        // is a format-string sink even when the value can only ever be
        // digits (CodeQL js/tainted-format-string).
        const frame =
          event.data instanceof ArrayBuffer
            ? `${event.data.byteLength} bytes`
            : typeof event.data;
        console.error("Error in onmessage handler:", e, "frame:", frame);
        return;
      }
    };
    this.socket.onerror = (err) => {
      console.error("Socket encountered error: ", err, "Closing socket");
      if (this.socket === null) return;
      this.socket.close();
    };
    this.socket.onclose = (event: CloseEvent) => {
      this.isSessionReady = false;
      console.log(
        `WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`,
      );
      if (isTerminalClose(event.code)) {
        if (event.code === CloseCode.Normal) {
          // The server ended the session (game over, kick): nothing to say
          // and nothing to retry. Latch, or the silence watchdog would open
          // a fresh socket 5s later only to be refused with "game not found".
          this.connectionRefused = true;
          this.stopPing();
        } else {
          this.handleConnectionRefused(event.reason);
        }
        return;
      }
      console.log(`received error code ${event.code}, reconnecting`);
      this.scheduleReconnect();
    };
  }

  private handleConnectionRefused(reason: string) {
    if (this.connectionRefused) {
      return;
    }
    this.connectionRefused = true;
    this.stopPing();
    // WrongWorker: the worker says it doesn't own this game, which means
    // this bundle routed with a stale worker count. One full navigation to
    // the game's own host re-fetches shell + cluster map and re-resolves;
    // the sessionStorage latch stops a loop if the fresh map still
    // misroutes (a real bug), falling through to the dialog instead. Not on
    // desktop: its shell owns navigation and updates its map at boot.
    if (reason === CloseReason.WrongWorker && !isDesktopShell()) {
      const gameID = this.lobbyConfig.gameID;
      const latch = `wrong-worker-redirect:${gameID}`;
      if (sessionStorage.getItem(latch) === null) {
        sessionStorage.setItem(latch, "1");
        window.location.href = `${ClientEnv.gameHttpBase(gameID)}/game/${gameID}${window.location.search}`;
        return;
      }
    }
    // The reason is a close_reason.* key the server chose. Anything else (a
    // proxy closing on its own, an empty reason) gets the generic text
    // rather than a bare key.
    const reasonKey = isCloseReason(reason) ? reason : CloseReason.Unknown;
    this.showTerminalDialog(
      translateText("error_modal.connection_refused", {
        reason: translateText(reasonKey),
      }),
    );
  }

  // The session is over: say so once, offer the menu, and let the player
  // stay to look at the map if they would rather.
  private showTerminalDialog(message: string) {
    void showInGameConfirm(message, {
      variant: "warning",
      confirmText: translateText("win_modal.exit"),
      cancelText: translateText("common.close"),
    }).then((goHome) => {
      if (goHome) {
        window.location.href = homeHref();
      }
    });
  }

  // Ask for a reconnect. Callers do not decide when (or whether) it happens:
  // one attempt is scheduled at a time, on the backoff schedule, until the
  // budget runs out.
  public reconnect() {
    if (this.isLocal) {
      this.connect(this.onconnect, this.onmessage);
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.connectionRefused || this.reconnectTimeout !== null) {
      return;
    }
    // An attempt is already in flight; let it succeed or fail on its own.
    if (this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.reconnectAttempts >= Transport.RECONNECT_MAX_ATTEMPTS) {
      console.error(
        `giving up after ${this.reconnectAttempts} reconnect attempts`,
      );
      this.connectionRefused = true;
      this.stopPing();
      this.showTerminalDialog(translateText("error_modal.connection_lost"));
      return;
    }
    this.reconnectAttempts++;
    const delay = Transport.reconnectDelay(this.reconnectAttempts);
    console.log(
      `reconnect attempt ${this.reconnectAttempts}/${Transport.RECONNECT_MAX_ATTEMPTS} in ${delay} ms`,
    );
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connectRemote(this.onconnect, this.onmessage);
    }, delay);
  }

  // Delay before the n-th consecutive attempt (1-based).
  static reconnectDelay(attempt: number): number {
    if (attempt <= 1) {
      return 0;
    }
    const nominal = Math.min(
      Transport.RECONNECT_MAX_DELAY_MS,
      Transport.RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 2),
    );
    // Jitter so a fleet of clients dropped by one worker restart does not
    // come back in lockstep.
    return Math.round(nominal * (0.75 + Math.random() * 0.5));
  }

  private cancelReconnect() {
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  public turnComplete() {
    if (this.isLocal) {
      this.localServer.turnComplete();
    }
  }

  async joinGame() {
    this.sendMsg({
      type: "join",
      gameID: this.lobbyConfig.gameID,
      // Note: clientID is not sent - server assigns it based on persistentID
      username: this.lobbyConfig.playerName,
      clanTag: this.lobbyConfig.playerClanTag ?? null,
      cosmetics: this.lobbyConfig.cosmetics,
      turnstileToken: this.lobbyConfig.turnstileToken,
      token: await getPlayToken(),
      spectator: this.lobbyConfig.spectator,
      gitCommit: ClientEnv.gitCommit(),
    } satisfies ClientJoinMessage);
  }

  async rejoinGame(lastTurn: number) {
    this.sendMsg({
      type: "rejoin",
      gameID: this.lobbyConfig.gameID,
      // Note: clientID is not sent - server looks it up from persistentID in token
      lastTurn: lastTurn,
      token: await getPlayToken(),
      gitCommit: ClientEnv.gitCommit(),
    } satisfies ClientRejoinMessage);
  }

  leaveGame() {
    if (this.isLocal) {
      this.localServer.endGame();
      return;
    }
    // A left game is never rejoined through this transport, whatever still
    // asks (the watchdog, a late send).
    this.connectionRefused = true;
    this.stopPing();
    this.cancelReconnect();
    if (this.socket === null) return;
    if (this.socket.readyState === WebSocket.OPEN) {
      console.log("on stop: leaving game");
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket.readyState,
      );
    }
    this.killExistingSocket();
  }

  private onSendAllianceRequest(event: SendAllianceRequestIntentEvent) {
    this.sendIntent({
      type: "allianceRequest",
      recipient: event.recipient.id(),
    });
  }

  private onAllianceRejectUIEvent(event: SendAllianceRejectIntentEvent) {
    this.sendIntent({
      type: "allianceReject",
      requestor: event.requestor.id(),
    });
  }

  private onBreakAllianceRequestUIEvent(event: SendBreakAllianceIntentEvent) {
    this.sendIntent({
      type: "breakAlliance",
      recipient: event.recipient.id(),
    });
  }

  private onSendAllianceExtensionIntent(
    event: SendAllianceExtensionIntentEvent,
  ) {
    this.sendIntent({
      type: "allianceExtension",
      recipient: event.recipient.id(),
    });
  }

  private onSendSpawnIntentEvent(event: SendSpawnIntentEvent) {
    this.sendIntent({
      type: "spawn",
      tile: event.tile,
    });
  }

  private onSendAttackIntent(event: SendAttackIntentEvent) {
    this.sendIntent({
      type: "attack",
      targetID: event.targetID,
      troops: event.troops,
    });
  }

  private onSendBoatAttackIntent(event: SendBoatAttackIntentEvent) {
    this.sendIntent({
      type: "boat",
      troops: event.troops,
      dst: event.dst,
    });
  }

  private onSendUpgradeStructureIntent(event: SendUpgradeStructureIntentEvent) {
    this.sendIntent({
      type: "upgrade_structure",
      unit: event.unitType,
      unitId: event.unitId,
      amount: event.amount,
    });
  }

  private onSendTargetPlayerIntent(event: SendTargetPlayerIntentEvent) {
    this.sendIntent({
      type: "targetPlayer",
      target: event.targetID,
    });
  }

  private onSendEmojiIntent(event: SendEmojiIntentEvent) {
    this.sendIntent({
      type: "emoji",
      recipient:
        event.recipient === AllPlayers ? AllPlayers : event.recipient.id(),
      emoji: event.emoji,
    });
  }

  private onSendDonateGoldIntent(event: SendDonateGoldIntentEvent) {
    this.sendIntent({
      type: "donate_gold",
      recipient: event.recipient.id(),
      gold: event.gold ? Number(event.gold) : null,
    });
  }

  private onSendDonateTroopIntent(event: SendDonateTroopsIntentEvent) {
    this.sendIntent({
      type: "donate_troops",
      recipient: event.recipient.id(),
      troops: event.troops,
    });
  }

  private onSendQuickChatIntent(event: SendQuickChatEvent) {
    this.sendIntent({
      type: "quick_chat",
      recipient: event.recipient.id(),
      quickChatKey: event.quickChatKey,
      target: event.target,
    });
  }

  private onSendEmbargoIntent(event: SendEmbargoIntentEvent) {
    this.sendIntent({
      type: "embargo",
      targetID: event.target.id(),
      action: event.action,
    });
  }

  private onSendEmbargoAllIntent(event: SendEmbargoAllIntentEvent) {
    this.sendIntent({
      type: "embargo_all",
      action: event.action,
    });
  }

  private onBuildUnitIntent(event: BuildUnitIntentEvent) {
    this.sendIntent({
      type: "build_unit",
      unit: event.unit,
      tile: event.tile,
      rocketDirectionUp: event.rocketDirectionUp,
      amount: event.amount,
    });
  }

  private onPauseGameIntent(event: PauseGameIntentEvent) {
    this.sendIntent({
      type: "toggle_pause",
      paused: event.paused,
    });
  }

  private onSendWinnerEvent(event: SendWinnerEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "winner",
        winner: event.winner,
        allPlayersStats: event.allPlayersStats,
      } satisfies ClientSendWinnerMessage);
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket?.readyState,
      );
      console.log("attempting reconnect");
    }
  }

  private onSendLiveStatsEvent(event: SendLiveStatsEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "live_stats",
        stats: event.stats,
      } satisfies ClientSendLiveStatsMessage);
    }
  }

  private onSendPlayerReportEvent(event: SendPlayerReportEvent) {
    // Singleplayer records are client-authored and the API ignores their
    // reports, so there is nowhere for one to go.
    if (this.isLocal) return;
    if (this.socket?.readyState !== WebSocket.OPEN) {
      console.log(
        "WebSocket is not open, dropping report. Current state:",
        this.socket?.readyState,
      );
      return;
    }
    this.sendMsg({
      type: "report",
      reported: event.reported,
      reason: event.reason,
    } satisfies ClientReportMessage);
    this.eventBus.emit(new PlayerReportedEvent(event.reported));
  }

  private onSendHashEvent(event: SendHashEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "hash",
        turnNumber: event.tick,
        hash: event.hash,
      } satisfies ClientHashMessage);
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket?.readyState,
      );
      console.log("attempting reconnect");
    }
  }

  private onCancelAttackIntentEvent(event: CancelAttackIntentEvent) {
    this.sendIntent({
      type: "cancel_attack",
      attackID: event.attackID,
    });
  }

  private onCancelBoatIntentEvent(event: CancelBoatIntentEvent) {
    this.sendIntent({
      type: "cancel_boat",
      unitID: event.unitID,
    });
  }

  private onMoveWarshipEvent(event: MoveWarshipIntentEvent) {
    this.sendIntent({
      type: "move_warship",
      unitIds: event.unitIds,
      tile: event.tile,
    });
  }

  private onSendDeleteUnitIntent(event: SendDeleteUnitIntentEvent) {
    this.sendIntent({
      type: "delete_unit",
      unitId: event.unitId,
    });
  }

  private onSendKickPlayerIntent(event: SendKickPlayerIntentEvent) {
    this.sendIntent({
      type: "kick_player",
      targetClientID: event.target,
    });
  }

  private onSendUpdateGameConfigIntent(event: SendUpdateGameConfigIntentEvent) {
    this.sendIntent({
      type: "update_game_config",
      config: event.config,
    });
  }

  private onSendToggleGameStartTimer(event: SendToggleGameStartTimer) {
    this.sendIntent({ type: "toggle_game_start_timer" });
  }

  private sendIntent(intent: Intent) {
    const msg = {
      type: "intent",
      intent: intent,
    } satisfies ClientIntentMessage;
    this.sendMsg(msg);
  }

  private flushBuffer(): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    while (this.buffer.length > 0) {
      console.log("sending dropped message");
      const msg = this.buffer.shift();
      if (msg === undefined) {
        console.warn("msg is undefined");
        continue;
      }
      this.socket.send(encodeClientMessage(msg, this.zbinCtx ?? undefined));
    }
  }

  private sendMsg(msg: ClientMessage) {
    if (this.connectionRefused) {
      return;
    }
    if (this.isLocal) {
      // Forward message to local server
      this.localServer.onMessage(msg);
      return;
    } else if (this.socket === null) {
      // Socket missing, do nothing
      return;
    }

    const isHandshakeMsg =
      msg.type === "join" || msg.type === "rejoin" || msg.type === "ping";

    if (this.socket.readyState !== WebSocket.OPEN) {
      // Buffer the message for the next successful open.
      console.warn("socket not ready, buffering and reconnecting");
      this.buffer.push(msg);
      this.scheduleReconnect();
    } else if (
      !isHandshakeMsg &&
      (!this.isSessionReady || this.buffer.length > 0)
    ) {
      // Hold non-handshake messages until the session handshake is complete,
      // and keep them queued behind any previously buffered messages.
      this.buffer.push(msg);
    } else {
      // Send the message directly
      this.socket.send(encodeClientMessage(msg, this.zbinCtx ?? undefined));
    }
  }

  private killExistingSocket(): void {
    this.isSessionReady = false;
    if (this.socket === null) {
      return;
    }
    // Remove all event listeners
    this.socket.onmessage = null;
    this.socket.onopen = null;
    this.socket.onclose = null;
    this.socket.onerror = null;

    // Close the connection if it's still open or still connecting
    try {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
    } catch (e) {
      console.warn("Error while closing WebSocket:", e);
    }

    this.socket = null;
  }
}
