import {
  GameMapSize,
  GameMode,
  HumansVsNations,
  UnitType,
} from "../../core/game/Game";
import {
  createDefaultPrivateGameConfig,
  createDefaultSingleplayerGameConfig,
} from "../../core/game/GameConfigDefaults";
import { GameConfig } from "../../core/Schemas";

type FormState = Record<string, any> & { requestUpdate?: () => void };

export type GameConfigPatch = Omit<
  Partial<GameConfig>,
  "maxTimerValue" | "goldMultiplier" | "startingGold" | "spawnImmunityDuration"
> & {
  maxTimerValue?: number | null;
  goldMultiplier?: number | null;
  startingGold?: number | null;
  spawnImmunityDuration?: number | null;
};

const TICKS_PER_MINUTE = 60 * 10;

function resetCommonGameConfigFormState(
  state: FormState,
  defaultConfig: GameConfig,
): void {
  state.selectedMap = defaultConfig.gameMap;
  state.useRandomMap = false;
  state.compactMap = defaultConfig.gameMapSize === GameMapSize.Compact;
  state.selectedDifficulty = defaultConfig.difficulty;
  state.disableNations = defaultConfig.disableNations;
  state.gameMode = defaultConfig.gameMode;
  state.teamCount = defaultConfig.playerTeams ?? 2;
  state.bots = defaultConfig.bots;
  state.infiniteGold = defaultConfig.infiniteGold;
  state.infiniteTroops = defaultConfig.infiniteTroops;
  state.instantBuild = defaultConfig.instantBuild;
  state.randomSpawn = defaultConfig.randomSpawn;
  state.disabledUnits = [...(defaultConfig.disabledUnits ?? [])];

  const defaultMaxTimerValue = defaultConfig.maxTimerValue;
  state.maxTimer = defaultMaxTimerValue !== undefined;
  state.maxTimerValue = defaultMaxTimerValue;

  const defaultGoldMultiplier = defaultConfig.goldMultiplier;
  state.goldMultiplier = defaultGoldMultiplier !== undefined;
  state.goldMultiplierValue = defaultGoldMultiplier;

  const defaultStartingGold = defaultConfig.startingGold;
  state.startingGold = defaultStartingGold !== undefined;
  state.startingGoldValue = defaultStartingGold;
}

function buildCommonGameConfigPatch(state: FormState): Partial<GameConfig> {
  return {
    gameMap: state.selectedMap,
    gameMapSize: state.compactMap ? GameMapSize.Compact : GameMapSize.Normal,
    difficulty: state.selectedDifficulty,
    disableNations:
      state.gameMode === GameMode.Team && state.teamCount === HumansVsNations
        ? false
        : state.disableNations,
    gameMode: state.gameMode,
    playerTeams: state.teamCount,
    bots: state.bots,
    infiniteGold: state.infiniteGold,
    infiniteTroops: state.infiniteTroops,
    instantBuild: state.instantBuild,
    randomSpawn: state.randomSpawn,
    disabledUnits: state.disabledUnits as UnitType[],
    maxTimerValue: state.maxTimer === true ? state.maxTimerValue : undefined,
    goldMultiplier:
      state.goldMultiplier === true ? state.goldMultiplierValue : undefined,
    startingGold:
      state.startingGold === true ? state.startingGoldValue : undefined,
  };
}

function applyCommonGameConfigPatch(
  state: FormState,
  patch: GameConfigPatch,
): void {
  if ("gameMap" in patch && patch.gameMap !== undefined) {
    state.selectedMap = patch.gameMap;
    state.useRandomMap = false;
  }

  if ("gameMapSize" in patch && patch.gameMapSize !== undefined) {
    state.compactMap = patch.gameMapSize === GameMapSize.Compact;
  }

  if ("difficulty" in patch && patch.difficulty !== undefined) {
    state.selectedDifficulty = patch.difficulty;
  }

  if ("disableNations" in patch && patch.disableNations !== undefined) {
    state.disableNations = patch.disableNations;
  }

  if ("gameMode" in patch && patch.gameMode !== undefined) {
    state.gameMode = patch.gameMode;
  }

  if ("playerTeams" in patch && patch.playerTeams !== undefined) {
    state.teamCount = patch.playerTeams;
  }

  if ("bots" in patch && patch.bots !== undefined) {
    state.bots = patch.bots;
  }

  if ("infiniteGold" in patch && patch.infiniteGold !== undefined) {
    state.infiniteGold = patch.infiniteGold;
  }

  if ("infiniteTroops" in patch && patch.infiniteTroops !== undefined) {
    state.infiniteTroops = patch.infiniteTroops;
  }

  if ("instantBuild" in patch && patch.instantBuild !== undefined) {
    state.instantBuild = patch.instantBuild;
  }

  if ("randomSpawn" in patch && patch.randomSpawn !== undefined) {
    state.randomSpawn = patch.randomSpawn;
  }

  if ("disabledUnits" in patch) {
    state.disabledUnits = patch.disabledUnits ?? [];
  }

  if ("maxTimerValue" in patch) {
    const value = patch.maxTimerValue;
    state.maxTimer = value !== undefined && value !== null;
    state.maxTimerValue = value === null ? undefined : value;
  }

  if ("goldMultiplier" in patch) {
    const value = patch.goldMultiplier;
    state.goldMultiplier = value !== undefined && value !== null;
    state.goldMultiplierValue = value === null ? undefined : value;
  }

  if ("startingGold" in patch) {
    const value = patch.startingGold;
    state.startingGold = value !== undefined && value !== null;
    state.startingGoldValue = value === null ? undefined : value;
  }
}

export function resetHostLobbyGameConfigFormState(state: FormState): void {
  const defaultConfig = createDefaultPrivateGameConfig();
  resetCommonGameConfigFormState(state, defaultConfig);

  state.donateGold = defaultConfig.donateGold;
  state.donateTroops = defaultConfig.donateTroops;

  const defaultSpawnImmunityTicks = defaultConfig.spawnImmunityDuration;
  state.spawnImmunity = defaultSpawnImmunityTicks !== undefined;
  state.spawnImmunityDurationMinutes =
    defaultSpawnImmunityTicks === undefined
      ? undefined
      : defaultSpawnImmunityTicks / TICKS_PER_MINUTE;
}

export function buildHostLobbyGameConfigPatch(
  state: FormState,
): Partial<GameConfig> {
  const patch = buildCommonGameConfigPatch(state);

  patch.donateGold = state.donateGold;
  patch.donateTroops = state.donateTroops;

  const spawnImmunityTicks = state.spawnImmunityDurationMinutes
    ? state.spawnImmunityDurationMinutes * TICKS_PER_MINUTE
    : 0;
  patch.spawnImmunityDuration = state.spawnImmunity
    ? spawnImmunityTicks
    : undefined;

  return patch;
}

export function applyHostLobbyGameConfigPatch(
  state: FormState,
  patch: GameConfigPatch,
): void {
  applyCommonGameConfigPatch(state, patch);

  if ("donateGold" in patch && patch.donateGold !== undefined) {
    state.donateGold = patch.donateGold;
  }

  if ("donateTroops" in patch && patch.donateTroops !== undefined) {
    state.donateTroops = patch.donateTroops;
  }

  if ("spawnImmunityDuration" in patch) {
    const ticks = patch.spawnImmunityDuration;
    state.spawnImmunity = ticks !== undefined && ticks !== null;
    state.spawnImmunityDurationMinutes =
      ticks === undefined || ticks === null
        ? undefined
        : ticks / TICKS_PER_MINUTE;
  }

  state.requestUpdate?.();
}

export function buildPrivateLobbyGameConfig(state: FormState): GameConfig {
  return {
    ...createDefaultPrivateGameConfig(),
    ...buildHostLobbyGameConfigPatch(state),
  };
}

export function resetSinglePlayerGameConfigFormState(state: FormState): void {
  resetCommonGameConfigFormState(state, createDefaultSingleplayerGameConfig());
}

export function buildSinglePlayerGameConfigPatch(
  state: FormState,
): Partial<GameConfig> {
  return buildCommonGameConfigPatch(state);
}

export function applySinglePlayerGameConfigPatch(
  state: FormState,
  patch: GameConfigPatch,
): void {
  applyCommonGameConfigPatch(state, patch);
  state.requestUpdate?.();
}

export function buildSinglePlayerGameConfig(state: FormState): GameConfig {
  const defaultConfig = createDefaultSingleplayerGameConfig();
  const patch = buildSinglePlayerGameConfigPatch(state);
  const gameMode = patch.gameMode ?? defaultConfig.gameMode;

  return {
    ...defaultConfig,
    ...patch,
    donateGold: gameMode === GameMode.Team,
    donateTroops: gameMode === GameMode.Team,
  };
}
