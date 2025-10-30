import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  Quads,
  Trios,
  UnitType,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { TeamCountConfig } from "../core/Schemas";
import { generateID } from "../core/Util";
import "./components/shared/AdvancedOptions";
import "./components/shared/BotsSlider";
import "./components/shared/DifficultyControls";
import "./components/shared/ExpandButton";
import "./components/shared/GameModeControls";
import "./components/shared/MapBrowserPane";
import "./components/shared/PresetsManager";
import "./components/shared/SettingsSummary";
import "./components/shared/TeamCountPicker";
import type { RuleKey } from "./utilities/RenderRulesOptions";

import { fetchCosmetics } from "./Cosmetics";
import { FlagInput } from "./FlagInput";
import { JoinLobbyEvent } from "./Main";
import type { Preset } from "./types/preset";
import { UsernameInput } from "./UsernameInput";

type PresetSettings = {
  selectedMap: GameMapType;
  selectedDifficulty: Difficulty;
  disableNPCs: boolean;
  bots: number;
  infiniteGold: boolean;
  infiniteTroops: boolean;
  compactMap: boolean;
  instantBuild: boolean;
  useRandomMap: boolean;
  gameMode: GameMode;
  teamCount: TeamCountConfig;
  disabledUnits: UnitType[];
};

type SinglePlayerPreset = Preset<PresetSettings>;

const MAX_PRESETS = 10;
const PRESETS_KEY = "sp.presets.v1";

@customElement("single-player-modal")
export class SinglePlayerModal extends LitElement {
  @property({ type: Number }) selectedMap: GameMapType = GameMapType.World;
  @property({ type: Number }) selectedDifficulty: Difficulty =
    Difficulty.Medium;
  @property({ type: Boolean }) disableNPCs = false;
  @property({ type: Number }) bots = 400;
  @property({ type: Boolean }) infiniteGold = false;
  @property({ type: Boolean }) infiniteTroops = false;
  @property({ type: Boolean }) compactMap = false;
  @property({ type: Boolean }) instantBuild = false;
  @property({ type: Boolean }) useRandomMap = false;
  @property({ type: Number }) gameMode: GameMode = GameMode.FFA;
  @property({ type: Number }) teamCount: TeamCountConfig = 2;

  @state() private disabledUnits: UnitType[] = [];
  @state() private rightExpanded: boolean = false;

  private userSettings: UserSettings = new UserSettings();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
    if (!this.style.display) this.style.display = "none";
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  private currentSettings(): SinglePlayerPreset["settings"] {
    return {
      selectedMap: this.selectedMap,
      selectedDifficulty: this.selectedDifficulty,
      disableNPCs: this.disableNPCs,
      bots: this.bots,
      infiniteGold: this.infiniteGold,
      infiniteTroops: this.infiniteTroops,
      compactMap: this.compactMap,
      instantBuild: this.instantBuild,
      useRandomMap: this.useRandomMap,
      gameMode: this.gameMode,
      teamCount: this.teamCount,
      disabledUnits: [...this.disabledUnits],
    };
  }

  private applySettings(s: SinglePlayerPreset["settings"]) {
    this.selectedMap = s.selectedMap;
    this.selectedDifficulty = s.selectedDifficulty;
    this.disableNPCs = s.disableNPCs;
    this.bots = s.bots;
    this.infiniteGold = s.infiniteGold;
    this.infiniteTroops = s.infiniteTroops;
    this.compactMap = s.compactMap;
    this.instantBuild = s.instantBuild;
    this.useRandomMap = s.useRandomMap;
    this.gameMode = s.gameMode;
    this.teamCount = s.teamCount;
    this.disabledUnits = [...s.disabledUnits];
  }

  private renderHeader() {
    return html`
      <header
        class="sticky top-0 z-10 flex items-center justify-between border-b border-white/15 bg-gradient-to-b from-zinc-900/95 to-zinc-900/70 px-4 py-3 backdrop-blur"
      >
        <h1
          id="sp-title"
          class="m-0 text-[18px] font-bold tracking-tight text-zinc-100"
        >
          ${translateText("single_modal.title")}
        </h1>
        <div class="flex gap-2">
          <button
            id="quickStartHeader"
            class="h-11 min-w-11 rounded-xl border border-blue-400/40 bg-blue-500/15 px-3 text-blue-50 hover:bg-blue-500/20"
            title=${translateText("single_modal.start")}
            @click=${this.startGame}
          >
            ▶ ${translateText("single_modal.start")}
          </button>
          <button
            id="closeModal"
            aria-label="Close"
            class="h-11 min-w-11 rounded-xl border border-white/15 bg-white/5 px-3 hover:bg-white/10 hover:border-white/20 text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 transition-colors"
            @click=${this.close}
          >
            ✕
          </button>
        </div>
      </header>
    `;
  }

  private renderMapsPane() {
    return html`
      <map-browser-pane
        .selectedMap=${this.selectedMap}
        .useRandomMap=${this.useRandomMap}
        @map-select=${(e: CustomEvent<{ value: GameMapType }>) =>
          this.handleMapSelection(e.detail.value)}
        @toggle-random=${this.handleRandomMapToggle}
      ></map-browser-pane>
    `;
  }

  private renderTeamCountControls() {
    if (this.gameMode !== GameMode.Team) return null;
    return html`
      <team-count-picker
        .mode=${this.gameMode}
        .value=${this.teamCount}
        @change=${(e: CustomEvent<{ value: TeamCountConfig }>) => {
          if (!e.detail) return;
          this.teamCount = e.detail.value;
        }}
      ></team-count-picker>
    `;
  }

  private renderSettingsPane() {
    return html`
      <section
        aria-label="Settings"
        class="min-h-0 flex flex-col gap-3 rounded-xl border border-white/15 bg-zinc-900/40 p-3 overflow-auto"
      >
        ${this.renderRightTopControls()}
        ${html`
          <settings-summary
            .selectedMap=${this.selectedMap}
            .selectedDifficulty=${this.selectedDifficulty}
            .gameMode=${this.gameMode}
            .bots=${this.bots}
            .useRandomMap=${this.useRandomMap}
          ></settings-summary>
        `}
        ${html`
          <difficulty-controls
            .value=${this.selectedDifficulty}
            @change=${(e: CustomEvent<{ value: Difficulty }>) => {
              if (!e.detail) return;
              this.handleDifficultySelection(e.detail.value);
            }}
          ></difficulty-controls>
        `}
        ${html`
          <game-mode-controls
            .value=${this.gameMode}
            @change=${(e: CustomEvent<{ value: GameMode }>) => {
              if (!e.detail) return;
              this.handleGameModeSelection(e.detail.value);
            }}
          ></game-mode-controls>
        `}
        ${this.renderTeamCountControls()}
        ${html`
          <bots-slider
            .value=${this.bots}
            .max=${400}
            .debounceMs=${0}
            @input=${this.handleBotsEvent}
            @change=${this.handleBotsEvent}
          ></bots-slider>
        `}
        ${html`
          <advanced-options
            .rules=${{
              disableNPCs: this.disableNPCs,
              instantBuild: this.instantBuild,
              infiniteGold: this.infiniteGold,
              infiniteTroops: this.infiniteTroops,
              compactMap: this.compactMap,
            }}
            .disabledUnits=${this.disabledUnits}
            @toggle-rule=${(
              e: CustomEvent<{ key: RuleKey; checked: boolean }>,
            ) => {
              if (!e.detail) return;
              this.setRuleFlag(e.detail.key, e.detail.checked);
            }}
            @toggle-unit=${(
              e: CustomEvent<{ unit: UnitType; checked: boolean }>,
            ) => {
              this.toggleUnit(e.detail.unit, e.detail.checked);
            }}
          ></advanced-options>
        `}
      </section>
    `;
  }

  private renderBody() {
    return html`
      <main
        class=${`grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-auto p-4 ${
          this.rightExpanded ? "md:grid-cols-1" : "md:grid-cols-[1.2fr_1fr]"
        }`}
      >
        ${this.rightExpanded ? null : this.renderMapsPane()}
        ${this.renderSettingsPane()}
      </main>
    `;
  }

  render() {
    return html`
      <div
        class="fixed inset-0 z-50"
        role="dialog"
        aria-labelledby="sp-title"
        aria-modal="true"
      >
        <div
          class="pointer-events-auto fixed inset-0 bg-[radial-gradient(1200px_600px_at_60%_-10%,rgba(59,130,246,0.18),transparent),radial-gradient(900px_500px_at_15%_110%,rgba(59,130,246,0.10),transparent)]"
          @click=${this.handleBackdropClick}
        ></div>

        <section
          class="fixed inset-4 mx-auto flex max-w-[1200px] min-h-[560px] flex-col rounded-2xl border border-white/15 bg-zinc-900/80 backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.45)] md:inset-8 text-zinc-100 antialiased"
        >
          ${this.renderHeader()} ${this.renderBody()}
          ${html`
            <presets-manager
              storageKey=${PRESETS_KEY}
              .limit=${MAX_PRESETS}
              .getSettings=${() => this.currentSettings()}
              @apply-preset=${(
                e: CustomEvent<{ settings: SinglePlayerPreset["settings"] }>,
              ) => {
                this.applySettings(e.detail.settings);
              }}
              @clear-preset=${() => this.resetToDefaults()}
            ></presets-manager>
          `}
        </section>
      </div>
    `;
  }

  createRenderRoot() {
    return this;
  }

  public open() {
    this.style.display = "block";
  }

  public close() {
    this.style.display = "none";
  }

  private handleRandomMapToggle() {
    this.useRandomMap = !this.useRandomMap;
  }

  private handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
  }

  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }

  private handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
  }

  private getRandomMap(): GameMapType {
    const numericValues = Object.values(GameMapType).filter(
      (v) => typeof v === "number",
    ) as number[];
    const pool = numericValues.length > 0 ? numericValues : [GameMapType.World];
    const randIdx = Math.floor(Math.random() * pool.length);
    return pool[randIdx] as GameMapType;
  }

  private toggleUnit = (unit: UnitType, checked: boolean): void => {
    // checked=true means the unit is enabled, so ensure it's NOT in disabledUnits
    this.disabledUnits = checked
      ? this.disabledUnits.filter((u) => u !== unit)
      : this.disabledUnits.includes(unit)
        ? this.disabledUnits
        : [...this.disabledUnits, unit];
  };

  private handleBotsEvent = (e: Event | CustomEvent<{ value: number }>) => {
    const detailVal = (e as CustomEvent<{ value: number }>).detail?.value;
    const targetVal = Number((e.target as HTMLInputElement)?.value);
    const raw = detailVal ?? targetVal;
    if (!Number.isNaN(raw)) {
      const clamped = Math.max(0, Math.min(400, raw));
      this.bots = clamped;
    }
  };

  // Safely set a rule flag by key
  private setRuleFlag(key: RuleKey, checked: boolean) {
    switch (key) {
      case "disableNPCs":
        this.disableNPCs = checked;
        break;
      case "instantBuild":
        this.instantBuild = checked;
        break;
      case "infiniteGold":
        this.infiniteGold = checked;
        break;
      case "infiniteTroops":
        this.infiniteTroops = checked;
        break;
      case "compactMap":
        this.compactMap = checked;
        break;
    }
  }

  private renderRightTopControls() {
    return html`
      <div class="sticky top-0 z-20 bg-transparent">
        <div class="flex items-center gap-2 pb-2 justify-end">
          <expand-button
            .expanded=${this.rightExpanded}
            @toggle=${(e: CustomEvent<{ value: boolean }>) =>
              (this.rightExpanded = e.detail.value)}
          ></expand-button>
        </div>
      </div>
    `;
  }

  private async startGame() {
    if (this.useRandomMap) {
      this.selectedMap = this.getRandomMap();
    }

    console.log(
      `Starting single player game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]}${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;
    if (!usernameInput) {
      console.warn("Username input element not found");
    }

    const flagInput = document.querySelector("flag-input") as FlagInput;
    if (!flagInput) {
      console.warn("Flag input element not found");
    }
    const cosmetics = await fetchCosmetics();
    let selectedPattern = this.userSettings.getSelectedPatternName(cosmetics);
    selectedPattern ??= cosmetics
      ? (this.userSettings.getDevOnlyPattern() ?? null)
      : null;

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          clientID: clientID,
          gameID: gameID,
          gameStartInfo: {
            gameID: gameID,
            players: [
              {
                clientID,
                username: usernameInput.getCurrentUsername(),
                cosmetics: {
                  flag:
                    flagInput.getCurrentFlag() === "xx"
                      ? ""
                      : flagInput.getCurrentFlag(),
                  pattern: selectedPattern ?? undefined,
                },
              },
            ],
            config: {
              gameMap: this.selectedMap,
              gameMapSize: this.compactMap
                ? GameMapSize.Compact
                : GameMapSize.Normal,
              gameType: GameType.Singleplayer,
              gameMode: this.gameMode,
              playerTeams: this.teamCount,
              difficulty: this.selectedDifficulty,
              disableNPCs: this.disableNPCs,
              maxTimerValue: this.maxTimer ? this.maxTimerValue : undefined,
              bots: this.bots,
              infiniteGold: this.infiniteGold,
              donateGold: true,
              donateTroops: true,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
              disabledUnits: this.disabledUnits
                .map((u) => Object.values(UnitType).find((ut) => ut === u))
                .filter((ut): ut is UnitType => ut !== undefined),
              ...(this.gameMode === GameMode.Team &&
              this.teamCount === HumansVsNations
                ? {
                    disableNPCs: false,
                  }
                : {
                    disableNPCs: this.disableNPCs,
                  }),
            },
          },
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  private resetToDefaults() {
    this.selectedMap = GameMapType.World;
    this.selectedDifficulty = Difficulty.Medium;
    this.disableNPCs = false;
    this.bots = 400;
    this.infiniteGold = false;
    this.infiniteTroops = false;
    this.compactMap = false;
    this.instantBuild = false;
    this.useRandomMap = false;
    this.gameMode = GameMode.FFA;
    this.teamCount = 2;
    this.disabledUnits = [];
  }

  // Close when clicking outside the modal content (backdrop)
  private handleBackdropClick = (e: MouseEvent) => {
    if (e.currentTarget === e.target) {
      this.close();
    }
  };
}
