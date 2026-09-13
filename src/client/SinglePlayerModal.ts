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
import { UserSettings } from "../core/game/UserSettings";
import { PlayerCosmetics, TeamCountConfig } from "../core/Schemas";
import { generateID } from "../core/Util";
import { responseHasLinkedIdentity } from "./AccountIdentity";
import "./components/baseComponents/Button";
import "./components/baseComponents/Modal";
import { BaseModal } from "./components/BaseModal";
import "./components/GameConfigSettings";
import { MEDAL_ORDER, medalIcon } from "./components/map/Medals";
import "./components/ToggleInputCard";
import { modalHeader } from "./components/ui/ModalHeader";
import { getPlayerCosmetics, prewarmCosmetics } from "./Cosmetics";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { showInGameAlert } from "./InGameModal";
import { JoinLobbyEvent } from "./Main";
import { fallbackPlayerName, ResolvedPlayerName } from "./PlayerName";
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

/**
 * Ceiling on how long a Start Game click will wait for the player's name and
 * cosmetics before starting on defaults.
 *
 * A backstop for a wait that never settles, but not only that: the bounds
 * beneath it chain rather than sit in parallel — getPlayerCosmetics reaches
 * getUserMe, which awaits userAuth's 10s-bounded /auth/refresh before issuing
 * its own 10s-bounded /users/@me — so a genuinely slow leg can exceed this and
 * be pre-empted. That is accepted: the cost is one single-player game on
 * default cosmetics, against a Start button that would otherwise sit at
 * "Starting…" for however long the chain takes. prewarmCosmetics() spends
 * that time while the player is still choosing, which is what keeps the case
 * rare rather than routine.
 */
export const START_PREPARE_DEADLINE_MS = 15_000;

/**
 * Ceiling on the CrazyGames midgame ad, deliberately far above
 * START_PREPARE_DEADLINE_MS: an ad creative routinely runs 15-30s and it has
 * to gate the start, because dispatching behind one puts gameplay — spawn
 * selection included — under a still-visible overlay. This exists only for an
 * SDK that never calls adFinished or adError at all. Off CrazyGames,
 * requestMidgameAd() resolves immediately and none of this is reached.
 */
export const MIDGAME_AD_DEADLINE_MS = 60_000;

/**
 * `work`, or `onDeadline()` if it has not settled within `ms`. The timer is
 * always cleared, so the fast path costs nothing.
 */
function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  onDeadline: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onDeadline()), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** What a start has to wait for before it can dispatch join-lobby. */
type StartPreparation = {
  resolvedName: ResolvedPlayerName;
  cosmetics: PlayerCosmetics;
};

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
  customAlliances: false,
  customAllianceMinutes: undefined as number | undefined,
  waterNukes: false,
  doomsdayClock: false,
  doomsdayClockSpeed: "normal" as DoomsdayClockSpeed,
  overtime: false,
  overtimeStartMinutes: undefined as number | undefined,
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
  @state() private customAlliances: boolean = DEFAULT_OPTIONS.customAlliances;
  @state() private customAllianceMinutes: number | undefined =
    DEFAULT_OPTIONS.customAllianceMinutes;
  @state() private waterNukes: boolean = DEFAULT_OPTIONS.waterNukes;
  @state() private doomsdayClock: boolean = DEFAULT_OPTIONS.doomsdayClock;
  @state() private doomsdayClockSpeed: DoomsdayClockSpeed =
    DEFAULT_OPTIONS.doomsdayClockSpeed;
  @state() private overtime: boolean = DEFAULT_OPTIONS.overtime;
  @state() private overtimeStartMinutes: number | undefined =
    DEFAULT_OPTIONS.overtimeStartMinutes;
  // Drives the Start Game button's busy state. Without it the click produces
  // nothing visible until every await in startGame() settles, which reads as
  // a hang rather than as loading whenever the network is slow or absent.
  @state() private starting: boolean = false;
  // Identifies the current start attempt. Bumped on every start and on every
  // close, so an attempt that outlives its modal can tell it has been retired.
  private startAttempt: number = 0;

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
      rightContent: responseHasLinkedIdentity(this.userMeResponse)
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
        .labelKey=${"game_settings.max_timer"}
        .checked=${this.maxTimer}
        .inputId=${"end-timer-value"}
        .inputMin=${1}
        .inputMax=${120}
        .inputValue=${this.maxTimerValue}
        .inputAriaLabel=${translateText("game_settings.max_timer")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleMaxTimerToggle}
        .onInput=${this.handleMaxTimerValueChanges}
        .onKeyDown=${this.handleMaxTimerValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.gold_multiplier"}
        .checked=${this.goldMultiplier}
        .inputId=${"gold-multiplier-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.goldMultiplierValue}
        .inputAriaLabel=${translateText("game_settings.gold_multiplier")}
        .inputPlaceholder=${"2.0x"}
        .defaultInputValue=${2}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleGoldMultiplierToggle}
        .onChange=${this.handleGoldMultiplierValueChanges}
        .onKeyDown=${this.handleGoldMultiplierValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.starting_gold"}
        .checked=${this.startingGold}
        .inputId=${"starting-gold-value"}
        .inputMin=${0.1}
        .inputMax=${1000}
        .inputStep=${"any"}
        .inputValue=${this.startingGoldValue}
        .inputAriaLabel=${translateText("game_settings.starting_gold")}
        .inputPlaceholder=${"5"}
        .defaultInputValue=${5}
        .minValidOnEnable=${0.1}
        .onToggle=${this.handleStartingGoldToggle}
        .onChange=${this.handleStartingGoldValueChanges}
        .onKeyDown=${this.handleStartingGoldValueKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.custom_alliances"}
        .checked=${this.customAlliances}
        .inputMin=${0}
        .inputMax=${15}
        .inputStep=${1}
        .inputValue=${this.customAllianceMinutes}
        .inputAriaLabel=${translateText("game_settings.custom_alliances")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${0}
        .minValidOnEnable=${0}
        .zeroLabel=${`(${translateText("public_game_modifier.disable_alliances")})`}
        .onToggle=${this.handleCustomAlliancesToggle}
        .onInput=${this.handleCustomAllianceMinutesInput}
        .onKeyDown=${this.handleCustomAllianceMinutesKeyDown}
      ></toggle-input-card>`,
      html`<toggle-input-card
        .labelKey=${"game_settings.overtime"}
        .checked=${this.overtime}
        .inputMin=${1}
        .inputMax=${120}
        .inputStep=${1}
        .inputValue=${this.overtimeStartMinutes}
        .inputAriaLabel=${translateText("game_settings.overtime")}
        .inputPlaceholder=${translateText("game_settings.mins_placeholder")}
        .defaultInputValue=${30}
        .minValidOnEnable=${1}
        .onToggle=${this.handleOvertimeToggle}
        .onInput=${this.handleOvertimeMinutesInput}
        .onKeyDown=${this.handleOvertimeMinutesKeyDown}
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
                titleKey: "game_settings.options",
                bots: {
                  value: this.bots,
                  labelKey: "game_settings.bots",
                  disabledKey: "common.disabled",
                },
                nations: {
                  value: this.nations,
                  defaultValue: this.defaultNationCount,
                  labelKey: "game_settings.nations",
                  disabledKey: "common.disabled",
                },
                toggles: [
                  {
                    labelKey: "game_settings.instant_build",
                    checked: this.instantBuild,
                  },
                  {
                    labelKey: "game_settings.random_spawn",
                    checked: this.randomSpawn,
                  },
                  {
                    labelKey: "game_settings.infinite_gold",
                    checked: this.infiniteGold,
                  },
                  {
                    labelKey: "game_settings.infinite_troops",
                    checked: this.infiniteTroops,
                  },
                  {
                    labelKey: "game_settings.compact_map",
                    checked: this.compactMap,
                  },
                  {
                    labelKey: "game_settings.water_nukes",
                    checked: this.waterNukes,
                  },
                  {
                    labelKey: "game_settings.doomsday_clock",
                    checked: this.doomsdayClock,
                    doomsdayClockSpeed: this.doomsdayClockSpeed,
                  },
                ],
                inputCards,
              },
              unitTypes: {
                titleKey: "game_settings.disable_units",
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
          ${responseHasLinkedIdentity(this.userMeResponse) &&
          this.hasOptionsChanged()
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
            translationKey=${this.starting
              ? "game_settings.starting"
              : "game_settings.start"}
            .disable=${this.starting}
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
      this.customAlliances !== DEFAULT_OPTIONS.customAlliances ||
      this.customAllianceMinutes !== DEFAULT_OPTIONS.customAllianceMinutes ||
      this.waterNukes !== DEFAULT_OPTIONS.waterNukes ||
      this.doomsdayClock !== DEFAULT_OPTIONS.doomsdayClock ||
      // Pace only matters when the mode is on (startGame drops it when off).
      (this.doomsdayClock &&
        this.doomsdayClockSpeed !== DEFAULT_OPTIONS.doomsdayClockSpeed) ||
      this.overtime !== DEFAULT_OPTIONS.overtime ||
      this.disabledUnits.length > 0
    );
  }

  protected onClose(): void {
    // Retires whatever start is still in flight. resetOptions() below hands
    // back a live button, so the player can close, reopen and start again
    // while the previous attempt is still resolving — and that attempt is
    // now describing settings the modal no longer holds. Without this, both
    // attempts dispatch join-lobby with different gameIDs and whichever
    // resolves last wins, which can be the one the player abandoned.
    this.startAttempt++;
    this.resetOptions();
  }

  /**
   * Starts a solo game on the default settings without opening the modal,
   * with the in-game tutorial switched back on (the play page's Tutorial
   * card for new players).
   */
  public async startTutorial(): Promise<void> {
    // The modal never opens on this path, so onOpen's prewarm never runs.
    // Overlap it with the manifest load below.
    void prewarmCosmetics();
    this.resetOptions();
    // A nation count of 0 means "nations disabled"; wait for the real one.
    await this.loadNationCount();
    new UserSettings().setTutorialDismissed(false);
    await this.startGame();
  }

  // Reset all transient form state to ensure clean slate
  private resetOptions(): void {
    // Belt and braces with the finally in startGame(): closing and reopening
    // the modal must always give the player a live Start button back, whatever
    // left the previous attempt in flight.
    this.starting = false;
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
    this.customAlliances = DEFAULT_OPTIONS.customAlliances;
    this.customAllianceMinutes = DEFAULT_OPTIONS.customAllianceMinutes;
    this.waterNukes = DEFAULT_OPTIONS.waterNukes;
    this.doomsdayClock = DEFAULT_OPTIONS.doomsdayClock;
    this.doomsdayClockSpeed = DEFAULT_OPTIONS.doomsdayClockSpeed;
    this.overtime = DEFAULT_OPTIONS.overtime;
    this.overtimeStartMinutes = DEFAULT_OPTIONS.overtimeStartMinutes;
  }

  protected onOpen(): void {
    void this.loadNationCount();
    // Spend the cosmetics round trip while the player is picking a map, not
    // after they commit. startGame() still resolves cosmetics properly; this
    // only moves the network time off the click, for the slow-but-reachable
    // case. It does not help when the backend is unreachable: fetchCosmetics
    // deliberately does not cache a failure, so the click re-pays one bounded
    // attempt. Remembering an unreachable backend is OPE-403.
    void prewarmCosmetics();
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
      case "game_settings.instant_build":
        this.instantBuild = checked;
        break;
      case "game_settings.random_spawn":
        this.randomSpawn = checked;
        break;
      case "game_settings.infinite_gold":
        this.infiniteGold = checked;
        break;
      case "game_settings.infinite_troops":
        this.infiniteTroops = checked;
        break;
      case "game_settings.compact_map":
        this.handleCompactMapChange(checked);
        break;
      case "game_settings.water_nukes":
        this.waterNukes = checked;
        break;
      case "game_settings.doomsday_clock":
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

  private handleCustomAlliancesToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.customAlliances = checked;
    this.customAllianceMinutes = toOptionalNumber(value);
  };

  private handleOvertimeToggle = (
    checked: boolean,
    value: number | string | undefined,
  ) => {
    this.overtime = checked;
    this.overtimeStartMinutes = toOptionalNumber(value);
  };

  private handleOvertimeMinutesKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private handleOvertimeMinutesInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, {
      min: 1,
      max: 120,
      stripPattern: /[e+-]/gi,
    });
    if (value === undefined) {
      return;
    }
    this.overtimeStartMinutes = value;
  };

  private handleCustomAllianceMinutesKeyDown = (e: KeyboardEvent) => {
    preventDisallowedKeys(e, ["-", "+", "e"]);
  };

  private handleCustomAllianceMinutesInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseBoundedIntegerFromInput(input, { min: 0, max: 15 });
    if (value === undefined) {
      return;
    }
    this.customAllianceMinutes = value;
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

  /**
   * The name and cosmetics the dispatch needs, bounded so neither can outlive
   * the button waiting on them.
   *
   * Both waits can reach code with no bound of its own — the Steam name seed
   * is a bare IPC call, cosmetics reach the network — and both degrade to
   * something playable: the interim generated name, default cosmetics. A slow
   * resolution here is a cost with nothing to show for it, so
   * START_PREPARE_DEADLINE_MS cuts it short rather than pinning Start at
   * "Starting…" for the rest of the session, which would take startTutorial()
   * down with it on the re-entrancy guard.
   *
   * The midgame ad is deliberately not part of this — see awaitMidgameAd.
   */
  private async resolveNameAndCosmetics(
    usernameInput: UsernameInput | null,
  ): Promise<StartPreparation> {
    const nameNow = () => usernameInput?.resolvedName() ?? fallbackPlayerName();

    const prepared = await withDeadline(
      (async (): Promise<StartPreparation> => {
        // Wait for the one-shot Steam name-seed to settle before reading
        // getUsername(), so a fast single-player start uses the Steam persona
        // rather than the interim generated anon name.
        await usernameInput?.whenSeeded();
        // Name and badge from one resolution, as on the multiplayer join path.
        const resolvedName = nameNow();
        // onOpen() prewarmed the caches this reads, so it normally resolves
        // without touching the network at all.
        return {
          resolvedName,
          cosmetics: await getPlayerCosmetics({
            verified: resolvedName.verified,
          }),
        };
      })(),
      START_PREPARE_DEADLINE_MS,
      () => {
        console.warn(
          "Start preparation exceeded its deadline; starting on defaults",
        );
        const resolvedName = nameNow();
        return {
          resolvedName,
          cosmetics: resolvedName.verified ? { verified: true } : {},
        };
      },
    );

    return prepared;
  }

  /**
   * The CrazyGames midgame ad, on a bound of its own.
   *
   * Separate from resolveNameAndCosmetics because an ad is not the same kind
   * of wait. It is the player watching something, legitimately for longer than
   * START_PREPARE_DEADLINE_MS — racing it there cut real creatives short and
   * dropped the player into spawn selection underneath a live overlay. So the
   * ad gates the start, the button staying busy while it plays is correct
   * rather than a hang, and MIDGAME_AD_DEADLINE_MS is sized only to catch an
   * SDK that has stopped answering (requestMidgameAd resolves solely from its
   * adFinished/adError callbacks).
   *
   * Only ever called for a start that is still live — an ad shown for a game
   * that will not start is worse than no ad. Off CrazyGames this resolves
   * immediately.
   */
  private awaitMidgameAd(): Promise<void> {
    return withDeadline(
      crazyGamesSDK.requestMidgameAd(),
      MIDGAME_AD_DEADLINE_MS,
      () => {
        console.warn("Midgame ad never signalled completion; starting anyway");
      },
    );
  }

  private async startGame() {
    // A second click while the first is still resolving would dispatch a
    // second join-lobby for a different gameID.
    if (this.starting) return;
    // Validate and clamp maxTimer setting before starting
    let finalMaxTimerValue: number | undefined = undefined;
    if (this.maxTimer) {
      if (!this.maxTimerValue || this.maxTimerValue <= 0) {
        console.error("Max timer is enabled but no valid value is set");
        await showInGameAlert(
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

    // Everything past this point awaits something, some of it network-bound.
    // Hold the button in its busy state until join-lobby is away so the wait
    // reads as loading rather than as a dead click.
    this.starting = true;
    const attempt = ++this.startAttempt;
    try {
      console.log(
        `Starting single player game with map: ${GameMapType[this.selectedMap as keyof typeof GameMapType]}${this.useRandomMap ? " (Randomly selected)" : ""}`,
      );
      const clientID = generateID();
      const gameID = generateID();

      const usernameInput = document.querySelector(
        "username-input",
      ) as UsernameInput | null;

      // Resolved before the dispatch rather than inside it, so every wait is
      // attributable to the busy button above, and bounded so none of them
      // can outlive it.
      const { resolvedName, cosmetics } =
        await this.resolveNameAndCosmetics(usernameInput);

      // Retired while this was resolving — the modal was closed, and possibly
      // reopened and started again. The live attempt owns the start; this one
      // would otherwise race it into join-lobby with stale settings.
      //
      // A start has exactly two side effects that leave this component, and
      // BOTH must sit behind this check. Anything added here that escapes the
      // component needs the same gate:
      //   1. awaitMidgameAd() — shows the player a real ad, so an abandoned
      //      attempt reaching it advertises a game that never starts, and a
      //      reopened modal can put a second request in flight beside it.
      //   2. the join-lobby dispatch — and everything downstream of it,
      //      including Main's gameplayStart() and incrementGamesPlayed().
      // resolveNameAndCosmetics() above is deliberately NOT gated: its only
      // writes are validating stored cosmetic selections against the catalog
      // and profile, which happens on any cosmetics resolution (menu
      // background, store, inventory) rather than as a consequence of this
      // start.
      if (attempt !== this.startAttempt) return;

      await this.awaitMidgameAd();

      // The ad is long enough that the modal can be closed while it runs.
      if (attempt !== this.startAttempt) return;

      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: gameID,
            gameStartInfo: {
              gameID: gameID,
              players: [
                {
                  clientID,
                  username: resolvedName.name,
                  clanTag: usernameInput?.getClanTag() ?? null,
                  cosmetics,
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
                disabledUnits: this.disabledUnits.filter(
                  (unit): unit is UnitType =>
                    Object.values(UnitType).includes(unit),
                ),
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
                ...(this.customAlliances
                  ? { customAllianceDuration: this.customAllianceMinutes ?? 0 }
                  : {}),
                ...(this.waterNukes ? { waterNukes: true } : {}),
                ...(this.doomsdayClock
                  ? {
                      doomsdayClock: {
                        enabled: true,
                        speed: this.doomsdayClockSpeed,
                      },
                    }
                  : {}),
                ...(this.overtime
                  ? {
                      overtime: {
                        enabled: true,
                        startMinutes: this.overtimeStartMinutes ?? 30,
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
    } finally {
      // Only if this attempt is still the live one: a retired attempt
      // settling later must not clear the busy state of the one that
      // replaced it.
      if (attempt === this.startAttempt) this.starting = false;
    }
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
