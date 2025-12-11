import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Difficulty, GameMapType, GameMode } from "../../../core/game/Game";
import { UserSettings } from "../../../core/game/UserSettings";
import {
  LobbyPresetConfig,
  LobbyPresetConfigSchema,
  TeamCountConfig,
} from "../../../core/Schemas";
import { translateText } from "../../Utils";
import "../baseComponents/Button";
export { LobbyPresetConfigSchema } from "../../../core/Schemas";
export type { LobbyPresetConfig } from "../../../core/Schemas";

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
    const parsed = LobbyPresetConfigSchema.parse(config);
    return {
      gameMap: parsed.gameMap ?? GameMapType.World,
      useRandomMap: parsed.useRandomMap ?? false,
      difficulty: parsed.difficulty ?? Difficulty.Medium,
      disableNPCs: parsed.disableNPCs ?? false,
      bots: parsed.bots ?? 400,
      infiniteGold: parsed.infiniteGold ?? false,
      donateGold: parsed.donateGold ?? false,
      infiniteTroops: parsed.infiniteTroops ?? false,
      donateTroops: parsed.donateTroops ?? false,
      instantBuild: parsed.instantBuild ?? false,
      randomSpawn: parsed.randomSpawn ?? false,
      compactMap: parsed.compactMap ?? false,
      maxTimer: parsed.maxTimer ?? false,
      maxTimerValue: parsed.maxTimerValue,
      gameMode: parsed.gameMode ?? GameMode.FFA,
      playerTeams: parsed.playerTeams ?? (2 as TeamCountConfig),
      disabledUnits: parsed.disabledUnits ?? [],
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
