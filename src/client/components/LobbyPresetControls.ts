import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameConfig } from "../../core/Schemas";
import {
  LobbyPreset,
  LobbyPresetGameConfigPatch,
  deletePreset,
  loadLobbyPresetStore,
  setAutoApplyLastUsed,
  setLastUsedPresetId,
  upsertPreset,
} from "../LobbyPresets";
import { generateCryptoRandomUUID, translateText } from "../Utils";
import { GameConfigPatch } from "../utilities/GameConfigFormState";

type GetConfigPatch = () => Partial<GameConfig>;
type ApplyPreset = (patch: GameConfigPatch) => void | Promise<void>;
type ResetPreset = () => void | Promise<void>;

@customElement("lobby-preset-controls")
export class LobbyPresetControls extends LitElement {
  @property({ attribute: false }) getConfigPatch?: GetConfigPatch;
  @property({ attribute: false }) onApplyPreset?: ApplyPreset;
  @property({ attribute: false }) onResetPreset?: ResetPreset;

  @state() private presetOptions: Array<{ id: string; name: string }> = [];
  @state() private selectedPresetId: string | undefined = undefined;
  @state() private presetNameInput: string = "";
  @state() private autoApplyLastUsedPreset: boolean = false;

  private readonly presetSelectId = `preset-select-${generateCryptoRandomUUID()}`;
  private readonly presetNameId = `preset-name-${generateCryptoRandomUUID()}`;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "block";
  }

  public syncFromStore(preferredSelectionId?: string): LobbyPreset | undefined {
    const store = loadLobbyPresetStore();

    this.presetOptions = store.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
    }));
    this.autoApplyLastUsedPreset = store.autoApplyLastUsed ?? false;

    const selectionId =
      preferredSelectionId ??
      (this.autoApplyLastUsedPreset ? store.lastUsedPresetId : undefined);
    const selectedPreset = selectionId
      ? store.presets.find((preset) => preset.id === selectionId)
      : undefined;

    this.selectedPresetId = selectedPreset?.id;
    this.presetNameInput = selectedPreset?.name ?? "";

    return selectedPreset;
  }

  private showMessage(message: string, color: "green" | "red" = "green") {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: { message, duration: 2000, color },
      }),
    );
  }

  private async handlePresetSelectionChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    this.selectedPresetId = value || undefined;

    if (!this.selectedPresetId) {
      this.presetNameInput = "";
      setLastUsedPresetId(undefined);
      await this.onResetPreset?.();
      return;
    }

    const store = loadLobbyPresetStore();
    const preset = store.presets.find(
      (candidate) => candidate.id === this.selectedPresetId,
    );
    if (!preset) {
      this.showMessage(translateText("host_modal.presets_not_found"), "red");
      this.selectedPresetId = undefined;
      this.presetNameInput = "";
      setLastUsedPresetId(undefined);
      return;
    }

    this.presetNameInput = preset.name;
    await this.onApplyPreset?.(preset.config);
    setLastUsedPresetId(preset.id);
    this.showMessage(
      translateText("host_modal.presets_applied", { name: preset.name }),
    );
  }

  private handlePresetNameInput(e: Event) {
    this.presetNameInput = (e.target as HTMLInputElement).value;
  }

  private handlePresetSaveClick() {
    const name = this.presetNameInput.trim();
    if (!name) return;
    if (!this.getConfigPatch) return;

    const rawPatch = this.getConfigPatch();
    const config: LobbyPresetGameConfigPatch = {
      ...rawPatch,
      maxTimerValue: rawPatch.maxTimerValue ?? null,
      goldMultiplier: rawPatch.goldMultiplier ?? null,
      startingGold: rawPatch.startingGold ?? null,
      spawnImmunityDuration: rawPatch.spawnImmunityDuration ?? null,
    };

    const preset = upsertPreset({
      id: this.selectedPresetId,
      name,
      config,
    });

    setLastUsedPresetId(preset.id);
    this.syncFromStore(preset.id);
    this.showMessage(
      translateText("host_modal.presets_saved", { name: preset.name }),
    );
  }

  private handlePresetDeleteClick() {
    if (!this.selectedPresetId) return;
    const store = loadLobbyPresetStore();
    const preset = store.presets.find(
      (candidate) => candidate.id === this.selectedPresetId,
    );

    deletePreset(this.selectedPresetId);
    this.syncFromStore();
    this.showMessage(
      translateText("host_modal.presets_deleted", {
        name: preset?.name ?? "",
      }),
    );
  }

  private handleAutoApplyPresetChange(e: Event) {
    this.autoApplyLastUsedPreset = (e.target as HTMLInputElement).checked;
    setAutoApplyLastUsed(this.autoApplyLastUsedPreset);
  }

  render() {
    const presetButtonClass = (enabled: boolean) =>
      `px-4 py-3 rounded-xl border transition-all duration-200 text-xs font-bold uppercase tracking-wider flex-1 ${
        enabled
          ? "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-white"
          : "bg-white/5 border-white/5 text-white/30 cursor-not-allowed"
      }`;
    const hasSelectedPreset = Boolean(this.selectedPresetId);
    const hasPresetName = this.presetNameInput.trim().length > 0;

    return html`
      <div class="space-y-6">
        <div class="flex items-center gap-4 pb-2 border-b border-white/10">
          <div
            class="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              class="w-5 h-5"
            >
              <path
                d="M6 4.5A2.25 2.25 0 018.25 2.25h7.5A2.25 2.25 0 0118 4.5v16.191a.75.75 0 01-1.135.65L12 18.382l-4.865 2.959A.75.75 0 016 20.691V4.5z"
              />
            </svg>
          </div>
          <h3 class="text-lg font-bold text-white uppercase tracking-wider">
            ${translateText("host_modal.presets_title")}
          </h3>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
          <div class="lg:col-span-4">
            <label
              class="text-xs font-bold text-white/40 uppercase tracking-widest mb-2 pl-2 block"
              for=${this.presetSelectId}
            >
              ${translateText("host_modal.presets_select")}
            </label>
            <select
              id=${this.presetSelectId}
              class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              @change=${this.handlePresetSelectionChange}
            >
              <option value="">
                ${translateText("host_modal.presets_default")}
              </option>
              ${this.presetOptions.map(
                (preset) => html`
                  <option
                    value=${preset.id}
                    ?selected=${this.selectedPresetId === preset.id}
                  >
                    ${preset.name}
                  </option>
                `,
              )}
            </select>
          </div>
          <div class="lg:col-span-4">
            <label
              class="text-xs font-bold text-white/40 uppercase tracking-widest mb-2 pl-2 block"
              for=${this.presetNameId}
            >
              ${translateText("host_modal.presets_name")}
            </label>
            <input
              id=${this.presetNameId}
              type="text"
              class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              .value=${this.presetNameInput}
              maxlength="40"
              placeholder=${translateText(
                "host_modal.presets_name_placeholder",
              )}
              @input=${this.handlePresetNameInput}
            />
          </div>
          <div class="lg:col-span-4 flex gap-2 items-end">
            <button
              class=${presetButtonClass(hasPresetName)}
              @click=${this.handlePresetSaveClick}
              ?disabled=${!hasPresetName}
            >
              ${translateText("host_modal.presets_save")}
            </button>
            <button
              class=${presetButtonClass(hasSelectedPreset)}
              @click=${this.handlePresetDeleteClick}
              ?disabled=${!hasSelectedPreset}
            >
              ${translateText("host_modal.presets_delete")}
            </button>
          </div>
          <label
            class="lg:col-span-12 flex items-center gap-3 text-sm text-white/70"
          >
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-white/20 bg-white/10 text-blue-500 focus:ring-blue-500/50"
              .checked=${this.autoApplyLastUsedPreset}
              @change=${this.handleAutoApplyPresetChange}
            />
            <span>${translateText("host_modal.presets_auto_apply")}</span>
          </label>
        </div>
      </div>
    `;
  }
}
