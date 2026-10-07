import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  BuildableUnit,
  GameType,
  GameUpdates,
  NameViewData,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  createGameUpdatesMap,
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { ClientID, GameStartInfo, Turn } from "@openfront/engine-api/Schemas";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { EngineConfig } from "./configuration/EngineConfig";
import { DoomsdayClockExecution } from "./execution/DoomsdayClockExecution";
import { Executor } from "./execution/ExecutionManager";
import { RecomputeRailClusterExecution } from "./execution/RecomputeRailClusterExecution";
import { SpawnTimerExecution } from "./execution/SpawnTimerExecution";
import { WinCheckExecution } from "./execution/WinCheckExecution";
import { Game, Player } from "./game/Game";
import { createGame } from "./game/GameImpl";
import { placeName, placeSpawnName } from "./game/NameBoxCalculator";
import { createNationsForGame } from "./game/NationCreation";
import {
  readSnapshotHeader,
  restoreGame,
  snapshotGame,
} from "./snapshot/GameSnapshot";

export async function createGameRunner(
  gameStart: GameStartInfo,
  clientID: ClientID | undefined,
  map: MapFiles,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
): Promise<GameRunner> {
  const config = new EngineConfig(gameStart.config, false, gameStart.listed);
  const gameMap = await loadGameMap(gameStart.config, map);
  const random = new PseudoRandom(simpleHash(gameStart.gameID));

  const humans = gameStart.players.map((p) => {
    return new PlayerInfo(
      p.username,
      PlayerType.Human,
      p.clientID,
      random.nextID(),
      p.isLobbyCreator ?? false,
      p.clanTag,
      p.friends ?? [],
      p.teamIndex ?? null,
    );
  });

  const nations = createNationsForGame(
    gameStart,
    gameMap.nations,
    gameMap.additionalNations,
    humans.length,
    random,
  );

  const game: Game = createGame(
    humans,
    nations,
    gameMap.gameMap,
    gameMap.miniGameMap,
    config,
    gameMap.teamGameSpawnAreas,
  );

  const gr = new GameRunner(
    game,
    new Executor(
      game,
      gameStart.gameID,
      clientID,
      gameStart.tribes?.map((t) => t.name),
    ),
    callBack,
  );
  gr.init();
  return gr;
}

/** The game's maps, from its map's files (which the game takes over). */
function loadGameMap(
  config: Pick<GameStartInfo["config"], "gameMap" | "gameMapSize">,
  map: MapFiles,
) {
  if (map.map !== config.gameMap || map.mapSize !== config.gameMapSize) {
    throw new Error(
      `the game is on ${config.gameMap} (${config.gameMapSize}), ` +
        `the files passed are ${map.map} (${map.mapSize})`,
    );
  }
  return loadTerrainMap(map);
}

/**
 * Rebuilds a runner from a snapshot (see snapshot/README.md). The game resumes
 * at the snapshot's tick: the first turn added afterwards is the turn for
 * that tick. Only runtime details (game id, listing) come from `gameStart`;
 * the config, players and all state come from the snapshot.
 */
export async function createGameRunnerFromSnapshot(
  gameStart: GameStartInfo,
  snapshot: Uint8Array,
  clientID: ClientID | undefined,
  map: MapFiles,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
): Promise<GameRunner> {
  const header = readSnapshotHeader(snapshot);
  const gameMap = await loadGameMap(header.gameConfig, map);
  const game = restoreGame(snapshot, {
    config: (gc) => new EngineConfig(gc, false, gameStart.listed),
    gameMap: gameMap.gameMap,
    miniGameMap: gameMap.miniGameMap,
    teamGameSpawnAreas: gameMap.teamGameSpawnAreas,
  });
  // No init(): the snapshot already holds every execution init() adds.
  const gr = new GameRunner(
    game,
    new Executor(
      game,
      gameStart.gameID,
      clientID,
      gameStart.tribes?.map((t) => t.name),
    ),
    callBack,
  );
  if (!game.inSpawnPhase()) {
    gr.setPendingSpawnPhaseEnd();
  }
  return gr;
}

export class GameRunner {
  private turns: Turn[] = [];
  private currTurn = 0;
  private isExecuting = false;
  private pendingSpawnPhaseEnd = false;

  private playerViewData: Record<PlayerID, NameViewData> = {};
  // Name placements are recomputed periodically; a runner that starts
  // mid-game (restored from a snapshot) computes them on its first tick.
  private viewDataStale = true;

  constructor(
    public game: Game,
    private execManager: Executor,
    private callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
  ) {}

  public setPendingSpawnPhaseEnd(): void {
    this.pendingSpawnPhaseEnd = true;
  }

  /**
   * Serializes the simulation at the current tick boundary. Turns that were
   * added but not executed yet are not part of it.
   */
  snapshot(gitCommit?: string): Uint8Array {
    if (this.isExecuting) {
      throw new Error("cannot snapshot while a tick is executing");
    }
    return snapshotGame(this.game, {
      gameID: this.execManager.gameID(),
      gitCommit,
    });
  }

  /**
   * Generates a full GameUpdateViewData representing the current simulation state
   * (e.g. for snapshot resume before processing new turns). Calling this also
   * initializes PlayerImpl.lastSentUpdate so subsequent tick emissions retain partial diffs.
   */
  public snapshotViewData(): GameUpdateViewData {
    const updates = createGameUpdatesMap();

    for (const player of this.game.allPlayers()) {
      const update = player.toUpdate(undefined, undefined, true);
      if (update !== null) {
        updates[GameUpdateType.Player].push(update);
      }
    }

    for (const unit of this.game.units()) {
      if (unit.isActive()) {
        updates[GameUpdateType.Unit].push(unit.toUpdate());
      }
    }

    if (!this.game.inSpawnPhase()) {
      updates[GameUpdateType.SpawnPhaseEnd].push({
        type: GameUpdateType.SpawnPhaseEnd,
        startTick: this.game.startTick() ?? 0,
      });
    }

    this.playerViewData = {};
    if (this.game.inSpawnPhase()) {
      for (const p of this.game.players()) {
        if (p.type() !== PlayerType.Human && p.type() !== PlayerType.Nation) {
          continue;
        }
        if (p.spawnTile() === undefined) continue;
        this.playerViewData[p.id()] = placeSpawnName(this.game, p);
      }
    } else {
      for (const p of this.game.players()) {
        this.playerViewData[p.id()] = placeName(this.game, p);
      }
    }

    const packedTileUpdates = new Uint32Array(0);
    const packedPlayerUpdates =
      this.game.drainPackedPlayerUpdates() ?? undefined;
    const packedAttackUpdates =
      this.game.drainPackedAttackUpdates() ?? undefined;

    return {
      tick: this.game.ticks(),
      updates,
      packedTileUpdates,
      ...(packedPlayerUpdates ? { packedPlayerUpdates } : {}),
      ...(packedAttackUpdates ? { packedAttackUpdates } : {}),
      playerNameViewData: this.playerViewData,
      tickExecutionDuration: 0,
      pendingTurns: 0,
    };
  }

  init() {
    if (this.game.config().gameConfig().gameType !== GameType.Singleplayer) {
      this.game.addExecution(new SpawnTimerExecution());
    }
    if (this.game.config().spawnNations()) {
      this.game.addExecution(...this.execManager.nationExecutions());
    }
    if (this.game.config().isRandomSpawn()) {
      this.game.addExecution(...this.execManager.spawnPlayers());
    }
    if (this.game.config().bots() > 0) {
      this.game.addExecution(
        ...this.execManager.spawnTribes(this.game.config().bots()),
      );
    }
    this.game.addExecution(new WinCheckExecution());
    if (this.game.config().doomsdayClockConfig().enabled) {
      this.game.addExecution(new DoomsdayClockExecution());
    }
    if (!this.game.config().isUnitDisabled(UnitType.Factory)) {
      this.game.addExecution(
        new RecomputeRailClusterExecution(this.game.railNetwork()),
      );
    }
  }

  public addTurn(turn: Turn): void {
    this.turns.push(turn);
  }

  public executeNextTick(pendingTurns?: number): boolean {
    if (this.isExecuting) {
      return false;
    }
    if (this.currTurn >= this.turns.length) {
      return false;
    }
    this.isExecuting = true;

    this.game.addExecution(
      ...this.execManager.createExecs(this.turns[this.currTurn]),
    );
    this.currTurn++;

    const wasInSpawnPhase = this.game.inSpawnPhase();
    let updates: GameUpdates;
    let tickExecutionDuration: number;

    try {
      const startTime = performance.now();
      updates = this.game.executeNextTick();
      const endTime = performance.now();
      tickExecutionDuration = endTime - startTime;
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
      this.isExecuting = false;
      return false;
    }

    if (this.pendingSpawnPhaseEnd) {
      this.pendingSpawnPhaseEnd = false;
      if (updates[GameUpdateType.SpawnPhaseEnd].length === 0) {
        updates[GameUpdateType.SpawnPhaseEnd].push({
          type: GameUpdateType.SpawnPhaseEnd,
          startTick: this.game.startTick() ?? 0,
        });
      }
    }

    // Track whether placements were recomputed this tick — the record is
    // only attached to the update when it could have changed, so the main
    // thread doesn't structured-clone an identical ~all-players record on
    // every other tick.
    let viewDataChanged = false;
    if (this.game.inSpawnPhase()) {
      for (const p of this.game.players()) {
        if (p.type() !== PlayerType.Human && p.type() !== PlayerType.Nation) {
          continue;
        }
        if (p.spawnTile() === undefined) continue;
        this.playerViewData[p.id()] = placeSpawnName(this.game, p);
        viewDataChanged = true;
      }
    }

    const spawnJustEnded = wasInSpawnPhase && !this.game.inSpawnPhase();
    if (
      spawnJustEnded ||
      this.viewDataStale ||
      this.game.ticks() < 3 ||
      this.game.ticks() % 30 === 0
    ) {
      this.viewDataStale = false;
      for (const p of this.game.players()) {
        this.playerViewData[p.id()] = placeName(this.game, p);
      }
      viewDataChanged = true;
    }

    const packedTileUpdates = this.game.drainPackedTileUpdates();
    const packedMotionPlans = this.game.drainPackedMotionPlans();
    const packedPlayerUpdates = this.game.drainPackedPlayerUpdates();
    const packedAttackUpdates = this.game.drainPackedAttackUpdates();
    const nukeImpactTiles = this.game.drainNukeImpacts();
    const packedNukeImpacts =
      nukeImpactTiles.length > 0 ? new Uint32Array(nukeImpactTiles) : undefined;

    this.callBack({
      tick: this.game.ticks(),
      packedTileUpdates,
      ...(packedMotionPlans ? { packedMotionPlans } : {}),
      ...(packedPlayerUpdates ? { packedPlayerUpdates } : {}),
      ...(packedAttackUpdates ? { packedAttackUpdates } : {}),
      ...(packedNukeImpacts ? { packedNukeImpacts } : {}),
      updates: updates,
      // A copy: hosts hold several ticks' updates before reading them, and
      // the record changes in place on later ticks.
      ...(viewDataChanged
        ? { playerNameViewData: { ...this.playerViewData } }
        : {}),
      tickExecutionDuration: tickExecutionDuration,
      pendingTurns: pendingTurns ?? 0,
    });
    this.isExecuting = false;
    return true;
  }

  public pendingTurns(): number {
    return Math.max(0, this.turns.length - this.currTurn);
  }

  public playerBuildables(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[],
  ): BuildableUnit[] {
    const player = this.game.player(playerID);
    const tile =
      x !== undefined && y !== undefined ? this.game.ref(x, y) : null;
    return player.buildableUnits(tile, units);
  }

  public playerActions(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): PlayerActions {
    const player = this.game.player(playerID);
    const tile =
      x !== undefined && y !== undefined ? this.game.ref(x, y) : null;
    const actions = {
      canAttack: tile !== null && player.canAttack(tile),
      buildableUnits: units === null ? [] : player.buildableUnits(tile, units),
      canSendEmojiAllPlayers: player.canSendEmoji(AllPlayers),
      canEmbargoAll: player.canEmbargoAll(),
    } as PlayerActions;

    if (tile !== null && this.game.hasOwner(tile)) {
      const other = this.game.owner(tile) as Player;
      actions.interaction = {
        sharedBorder: player.sharesBorderWith(other),
        canSendEmoji: player.canSendEmoji(other),
        canTarget: player.canTarget(other),
        canSendAllianceRequest: player.canSendAllianceRequest(other),
        canBreakAlliance: player.isAlliedWith(other),
        canDonateGold: player.canDonateGold(other),
        canDonateTroops: player.canDonateTroops(other),
        canEmbargo: !player.hasEmbargoAgainst(other),
        allianceInfo: player.allianceInfo(other) ?? undefined,
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
  public playerBorderTiles(playerID: PlayerID): PlayerBorderTiles {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return {
      // Copy into a plain Set: this result crosses the worker boundary via
      // structured clone, which TileSet does not survive.
      borderTiles: new Set(player.borderTiles()),
    } as PlayerBorderTiles;
  }

  public attackClusteredPositions(
    playerID: number,
    attackID?: string,
  ): { id: string; positions: { x: number; y: number }[] }[] {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer())
      throw new Error(`player with id ${playerID} not found`);
    const all = [...player.outgoingAttacks(), ...player.incomingAttacks()];
    const attacks = attackID ? all.filter((a) => a.id() === attackID) : all;

    return attacks.map((a) => ({
      id: a.id(),
      positions: a.clusteredPositions().map((tile) => ({
        x: this.game.map().x(tile),
        y: this.game.map().y(tile),
      })),
    }));
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
