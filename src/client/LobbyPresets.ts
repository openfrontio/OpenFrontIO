import { Difficulty, GameMapType, GameMode, UnitType } from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { TeamCountConfig } from "../core/Schemas";

export type LobbyPresetConfig = {
  gameMap: GameMapType;
  useRandomMap: boolean;
  difficulty: Difficulty;
  disableNPCs: boolean;
  bots: number;
  infiniteGold: boolean;
  donateGold: boolean;
  infiniteTroops: boolean;
  donateTroops: boolean;
  instantBuild: boolean;
  randomSpawn: boolean;
  compactMap: boolean;
  maxTimer: boolean;
  maxTimerValue?: number;
  gameMode: GameMode;
  playerTeams: TeamCountConfig;
  disabledUnits: UnitType[];
};

export type LobbyPreset = {
  name: string;
  config: LobbyPresetConfig;
};

export class LobbyPresetStore {
  constructor(private userSettings = new UserSettings()) {}

  list(): LobbyPreset[] {
    return this.userSettings
      .getLobbyPresets()
      .map((preset) => this.normalizePreset(preset));
  }

  save(name: string, config: LobbyPresetConfig): LobbyPreset[] {
    const presets = this.list().filter((preset) => preset.name !== name);
    const updated = [
      ...presets,
      { name, config: this.normalizePresetConfig(config) },
    ];
    this.userSettings.setLobbyPresets(updated);
    return updated;
  }

  delete(name: string): LobbyPreset[] {
    const updated = this.list().filter((preset) => preset.name !== name);
    this.userSettings.setLobbyPresets(updated);
    return updated;
  }

  private normalizePreset(preset: LobbyPreset): LobbyPreset {
    const config = this.normalizePresetConfig(preset?.config ?? {});
    return { name: preset?.name ?? "Preset", config };
  }

  private normalizePresetConfig(
    config: Partial<LobbyPresetConfig>,
  ): LobbyPresetConfig {
    return {
      gameMap: config.gameMap ?? GameMapType.World,
      useRandomMap: config.useRandomMap ?? false,
      difficulty: config.difficulty ?? Difficulty.Medium,
      disableNPCs: config.disableNPCs ?? false,
      bots: config.bots ?? 0,
      infiniteGold: config.infiniteGold ?? false,
      donateGold: config.donateGold ?? false,
      infiniteTroops: config.infiniteTroops ?? false,
      donateTroops: config.donateTroops ?? false,
      instantBuild: config.instantBuild ?? false,
      randomSpawn: config.randomSpawn ?? false,
      compactMap: config.compactMap ?? false,
      maxTimer: config.maxTimer ?? false,
      maxTimerValue: config.maxTimerValue,
      gameMode: config.gameMode ?? GameMode.FFA,
      playerTeams: config.playerTeams ?? 2,
      disabledUnits: config.disabledUnits ?? [],
    };
  }
}
