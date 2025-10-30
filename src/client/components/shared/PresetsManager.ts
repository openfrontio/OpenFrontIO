import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { generateID } from "../../../core/Util";
import { translateText } from "../../Utils";
import type { Preset } from "../../types/preset";
import "./PresetsBar";

// Generic preset type (alias to shared Preset<T>)
export type GenericPreset<T = unknown> = Preset<T>;

@customElement("presets-manager")
export class PresetsManager<T = unknown> extends LitElement {
  // Storage key to isolate presets per context (host vs single player)
  @property({ type: String }) storageKey!: string;
  // Max number of presets to keep
  @property({ type: Number }) limit: number = 10;
  // Function to read the current settings from the parent
  @property({ attribute: false }) getSettings: (() => T) | null = null;

  @state() private presets: Array<GenericPreset<T>> = [];
  @state() private selectedId: string | null = null;
  @state() private nameInput: string = "";
  @state() private error: string = "";

  connectedCallback(): void {
    super.connectedCallback();
    // Warn early if a required prop is missing to aid integration/debugging
    if (!this.storageKey) {
      console.warn(
        "PresetsManager: missing required 'storageKey' prop. Presets will not be loaded/saved.",
      );
      return;
    }
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (!this.storageKey) return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const arr = parsed.filter(
          (item: any) =>
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.createdAt === "number" &&
            typeof item.updatedAt === "number" &&
            item.settings !== undefined,
        ) as Array<GenericPreset<T>>;
        this.presets = arr
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, this.limit);
        if (arr.length !== this.presets.length) this.persistToStorage();
      }
    } catch (e) {
      console.warn("Failed to load presets:", e);
    }
  }

  private persistToStorage() {
    if (!this.storageKey) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.presets));
    } catch (e) {
      console.warn("Failed to save presets:", e);
    }
  }

  private onSelect = (id: string | null) => {
    this.selectedId = id;
    const preset = this.presets.find((p) => p.id === id) ?? null;
    if (preset) {
      this.nameInput = preset.name;
      this.dispatchEvent(
        new CustomEvent("apply-preset", {
          detail: { settings: preset.settings },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.nameInput = "";
      // Notify parent that selection was cleared so it can restore defaults
      this.dispatchEvent(
        new CustomEvent("clear-preset", {
          bubbles: true,
          composed: true,
        }),
      );
    }
  };

  private onNameInput = (value: string) => {
    this.nameInput = value;
    if (this.error && this.nameInput.trim()) this.error = "";
  };

  private onSave = () => {
    const name = this.nameInput.trim();
    if (!name) {
      this.error = translateText("presets.error_no_name");
      return;
    }
    if (this.presets.length >= this.limit) {
      this.error = translateText("presets.error_limit_reached").replace(
        "{limit}",
        String(this.limit),
      );
      return;
    }
    if (!this.getSettings) {
      this.error = translateText("presets.error_missing_settings");
      return;
    }

    const now = Date.now();
    const preset: GenericPreset<T> = {
      id: generateID(),
      name,
      createdAt: now,
      updatedAt: now,
      settings: this.getSettings(),
    };
    this.presets = [...this.presets, preset];
    this.selectedId = preset.id;
    this.persistToStorage();
  };

  private onUpdate = () => {
    if (!this.selectedId) return;
    const i = this.presets.findIndex((p) => p.id === this.selectedId);
    if (i < 0) return;
    if (!this.getSettings) {
      this.error = translateText("presets.error_missing_settings");
      return;
    }

    const name = this.nameInput.trim() || this.presets[i].name;
    const updated: GenericPreset<T> = {
      ...this.presets[i],
      name,
      updatedAt: Date.now(),
      settings: this.getSettings(),
    };
    this.presets = [
      ...this.presets.slice(0, i),
      updated,
      ...this.presets.slice(i + 1),
    ];
    this.nameInput = updated.name;
    this.persistToStorage();
  };

  private onDelete = () => {
    if (!this.selectedId) return;
    this.presets = this.presets.filter((p) => p.id !== this.selectedId);
    this.selectedId = null;
    this.nameInput = "";
    this.persistToStorage();
  };

  render() {
    return html`
      <presets-bar
        .items=${this.presets.map((p) => ({ id: p.id, name: p.name }))}
        .selectedId=${this.selectedId}
        .nameInput=${this.nameInput}
        .error=${this.error}
        .limit=${this.limit}
        @select=${(e: CustomEvent<string | null>) => this.onSelect(e.detail)}
        @name-input=${(e: CustomEvent<string>) => this.onNameInput(e.detail)}
        @save=${this.onSave}
        @update=${this.onUpdate}
        @delete=${this.onDelete}
      ></presets-bar>
    `;
  }

  createRenderRoot() {
    return this;
  }
}
