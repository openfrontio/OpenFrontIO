import { TemplateResult, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserMeResponse } from "../core/ApiSchemas";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  UnitType,
} from "../core/game/Game";
import { UserSettings } from "../core/game/UserSettings";
import { TeamCountConfig } from "../core/Schemas";
import { generateID } from "../core/Util";
import { hasLinkedAccount } from "./Api";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/Difficulties";
import "./components/FluentSlider";
import "./components/Maps";
import { renderDifficultySection } from "./components/ui/DifficultySection";
import { renderGameModeSection } from "./components/ui/GameModeSection";
import { renderGameOptionsSection } from "./components/ui/GameOptionsSection";
import { lobbyModalShell } from "./components/ui/LobbyModalShell";
import { renderMapSelection } from "./components/ui/MapSelection";
import { fetchCosmetics } from "./Cosmetics";
import { FlagInput } from "./FlagInput";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import { renderUnitTypeSection } from "./utilities/RenderUnitTypeOptions";

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseModal {
  @state() private selectedMap: GameMapType = GameMapType.World;
  @state() private selectedDifficulty: Difficulty = Difficulty.Easy;
  @state() private disableNations: boolean = false;
  @state() private bots: number = 400;
  @state() private infiniteGold: boolean = false;
  @state() private infiniteTroops: boolean = false;
  @state() private compactMap: boolean = false;
  @state() private maxTimer: boolean = false;
  @state() private maxTimerValue: number | undefined = undefined;
  @state() private instantBuild: boolean = false;
  @state() private randomSpawn: boolean = false;
  @state() private useRandomMap: boolean = false;
  @state() private gameMode: GameMode = GameMode.FFA;
  @state() private teamCount: TeamCountConfig = 2;
  @state() private showAchievements: boolean = false;
  @state() private mapWins: Map<GameMapType, Set<Difficulty>> = new Map();
  @state() private userMeResponse: UserMeResponse | false = false;

  @state() private disabledUnits: UnitType[] = [];

  private userSettings: UserSettings = new UserSettings();

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
  }

  disconnectedCallback() {
    document.removeEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    super.disconnectedCallback();
  }

  private toggleAchievements = () => {
    this.showAchievements = !this.showAchievements;
  };

  private handleUserMeResponse = (
    event: CustomEvent<UserMeResponse | false>,
  ) => {
    this.userMeResponse = event.detail;
    this.applyAchievements(event.detail);
  };

  private renderNotLoggedInBanner(): TemplateResult {
    return html`<div
      class="px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap shrink-0"
    >
      ${translateText("single_modal.sign_in_for_achievements")}
    </div>`;
  }

  private applyAchievements(userMe: UserMeResponse | false) {
    if (!userMe) {
      this.mapWins = new Map();
      return;
    }

    const achievements = Array.isArray(userMe.player.achievements)
      ? userMe.player.achievements
      : [];

    const completions =
      achievements.find(
        (achievement) => achievement?.type === "singleplayer-map",
      )?.data ?? [];

    const winsMap = new Map<GameMapType, Set<Difficulty>>();
    for (const entry of completions) {
      const { mapName, difficulty } = entry ?? {};
      const isValidMap =
        typeof mapName === "string" &&
        Object.values(GameMapType).includes(mapName as GameMapType);
      const isValidDifficulty =
        typeof difficulty === "string" &&
        Object.values(Difficulty).includes(difficulty as Difficulty);
      if (!isValidMap || !isValidDifficulty) continue;

      const map = mapName as GameMapType;
      const set = winsMap.get(map) ?? new Set<Difficulty>();
      set.add(difficulty as Difficulty);
      winsMap.set(map, set);
    }

    this.mapWins = winsMap;
  }

  private renderMaxTimerCard(): TemplateResult {
    const cardClass = this.maxTimer
      ? "bg-blue-500/20 border-blue-500/50"
      : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20";
    const checkClass = this.maxTimer
      ? "bg-blue-500 border-blue-500"
      : "border-white/20 bg-white/5";
    const labelClass = this.maxTimer ? "text-white" : "text-white/60";

    const toggleMaxTimer = () => {
      this.maxTimer = !this.maxTimer;
      if (!this.maxTimer) {
        this.maxTimerValue = undefined;
        return;
      }
      if (!this.maxTimerValue || this.maxTimerValue <= 0) {
        this.maxTimerValue = 30;
      }
      setTimeout(() => {
        const input = this.getEndTimerInput();
        if (input) {
          input.focus();
          input.select();
        }
      }, 0);
    };

    const handleToggleClick = (e: Event) => {
      if ((e.target as HTMLElement).tagName.toLowerCase() === "input") {
        return;
      }
      toggleMaxTimer();
    };

    const handleToggleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName.toLowerCase() === "input") {
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleMaxTimer();
      }
    };

    return html`
      <div
        role="button"
        tabindex="0"
        class="relative p-3 rounded-xl border transition-all duration-200 flex flex-col items-center justify-between gap-2 h-full cursor-pointer min-h-[100px] ${cardClass}"
        @click=${handleToggleClick}
        @keydown=${handleToggleKeyDown}
      >
        <div class="flex items-center justify-center w-full mt-1">
          <div
            class="w-5 h-5 rounded border flex items-center justify-center transition-colors ${checkClass}"
          >
            ${this.maxTimer
              ? html`<svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-3 w-3 text-white"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clip-rule="evenodd"
                  />
                </svg>`
              : ""}
          </div>
        </div>

        ${this.maxTimer
          ? html`<input
              type="number"
              id="end-timer-value"
              min="1"
              max="120"
              .value=${String(this.maxTimerValue ?? "")}
              class="w-full text-center rounded bg-black/60 text-white text-sm font-bold border border-white/20 focus:outline-none focus:border-blue-500 p-1 my-1"
              aria-label=${translateText("single_modal.max_timer")}
              @click=${(e: Event) => e.stopPropagation()}
              @input=${this.handleMaxTimerValueChanges}
              @keydown=${this.handleMaxTimerValueKeyDown}
              placeholder=${translateText("single_modal.max_timer_placeholder")}
            />`
          : html`<div class="h-[2px] w-4 bg-white/10 rounded my-3"></div>`}

        <div
          class="text-[10px] uppercase font-bold tracking-wider text-center w-full leading-tight ${labelClass}"
        >
          ${translateText("single_modal.max_timer")}
        </div>
      </div>
    `;
  }

  render() {
    const isHumanVsNations =
      this.gameMode === GameMode.Team && this.teamCount === HumansVsNations;
    const maxTimerCard = this.renderMaxTimerCard();
    const hasAccount = hasLinkedAccount(this.userMeResponse);

    const content = html`
      <div class="max-w-5xl mx-auto space-y-10">
        <!-- Map Selection -->
        ${renderMapSelection({
          selectedMap: this.selectedMap,
          useRandomMap: this.useRandomMap,
          onSelectMap: (map) => this.handleMapSelection(map),
          onSelectRandomMap: this.handleSelectRandomMap,
          showMedals: this.showAchievements,
          winsByMap: this.mapWins,
          specialSectionClassName: "w-full pt-4 border-t border-white/5",
        })}

        <!-- Difficulty Selection -->
        ${renderDifficultySection({
          selectedDifficulty: this.selectedDifficulty,
          disableNations: this.disableNations,
          onSelectDifficulty: (difficulty) =>
            this.handleDifficultySelection(difficulty),
        })}

        <!-- Game Mode Selection -->
        ${renderGameModeSection({
          gameMode: this.gameMode,
          teamCount: this.teamCount,
          onSelectMode: (mode) => this.handleGameModeSelection(mode),
          onSelectTeamCount: (count) => this.handleTeamCountSelection(count),
        })}

        <!-- Game Options -->
        ${renderGameOptionsSection({
          titleKey: "single_modal.options_title",
          botsValue: this.bots,
          botsMin: 0,
          botsMax: 400,
          botsStep: 1,
          botsLabelKey: "single_modal.bots",
          botsDisabledKey: "single_modal.bots_disabled",
          onBotsChange: this.handleBotsChange,
          toggles: [
            {
              labelKey: "single_modal.disable_nations",
              checked: this.disableNations,
              onToggle: (val) => (this.disableNations = val),
              hidden: isHumanVsNations,
            },
            {
              labelKey: "single_modal.instant_build",
              checked: this.instantBuild,
              onToggle: (val) => (this.instantBuild = val),
            },
            {
              labelKey: "single_modal.random_spawn",
              checked: this.randomSpawn,
              onToggle: (val) => (this.randomSpawn = val),
            },
            {
              labelKey: "single_modal.infinite_gold",
              checked: this.infiniteGold,
              onToggle: (val) => (this.infiniteGold = val),
            },
            {
              labelKey: "single_modal.infinite_troops",
              checked: this.infiniteTroops,
              onToggle: (val) => (this.infiniteTroops = val),
            },
            {
              labelKey: "single_modal.compact_map",
              checked: this.compactMap,
              onToggle: (val) => {
                this.compactMap = val;
                if (val && this.bots === 400) {
                  this.bots = 100;
                } else if (!val && this.bots === 100) {
                  this.bots = 400;
                }
              },
            },
          ],
          extraCards: [maxTimerCard],
        })}

        <!-- Enable Settings -->
        ${renderUnitTypeSection({
          titleKey: "single_modal.enables_title",
          disabledUnits: this.disabledUnits,
          toggleUnit: this.toggleUnit.bind(this),
        })}
      </div>
    `;

    const footer = html`
      <button
        @click=${this.startGame}
        class="w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0"
      >
        ${translateText("single_modal.start")}
      </button>
    `;

    return lobbyModalShell({
      header: {
        title: translateText("main.solo") || "Solo",
        onBack: this.close,
        ariaLabel: translateText("common.back"),
        rightContent: hasAccount
          ? html`<button
              @click=${this.toggleAchievements}
              class="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all shrink-0 ${this
                .showAchievements
                ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                : "text-white/60"}"
            >
              <img
                src="/images/MedalIconWhite.svg"
                class="w-4 h-4 opacity-80 shrink-0"
                style="${this.showAchievements ? "" : "filter: grayscale(1);"}"
              />
              <span
                class="text-xs font-bold uppercase tracking-wider whitespace-nowrap"
                >${translateText("single_modal.toggle_achievements")}</span
              >
            </button>`
          : this.renderNotLoggedInBanner(),
      },
      content,
      footer,
      inline: this.inline,
      modalId: "singlePlayerModal",
      modalTitle: translateText("main.solo") || "Solo",
    });
  }

  protected onClose(): void {
    // Reset all transient form state to ensure clean slate
    this.selectedMap = GameMapType.World;
    this.selectedDifficulty = Difficulty.Easy;
    this.gameMode = GameMode.FFA;
    this.useRandomMap = false;
    this.disableNations = false;
    this.bots = 400;
    this.infiniteGold = false;
    this.infiniteTroops = false;
    this.compactMap = false;
    this.maxTimer = false;
    this.maxTimerValue = undefined;
    this.instantBuild = false;
    this.randomSpawn = false;
    this.teamCount = 2;
    this.disabledUnits = [];
  }

  private handleSelectRandomMap() {
    this.useRandomMap = true;
  }

  private handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
  }

  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }

  private handleBotsChange(e: Event) {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;
  }

  private handleMaxTimerValueKeyDown(e: KeyboardEvent) {
    if (["-", "+", "e"].includes(e.key)) {
      e.preventDefault();
    }
  }

  private getEndTimerInput(): HTMLInputElement | null {
    return (
      (this.renderRoot.querySelector(
        "#end-timer-value",
      ) as HTMLInputElement | null) ??
      (this.querySelector("#end-timer-value") as HTMLInputElement | null)
    );
  }

  private handleMaxTimerValueChanges(e: Event) {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/[e+-]/gi, "");
    const value = parseInt(input.value);

    // Always update state to keep UI and internal state in sync
    if (isNaN(value) || value < 1 || value > 120) {
      // Set to undefined for invalid/empty/out-of-range values
      this.maxTimerValue = undefined;
    } else {
      this.maxTimerValue = value;
    }
  }

  private handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
  }

  private handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
  }

  private getRandomMap(): GameMapType {
    const maps = Object.values(GameMapType);
    const randIdx = Math.floor(Math.random() * maps.length);
    return maps[randIdx] as GameMapType;
  }

  private toggleUnit(unit: UnitType, enabled: boolean): void {
    this.disabledUnits = enabled
      ? this.disabledUnits.filter((u) => u !== unit)
      : [...this.disabledUnits, unit];
  }

  private async startGame() {
    // Validate and clamp maxTimer setting before starting
    let finalMaxTimerValue: number | undefined = undefined;
    if (this.maxTimer) {
      if (!this.maxTimerValue || this.maxTimerValue <= 0) {
        console.error("Max timer is enabled but no valid value is set");
        alert(
          translateText("single_modal.max_timer_invalid") ||
            "Please enter a valid max timer value (1-120 minutes)",
        );
        // Focus the input
        const input = this.getEndTimerInput();
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }
      // Clamp value to valid range
      finalMaxTimerValue = Math.max(1, Math.min(120, this.maxTimerValue));
    }

    // If random map is selected, choose a random map now
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

    const selectedColor = this.userSettings.getSelectedColor();

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
                  color: selectedColor ? { color: selectedColor } : undefined,
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
              maxTimerValue: finalMaxTimerValue,
              bots: this.bots,
              infiniteGold: this.infiniteGold,
              donateGold: this.gameMode === GameMode.Team,
              donateTroops: this.gameMode === GameMode.Team,
              infiniteTroops: this.infiniteTroops,
              instantBuild: this.instantBuild,
              randomSpawn: this.randomSpawn,
              disabledUnits: this.disabledUnits
                .map((u) => Object.values(UnitType).find((ut) => ut === u))
                .filter((ut): ut is UnitType => ut !== undefined),
              ...(this.gameMode === GameMode.Team &&
              this.teamCount === HumansVsNations
                ? {
                    disableNations: false,
                  }
                : {
                    disableNations: this.disableNations,
                  }),
            },
            lobbyCreatedAt: Date.now(), // ms; server should be authoritative in MP
          },
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}
