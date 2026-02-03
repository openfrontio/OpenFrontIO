import { Logger } from "winston";
import WebSocket from "ws";
import { ServerConfig } from "../core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../core/game/Game";
import { ClientRejoinMessage, GameConfig, GameID } from "../core/Schemas";
import { Client } from "./Client";
import { GamePhase, GameServer } from "./GameServer";

export class GameManager {
  private games: Map<GameID, GameServer> = new Map();

  constructor(
    private config: ServerConfig,
    private log: Logger,
  ) {
    setInterval(() => this.tick(), 1000);
  }

  public game(id: GameID): GameServer | null {
    return this.games.get(id) ?? null;
  }

  public publicLobbies(): GameServer[] {
    return Array.from(this.games.values()).filter(
      (g) => g.phase() === GamePhase.Lobby && g.isPublic(),
    );
  }

  joinClient(client: Client, gameID: GameID): boolean {
    const game = this.games.get(gameID);
    if (game) {
      game.joinClient(client);
      return true;
    }
    return false;
  }

  rejoinClient(
    ws: WebSocket,
    persistentID: string,
    msg: ClientRejoinMessage,
  ): boolean {
    const game = this.games.get(msg.gameID);
    if (game) {
      game.rejoinClient(ws, persistentID, msg);
      return true;
    }
    return false;
  }

  createGame(
    id: GameID,
    gameConfig: GameConfig | undefined,
    creatorClientID?: string,
    startsAt?: number,
  ) {
    const game = new GameServer(
      id,
      this.log,
      Date.now(),
      this.config,
      {
        donateGold: false,
        donateTroops: false,
        gameMap: GameMapType.World,
        gameType: GameType.Private,
        gameMapSize: GameMapSize.Normal,
        difficulty: Difficulty.Medium,
        disableNations: false,
        infiniteGold: false,
        infiniteTroops: false,
        maxTimerValue: undefined,
        instantBuild: false,
        randomSpawn: false,
        gameMode: GameMode.FFA,
        bots: 400,
        disabledUnits: [],
        ...gameConfig,
      },
      creatorClientID,
      startsAt,
    );
    this.games.set(id, game);
    return game;
  }

  activeGames(): number {
    return this.games.size;
  }

  activeClients(): number {
    let totalClients = 0;
    this.games.forEach((game: GameServer) => {
      totalClients += game.activeClients.length;
    });
    return totalClients;
  }

  desyncCount(): number {
    let totalDesyncs = 0;
    this.games.forEach((game: GameServer) => {
      totalDesyncs += game.desyncCount;
    });
    return totalDesyncs;
  }

  tick() {
    const active = new Map<GameID, GameServer>();
    for (const [id, game] of this.games) {
      const phase = game.phase();
      if (phase === GamePhase.Active) {
        if (!game.hasStarted()) {
          // Prestart tells clients to start loading the game.
          game.prestart();
          // Start game on delay to allow time for clients to connect.
          setTimeout(() => {
            try {
              game.start();
            } catch (error) {
              this.log.error(`error starting game ${id}: ${error}`);
            }
          }, 2000);
        }
      }

      if (phase === GamePhase.Finished) {
        try {
          game.end();
        } catch (error) {
          this.log.error(`error ending game ${id}: ${error}`);
        }
      } else {
        active.set(id, game);
      }
    }
    this.games = active;
  }
}
