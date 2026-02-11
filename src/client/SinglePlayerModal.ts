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
import { modalHeader } from "./components/ui/ModalHeader";
import { fetchCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { FlagInput } from "./FlagInput";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import {
  renderGameConfigSettings,
  renderToggleInputCard,
  renderToggleInputCardInput,
} from "./utilities/RenderGameConfigSettings";

const DEFAULT_OPTIONS = {
  selectedMap: GameMapType.World,
  selectedDifficulty: Difficulty.Easy,
  disableNations: false,
  bots: 400,
  infiniteGold: false,
  infiniteTroops: false,
  compactMap: false,
  maxTimer: false,
  maxTimerValue: undefined as number | undefined,
  instantBuild: false,
  randomSpawn: false,
  useRandomMap: false,
  gameMode: GameMode.FFA,
  teamCount: 2 as TeamCountConfig,
  goldMultiplier: false,
  goldMultiplierValue: undefined as number | undefined,
  startingGold: false,
  startingGoldValue: undefined as number | undefined,
  disabledUnits: [] as UnitType[],
} as const;

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseModal {
  @state() private selectedMap: GameMapType = DEFAULT_OPTIONS.selectedMap;
  @state() private selectedDifficulty: Difficulty =
    DEFAULT_OPTIONS.selectedDifficulty;
  @state() private disableNations: boolean = DEFAULT_OPTIONS.disableNations;
  @state() private bots: number = DEFAULT_OPTIONS.bots;
  @state() private infiniteGold: boolean = DEFAULT_OPTIONS.infiniteGold;
  @state() private infiniteTroops: boolean = DEFAULT_OPTIONS.infiniteTroops;
  @state() private compactMap: boolean = DEFAULT_OPTIONS.compactMap;
  @state() private maxTimer: boolean = DEFAULT_OPTIONS.maxTimer;
  @state() private maxTimerValue: number | undefined =
    DEFAULT_OPTIONS.maxTimerValue;
  @state() private instantBuild: boolean = DEFAULT_OPTIONS.instantBuild;
  @state() private randomSpawn: boolean = DEFAULT_OPTIONS.randomSpawn;
  @state() private useRandomMap: boolean = DEFAULT_OPTIONS.useRandomMap;
  @state() private gameMode: GameMode = DEFAULT_OPTIONS.gameMode;
  @state() private teamCount: TeamCountConfig = DEFAULT_OPTIONS.teamCount;
  @state() private showAchievements: boolean = false;
  @state() private mapWins: Map<GameMapType, Set<Difficulty>> = new Map();
  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private goldMultiplier: boolean = DEFAULT_OPTIONS.goldMultiplier;
  @state() private goldMultiplierValue: number | undefined =
    DEFAULT_OPTIONS.goldMultiplierValue;
  @state() private startingGold: boolean = DEFAULT_OPTIONS.startingGold;
  @state() private startingGoldValue: number | undefined =
    DEFAULT_OPTIONS.startingGoldValue;

  @state() private disabledUnits: UnitType[] = [
    ...DEFAULT_OPTIONS.disabledUnits,
  ];

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
    if (crazyGamesSDK.isOnCrazyGames()) {
      return html``;
    }
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

  render() {
    const inputCards = [
      renderToggleInputCard({
        labelKey: "single_modal.max_timer",
        checked: this.maxTimer,
        onClick: () => {
          this.maxTimer = !this.maxTimer;
          if (!this.maxTimer) {
            this.maxTimerValue = undefined;
          } else {
            // Set default value when enabling if not already set or invalid
            if (!this.maxTimerValue || this.maxTimerValue <= 0) {
              this.maxTimerValue = 30;
            }
            // Focus the input after render
            setTimeout(() => {
              const input = this.getEndTimerInput();
              if (input) {
                input.focus();
                input.select();
              }
            }, 0);
          }
        },
        input: renderToggleInputCardInput({
          id: "end-timer-value",
          min: 1,
          max: 120,
          value: this.maxTimerValue ?? "",
          ariaLabel: translateText("single_modal.max_timer"),
          placeholder: translateText("single_modal.max_timer_placeholder"),
          onInput: this.handleMaxTimerValueChanges,
          onKeyDown: this.handleMaxTimerValueKeyDown,
        }),
      }),
      renderToggleInputCard({
        labelKey: "single_modal.gold_multiplier",
        checked: this.goldMultiplier,
        onClick: () => {
          this.goldMultiplier = !this.goldMultiplier;
          if (!this.goldMultiplier) {
            this.goldMultiplierValue = undefined;
          } else {
            if (!this.goldMultiplierValue || this.goldMultiplierValue <= 0) {
              this.goldMultiplierValue = 2;
            }
            setTimeout(() => {
              const input = this.renderRoot.querySelector(
                "#gold-multiplier-value",
              ) as HTMLInputElement;
              if (input) {
                input.focus();
                input.select();
              }
            }, 0);
          }
        },
        input: renderToggleInputCardInput({
          id: "gold-multiplier-value",
          min: 0.1,
          max: 1000,
          step: "any",
          value: this.goldMultiplierValue ?? "",
          ariaLabel: translateText("single_modal.gold_multiplier"),
          placeholder: translateText(
            "single_modal.gold_multiplier_placeholder",
          ),
          onChange: this.handleGoldMultiplierValueChanges,
          onKeyDown: this.handleGoldMultiplierValueKeyDown,
        }),
      }),
      renderToggleInputCard({
        labelKey: "single_modal.starting_gold",
        checked: this.startingGold,
        onClick: () => {
          this.startingGold = !this.startingGold;
          if (!this.startingGold) {
            this.startingGoldValue = undefined;
          } else {
            if (!this.startingGoldValue || this.startingGoldValue < 0) {
              this.startingGoldValue = 5000000;
            }
            setTimeout(() => {
              const input = this.renderRoot.querySelector(
                "#starting-gold-value",
              ) as HTMLInputElement;
              if (input) {
                input.focus();
                input.select();
              }
            }, 0);
          }
        },
        input: renderToggleInputCardInput({
          id: "starting-gold-value",
          min: 0,
          max: 1000000000,
          step: 100000,
          value: this.startingGoldValue ?? "",
          ariaLabel: translateText("single_modal.starting_gold"),
          placeholder: translateText("single_modal.starting_gold_placeholder"),
          onInput: this.handleStartingGoldValueChanges,
          onKeyDown: this.handleStartingGoldValueKeyDown,
        }),
      }),
    ];

    const content = html`
      <div
        class="h-full flex flex-col bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden"
      >
        <!-- Header -->
        ${modalHeader({
          title: translateText("main.solo") || "Solo",
          onBack: this.close,
          ariaLabel: translateText("common.back"),
          rightContent: hasLinkedAccount(this.userMeResponse)
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
                  style="${this.showAchievements
                    ? ""
                    : "filter: grayscale(1);"}"
                />
                <span
                  class="text-xs font-bold uppercase tracking-wider whitespace-nowrap"
                  >${translateText("single_modal.toggle_achievements")}</span
                >
              </button>`
            : this.renderNotLoggedInBanner(),
        })}

        <div
          class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-4 pb-6 mr-1 mx-auto w-full max-w-5xl space-y-6"
        >
          ${renderGameConfigSettings({
            map: {
              selected: this.selectedMap,
              useRandom: this.useRandomMap,
              showMedals: this.showAchievements,
              mapWins: this.mapWins,
              onSelectMap: (mapValue: GameMapType) =>
                this.handleMapSelection(mapValue),
              onSelectRandom: () => this.handleSelectRandomMap(),
            },
            difficulty: {
              selected: this.selectedDifficulty,
              disabled: this.disableNations,
              onSelect: (value: Difficulty) =>
                this.handleDifficultySelection(value),
            },
            gameMode: {
              selected: this.gameMode,
              onSelect: (mode: GameMode) => this.handleGameModeSelection(mode),
            },
            teamCount: {
              selected: this.teamCount,
              onSelect: (count: TeamCountConfig) =>
                this.handleTeamCountSelection(count),
            },
            options: {
              titleKey: "single_modal.options_title",
              bots: {
                value: this.bots,
                labelKey: "single_modal.bots",
                disabledKey: "single_modal.bots_disabled",
                onChange: this.handleBotsChange,
              },
              toggles: [
                {
                  labelKey: "single_modal.disable_nations",
                  checked: this.disableNations,
                  onChange: (val) => (this.disableNations = val),
                  hidden:
                    this.gameMode === GameMode.Team &&
                    this.teamCount === HumansVsNations,
                },
                {
                  labelKey: "single_modal.instant_build",
                  checked: this.instantBuild,
                  onChange: (val) => (this.instantBuild = val),
                },
                {
                  labelKey: "single_modal.random_spawn",
                  checked: this.randomSpawn,
                  onChange: (val) => (this.randomSpawn = val),
                },
                {
                  labelKey: "single_modal.infinite_gold",
                  checked: this.infiniteGold,
                  onChange: (val) => (this.infiniteGold = val),
                },
                {
                  labelKey: "single_modal.infinite_troops",
                  checked: this.infiniteTroops,
                  onChange: (val) => (this.infiniteTroops = val),
                },
                {
                  labelKey: "single_modal.compact_map",
                  checked: this.compactMap,
                  onChange: (val) => {
                    this.compactMap = val;
                    if (val && this.bots === 400) {
                      this.bots = 100;
                    } else if (!val && this.bots === 100) {
                      this.bots = 400;
                    }
                  },
                },
              ],
              inputCards,
            },
            unitTypes: {
              titleKey: "single_modal.enables_title",
              disabledUnits: this.disabledUnits,
              toggleUnit: this.toggleUnit.bind(this),
            },
          })}
        </div>

        <!-- Footer Action -->
        <div class="p-6 border-t border-white/10 bg-black/20">
          ${hasLinkedAccount(this.userMeResponse) && this.hasOptionsChanged()
            ? html`<div
                class="mb-4 px-4 py-3 rounded-xl bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-bold uppercase tracking-wider text-center"
              >
                ${translateText("single_modal.options_changed_no_achievements")}
              </div>`
            : null}
          <button
            @click=${this.startGame}
            class="w-full py-4 text-sm font-bold text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:translate-y-0"
          >
            ${translateText("single_modal.start")}
          </button>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="singlePlayerModal"
        title="${translateText("main.solo") || "Solo"}"
        ?inline=${this.inline}
        hideHeader
        hideCloseButton
      >
        ${content}
      </o-modal>
    `;
  }

  // Check if any options other than map and difficulty have been changed from defaults
  private hasOptionsChanged(): boolean {
    return (
      this.disableNations !== DEFAULT_OPTIONS.disableNations ||
      this.bots !== DEFAULT_OPTIONS.bots ||
      this.infiniteGold !== DEFAULT_OPTIONS.infiniteGold ||
      this.infiniteTroops !== DEFAULT_OPTIONS.infiniteTroops ||
      this.compactMap !== DEFAULT_OPTIONS.compactMap ||
      this.maxTimer !== DEFAULT_OPTIONS.maxTimer ||
      this.instantBuild !== DEFAULT_OPTIONS.instantBuild ||
      this.randomSpawn !== DEFAULT_OPTIONS.randomSpawn ||
      this.gameMode !== DEFAULT_OPTIONS.gameMode ||
      this.goldMultiplier !== DEFAULT_OPTIONS.goldMultiplier ||
      this.startingGold !== DEFAULT_OPTIONS.startingGold ||
      this.disabledUnits.length > 0
    );
  }

  protected onClose(): void {
    // Reset all transient form state to ensure clean slate
    this.selectedMap = DEFAULT_OPTIONS.selectedMap;
    this.selectedDifficulty = DEFAULT_OPTIONS.selectedDifficulty;
    this.gameMode = DEFAULT_OPTIONS.gameMode;
    this.useRandomMap = DEFAULT_OPTIONS.useRandomMap;
    this.disableNations = DEFAULT_OPTIONS.disableNations;
    this.bots = DEFAULT_OPTIONS.bots;
    this.infiniteGold = DEFAULT_OPTIONS.infiniteGold;
    this.infiniteTroops = DEFAULT_OPTIONS.infiniteTroops;
    this.compactMap = DEFAULT_OPTIONS.compactMap;
    this.maxTimer = DEFAULT_OPTIONS.maxTimer;
    this.maxTimerValue = DEFAULT_OPTIONS.maxTimerValue;
    this.instantBuild = DEFAULT_OPTIONS.instantBuild;
    this.randomSpawn = DEFAULT_OPTIONS.randomSpawn;
    this.teamCount = DEFAULT_OPTIONS.teamCount;
    this.disabledUnits = [...DEFAULT_OPTIONS.disabledUnits];
    this.goldMultiplier = DEFAULT_OPTIONS.goldMultiplier;
    this.goldMultiplierValue = DEFAULT_OPTIONS.goldMultiplierValue;
    this.startingGold = DEFAULT_OPTIONS.startingGold;
    this.startingGoldValue = DEFAULT_OPTIONS.startingGoldValue;
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

  private handleGoldMultiplierValueKeyDown(e: KeyboardEvent) {
    if (["+", "-", "e", "E"].includes(e.key)) {
      e.preventDefault();
    }
  }

  private handleGoldMultiplierValueChanges(e: Event) {
    const input = e.target as HTMLInputElement;
    const value = parseFloat(input.value);

    if (isNaN(value) || value < 0.1 || value > 1000) {
      this.goldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.goldMultiplierValue = value;
    }
  }

  private handleStartingGoldValueKeyDown(e: KeyboardEvent) {
    if (["-", "+", "e", "E"].includes(e.key)) {
      e.preventDefault();
    }
  }

  private handleStartingGoldValueChanges(e: Event) {
    const input = e.target as HTMLInputElement;
    input.value = input.value.replace(/[eE+-]/g, "");
    const value = parseInt(input.value);

    if (isNaN(value) || value < 0 || value > 1000000000) {
      this.startingGoldValue = undefined;
    } else {
      this.startingGoldValue = value;
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

  private toggleUnit(unit: UnitType, checked: boolean): void {
    this.disabledUnits = checked
      ? [...this.disabledUnits, unit]
      : this.disabledUnits.filter((u) => u !== unit);
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

    await crazyGamesSDK.requestMidgameAd();

    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
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
              ...(this.goldMultiplier && this.goldMultiplierValue
                ? { goldMultiplier: this.goldMultiplierValue }
                : {}),
              ...(this.startingGold && this.startingGoldValue !== undefined
                ? { startingGold: this.startingGoldValue }
                : {}),
            },
            lobbyCreatedAt: Date.now(), // ms; server should be authoritative in MP
          },
          source: "singleplayer",
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}
