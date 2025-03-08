import { ServerConfig } from "../core/configuration/Config";
import { GameConfig, GameID } from "../core/Schemas";
import { Client } from "./Client";
import { GamePhase, GameServer } from "./GameServer";
import { Difficulty, GameMapType, GameType } from "../core/game/Game";
import { isHighTrafficTime } from "./Util";

export class GameManager {
  private games: Map<GameID, GameServer> = new Map();

  constructor(private config: ServerConfig) {
    setInterval(() => this.tick(), 1000);
  }

  public game(id: GameID): GameServer | null {
    return this.games.get(id);
  }

  addClient(client: Client, gameID: GameID, lastTurn: number): boolean {
    const game = this.games.get(gameID);
    if (game) {
      game.addClient(client, lastTurn);
      return true;
    }
    return false;
  }

  createGame(id: GameID, gameConfig: GameConfig | undefined) {
    const game = new GameServer(
      id,
      Date.now(),
      isHighTrafficTime(),
      this.config,
      {
        gameMap: GameMapType.World,
        gameType: GameType.Private,
        difficulty: Difficulty.Medium,
        disableNPCs: false,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        bots: 400,
        ...gameConfig,
      },
    );
    this.games.set(id, game);
    return game;
  }

  tick() {
    const active = new Map<GameID, GameServer>();
    for (const [id, game] of this.games) {
      const phase = game.phase();
      if (phase == GamePhase.Active) {
        if (!game.hasStarted()) {
          try {
            game.start();
          } catch (error) {
            console.log(`error starting game ${id}: ${error}`);
          }
        }
      }

      if (phase == GamePhase.Finished) {
        try {
          game.end();
        } catch (error) {
          console.log(`error ending game ${id}: ${error}`);
        }
      } else {
        active.set(id, game);
      }
    }
    this.games = active;
  }
}
