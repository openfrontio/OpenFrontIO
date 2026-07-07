import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { UserMeResponse } from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import { DoomsdayClockSpeed } from "../core/game/DoomsdayClock";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  maps,
  UnitType,
} from "../core/game/Game";
import { TeamCountConfig } from "../core/Schemas";
import { generateID } from "../core/Util";
import { hasLinkedAccount } from "./Api";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/GameConfigSettings";
import { MEDAL_ORDER, medalIcon } from "./components/map/Medals";
import "./components/ToggleInputCard";
import { modalHeader } from "./components/ui/ModalHeader";
import { getPlayerCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { JoinLobbyEvent } from "./Main";
import { UsernameInput } from "./UsernameInput";
import {
  getBotsForCompactMap,
  getNationsForCompactMap,
  getRandomMapType,
  getUpdatedDisabledUnits,
  parseBoundedFloatFromInput,
  parseBoundedIntegerFromInput,
  preventDisallowedKeys,
  sliderToNationsConfig,
  toOptionalNumber,
} from "./utilities/GameConfigHelpers";

import { terrainMapFileLoader } from "./TerrainMapFileLoader";

const DEFAULT_OPTIONS = {
  selectedMap: GameMapType.World,
  selectedDifficulty: Difficulty.Easy,
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
  disableAlliances: false,
  waterNukes: false,
  doomsdayClock: false,
  doomsdayClockSpeed: "normal" as DoomsdayClockSpeed,
} as const;

// A map earns achievements only if it has nations to conquer — the same rule
// MapDisplay uses to decide whether to draw medals. Maps without nations (e.g.
// Baikal Nuke Wars) must be excluded from the medal totals. The complete set is
// cached for the page session and concurrent callers share the in-flight
// promise so we never fetch the manifests twice. A load that hits any fetch
// error resolves to null (not a partial set) and clears the shared promise, so
// a transient failure retries on the next call rather than locking in an
// undercount for the whole session.
let eligibleMapsCache: Set<GameMapType> | null = null;
let eligibleMapsPromise: Promise<Set<GameMapType> | null> | null = null;

async function loadAchievementEligibleMaps(): Promise<Set<GameMapType> | null> {
  if (eligibleMapsCache) return eligibleMapsCache;
  eligibleMapsPromise ??= (async () => {
    const eligible = new Set<GameMapType>();
    let hadFailure = false;
    await Promise.all(
      maps.map(async (m) => {
        try {
          const manifest = await terrainMapFileLoader
            .getMapData(m.type)
            .manifest();
          if (manifest.nations.length > 0) {
            eligible.add(m.type);
          }
        } catch {
          // A missing manifest would undercount the total; remember the failure
          // so we don't cache this incomplete set below.
          hadFailure = true;
        }
      }),
    );
    if (hadFailure) {
      eligibleMapsPromise = null; // allow a later call to retry
      return null;
    }
    eligibleMapsCache = eligible;
    return eligible;
  })();
  return eligibleMapsPromise;
}

@customElement("single-player-modal")
export class SinglePlayerModal extends BaseModal {
  protected routerName = "single-player";

  @state() private selectedMap: GameMapType = DEFAULT_OPTIONS.selectedMap;
  @state() private selectedDifficulty: Difficulty =
    DEFAULT_OPTIONS.selectedDifficulty;
  @state() private nations: number = 0;
  @state() private defaultNationCount: number = 0;
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
  // Maps that support achievements (have nations). null until loaded — the
  // medal overview shows a placeholder total meanwhile.
  @state() private eligibleMaps: Set<GameMapType> | null = null;
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
  @state() private disableAlliances: boolean = DEFAULT_OPTIONS.disableAlliances;
  @state() private waterNukes: boolean = DEFAULT_OPTIONS.waterNukes;
  @state() private doomsdayClock: boolean = DEFAULT_OPTIONS.doomsdayClock;
  @state() private doomsdayClockSpeed: DoomsdayClockSpeed =
    DEFAULT_OPTIONS.doomsdayClockSpeed;

  private mapLoader = terrainMapFileLoader;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    void this.loadNationCount();
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
    if (this.showAchievements) void this.ensureEligibleMaps();
  };

  private async ensureEligibleMaps() {
    if (this.eligibleMaps) return;
    const eligible = await loadAchievementEligibleMaps();
    // Leave eligibleMaps null on a failed/incomplete load so the overview keeps
    // its placeholder total and the next toggle retries.
    if (eligible) this.eligibleMaps = eligible;
  }

  // Medals earned per difficulty, counted only on achievement-eligible maps.
  private medalCounts(): Record<Difficulty, number> {
    const counts: Record<Difficulty, number> = {
      [Difficulty.Easy]: 0,
      [Difficulty.Medium]: 0,
      [Difficulty.Hard]: 0,
      [Difficulty.Impossible]: 0,
    };
    // Until eligibility is loaded, count nothing — otherwise the overview would
    // briefly include wins on non-eligible maps before the manifests resolve.
    if (!this.eligibleMaps) return counts;
    for (const [map, difficulties] of this.mapWins) {
      if (!this.eligibleMaps.has(map)) continue;
      for (const difficulty of difficulties) counts[difficulty]++;
    }
    return counts;
  }

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
    return html`<button
      class="px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors duration-200 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap shrink-0 cursor-pointer hover:bg-yellow-500/30"
      @click=${() => {
        this.close();
        window.showPage?.("page-account");
      }}
    >
      ${translateText("single_modal.sign_in_for_achievements")}
    </button>`;
  }

  private applyAchievements(userMe: UserMeResponse | false) {
    if (!userMe) {
      this.mapWins = new Map();
      return;
    }

    const completions = userMe.player.achievements.singleplayerMap;

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

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("main.solo") || "Solo",
      onBack: () => this.close(),
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
                src=${assetUrl("images/MedalIconWhite.svg")}
                class="w-4 h-4 opacity-80 shrink-0"
                style="${this.showAchievements ? "" : "filter: grayscale(1);"}"
              />
              <span
                class="text-xs font-bold uppercase tracking-wider whitespace-nowrap"
                >${translateText("single_modal.toggle_achievements")}</span
              >
            </button>
            ${this.showAchievements ? this.renderMedalOverview() : null}`
        : this.renderNotLoggedInBanner(),
    });
  }

  // Compact summary that expands under the header while achievements are on:
  // each colored medal with how many maps you've earned it on, plus the shared
  // "out of N maps" total (N = achievement-eligible maps).
  private renderMedalOverview(): TemplateResult {
    const counts = this.medalCounts();
    const total = this.eligibleMaps?.size ?? null;
    return html`<div class="basis-full w-full">
      <div
        class="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 rounded-xl border border-yellow-500/20 bg-yellow-500/5"
      >
        <span
          class="text-[11px] font-bold uppercase tracking-wider text-yellow-400/80 shrink-0"
        >
          ${translateText("single_modal.medals_earned")}
        </span>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          ${MEDAL_ORDER.map((difficulty) =>
            this.renderMedalStat(difficulty, counts[difficulty]),
          )}
        </div>
        <span
          class="ml-auto text-[11px] font-semibold uppercase tracking-wider text-white/40 shrink-0"
        >
          ${translateText("single_modal.medals_of_maps", {
            total: total ?? "…",
          })}
        </span>
      </div>
    </div>`;
  }

  private renderMedalStat(
    difficulty: Difficulty,
    count: number,
  ): TemplateResult {
    return html`<div
      class="flex items-center gap-1.5"
      title=${translateText(`difficulty.${difficulty.toLowerCase()}`)}
    >
      ${medalIcon(difficulty, "w-4 h-4")}
      <span class="text-xs font-medium text-white/50 hidden sm:inline"
        >${translateText(`difficulty.${difficulty.toLowerCase()}`)}</span
      >
      <span class="text-sm font-bold text-white tabular-nums">${count}</span>
    </div>`;
  }

  protected renderBody() {
    const inputCards = [
      html`<toggle-input-card
        .labelKey=${"single_modal.max_timer"}
        .checked=${this.maxTimer}
        .inputId=${"end-timer-value"}
        .inputMin=${1}
        .inputMax=${120}
        .inputValue=${this.maxTimerValue}
        .inputAriaLabel=${translateText("single_modal.max_timer")}
        .inputPlaceholder=${translateText("single_modal.max_timer_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleMaxTimerToggle}
        .onInput=${this.handleMaxTimerValueChanges}
        .onKeyDown=${this.handleMaxTimerValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"single_modal.gold_multiplier"}
        .checked=${this.goldMultiplier}
        .inputId=${"gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.goldMultiplierValue}
        .inputAriaLabel=${translateText("single_modal.gold_multiplier")}
        .inputPlaceholder=${translateText(
          "single_modal.gold_multiplier_placeholder",
        )}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleGoldMultiplierToggle}
        .onChange=${this.handleGoldMultiplierValueChanges}
        .onKeyDown=${this.handleGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"single_modal.starting_gold"}
        .checked=${this.startingGold}
        .inputId=${"starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.startingGoldValue}
        .inputAriaLabel=${translateText("single_modal.starting_gold")}
        .inputPlaceholder=${translateText(
          "single_modal.starting_gold_placeholder",
        )}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleStartingGoldToggle}
        .onChange=${this.handleStartingGoldValueChanges}
        .onKeyDown=${this.handleStartingGoldValueKeyDown}
      ></toggle-input-card>`,
    ];

    return html`
      <div class="flex flex-col h-full">
        <div
          class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pt-4 pb-6 mr-1 mx-auto w-full max-w-5xl"
        >
          <game-config-settings
            class="block"
            .sectionGapClass=${"space-y-6"}
            .settings=${{
              map: {
                selected: this.selectedMap,
                useRandom: this.useRandomMap,
                showMedals: this.showAchievements,
                mapWins: this.mapWins,
              },
              difficulty: {
                selected: this.selectedDifficulty,
                disabled: this.nations === 0,
              },
              gameMode: {
                selected: this.gameMode,
              },
              teamCount: {
                selected: this.teamCount,
              },
              options: {
                titleKey: "single_modal.options_title",
                bots: {
                  value: this.bots,
                  labelKey: "single_modal.bots",
                  disabledKey: "single_modal.bots_disabled",
                },
                nations: {
                  value: this.nations,
                  defaultValue: this.defaultNationCount,
                  labelKey: "single_modal.nations",
                  disabledKey: "single_modal.nations_disabled",
                },
                toggles: [
                  {
                    labelKey: "single_modal.instant_build",
                    checked: this.instantBuild,
                  },
                  {
                    labelKey: "single_modal.random_spawn",
                    checked: this.randomSpawn,
                  },
                  {
                    labelKey: "single_modal.infinite_gold",
                    checked: this.infiniteGold,
                  },
                  {
                    labelKey: "single_modal.infinite_troops",
                    checked: this.infiniteTroops,
                  },
                  {
                    labelKey: "single_modal.compact_map",
                    checked: this.compactMap,
                  },
                  {
                    labelKey: "single_modal.disable_alliances",
                    checked: this.disableAlliances,
                  },
                  {
                    labelKey: "single_modal.water_nukes",
                    checked: this.waterNukes,
                  },
                  {
                    labelKey: "single_modal.doomsday_clock",
                    checked: this.doomsdayClock,
                    doomsdayClockSpeed: this.doomsdayClockSpeed,
                  },
                ],
                inputCards,
              },
              unitTypes: {
                titleKey: "single_modal.enables_title",
                disabledUnits: this.disabledUnits,
              },
            }}
            @map-selected=${this.handleConfigMapSelected}
            @random-map-selected=${this.handleConfigRandomMapSelected}
            @difficulty-selected=${this.handleConfigDifficultySelected}
            @doomsday-clock-speed-selected=${this
              .handleConfigDoomsdayClockSpeedSelected}
            @game-mode-selected=${this.handleConfigGameModeSelected}
            @team-count-selected=${this.handleConfigTeamCountSelected}
            @bots-changed=${this.handleBotsChange}
            @nations-changed=${this.handleNationsChange}
            @option-toggle-changed=${this.handleConfigOptionToggleChanged}
            @unit-toggle-changed=${this.handleConfigUnitToggleChanged}
          ></game-config-settings>
        </div>

        <!-- Footer Action -->
        <div class="p-6 border-t border-white/10 bg-black/20 shrink-0">
          ${hasLinkedAccount(this.userMeResponse) && this.hasOptionsChanged()
            ? html`<div
                class="mb-4 px-4 py-3 rounded-xl bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-bold uppercase tracking-wider text-center"
              >
                ${translateText("single_modal.options_changed_no_achievements")}
              </div>`
            : null}
          <o-button
            variant="primary"
            width="block"
            size="lg"
            translationKey="single_modal.start"
            @click=${this.startGame}
          ></o-button>
        </div>
      </div>
    `;
  }

  // Check if any options other than map and difficulty have been changed from defaults
  private hasOptionsChanged(): boolean {
    return (
      this.nations !== this.defaultNationCount ||
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
      this.disableAlliances !== DEFAULT_OPTIONS.disableAlliances ||
      this.waterNukes !== DEFAULT_OPTIONS.waterNukes ||
      this.doomsdayClock !== DEFAULT_OPTIONS.doomsdayClock ||
      // Pace only matters when the mode is on (startGame drops it when off).
      (this.doomsdayClock &&
        this.doomsdayClockSpeed !== DEFAULT_OPTIONS.doomsdayClockSpeed) ||
      this.disabledUnits.length > 0
    );
  }

  protected onClose(): void {
    // Reset all transient form state to ensure clean slate
    this.selectedMap = DEFAULT_OPTIONS.selectedMap;
    this.selectedDifficulty = DEFAULT_OPTIONS.selectedDifficulty;
    this.gameMode = DEFAULT_OPTIONS.gameMode;
    this.useRandomMap = DEFAULT_OPTIONS.useRandomMap;
    this.bots = DEFAULT_OPTIONS.bots;
    this.nations = 0;
    this.defaultNationCount = 0;
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
    this.disableAlliances = DEFAULT_OPTIONS.disableAlliances;
    this.waterNukes = DEFAULT_OPTIONS.waterNukes;
    this.doomsdayClock = DEFAULT_OPTIONS.doomsdayClock;
    this.doomsdayClockSpeed = DEFAULT_OPTIONS.doomsdayClockSpeed;
  }

  protected onOpen(): void {
    void this.loadNationCount();
  }

  private handleSelectRandomMap() {
    this.useRandomMap = true;
    this.selectedMap = getRandomMapType();
    void this.loadNationCount();
  }

  private handleConfigRandomMapSelected = () => {
    this.handleSelectRandomMap();
  };

  private handleMapSelection(value: GameMapType) {
    this.selectedMap = value;
    this.useRandomMap = false;
    void this.loadNationCount();
  }

  private handleConfigMapSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ map: GameMapType }>;
    this.handleMapSelection(customEvent.detail.map);
  };

  private handleDifficultySelection(value: Difficulty) {
    this.selectedDifficulty = value;
  }

  private handleConfigDifficultySelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ difficulty: Difficulty }>;
    this.handleDifficultySelection(customEvent.detail.difficulty);
  };

  private handleConfigDoomsdayClockSpeedSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ speed: DoomsdayClockSpeed }>;
    this.doomsdayClockSpeed = customEvent.detail.speed;
  };

  private handleConfigGameModeSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ mode: GameMode }>;
    this.handleGameModeSelection(customEvent.detail.mode);
  };

  private handleConfigTeamCountSelected = (e: Event) => {
    const customEvent = e as CustomEvent<{ count: TeamCountConfig }>;
    this.handleTeamCountSelection(customEvent.detail.count);
  };

  private handleCompactMapChange(val: boolean) {
    this.compactMap = val;
    this.bots = getBotsForCompactMap(this.bots, val);
    this.nations = getNationsForCompactMap(
      this.nations,
      this.defaultNationCount,
      val,
    );
  }

  private handleConfigOptionToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{
      labelKey: string;
      checked: boolean;
    }>;
    const { labelKey, checked } = customEvent.detail;

    switch (labelKey) {
      case "single_modal.instant_build":
        this.instantBuild = checked;
        break;
      case "single_modal.random_spawn":
        this.randomSpawn = checked;
        break;
      case "single_modal.infinite_gold":
        this.infiniteGold = checked;
        break;
      case "single_modal.infinite_troops":
        this.infiniteTroops = checked;
        break;
      case "single_modal.compact_map":
        this.handleCompactMapChange(checked);
        break;
      case "single_modal.disable_alliances":
        this.disableAlliances = checked;
        break;
      case "single_modal.water_nukes":
        this.waterNukes = checked;
        break;
      case "single_modal.doomsday_clock":
        this.doomsdayClock = checked;
        break;
      default:
        break;
    }
  };

  private handleConfigUnitToggleChanged = (e: Event) => {
    const customEvent = e as CustomEvent<{ unit: UnitType; checked: boolean }>;
    const { unit, checked } = customEvent.detail;
    this.disabledUnits = getUpdatedDisabledUnits(
      this.disabledUnits,
      unit,
      checked,
    );
  };

  private handleBotsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.bots = value;
  };

  private handleNationsChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ value: number }>;
    const value = customEvent.detail.value;
    if (isNaN(value) || value < 0 || value > 400) {
      return;
    }
    this.nations = value;
  };

  private handleMaxTimerToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.maxTimer = checked;
    this.maxTimerValue = toOptionalNumber(value);
  };

  private handleGoldMultiplierToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.goldMultiplier = checked;
    this.goldMultiplierValue = toOptionalNumber(value);
  };

  private handleStartingGoldToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.startingGold = checked;
    this.startingGoldValue = toOptionalNumber(value);
  };

  private handleMaxTimerValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private getEndTimerInput(): HTMLInputElement | null {
    return (
      (this.renderRoot.querySelector(
        "#end-timer-value",
      ) as HTMLInputElement | null) ??
      (this.querySelector("#end-timer-value") as HTMLInputElement | null)
    );
  }

  private handleMaxTimerValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });

    this.maxTimerValue = value;
  };

  private handleGoldMultiplierValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["+", "-", "e", "E"]);
  };

  private handleGoldMultiplierValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, { min: 0.1, max: 1000 });

    if (value === undefined) {
      this.goldMultiplierValue = undefined;
      input.value = "";
    } else {
      this.goldMultiplierValue = value;
    }
  };

  private handleStartingGoldValueKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e", "E"]);
  };

  private handleStartingGoldValueChanges = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedFloatFromInput(input, {
      min: 0.1,
      max: 1000,
    });

    if (value === undefined) {
      this.startingGoldValue = undefined;
      input.value = "";
    } else {
      this.startingGoldValue = value;
    }
  };

  private handleGameModeSelection(value: GameMode) {
    this.gameMode = value;
  }

  private handleTeamCountSelection(value: TeamCountConfig) {
    this.teamCount = value;
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

    console.log(
      `Starting single player game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]}${this.useRandomMap ? " (Randomly selected)" : ""}`,
    );
    const clientID = generateID();
    const gameID = generateID();

    const usernameInput = document.querySelector(
      "username-input",
    ) as UsernameInput;

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
                username: usernameInput.getUsername(),
                clanTag: usernameInput.getClanTag() ?? null,
                cosmetics: await getPlayerCosmetics(),
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
              nations: sliderToNationsConfig(
                this.nations,
                this.defaultNationCount,
              ),
              ...(this.goldMultiplier && this.goldMultiplierValue
                ? { goldMultiplier: this.goldMultiplierValue }
                : {}),
              ...(this.startingGold && this.startingGoldValue !== undefined
                ? {
                    startingGold: Math.round(
                      this.startingGoldValue * 1_000_000,
                    ),
                  }
                : {}),
              ...(this.disableAlliances ? { disableAlliances: true } : {}),
              ...(this.waterNukes ? { waterNukes: true } : {}),
              ...(this.doomsdayClock
                ? {
                    doomsdayClock: {
                      enabled: true,
                      speed: this.doomsdayClockSpeed,
                    },
                  }
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

  private async loadNationCount() {
    const currentMap = this.selectedMap;
    try {
      const mapData = this.mapLoader.getMapData(currentMap);
      const manifest = await mapData.manifest();
      // Only update if the map hasn't changed
      if (this.selectedMap === currentMap) {
        this.defaultNationCount = manifest.nations.length;
        this.nations = this.compactMap
          ? Math.max(0, Math.floor(manifest.nations.length * 0.25))
          : manifest.nations.length;
      }
    } catch (error) {
      console.warn("Failed to load nation count", error);
      // Leave existing values unchanged so the UI stays consistent
    }
  }
}
