import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  Difficulty,
  GameMapType,
  GameMode,
  UnitType,
} from "../../../core/game/Game";
import { UserSettings } from "../../../core/game/UserSettings";
import { TeamCountConfig } from "../../../core/Schemas";
import { translateText } from "../../Utils";
import "../baseComponents/Button";

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
      bots: config.bots ?? 400,
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

@customElement("lobby-preset-controls")
export class LobbyPresetControls extends LitElement {
  @property({ type: Array }) presets: LobbyPreset[] = [];
  @property({ type: String }) selectedName = "";
  @property({ type: String }) nameInput = "";

  createRenderRoot() {
    return this;
  }

  private handlePresetSelect(e: Event) {
    const name = (e.target as HTMLSelectElement).value;
    this.dispatchEvent(
      new CustomEvent<string>("preset-select", {
        detail: name,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handlePresetLoad() {
    const name = this.selectedName.trim();
    if (!name) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<string>("preset-load", {
        detail: name,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handlePresetDelete() {
    const name = this.selectedName.trim();
    if (!name) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<string>("preset-delete", {
        detail: name,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleNameInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    this.dispatchEvent(
      new CustomEvent<string>("preset-name-input", {
        detail: value,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handlePresetSave() {
    const cleanedName = (this.nameInput || this.selectedName).trim();
    if (!cleanedName) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<string>("preset-save", {
        detail: cleanedName,
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="options-section">
        <div class="option-title">
          ${translateText("lobby_config.preset.title")}
        </div>
        <div class="option-cards" style="gap: 10px;">
          <div style="display: flex; gap: 8px; flex-wrap: wrap; width: 100%;">
            <select
              @change=${this.handlePresetSelect}
              .value=${this.selectedName}
              class="preset-select px-2 py-1 rounded-lg border border-gray-300 text-black dark:bg-gray-700 dark:text-white dark:border-gray-300/60"
              style="flex: 1; min-width: 160px;"
            >
              <option value="">
                ${translateText("lobby_config.preset.select")}
              </option>
              ${this.presets.map(
                (preset) =>
                  html` <option value=${preset.name}>${preset.name}</option>`,
              )}
            </select>
            <o-button
              title=${translateText("lobby_config.preset.load")}
              @click=${this.handlePresetLoad}
              ?disabled=${!this.selectedName}
              secondary
            ></o-button>
            <o-button
              title=${translateText("lobby_config.preset.delete")}
              @click=${this.handlePresetDelete}
              ?disabled=${!this.selectedName}
              secondary
            ></o-button>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; width: 100%;">
            <input
              type="text"
              placeholder=${translateText("lobby_config.preset.placeholder")}
              .value=${this.nameInput}
              @input=${this.handleNameInput}
              class="px-2 py-2 rounded-lg border border-gray-300 text-black dark:bg-gray-700 dark:text-white dark:border-gray-300/60"
              style="flex: 1; min-width: 160px;"
            />
            <o-button
              title=${translateText("lobby_config.preset.save")}
              @click=${this.handlePresetSave}
              secondary
            ></o-button>
          </div>
        </div>
      </div>
    `;
  }
}
