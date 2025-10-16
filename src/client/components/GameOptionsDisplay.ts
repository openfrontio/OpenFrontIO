import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMapSize, UnitType } from "../../core/game/Game";
import { GameConfig } from "../../core/Schemas";
import { translateText } from "../Utils";
import "./CheckboxCard";

/**
 * Shared component for displaying game options and unit settings
 * Used by both HostLobbyModal (interactive) and JoinPrivateLobbyModal (read-only)
 */
@customElement("game-options-display")
export class GameOptionsDisplay extends LitElement {
  /**
   * The game configuration to display
   */
  @property({ type: Object }) gameConfig?: GameConfig;

  /**
   * Whether the options should be editable (true) or read-only (false)
   */
  @property({ type: Boolean }) editable: boolean = false;

  /**
   * Current bot count value (for interactive mode)
   */
  @property({ type: Number }) bots: number = 0;

  /**
   * Callback for when bot count changes (interactive mode only)
   */
  @property({ attribute: false }) onBotsChange?: (value: number) => void;

  /**
   * Callback for when a checkbox option changes (interactive mode only)
   */
  @property({ attribute: false }) onOptionChange?: (
    key: string,
    value: boolean,
  ) => void;

  /**
   * Callback for when a unit is toggled (interactive mode only)
   */
  @property({ attribute: false }) onUnitToggle?: (
    unit: UnitType,
    disabled: boolean,
  ) => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Use display: contents so this element doesn't participate in flex layout
    // This makes its children direct flex items of the parent .option-cards container
    this.style.display = "contents";
  }

  render() {
    if (!this.gameConfig) return html``;

    return html`
      ${this.renderBotSlider()} ${this.renderCheckboxOptions()}
      ${this.renderUnitSettings()}
    `;
  }

  /**
   * Renders the bot count slider
   */
  private renderBotSlider() {
    if (!this.gameConfig) return html``;

    const botCount = this.editable ? this.bots : this.gameConfig.bots;

    if (this.editable) {
      return html`
        <label for="bots-count" class="option-card">
          <input
            type="range"
            id="bots-count"
            min="0"
            max="400"
            step="1"
            @input=${(e: Event) => {
              const value = parseInt((e.target as HTMLInputElement).value);
              if (this.onBotsChange) {
                this.onBotsChange(value);
              }
            }}
            @change=${(e: Event) => {
              const value = parseInt((e.target as HTMLInputElement).value);
              if (this.onBotsChange) {
                this.onBotsChange(value);
              }
            }}
            .value="${String(botCount)}"
          />
          <div class="option-card-title">
            <span>${translateText("host_modal.bots")} </span>
            ${botCount === 0
              ? translateText("host_modal.bots_disabled")
              : botCount}
          </div>
        </label>
      `;
    } else {
      // Read-only mode
      return html`
        <label
          for="bots-count-display"
          class="option-card ${botCount > 0 ? "selected" : ""}"
          style="pointer-events: none;"
        >
          <input
            type="range"
            id="bots-count-display"
            min="0"
            max="400"
            step="1"
            .value="${String(botCount)}"
            style="pointer-events: none;"
            disabled
          />
          <div class="option-card-title">
            <span>${translateText("host_modal.bots")} </span>
            ${botCount === 0
              ? translateText("host_modal.bots_disabled")
              : botCount}
          </div>
          <style>
            #bots-count-display::-webkit-slider-thumb {
              display: none;
            }
            #bots-count-display::-moz-range-thumb {
              display: none;
            }
            #bots-count-display::-ms-thumb {
              display: none;
            }
          </style>
        </label>
      `;
    }
  }

  /**
   * Renders all checkbox options (NPCs, instant build, donations, etc.)
   */
  private renderCheckboxOptions() {
    if (!this.gameConfig) return html``;

    const options = [
      { key: "disableNPCs", label: "disable_nations" },
      { key: "instantBuild", label: "instant_build" },
      { key: "donateGold", label: "donate_gold" },
      { key: "donateTroops", label: "donate_troops" },
      { key: "infiniteGold", label: "infinite_gold" },
      { key: "infiniteTroops", label: "infinite_troops" },
    ];

    return html`
      ${options.map((option) =>
        this.renderCheckboxOption(option.key, option.label),
      )}
      ${this.renderCompactMapOption()}
    `;
  }

  /**
   * Renders a single checkbox option
   */
  private renderCheckboxOption(key: string, label: string): TemplateResult {
    if (!this.gameConfig) return html``;

    const value = this.gameConfig[key as keyof GameConfig] as boolean;

    return html`
      <checkbox-card
        id="${key}"
        label="${translateText(`host_modal.${label}`)}"
        .checked=${value}
        .editable=${this.editable}
        .onChange=${(checked: boolean) => {
          if (this.onOptionChange) {
            this.onOptionChange(key, checked);
          }
        }}
      ></checkbox-card>
    `;
  }

  /**
   * Renders the compact map option
   */
  private renderCompactMapOption(): TemplateResult {
    if (!this.gameConfig) return html``;

    const isCompact = this.gameConfig.gameMapSize === GameMapSize.Compact;

    return html`
      <checkbox-card
        id="host-modal-compact-map"
        label="${translateText("host_modal.compact_map")}"
        .checked=${isCompact}
        .editable=${this.editable}
        .onChange=${(checked: boolean) => {
          if (this.onOptionChange) {
            this.onOptionChange("compactMap", checked);
          }
        }}
      ></checkbox-card>
    `;
  }

  /**
   * Renders the unit enable/disable settings
   */
  private renderUnitSettings(): TemplateResult {
    if (!this.gameConfig) return html``;

    const unitOptions = [
      { type: UnitType.City, translationKey: "unit_type.city" },
      { type: UnitType.DefensePost, translationKey: "unit_type.defense_post" },
      { type: UnitType.Port, translationKey: "unit_type.port" },
      { type: UnitType.Warship, translationKey: "unit_type.warship" },
      {
        type: UnitType.MissileSilo,
        translationKey: "unit_type.missile_silo",
      },
      { type: UnitType.SAMLauncher, translationKey: "unit_type.sam_launcher" },
      { type: UnitType.AtomBomb, translationKey: "unit_type.atom_bomb" },
      {
        type: UnitType.HydrogenBomb,
        translationKey: "unit_type.hydrogen_bomb",
      },
      { type: UnitType.MIRV, translationKey: "unit_type.mirv" },
      { type: UnitType.Factory, translationKey: "unit_type.factory" },
    ];

    const disabledUnits = this.gameConfig.disabledUnits ?? [];

    return html`
      <hr style="width: 100%; border-top: 1px solid #444; margin: 1rem 0;" />

      <div
        style="margin: 0.5rem 0 0.75rem 0; font-weight: bold; color: #ccc; ${this
          .editable
          ? "text-align: center;"
          : "text-align: center; width: 100%;"}"
      >
        ${this.editable
          ? translateText("host_modal.enables_title")
          : translateText("private_lobby.enabled_settings")}
      </div>

      ${this.editable
        ? html`
            <div
              style="display: flex; flex-wrap: wrap; justify-content: center; gap: 0.75rem;"
            >
              ${unitOptions.map(
                ({ type, translationKey }) => html`
                  <checkbox-card
                    id="unit-${type}"
                    label="${translateText(translationKey)}"
                    .checked=${!disabledUnits.includes(type)}
                    .editable=${true}
                    width="8.75rem"
                    titleStyle="text-align: center;"
                    .onChange=${(checked: boolean) => {
                      if (this.onUnitToggle) {
                        this.onUnitToggle(type, !checked);
                      }
                    }}
                  ></checkbox-card>
                `,
              )}
            </div>
          `
        : unitOptions.map(
            ({ type, translationKey }) => html`
              <checkbox-card
                id="unit-${type}-readonly"
                label="${translateText(translationKey)}"
                .checked=${!disabledUnits.includes(type)}
                .editable=${false}
                width="9rem"
                titleStyle="text-align: center;"
              ></checkbox-card>
            `,
          )}
    `;
  }
}
