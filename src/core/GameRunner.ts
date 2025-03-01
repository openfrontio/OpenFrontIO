import { placeName } from "../client/graphics/NameBoxCalculator";
import { getConfig } from "./configuration/Config";
import { Executor } from "./execution/ExecutionManager";
import { WinCheckExecution } from "./execution/WinCheckExecution";
import {
  AllPlayers,
  BuildableUnit,
  Game,
  GameUpdates,
  NameViewData,
  Player,
  PlayerActions,
  PlayerID,
  PlayerProfile,
  PlayerType,
  UnitType,
} from "./game/Game";
import { createGame } from "./game/GameImpl";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
} from "./game/GameUpdates";
import { loadTerrainMap as loadGameMap } from "./game/TerrainMapLoader";
import { ClientID, GameConfig, Turn } from "./Schemas";

export async function createGameRunner(
  gameID: string,
  gameConfig: GameConfig,
  clientID: ClientID,
  callBack: (gu: GameUpdateViewData) => void,
): Promise<GameRunner> {
  const config = getConfig(gameConfig, null);
  const gameMap = await loadGameMap(gameConfig.gameMap);
  const game = createGame(
    gameMap.gameMap,
    gameMap.miniGameMap,
    gameMap.nationMap,
    config,
  );
  const gr = new GameRunner(
    game as Game,
    new Executor(game, gameID, clientID),
    callBack,
  );
  gr.init();
  return gr;
}

export class GameRunner {
  private turns: Turn[] = [];
  private currTurn = 0;
  private isExecuting = false;

  private playerViewData: Record<PlayerID, NameViewData> = {};

  constructor(
    public game: Game,
    private execManager: Executor,
    private callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
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
        return;
      }
    }

    if (this.game.inSpawnPhase() && this.game.ticks() % 2 == 0) {
      this.game
        .players()
        .filter(
          (p) =>
            p.type() == PlayerType.Human || p.type() == PlayerType.FakeHuman,
        )
        .forEach(
          (p) => (this.playerViewData[p.id()] = placeName(this.game, p)),
        );
    }

    if (this.game.ticks() < 3 || this.game.ticks() % 30 == 0) {
      this.game.players().forEach((p) => {
        this.playerViewData[p.id()] = placeName(this.game, p);
      });
    }

    // Many tiles are updated to pack it into an array
    const packedTileUpdates = updates[GameUpdateType.Tile].map((u) => u.update);
    updates[GameUpdateType.Tile] = [];

    this.callBack({
      tick: this.game.ticks(),
      packedTileUpdates: new BigUint64Array(packedTileUpdates),
      updates: updates,
      playerNameViewData: this.playerViewData,
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
      canBoat: player.canBoat(tile),
      canAttack: player.canAttack(tile),
      buildableUnits: Object.values(UnitType).map((u) => {
        return {
          type: u,
          canBuild: player.canBuild(u, tile) != false,
          cost: this.game.config().unitInfo(u).cost(player),
        } as BuildableUnit;
      }),
      canSendEmojiAllPlayers: player.canSendEmoji(AllPlayers),
    } as PlayerActions;

    if (this.game.hasOwner(tile)) {
      const other = this.game.owner(tile) as Player;
      actions.interaction = {
        sharedBorder: player.sharesBorderWith(other),
        canSendEmoji: player.canSendEmoji(other),
        canTarget: player.canTarget(other),
        canSendAllianceRequest: player.canSendAllianceRequest(other),
        canBreakAlliance: player.isAlliedWith(other),
        canDonate: player.canDonate(other),
      };
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
}
