import { ServerConfig } from "../core/configuration/Config";
import { SendLogEvent } from "../core/Consolex";
import { EventBus, GameEvent } from "../core/EventBus";
import {
  AllPlayers,
  Cell,
  GameType,
  PlayerID,
  PlayerType,
  UnitType,
} from "../core/game/Game";
import { PlayerView } from "../core/game/GameView";
import {
  ClientID,
  ClientIntentMessageSchema,
  ClientJoinMessageSchema,
  ClientLogMessageSchema,
  ClientPingMessageSchema,
  ClientSendWinnerSchema,
  GameConfig,
  Intent,
  ServerMessage,
  ServerMessageSchema,
} from "../core/Schemas";
import { LobbyConfig } from "./ClientGameRunner";
import { LocalServer } from "./LocalServer";

export class PauseGameEvent implements GameEvent {
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

export class SendAllianceReplyIntentEvent implements GameEvent {
  constructor(
    // The original alliance requestor
    public readonly requestor: PlayerView,
    public readonly recipient: PlayerView,
    public readonly accepted: boolean,
  ) {}
}

export class SendSpawnIntentEvent implements GameEvent {
  constructor(public readonly cell: Cell) {}
}

export class SendAttackIntentEvent implements GameEvent {
  constructor(
    public readonly targetID: PlayerID,
    public readonly troops: number,
  ) {}
}

export class SendBoatAttackIntentEvent implements GameEvent {
  constructor(
    public readonly targetID: PlayerID,
    public readonly cell: Cell,
    public readonly troops: number,
  ) {}
}

export class BuildUnitIntentEvent implements GameEvent {
  constructor(
    public readonly unit: UnitType,
    public readonly cell: Cell,
  ) {}
}

export class SendTargetPlayerIntentEvent implements GameEvent {
  constructor(public readonly targetID: PlayerID) {}
}

export class SendEmojiIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView | typeof AllPlayers,
    public readonly emoji: string,
  ) {}
}

export class SendDonateIntentEvent implements GameEvent {
  constructor(
    public readonly sender: PlayerView,
    public readonly recipient: PlayerView,
    public readonly troops: number | null,
  ) {}
}

export class SendSetTargetTroopRatioEvent implements GameEvent {
  constructor(public readonly ratio: number) {}
}

export class SendWinnerEvent implements GameEvent {
  constructor(public readonly winner: ClientID) {}
}

export class Transport {
  private socket: WebSocket;

  private localServer: LocalServer;

  private buffer: string[] = [];

  private onconnect: () => void;
  private onmessage: (msg: ServerMessage) => void;

  private pingInterval: number | null = null;
  private isLocal: boolean;

  constructor(
    private lobbyConfig: LobbyConfig,
    // gameConfig only set on private games
    private gameConfig: GameConfig | null,
    private eventBus: EventBus,
    private serverConfig: ServerConfig,
  ) {
    this.isLocal = lobbyConfig.gameType == GameType.Singleplayer;

    this.eventBus.on(SendAllianceRequestIntentEvent, (e) =>
      this.onSendAllianceRequest(e),
    );
    this.eventBus.on(SendAllianceReplyIntentEvent, (e) =>
      this.onAllianceRequestReplyUIEvent(e),
    );
    this.eventBus.on(SendBreakAllianceIntentEvent, (e) =>
      this.onBreakAllianceRequestUIEvent(e),
    );
    this.eventBus.on(SendSpawnIntentEvent, (e) =>
      this.onSendSpawnIntentEvent(e),
    );
    this.eventBus.on(SendAttackIntentEvent, (e) => this.onSendAttackIntent(e));
    this.eventBus.on(SendBoatAttackIntentEvent, (e) =>
      this.onSendBoatAttackIntent(e),
    );
    this.eventBus.on(SendTargetPlayerIntentEvent, (e) =>
      this.onSendTargetPlayerIntent(e),
    );
    this.eventBus.on(SendEmojiIntentEvent, (e) => this.onSendEmojiIntent(e));
    this.eventBus.on(SendDonateIntentEvent, (e) => this.onSendDonateIntent(e));
    this.eventBus.on(SendSetTargetTroopRatioEvent, (e) =>
      this.onSendSetTargetTroopRatioEvent(e),
    );
    this.eventBus.on(BuildUnitIntentEvent, (e) => this.onBuildUnitIntent(e));

    this.eventBus.on(SendLogEvent, (e) => this.onSendLogEvent(e));
    this.eventBus.on(PauseGameEvent, (e) => this.onPauseGameEvent(e));
    this.eventBus.on(SendWinnerEvent, (e) => this.onSendWinnerEvent(e));
  }

  private startPing() {
    if (this.isLocal || this.pingInterval) return;
    if (this.pingInterval == null) {
      this.pingInterval = window.setInterval(() => {
        if (this.socket != null && this.socket.readyState === WebSocket.OPEN) {
          this.sendMsg(
            JSON.stringify(
              ClientPingMessageSchema.parse({
                type: "ping",
                clientID: this.lobbyConfig.clientID,
                persistentID: this.lobbyConfig.persistentID,
                gameID: this.lobbyConfig.gameID,
              }),
            ),
          );
        }
      }, 5 * 1000);
    }
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

  private connectLocal(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.localServer = new LocalServer(
      this.serverConfig,
      this.gameConfig,
      this.lobbyConfig,
      onconnect,
      onmessage,
    );
    this.localServer.start();
  }

  private connectRemote(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.startPing();
    this.maybeKillSocket();
    const wsHost = process.env.WEBSOCKET_URL || window.location.host;
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${wsProtocol}//${wsHost}`);
    this.onconnect = onconnect;
    this.onmessage = onmessage;
    this.socket.onopen = () => {
      console.log("Connected to game server!");
      while (this.buffer.length > 0) {
        console.log("sending dropped message");
        this.sendMsg(this.buffer.pop());
      }
      onconnect();
    };
    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const serverMsg = ServerMessageSchema.parse(JSON.parse(event.data));
        this.onmessage(serverMsg);
      } catch (error) {
        console.error("Failed to process server message:", error);
      }
    };
    this.socket.onerror = (err) => {
      console.error("Socket encountered error: ", err, "Closing socket");
      this.socket.close();
    };
    this.socket.onclose = (event: CloseEvent) => {
      console.log(
        `WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`,
      );
      if (event.code != 1000) {
        console.log(`reconnecting`);
        this.connect(onconnect, onmessage);
      }
    };
  }

  private onSendLogEvent(event: SendLogEvent) {
    this.sendMsg(
      JSON.stringify(
        ClientLogMessageSchema.parse({
          type: "log",
          gameID: this.lobbyConfig.gameID,
          clientID: this.lobbyConfig.clientID,
          persistentID: this.lobbyConfig.persistentID,
          log: event.log,
          severity: event.severity,
        }),
      ),
    );
  }

  joinGame(numTurns: number) {
    this.sendMsg(
      JSON.stringify(
        ClientJoinMessageSchema.parse({
          type: "join",
          gameID: this.lobbyConfig.gameID,
          clientID: this.lobbyConfig.clientID,
          lastTurn: numTurns,
          persistentID: this.lobbyConfig.persistentID,
          username: this.lobbyConfig.playerName(),
        }),
      ),
    );
  }

  leaveGame() {
    if (this.isLocal) {
      this.localServer.endGame();
      return;
    }
    this.stopPing();
    if (this.socket.readyState === WebSocket.OPEN) {
      console.log("on stop: leaving game");
      this.socket.close();
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket.readyState,
      );
      console.error("attempting reconnect");
    }
    this.socket.onclose = (event: CloseEvent) => {};
  }

  private onSendAllianceRequest(event: SendAllianceRequestIntentEvent) {
    this.sendIntent({
      type: "allianceRequest",
      clientID: this.lobbyConfig.clientID,
      playerID: event.requestor.id(),
      recipient: event.recipient.id(),
    });
  }

  private onAllianceRequestReplyUIEvent(event: SendAllianceReplyIntentEvent) {
    this.sendIntent({
      type: "allianceRequestReply",
      clientID: this.lobbyConfig.clientID,
      requestor: event.requestor.id(),
      playerID: event.recipient.id(),
      accept: event.accepted,
    });
  }

  private onBreakAllianceRequestUIEvent(event: SendBreakAllianceIntentEvent) {
    this.sendIntent({
      type: "breakAlliance",
      clientID: this.lobbyConfig.clientID,
      playerID: event.requestor.id(),
      recipient: event.recipient.id(),
    });
  }

  private onSendSpawnIntentEvent(event: SendSpawnIntentEvent) {
    this.sendIntent({
      type: "spawn",
      clientID: this.lobbyConfig.clientID,
      playerID: this.lobbyConfig.playerID,
      flag: this.lobbyConfig.flag(),
      name: this.lobbyConfig.playerName(),
      playerType: PlayerType.Human,
      x: event.cell.x,
      y: event.cell.y,
    });
  }

  private onSendAttackIntent(event: SendAttackIntentEvent) {
    this.sendIntent({
      type: "attack",
      clientID: this.lobbyConfig.clientID,
      playerID: this.lobbyConfig.playerID,
      targetID: event.targetID,
      troops: event.troops,
    });
  }

  private onSendBoatAttackIntent(event: SendBoatAttackIntentEvent) {
    this.sendIntent({
      type: "boat",
      clientID: this.lobbyConfig.clientID,
      playerID: this.lobbyConfig.playerID,
      targetID: event.targetID,
      troops: event.troops,
      x: event.cell.x,
      y: event.cell.y,
    });
  }

  private onSendTargetPlayerIntent(event: SendTargetPlayerIntentEvent) {
    this.sendIntent({
      type: "targetPlayer",
      clientID: this.lobbyConfig.clientID,
      playerID: this.lobbyConfig.playerID,
      target: event.targetID,
    });
  }

  private onSendEmojiIntent(event: SendEmojiIntentEvent) {
    this.sendIntent({
      type: "emoji",
      clientID: this.lobbyConfig.clientID,
      playerID: this.lobbyConfig.playerID,
      recipient:
        event.recipient == AllPlayers ? AllPlayers : event.recipient.id(),
      emoji: event.emoji,
    });
  }

  private onSendDonateIntent(event: SendDonateIntentEvent) {
    this.sendIntent({
      type: "donate",
      clientID: this.lobbyConfig.clientID,
      playerID: event.sender.id(),
      recipient: event.recipient.id(),
      troops: event.troops,
    });
  }

  private onSendSetTargetTroopRatioEvent(event: SendSetTargetTroopRatioEvent) {
    this.sendIntent({
      type: "troop_ratio",
      clientID: this.lobbyConfig.clientID,
      playerID: this.lobbyConfig.playerID,
      ratio: event.ratio,
    });
  }

  private onBuildUnitIntent(event: BuildUnitIntentEvent) {
    this.sendIntent({
      type: "build_unit",
      clientID: this.lobbyConfig.clientID,
      playerID: this.lobbyConfig.playerID,
      unit: event.unit,
      x: event.cell.x,
      y: event.cell.y,
    });
  }

  private onPauseGameEvent(event: PauseGameEvent) {
    if (!this.isLocal) {
      console.log(`cannot pause multiplayer games`);
      return;
    }
    if (event.paused) {
      this.localServer.pause();
    } else {
      this.localServer.resume();
    }
  }

  private onSendWinnerEvent(event: SendWinnerEvent) {
    if (this.isLocal || this.socket.readyState === WebSocket.OPEN) {
      const msg = ClientSendWinnerSchema.parse({
        type: "winner",
        clientID: this.lobbyConfig.clientID,
        persistentID: this.lobbyConfig.persistentID,
        gameID: this.lobbyConfig.gameID,
        winner: event.winner,
      });
      this.sendMsg(JSON.stringify(msg));
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket.readyState,
      );
      console.log("attempting reconnect");
    }
  }

  private sendIntent(intent: Intent) {
    if (this.isLocal || this.socket.readyState === WebSocket.OPEN) {
      const msg = ClientIntentMessageSchema.parse({
        type: "intent",
        clientID: this.lobbyConfig.clientID,
        persistentID: this.lobbyConfig.persistentID,
        gameID: this.lobbyConfig.gameID,
        intent: intent,
      });
      this.sendMsg(JSON.stringify(msg));
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket.readyState,
      );
      console.log("attempting reconnect");
    }
  }

  private sendMsg(msg: string) {
    if (this.isLocal) {
      this.localServer.onMessage(msg);
    } else {
      if (
        this.socket.readyState == WebSocket.CLOSED ||
        this.socket.readyState == WebSocket.CLOSED
      ) {
        console.warn("socket not ready, closing and trying later");
        this.socket.close();
        this.socket = null;
        this.connectRemote(this.onconnect, this.onmessage);
        this.buffer.push(msg);
      } else {
        this.socket.send(msg);
      }
    }
  }

  private maybeKillSocket(): void {
    if (this.socket == null) {
      return;
    }
    // Remove all event listeners
    this.socket.onmessage = null;
    this.socket.onopen = null;
    this.socket.onclose = null;
    this.socket.onerror = null;

    // Close the connection if it's still open
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = null;
  }
}
