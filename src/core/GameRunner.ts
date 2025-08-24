import { placeName } from "../client/graphics/NameBoxCalculator";
import { getConfig } from "./configuration/ConfigLoader";
import { Executor } from "./execution/ExecutionManager";
import { WinCheckExecution } from "./execution/WinCheckExecution";
import {
  AllPlayers,
  Attack,
  Cell,
  Game,
  GameUpdates,
  NameViewData,
  Nation,
  Player,
  PlayerActions,
  PlayerBorderTiles,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
} from "./game/Game";
import { createGame } from "./game/GameImpl";
import { TileRef } from "./game/GameMap";
import { GameMapLoader } from "./game/GameMapLoader";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
} from "./game/GameUpdates";
import { loadTerrainMap } from "./game/TerrainMapLoader";
import { PseudoRandom } from "./PseudoRandom";
import { ClientID, GameStartInfo, Turn } from "./Schemas";
import { sanitize, simpleHash } from "./Util";
import { fixProfaneUsername } from "./validations/username";

export async function createGameRunner(
  gameStart: GameStartInfo,
  clientID: ClientID,
  mapLoader: GameMapLoader,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
): Promise<GameRunner> {
  const config = await getConfig(gameStart.config, null);
  const gameMap = await loadTerrainMap(gameStart.config.gameMap, mapLoader);
  const random = new PseudoRandom(simpleHash(gameStart.gameID));

  const humans = gameStart.players.map(
    (p) =>
      new PlayerInfo(
        p.clientID === clientID
          ? sanitize(p.username)
          : fixProfaneUsername(sanitize(p.username)),
        PlayerType.Human,
        p.clientID,
        random.nextID(),
      ),
  );

  const nations = gameStart.config.disableNPCs
    ? []
    : gameMap.manifest.nations.map(
        (n) =>
          new Nation(
            new Cell(n.coordinates[0], n.coordinates[1]),
            n.strength,
            new PlayerInfo(n.name, PlayerType.FakeHuman, null, random.nextID()),
          ),
      );

  const game: Game = createGame(
    humans,
    nations,
    gameMap.gameMap,
    gameMap.miniGameMap,
    config,
  );

  const gr = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, clientID),
    callBack,
  );
  gr.init();
  return gr;
}

export class GameRunner {
  private readonly turns: Turn[] = [];
  private currTurn = 0;
  private isExecuting = false;

  private playerViewData: Record<PlayerID, NameViewData> = {};

  constructor(
    public game: Game,
    private readonly execManager: Executor,
    private readonly callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
  ) {}

  init() {
    if (this.game.config().bots() > 0) {
      this.game.addExecution(
        ...this.execManager.spawnBots(this.game.config().numBots()),
      );
    }
    if (this.game.config().spawnNPCs()) {
      this.game.addExecution(...this.execManager.fakeHumanExecutions());
    }
    this.game.addExecution(new WinCheckExecution());
  }

  public addTurn(turn: Turn): void {
    this.turns.push(turn);
  }

  public executeNextTick() {
    if (this.isExecuting) {
      return;
    }
    if (this.currTurn >= this.turns.length) {
      return;
    }
    this.isExecuting = true;

    this.game.addExecution(
      ...this.execManager.createExecs(this.turns[this.currTurn]),
    );
    this.currTurn++;

    let updates: GameUpdates;

    try {
      updates = this.game.executeNextTick();
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Game tick error:", error.message);
        this.callBack({
          errMsg: error.message,
          stack: error.stack,
        } as ErrorUpdate);
      } else {
        console.error("Game tick error:", error);
      }
      return;
    }

    if (this.game.inSpawnPhase() && this.game.ticks() % 2 === 0) {
      this.game
        .players()
        .filter(
          (p) =>
            p.type() === PlayerType.Human || p.type() === PlayerType.FakeHuman,
        )
        .forEach(
          (p) => (this.playerViewData[p.id()] = placeName(this.game, p)),
        );
    }

    if (this.game.ticks() < 3 || this.game.ticks() % 30 === 0) {
      this.game.players().forEach((p) => {
        this.playerViewData[p.id()] = placeName(this.game, p);
      });
    }

    // Many tiles are updated to pack it into an array
    const packedTileUpdates = updates[GameUpdateType.Tile].map((u) => u.update);
    updates[GameUpdateType.Tile] = [];

    this.callBack({
      packedTileUpdates: new BigUint64Array(packedTileUpdates),
      playerNameViewData: this.playerViewData,
      tick: this.game.ticks(),
      updates,
    });
    this.isExecuting = false;
  }

  public playerActions(
    playerID: PlayerID,
    x: number,
    y: number,
  ): PlayerActions {
    const player = this.game.player(playerID);
    const tile = this.game.ref(x, y);
    const actions = {
      buildableUnits: player.buildableUnits(tile),
      canAttack: player.canAttack(tile),
      canSendEmojiAllPlayers: player.canSendEmoji(AllPlayers),
    } as PlayerActions;

    if (this.game.hasOwner(tile)) {
      const other = this.game.owner(tile) as Player;
      actions.interaction = {
        canBreakAlliance: player.isAlliedWith(other),
        canDonateGold: player.canDonateGold(other),
        canDonateTroops: player.canDonateTroops(other),
        canEmbargo: !player.hasEmbargoAgainst(other),
        canSendAllianceRequest: player.canSendAllianceRequest(other),
        canSendEmoji: player.canSendEmoji(other),
        canTarget: player.canTarget(other),
        sharedBorder: player.sharesBorderWith(other),
      };
      const alliance = player.allianceWith(other);
      if (alliance) {
        actions.interaction.allianceExpiresAt = alliance.expiresAt();
      }
    }

    return actions;
  }

  public playerProfile(playerID: number): PlayerProfile {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.playerProfile();
  }
  public playerBorderTiles(playerID: PlayerID): PlayerBorderTiles {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return {
      borderTiles: player.borderTiles(),
    } as PlayerBorderTiles;
  }

  public attackAveragePosition(
    playerID: number,
    attackID: string,
  ): Cell | null {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }

    const condition = (a: Attack) => a.id() === attackID;
    const attack =
      player.outgoingAttacks().find(condition) ??
      player.incomingAttacks().find(condition);
    if (attack === undefined) {
      return null;
    }

    return attack.averagePosition();
  }

  public bestTransportShipSpawn(
    playerID: PlayerID,
    targetTile: TileRef,
  ): TileRef | false {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.bestTransportShipSpawn(targetTile);
  }
}
