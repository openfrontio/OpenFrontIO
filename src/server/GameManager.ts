import { ServerConfig } from "../core/configuration/Config";
import { Difficulty, GameMapType, GameType } from "../core/game/Game";
import { PseudoRandom } from "../core/PseudoRandom";
import { GameConfig, GameID } from "../core/Schemas";
import { generateID } from "../core/Util";
import { Client } from "./Client";
import { GamePhase, GameServer } from "./GameServer";

export class GameManager {
  private lastNewLobby: number = 0;
  private mapsPlaylist: GameMapType[] = [];

  private games: GameServer[] = [];

  private random = new PseudoRandom(123);

  constructor(private config: ServerConfig) {}

  public game(id: GameID): GameServer | null {
    return this.games.find((g) => g.id == id);
  }

  gamesByPhase(phase: GamePhase): GameServer[] {
    return this.games.filter((g) => g.phase() == phase);
  }

  addClient(client: Client, gameID: GameID, lastTurn: number): boolean {
    const game = this.games.find((g) => g.id == gameID);
    if (game) {
      game.addClient(client, lastTurn);
      return true;
    }
    return false;
  }

  updateGameConfig(gameID: GameID, gameConfig: GameConfig) {
    const game = this.games.find((g) => g.id == gameID);
    if (game == null) {
      console.warn(`game ${gameID} not found`);
      return;
    }
    if (game.isPublic) {
      console.warn(`cannot update public game ${gameID}`);
      return;
    }
    game.updateGameConfig(gameConfig);
  }

  createPrivateGame(): string {
    const id = generateID();
    this.games.push(
      new GameServer(id, Date.now(), false, this.config, {
        gameMap: GameMapType.World,
        gameType: GameType.Private,
        difficulty: Difficulty.Medium,
        disableNPCs: false,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        bots: 400,
      }),
    );
    return id;
  }

  hasActiveGame(gameID: GameID): boolean {
    const game = this.games
      .filter((g) => g.id == gameID)
      .filter(
        (g) => g.phase() == GamePhase.Lobby || g.phase() == GamePhase.Active,
      );
    return game.length > 0;
  }

  // TODO: stop private games to prevent memory leak.
  startPrivateGame(gameID: GameID) {
    const game = this.games.find((g) => g.id == gameID);
    console.log(`found game ${game}`);
    if (game) {
      game.start();
    } else {
      throw new Error(`cannot start private game, game ${gameID} not found`);
    }
  }

  private getNextMap(): GameMapType {
    if (this.mapsPlaylist.length > 0) {
      return this.mapsPlaylist.shift();
    }

    const frequency = {
      World: 4,
      Europe: 4,
      Mena: 2,
      NorthAmerica: 2,
      Oceania: 1,
      BlackSea: 2,
      Africa: 2,
      Asia: 2,
      Mars: 0,
    };

    Object.keys(GameMapType).map((key) => {
      let count = parseInt(frequency[key]);

      while (count > 0) {
        this.mapsPlaylist.push(GameMapType[key]);
        count--;
      }
    });

    while (true) {
      this.random.shuffleArray(this.mapsPlaylist);
      if (this.allNonConsecutive(this.mapsPlaylist)) {
        return this.mapsPlaylist.shift();
      }
    }
  }

  private allNonConsecutive(maps: GameMapType[]): boolean {
    // Check for consecutive duplicates in the maps array
    for (let i = 0; i < maps.length - 1; i++) {
      if (maps[i] === maps[i + 1]) {
        return false;
      }
    }
    return true;
  }

  tick() {
    const lobbies = this.gamesByPhase(GamePhase.Lobby);
    const active = this.gamesByPhase(GamePhase.Active);
    const finished = this.gamesByPhase(GamePhase.Finished);

    const now = Date.now();
    if (now > this.lastNewLobby + this.config.gameCreationRate()) {
      this.lastNewLobby = now;
      lobbies.push(
        new GameServer(generateID(), now, true, this.config, {
          gameMap: this.getNextMap(),
          gameType: GameType.Public,
          difficulty: Difficulty.Medium,
          infiniteGold: false,
          infiniteTroops: false,
          instantBuild: false,
          disableNPCs: false,
          bots: 400,
        }),
      );
    }

    active
      .filter((g) => !g.hasStarted() && g.isPublic)
      .forEach((g) => {
        g.start();
      });
    finished.forEach((g) => {
      try {
        g.endGame();
      } catch (error) {
        console.log(`error ending game ${g.id}: `, error);
      }
    });
    this.games = [...lobbies, ...active];
  }
}
