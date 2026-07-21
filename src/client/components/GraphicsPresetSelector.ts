import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import {
  GRAPHICS_KEY,
  GRAPHICS_PRESETS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import { showInGameConfirm } from "../InGameModal";
import { GraphicsOverridesSchema, type GraphicsOverrides } from "../render/gl";
import builtinPresets from "../render/gl/graphics-presets.json";
import { translateText } from "../Utils";

// Built-in presets, defined in graphics-presets.json — each entry's overrides
// are schema-parsed at load (JSON imports can't carry the palette enum's
// literal types). Overrides are applied wholesale. Night's ambient 0.36 is
// the graphics modal slider's level 8.
export const BUILTIN_PRESETS: ReadonlyArray<{
  nameKey: string;
  descKey: string;
  overrides: GraphicsOverrides;
}> = builtinPresets.map((preset) => ({
  nameKey: preset.nameKey,
  descKey: preset.descKey,
  overrides: GraphicsOverridesSchema.parse(preset.overrides),
}));

// Serialize with recursively sorted keys so preset equality doesn't depend on
// the order the settings were touched in.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

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

  private selectedValue(): string {
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
    const separator = value.indexOf(":");
    if (separator === -1) return; // the disabled "Custom" placeholder
    const kind = value.slice(0, separator);
    const key = value.slice(separator + 1);
    const overrides =
      kind === "builtin"
        ? BUILTIN_PRESETS.find((p) => p.nameKey === key)?.overrides
        : this.userSettings.graphicsPresets()[key];
    if (overrides !== undefined) {
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
