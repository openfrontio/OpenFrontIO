import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  GRAPHICS_KEY,
  GRAPHICS_PRESETS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import {
  BUILTIN_PRESETS,
  migrateLegacyGraphicsSettings,
  stableStringify,
} from "../GraphicsPresets";
import { showInGameConfirm } from "../InGameModal";
import { type GraphicsOverrides } from "../render/gl";
import { translateText } from "../Utils";

const CUSTOM_VALUE = "custom";

/**
 * Dropdown that applies a graphics preset (built-ins + the player's saved
 * ones) wholesale. Shows a disabled "Custom" entry while the current
 * overrides match no preset, and a delete button when a saved preset is
 * selected. Self-contained: reads/writes UserSettings directly and re-renders
 * on the settings-changed events, so hosts just drop the element in.
 */
@customElement("graphics-preset-selector")
export class GraphicsPresetSelector extends LitElement {
  private readonly userSettings = new UserSettings();

  // The option value the player last picked. Selection is otherwise derived
  // by content matching, which cannot tell apart presets with identical
  // overrides (e.g. a saved preset that duplicates a built-in) — without
  // this, such a preset could never show as selected, so its delete button
  // could never appear.
  @state()
  private lastSelected: string | null = null;

  createRenderRoot() {
    return this;
  }

  private readonly onSettingsChanged = () => this.requestUpdate();

  connectedCallback() {
    super.connectedCallback();
    for (const key of [GRAPHICS_KEY, GRAPHICS_PRESETS_KEY]) {
      globalThis.addEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${key}`,
        this.onSettingsChanged,
      );
    }
  }

  disconnectedCallback() {
    for (const key of [GRAPHICS_KEY, GRAPHICS_PRESETS_KEY]) {
      globalThis.removeEventListener(
        `${USER_SETTINGS_CHANGED_EVENT}:${key}`,
        this.onSettingsChanged,
      );
    }
    super.disconnectedCallback();
  }

  private isActive(overrides: GraphicsOverrides): boolean {
    return (
      stableStringify(this.userSettings.graphicsOverrides()) ===
      stableStringify(overrides)
    );
  }

  private overridesForValue(value: string): GraphicsOverrides | undefined {
    const separator = value.indexOf(":");
    if (separator === -1) return undefined;
    const kind = value.slice(0, separator);
    const key = value.slice(separator + 1);
    return kind === "builtin"
      ? BUILTIN_PRESETS.find((p) => p.nameKey === key)?.overrides
      : this.userSettings.graphicsPresets()[key];
  }

  private selectedValue(): string {
    const last =
      this.lastSelected !== null
        ? this.overridesForValue(this.lastSelected)
        : undefined;
    if (last !== undefined && this.isActive(last)) {
      return this.lastSelected!;
    }
    const builtin = BUILTIN_PRESETS.find((p) => this.isActive(p.overrides));
    if (builtin !== undefined) return `builtin:${builtin.nameKey}`;
    const user = Object.entries(this.userSettings.graphicsPresets()).find(
      ([, overrides]) => this.isActive(overrides),
    );
    if (user !== undefined) return `user:${user[0]}`;
    return CUSTOM_VALUE;
  }

  private onSelect(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    const overrides = this.overridesForValue(value);
    if (overrides !== undefined) {
      // Snapshot pre-preset custom settings before the first wholesale
      // overwrite — the in-game migration hasn't run yet if the player has
      // only used the main-menu selector.
      migrateLegacyGraphicsSettings(this.userSettings);
      this.lastSelected = value;
      this.userSettings.setGraphicsOverrides(overrides);
    }
  }

  private async onDelete() {
    const value = this.selectedValue();
    if (!value.startsWith("user:")) return;
    const name = value.slice("user:".length);
    const confirmed = await showInGameConfirm(
      translateText("graphics_setting.preset_delete_confirm", { name }),
    );
    if (!confirmed) return;
    const presets = { ...this.userSettings.graphicsPresets() };
    delete presets[name];
    this.userSettings.setGraphicsPresets(presets);
  }

  render() {
    const selected = this.selectedValue();
    const userPresets = Object.keys(this.userSettings.graphicsPresets());
    return html`
      <div class="flex gap-2 items-center">
        <select
          @change=${this.onSelect}
          class="flex-1 min-w-0 px-2 py-1.5 bg-slate-900 border border-slate-500 rounded-sm text-sm text-white cursor-pointer"
        >
          ${selected === CUSTOM_VALUE
            ? html`<option value=${CUSTOM_VALUE} .selected=${true} disabled>
                ${translateText("graphics_setting.preset_custom")}
              </option>`
            : null}
          ${BUILTIN_PRESETS.map(
            (preset) =>
              html`<option
                value=${`builtin:${preset.nameKey}`}
                .selected=${selected === `builtin:${preset.nameKey}`}
              >
                ${translateText(preset.nameKey)}
              </option>`,
          )}
          ${userPresets.map(
            (name) =>
              html`<option
                value=${`user:${name}`}
                .selected=${selected === `user:${name}`}
              >
                ${name}
              </option>`,
          )}
        </select>
        ${selected.startsWith("user:")
          ? html`
              <button
                class="px-2 py-1 text-slate-400 hover:text-white"
                @click=${this.onDelete}
              >
                ✕
              </button>
            `
          : null}
      </div>
    `;
  }
}
