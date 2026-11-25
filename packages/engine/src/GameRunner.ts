import {
  EditorCommand,
  EditorCommandSchema,
} from "@openfront/engine-api/EditorCommands";
import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  BuildableUnit,
  CustomGameMap,
  GameMapSize,
  GameType,
  GameUpdates,
  HumanDisconnects,
  HumanStatsSnapshot,
  NameViewData,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  UnitUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import {
  MapFiles,
  MapManifest,
  MapMetadata,
} from "@openfront/engine-api/game/MapFiles";
import { ClientID, GameStartInfo, Turn } from "@openfront/engine-api/Schemas";
import { packUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { EngineConfig } from "./configuration/EngineConfig";
import { applyEditorCommand } from "./editor/EditorCommands";
import { structureExecution } from "./execution/ConstructionExecution";
import { DoomsdayClockExecution } from "./execution/DoomsdayClockExecution";
import { Executor } from "./execution/ExecutionManager";
import { PlayerExecution } from "./execution/PlayerExecution";
import { RecomputeRailClusterExecution } from "./execution/RecomputeRailClusterExecution";
import { SpawnTimerExecution } from "./execution/SpawnTimerExecution";
import { WarshipExecution } from "./execution/WarshipExecution";
import { WinCheckExecution } from "./execution/WinCheckExecution";
import { Game, Player } from "./game/Game";
import { createGame } from "./game/GameImpl";
import { humanDisconnects, humanStatsSnapshot } from "./game/HumanStats";
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
  // The scenario editor's engine never ticks, so it gets none of the
  // executions init() adds.
  editor = false,
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
    editor ? map.manifest : null,
  );
  if (!editor) gr.init();
  return gr;
}

/**
 * The game's maps, from its map's files (which the game takes over). A stock
 * map must get its own files; a Custom map's files came with the game start,
 * so any are accepted (a snapshot still checks them against its own hash).
 */
function loadGameMap(
  config: Pick<GameStartInfo["config"], "gameMap" | "gameMapSize">,
  map: MapFiles,
) {
  if (
    (config.gameMap !== CustomGameMap && map.map !== config.gameMap) ||
    map.mapSize !== config.gameMapSize
  ) {
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
  if (gameStart.scenario !== undefined) {
    assignScenarioNations(game, gameStart);
  }
  // No init(): the snapshot already holds every execution init() adds.
  return new GameRunner(
    game,
    new Executor(
      game,
      gameStart.gameID,
      clientID,
      gameStart.tribes?.map((t) => t.name),
    ),
    callBack,
  );
}

/**
 * Hands each scenario nation to its player (docs/ScenarioEditor.md,
 * "Starting a game from a bundle"). Every assignment is checked against the
 * restored game and the start info before any takeover, so a bad start
 * fails whole, and the same way on every client.
 */
function assignScenarioNations(game: Game, gameStart: GameStartInfo): void {
  const assignments = gameStart.scenario!.assignments;
  const players = new Set(gameStart.players.map((p) => p.clientID));
  const nations = new Set<string>();
  const clients = new Set<ClientID>();
  for (const { clientID, nationID } of assignments) {
    const nation = game.hasPlayer(nationID) ? game.player(nationID) : null;
    if (nation === null || nation.type() !== PlayerType.Nation) {
      throw new Error(`scenario: no nation ${nationID}`);
    }
    if (!nation.playable()) {
      throw new Error(`scenario: nation ${nationID} is not playable`);
    }
    if (nations.has(nationID)) {
      throw new Error(`scenario: nation ${nationID} is assigned twice`);
    }
    if (!players.has(clientID)) {
      throw new Error(`scenario: client ${clientID} is not a player`);
    }
    if (clients.has(clientID)) {
      throw new Error(`scenario: client ${clientID} has two nations`);
    }
    nations.add(nationID);
    clients.add(clientID);
  }
  // The spawn phase is over, so a player without a nation has nowhere to be.
  if (clients.size !== players.size) {
    throw new Error("scenario: a player has no nation");
  }
  for (const { clientID, nationID } of assignments) {
    game.takeoverPlayer(nationID, clientID);
  }
}

export class GameRunner {
  private turns: Turn[] = [];
  private currTurn = 0;
  private isExecuting = false;

  private playerViewData: Record<PlayerID, NameViewData> = {};

  // Name placements are recomputed periodically; a runner that starts
  // mid-game (restored from a snapshot) computes them on its first tick.
  private viewDataStale = true;

  private lastSpawnTiles = new Map<PlayerID, TileRef>();

  constructor(
    public game: Game,
    private execManager: Executor,
    private callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
    // Scenario editor: the manifest the engine started on, which the
    // exported map files' manifest is based on.
    private editorManifest: MapManifest | null = null,
  ) {}

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
    this.addRunningGameExecutions();
  }

  /** What every running game has, however it started. */
  private addRunningGameExecutions(): void {
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

    this.sendUpdates(
      updates,
      wasInSpawnPhase,
      tickExecutionDuration,
      pendingTurns ?? 0,
    );
    this.isExecuting = false;
    return true;
  }

  /**
   * Scenario editor: applies one command and sends the updates it made,
   * without running a tick. Throws, having changed nothing, if the command
   * is invalid. Returns the map files `export_terrain` writes.
   */
  public applyEditorCommand(command: EditorCommand): MapFiles | undefined {
    const parsed = EditorCommandSchema.parse(command);
    const wasInSpawnPhase = this.game.inSpawnPhase();
    let files: MapFiles | undefined;
    switch (parsed.type) {
      case "export_terrain":
        files = this.exportTerrain();
        break;
      case "finalize":
        this.finalize();
        break;
      default:
        applyEditorCommand(this.game, parsed);
    }
    this.sendUpdates(
      this.game.drainPendingUpdates(),
      wasInSpawnPhase,
      0,
      this.pendingTurns(),
    );
    return files;
  }

  /**
   * Runs the full terrain pass and writes the terrain out as a Custom map's
   * files (docs/ScenarioEditor.md, "Finalising for export"). The water
   * graph is not rebuilt: the files don't hold it, and the engine that
   * loads them builds its own.
   */
  private exportTerrain(): MapFiles {
    if (this.editorManifest === null) {
      throw new Error("only an editor engine exports its terrain");
    }
    if (this.game.config().gameConfig().gameMapSize !== GameMapSize.Normal) {
      throw new Error("only a Normal-size editor engine has map.bin");
    }
    this.game.endTerrainEdit();
    const map = this.game.map();
    const map4x = this.game.miniMap();
    const map16x = this.game.downscaleMiniMap();
    return {
      map: CustomGameMap,
      mapSize: GameMapSize.Normal,
      manifest: {
        ...this.editorManifest,
        map: mapMetadata(map),
        map4x: mapMetadata(map4x),
        map16x: mapMetadata(map16x),
      },
      mapBin: terrainBytes(map),
      map4xBin: terrainBytes(map4x),
      map16xBin: terrainBytes(map16x),
    };
  }

  /**
   * Scenario editor: makes the game a running one with every nation
   * AI-run, ready to snapshot (docs/ScenarioEditor.md, "Finalising for
   * export"). Nothing ticks between this and the snapshot.
   */
  private finalize(): void {
    if (!this.game.inSpawnPhase()) {
      throw new Error("the game is already finalized");
    }
    // In the order a new game adds them: init()'s, then each spawn's, then
    // each structure's and warship's as it's built. Every nation gets its
    // AI, whatever the config's nations setting: they are the author's. One
    // with no land is dead and stops on its first tick.
    this.game.addExecution(...this.execManager.nationExecutions());
    this.addRunningGameExecutions();
    for (const nation of this.game.nations()) {
      const player = this.game.player(nation.playerInfo.id);
      // A nation the author gave land has spawned, as SpawnExecution
      // spawns one: a spawn tile and its player execution.
      let spawnTile: TileRef | undefined;
      for (const tile of player.tiles()) {
        if (spawnTile === undefined || tile < spawnTile) spawnTile = tile;
      }
      // One with no land is dead, and the dead have no allies or units
      // (see PlayerExecution's removeOnDeath); its only units are warships,
      // as a structure stands on its nation's land.
      if (spawnTile === undefined) {
        player.removeAllAlliances();
        for (const warship of player.units(UnitType.Warship)) {
          warship.delete(false);
        }
        continue;
      }
      player.setSpawnTile(spawnTile);
      this.game.stats().recordSpawnTile(player, spawnTile);
      this.game.addExecution(new PlayerExecution(player));
    }
    for (const structure of this.game.units(Structures.types)) {
      this.game.addExecution(structureExecution(structure));
    }
    // And every warship the one it gets when built, patrolling around its
    // tile.
    for (const warship of this.game.units(UnitType.Warship)) {
      this.game.addExecution(new WarshipExecution(warship));
    }
    this.game.endSpawnPhase();
  }

  /** Builds the update for the host from the game's pending updates. */
  private sendUpdates(
    updates: GameUpdates,
    wasInSpawnPhase: boolean,
    tickExecutionDuration: number,
    pendingTurns: number,
  ): void {
    // Track whether placements were recomputed this tick — the record is
    // only attached to the update when it could have changed, so the main
    // thread doesn't structured-clone an identical ~all-players record on
    // every other tick.
    let viewDataChanged = false;
    if (this.game.inSpawnPhase()) {
      for (const p of this.game.allPlayers()) {
        const spawnTile = p.spawnTile();
        if (spawnTile === undefined) continue;
        if (this.lastSpawnTiles.get(p.id()) !== spawnTile) {
          this.lastSpawnTiles.set(p.id(), spawnTile);
          this.playerViewData[p.id()] = placeSpawnName(this.game, p);
          viewDataChanged = true;
        }
      }
    }

    const spawnJustEnded = wasInSpawnPhase && !this.game.inSpawnPhase();
    if (
      spawnJustEnded ||
      (!this.game.inSpawnPhase() && this.lastSpawnTiles.size > 0)
    ) {
      this.lastSpawnTiles.clear();
    }
    if (
      spawnJustEnded ||
      (!this.game.inSpawnPhase() &&
        (this.viewDataStale ||
          this.game.ticks() < 3 ||
          this.game.ticks() % 30 === 0))
    ) {
      this.viewDataStale = false;
      this.playerViewData = {};
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

    let packedUnitUpdates: Float64Array | undefined;
    let packedMissileTimers: Uint32Array | undefined;

    const unitUpdates = updates[GameUpdateType.Unit] as UnitUpdate[];
    if (unitUpdates && unitUpdates.length > 0) {
      const packed = packUnitUpdates(unitUpdates);
      packedUnitUpdates = packed.packedUnitUpdates;
      if (packed.packedMissileTimers.length > 0) {
        packedMissileTimers = packed.packedMissileTimers;
      }
      // Clear the original array so it's not structured-cloned
      updates[GameUpdateType.Unit] = [];
    }

    this.callBack({
      tick: this.game.ticks(),
      packedTileUpdates,
      ...(packedMotionPlans ? { packedMotionPlans } : {}),
      ...(packedPlayerUpdates ? { packedPlayerUpdates } : {}),
      ...(packedAttackUpdates ? { packedAttackUpdates } : {}),
      ...(packedNukeImpacts ? { packedNukeImpacts } : {}),
      ...(packedUnitUpdates ? { packedUnitUpdates } : {}),
      ...(packedMissileTimers ? { packedMissileTimers } : {}),
      updates: updates,
      // A copy: hosts hold several ticks' updates before reading them, and
      // the record changes in place on later ticks.
      ...(viewDataChanged
        ? { playerNameViewData: { ...this.playerViewData } }
        : {}),
      tickExecutionDuration: tickExecutionDuration,
      pendingTurns: pendingTurns,
    });
  }

  public pendingTurns(): number {
    return Math.max(0, this.turns.length - this.currTurn);
  }

  public playerBuildables(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[],
    includeBuildPreview = false,
  ): BuildableUnit[] {
    const player = this.game.player(playerID);
    const tile =
      x !== undefined && y !== undefined ? this.game.ref(x, y) : null;
    return player.buildableUnits(tile, units, includeBuildPreview);
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
  public humanDisconnects(): HumanDisconnects {
    return humanDisconnects(this.game);
  }
  public humanStats(): HumanStatsSnapshot {
    return humanStatsSnapshot(this.game);
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

function mapMetadata(map: GameMap): MapMetadata {
  return {
    width: map.width(),
    height: map.height(),
    num_land_tiles: map.numLandTiles(),
  };
}

/** A copy of the map's terrain bytes: the game keeps the map. */
function terrainBytes(map: GameMap): Uint8Array {
  const bytes = new Uint8Array(map.width() * map.height());
  for (let t = 0; t < bytes.length; t++) bytes[t] = map.terrainByte(t);
  return bytes;
}
