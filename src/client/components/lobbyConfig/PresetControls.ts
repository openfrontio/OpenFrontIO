import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UserSettings } from "../../../core/game/UserSettings";
import {
  defaultLobbySettings,
  LobbyPreset,
  LobbyPresetConfig,
  LobbyPresetConfigSchema,
} from "../../../core/Schemas";
import { translateText } from "../../Utils";
import "../baseComponents/Button";

export const lobbyPresetKeys = [
  "gameMap",
  "useRandomMap",
  "difficulty",
  "disableNPCs",
  "bots",
  "infiniteGold",
  "donateGold",
  "infiniteTroops",
  "donateTroops",
  "gameType",
  "gameMapSize",
  "instantBuild",
  "randomSpawn",
  "compactMap",
  "maxTimer",
  "maxTimerValue",
  "gameMode",
  "playerTeams",
  "disabledUnits",
] as const;

export type LobbyPresetKey = (typeof lobbyPresetKeys)[number];
export type LobbyPresetDefaults = {
  [K in LobbyPresetKey]-?: LobbyPresetConfig[K];
};

export class PresetManagement extends LitElement {
  @state() protected lobbyPresets: LobbyPreset[] = [];
  @state() protected selectedPresetName = "";
  @state() protected presetNameInput = "";

  protected userSettings: UserSettings;

  constructor() {
    super();
    this.userSettings = new UserSettings();
  }

  protected loadPresets() {
    this.lobbyPresets = this.listPresets();
  }

  protected handlePresetSelect(e: CustomEvent<string>) {
    this.selectedPresetName = e.detail;
  }

  protected handlePresetNameInput(e: CustomEvent<string>) {
    this.presetNameInput = e.detail;
  }

  protected savePreset(
    e: CustomEvent<string>,
    buildConfig: () => LobbyPresetConfig,
  ) {
    const name = (
      e.detail ??
      this.presetNameInput ??
      this.selectedPresetName
    ).trim();
    if (!name) return;

    this.lobbyPresets = this.savePresetConfig(name, buildConfig());
    this.selectedPresetName = name;
    this.presetNameInput = "";
  }

  protected deletePreset(e?: CustomEvent<string>) {
    const presetName = (e?.detail ?? this.selectedPresetName).trim();
    if (!presetName) return;

    this.lobbyPresets = this.deletePresetConfig(presetName);
    if (this.selectedPresetName === presetName) {
      this.selectedPresetName = "";
    }
  }

  protected listPresets(): LobbyPreset[] {
    return this.userSettings
      .getLobbyPresets()
      .map((preset) => LobbyPresetControls.normalizePreset(preset));
  }

  protected savePresetConfig(
    name: string,
    config: LobbyPresetConfig,
  ): LobbyPreset[] {
    const presets = this.listPresets().filter((preset) => preset.name !== name);
    const updated = [
      ...presets,
      {
        name,
        config: LobbyPresetControls.normalizePresetConfig(config),
      },
    ];
    this.userSettings.setLobbyPresets(updated);
    return updated;
  }

  protected deletePresetConfig(name: string): LobbyPreset[] {
    const updated = this.listPresets().filter((preset) => preset.name !== name);
    this.userSettings.setLobbyPresets(updated);
    return updated;
  }
}

@customElement("lobby-preset-controls")
export class LobbyPresetControls extends LitElement {
  @property({ type: Array }) presets: LobbyPreset[] = [];
  @property({ type: String }) selectedName = "";
  @property({ type: String }) nameInput = "";

  static normalizePreset(preset: LobbyPreset): LobbyPreset {
    const config = LobbyPresetControls.normalizePresetConfig(
      preset?.config ?? {},
    );
    return { name: preset?.name ?? "Preset", config };
  }

  static normalizePresetConfig(
    config: Partial<LobbyPresetConfig>,
  ): LobbyPresetConfig {
    const merged = {
      ...(defaultLobbySettings as LobbyPresetDefaults),
      ...config,
    } as LobbyPresetConfig;
    const parsedResult = LobbyPresetConfigSchema.safeParse(merged);
    if (parsedResult.success) {
      return parsedResult.data;
    }
    return defaultLobbySettings as LobbyPresetConfig;
  }

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
