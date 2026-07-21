/**
 * Stub builders for GameView/PlayerView/UnitView unit tests.
 *
 * These tests don't go through the full game setup (which creates a worker
 * and runs the simulation) — they exercise the view classes directly with
 * minimal stubs for their dependencies.
 */

import { colord } from "colord";
import { Theme } from "../../src/client/theme/ThemeProvider";
import { GameView } from "../../src/client/view/GameView";
import { PlayerView } from "../../src/client/view/PlayerView";
import { Config } from "../../src/core/configuration/Config";
import {
  NameViewData,
  PlayerType,
  Team,
  UnitType,
} from "../../src/core/game/Game";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  GameUpdateType,
  GameUpdateViewData,
  PlayerUpdate,
  UnitUpdate,
} from "../../src/core/game/GameUpdates";
import { TerrainMapData } from "../../src/core/game/TerrainMapLoader";
import { Player, PlayerCosmetics } from "../../src/core/Schemas";
import { WorkerClient } from "../../src/core/worker/WorkerClient";

/** Theme stub — returns deterministic colors so PlayerView's color math works. */
export function stubTheme(): Theme {
  const white = colord("#ffffff");
  const grey = colord("#808080");
  const defended = { light: white, dark: grey };
  return {
    teamColor: () => white,
    territoryColor: () => white,
    structureColors: () => defended,
    borderColor: () => grey,
    defendedBorderColors: () => defended,
    focusedBorderColor: () => grey,
    spawnHighlightColor: () => white,
  };
}

/** Minimum Config stub for view tests. Extend as test needs grow. */
export function stubConfig(overrides: Partial<Config> = {}): Config {
  const theme = stubTheme();
  const cfg = {
    theme: () => theme,
    SAMCooldown: () => 120,
    SiloCooldown: () => 75,
    deleteUnitCooldown: () => 0,
    spawnImmunityDuration: () => 0,
    nationSpawnImmunityDuration: () => 0,
    unitInfo: () => ({ maxHealth: 100, constructionDuration: 20 }),
    disableAlliances: () => false,
    allianceDuration: () => 100,
    deletionMarkDuration: () => 300,
    doomsdayClockConfig: () => ({ warnSeconds: 15 }),
    nukeMagnitudes: () => ({ inner: 0, outer: 0 }),
    nukeAllianceBreakThreshold: () => 0,
    userSettings: () => ({}),
    ...overrides,
  } as unknown as Config;
  return cfg;
}

/** WorkerClient stub. View classes only call worker.* in async methods we don't exercise. */
export function stubWorker(): WorkerClient {
  return {} as unknown as WorkerClient;
}

/** Build TerrainMapData wrapping a fresh GameMapImpl of the given size. */
export function stubTerrainMap(width = 10, height = 10): TerrainMapData {
  const terrain = new Uint8Array(width * height);
  const gameMap = new GameMapImpl(width, height, terrain, 0);
  return {
    nations: [],
    additionalNations: [],
    gameMap,
    miniGameMap: gameMap,
  } as unknown as TerrainMapData;
}

export interface GameViewStubOptions {
  width?: number;
  height?: number;
  myClientID?: string;
  myUsername?: string;
  myClanTag?: string | null;
  humans?: Player[];
  config?: Config;
}

/** Construct a GameView with minimal dependencies. */
export function makeGameView(opts: GameViewStubOptions = {}): GameView {
  return new GameView(
    stubWorker(),
    opts.config ?? stubConfig(),
    stubTerrainMap(opts.width ?? 10, opts.height ?? 10),
    opts.myClientID,
    opts.myUsername ?? "tester",
    opts.myClanTag ?? null,
    "test-game",
    opts.humans ?? [],
  );
}

// ── Synthetic update builders ──

export function makePlayerUpdate(
  overrides: Partial<PlayerUpdate> = {},
): PlayerUpdate {
  return {
    type: GameUpdateType.Player,
    clientID: "client-a",
    name: "Alice",
    displayName: "Alice",
    id: "player-a",
    smallID: 1,
    playerType: PlayerType.Human,
    isAlive: true,
    isDisconnected: false,
    tilesOwned: 0,
    gold: 0n,
    troops: 100,
    allies: [],
    embargoes: new Set(),
    isTraitor: false,
    targets: [],
    outgoingEmojis: [],
    outgoingAttacks: [],
    incomingAttacks: [],
    outgoingAllianceRequests: [],
    alliances: [],
    hasSpawned: true,
    betrayals: 0,
    lastDeleteUnitTick: 0,
    isLobbyCreator: false,
    ...overrides,
  };
}

export function makeUnitUpdate(
  overrides: Partial<UnitUpdate> = {},
): UnitUpdate {
  return {
    type: GameUpdateType.Unit,
    unitType: UnitType.Warship,
    troops: 0,
    id: 1,
    ownerID: 1,
    pos: 0,
    lastPos: 0,
    isActive: true,
    reachedTarget: false,
    targetable: true,
    markedForDeletion: false,
    missileTimerQueue: [],
    level: 1,
    hasTrainStation: false,
    ...overrides,
  };
}

export function makeNameViewData(
  overrides: Partial<NameViewData> = {},
): NameViewData {
  return { x: 0, y: 0, size: 12, ...overrides };
}

export interface PlayerViewStubOptions {
  game?: GameView;
  data?: Partial<PlayerUpdate>;
  nameData?: NameViewData;
  cosmetics?: PlayerCosmetics;
}

/** Construct a PlayerView with minimal dependencies. */
export function makePlayerView(opts: PlayerViewStubOptions = {}): PlayerView {
  return new PlayerView(
    opts.game ?? makeGameView(),
    makePlayerUpdate(opts.data),
    opts.nameData ?? makeNameViewData(),
    opts.cosmetics ?? {},
  );
}

/**
 * Build a GameUpdateViewData with no updates and an empty packed tile delta.
 * Caller can fill in updates[GameUpdateType.X] arrays as needed.
 */
export function makeEmptyGu(
  tick: number,
  overrides: Partial<GameUpdateViewData> = {},
): GameUpdateViewData {
  const updates = Object.fromEntries(
    Object.values(GameUpdateType)
      .filter((v): v is number => typeof v === "number")
      .map((k) => [k, []]),
  ) as unknown as GameUpdateViewData["updates"];
  return {
    tick,
    updates,
    packedTileUpdates: new Uint32Array(0),
    // playerNameViewData deliberately absent — production omits it on every
    // tick between placement rebuilds, so the stub default must exercise the
    // absent path. Tests that need placements set it explicitly.
    ...overrides,
  };
}

export { Team };
