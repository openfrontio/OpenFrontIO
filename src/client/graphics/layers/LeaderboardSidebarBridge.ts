import { EventBus } from "../../../core/EventBus";
import { GameMode, Team, UnitType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { Colord } from "colord";
import { html, LitElement, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  dispatchUiAction,
  dispatchUiSnapshot,
  initDioxusRuntime,
} from "../../UiRuntimeBridge";
import { GoToPlayerEvent } from "../../InputHandler";
import {
  formatPercentage,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import {
  UI_RUNTIME_ACTIONS,
  UI_RUNTIME_EVENTS,
  UI_RUNTIME_SNAPSHOTS,
} from "../../runtime/UiRuntimeProtocol";
import { subscribeUiRuntimeEvents } from "../../runtime/UiRuntimeEventRouter";
import { parseUiRuntimePayload } from "../../runtime/UiRuntimeParsing";
import { Layer } from "./Layer";

import leaderboardRegularIcon from "/images/LeaderboardIconRegularWhite.svg?url";
import leaderboardSolidIcon from "/images/LeaderboardIconSolidWhite.svg?url";
import teamRegularIcon from "/images/TeamIconRegularWhite.svg?url";
import teamSolidIcon from "/images/TeamIconSolidWhite.svg?url";

function dispatchInGameRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): void {
  if (!dispatchUiAction({ type: actionType, payload })) {
    console.warn(
      "[LeaderboardSidebarBridge] Failed to dispatch runtime action:",
      actionType,
    );
  }
}

/** Player entry data passed to Dioxus */
export interface LeaderboardEntry {
  id: string;
  name: string;
  position: number;
  tilesPercent: number;
  tilesDisplay: string;
  gold: number;
  goldDisplay: string;
  maxTroops: number;
  maxTroopsDisplay: string;
  isMyPlayer: boolean;
  isOnSameTeam: boolean;
}

/** Translations passed to Dioxus */
export interface LeaderboardTranslations {
  player: string;
  owned: string;
  gold: string;
  maxTroops: string;
}

/** Event detail from Dioxus when a row is clicked */
export interface LeaderboardRowClickEvent {
  playerId: string;
}

/** Event detail from Dioxus when sort changes */
export interface LeaderboardSortEvent {
  sortKey: "tiles" | "gold" | "maxtroops";
  sortOrder: "asc" | "desc";
}

@customElement("dioxus-leader-board")
export class DioxusLeaderboard extends LitElement implements Layer {
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;

  private playerMap: Map<string, PlayerView> = new Map();

  @property({ type: Boolean }) visible = false;

  @state()
  private isLaunched: boolean = false;

  @state()
  private showTopFive: boolean = true;

  @state()
  private sortKey: "tiles" | "gold" | "maxtroops" = "tiles";

  @state()
  private sortOrder: "asc" | "desc" = "desc";

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  init() {
    if (!this.game || !this.eventBus) {
      console.error("[DioxusLeaderboard] game or eventBus not set");
      return;
    }
    this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [
        UI_RUNTIME_EVENTS.uiInGameLeaderboardRowClick,
        UI_RUNTIME_EVENTS.uiInGameLeaderboardSort,
        UI_RUNTIME_EVENTS.uiInGameLeaderboardToggle,
      ],
      (event) => {
        const payload = parseUiRuntimePayload(event.payload);
        if (event.type === UI_RUNTIME_EVENTS.uiInGameLeaderboardToggle) {
          this.handleToggle();
          return;
        }

        if (event.type === UI_RUNTIME_EVENTS.uiInGameLeaderboardRowClick) {
          const playerId = payload.playerId;
          if (typeof playerId === "string") {
            this.handleRowClick({
              detail: { playerId },
            } as CustomEvent<LeaderboardRowClickEvent>);
          }
          return;
        }

        if (event.type === UI_RUNTIME_EVENTS.uiInGameLeaderboardSort) {
          const sortKey = payload.sortKey;
          const sortOrder = payload.sortOrder;
          if (
            (sortKey === "tiles" || sortKey === "gold" || sortKey === "maxtroops") &&
            (sortOrder === "asc" || sortOrder === "desc")
          ) {
            this.handleSortChange({
              detail: { sortKey, sortOrder },
            } as CustomEvent<LeaderboardSortEvent>);
          }
        }
      },
    );
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  updated(changedProperties: PropertyValues) {
    if (changedProperties.has("visible") && this.visible && this.game) {
      this.updateLeaderboard();
    }
  }

  tick() {
    if (!this.game) {
      return;
    }
    if (!this.visible) {
      return;
    }

    if (this.game.ticks() % 10 === 0) {
      this.updateLeaderboard();
    }
  }

  private handleRowClick = (event: Event) => {
    const detail = (event as CustomEvent<LeaderboardRowClickEvent>).detail;
    const player = this.playerMap.get(detail.playerId);
    if (player && this.eventBus) {
      this.eventBus.emit(new GoToPlayerEvent(player));
    }
  };

  private handleSortChange = (event: Event) => {
    const detail = (event as CustomEvent<LeaderboardSortEvent>).detail;
    this.sortKey = detail.sortKey;
    this.sortOrder = detail.sortOrder;
    this.updateLeaderboard();
  };

  private handleToggle = () => {
    this.showTopFive = !this.showTopFive;
    this.updateLeaderboard();
  };

  private getEntries(): LeaderboardEntry[] {
    if (!this.game) return [];

    const myPlayer = this.game.myPlayer();
    let sorted = this.game.playerViews();

    const compare = (a: number, b: number) =>
      this.sortOrder === "asc" ? a - b : b - a;

    const maxTroops = (p: PlayerView) => this.game!.config().maxTroops(p);

    switch (this.sortKey) {
      case "gold":
        sorted = sorted.sort((a, b) =>
          compare(Number(a.gold()), Number(b.gold())),
        );
        break;
      case "maxtroops":
        sorted = sorted.sort((a, b) => compare(maxTroops(a), maxTroops(b)));
        break;
      default:
        sorted = sorted.sort((a, b) =>
          compare(a.numTilesOwned(), b.numTilesOwned()),
        );
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    const alivePlayers = sorted.filter((player) => player.isAlive());
    const playersToShow = this.showTopFive
      ? alivePlayers.slice(0, 5)
      : alivePlayers;

    this.playerMap.clear();

    const entries: LeaderboardEntry[] = playersToShow.map((player, index) => {
      const playerMaxTroops = this.game!.config().maxTroops(player);
      const tilesPercent = player.numTilesOwned() / numTilesWithoutFallout;
      const goldValue = Number(player.gold());
      const id = player.id().toString();

      this.playerMap.set(id, player);

      return {
        id,
        name: player.displayName(),
        position: index + 1,
        tilesPercent,
        tilesDisplay: formatPercentage(tilesPercent),
        gold: goldValue,
        goldDisplay: renderNumber(player.gold()),
        maxTroops: playerMaxTroops,
        maxTroopsDisplay: renderTroops(playerMaxTroops),
        isMyPlayer: player === myPlayer,
        isOnSameTeam:
          myPlayer !== null &&
          (player === myPlayer || player.isOnSameTeam(myPlayer)),
      };
    });

    if (
      myPlayer !== null &&
      entries.find((e) => e.isMyPlayer) === undefined &&
      myPlayer.isAlive()
    ) {
      let place = 0;
      for (const p of sorted) {
        place++;
        if (p === myPlayer) break;
      }

      const myPlayerMaxTroops = this.game!.config().maxTroops(myPlayer);
      const tilesPercent = myPlayer.numTilesOwned() / this.game.numLandTiles();
      const goldValue = Number(myPlayer.gold());
      const id = myPlayer.id().toString();

      this.playerMap.set(id, myPlayer);

      entries.pop();
      entries.push({
        id,
        name: myPlayer.displayName(),
        position: place,
        tilesPercent,
        tilesDisplay: formatPercentage(tilesPercent),
        gold: goldValue,
        goldDisplay: renderNumber(myPlayer.gold()),
        maxTroops: myPlayerMaxTroops,
        maxTroopsDisplay: renderTroops(myPlayerMaxTroops),
        isMyPlayer: true,
        isOnSameTeam: true,
      });
    }

    return entries;
  }

  private getTranslations(): LeaderboardTranslations {
    return {
      player: translateText("leaderboard.player"),
      owned: translateText("leaderboard.owned"),
      gold: translateText("leaderboard.gold"),
      maxTroops: translateText("leaderboard.maxtroops"),
    };
  }

  private async updateLeaderboard() {
    const entries = this.getEntries();

    if (!this.isLaunched) {
      await this.launchDioxusComponent(entries);
    } else {
      if (
        !dispatchUiSnapshot({
          type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameLeaderboardEntries,
          scope: "ingame",
          tick: this.game?.ticks(),
          payload: { entries },
        })
      ) {
        console.warn("[DioxusLeaderboard] Failed to dispatch runtime snapshot");
      }
    }
  }

  private async launchDioxusComponent(entries: LeaderboardEntry[]) {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();

      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameLeaderboardLaunch,
        {
          entries,
          translations,
          showTopFive: this.showTopFive,
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusLeaderboard] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  renderLayer(_context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    if (this.loading) {
      return html`
        <div class="text-white text-xs">Loading leaderboard...</div>
      `;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-leaderboard-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-leader-board": DioxusLeaderboard;
  }
}

/** Team entry data passed to Dioxus */
export interface TeamStatsEntry {
  teamName: string;
  isMyTeam: boolean;
  totalScoreStr: string;
  totalGold: string;
  totalMaxTroops: string;
  totalSams: string;
  totalLaunchers: string;
  totalWarShips: string;
  totalCities: string;
  totalScoreSort: number;
}

/** Translations passed to Dioxus */
export interface TeamStatsTranslations {
  team: string;
  owned: string;
  gold: string;
  maxTroops: string;
  launchers: string;
  sams: string;
  warships: string;
  cities: string;
  showUnits: string;
  showControl: string;
}

@customElement("dioxus-team-stats")
export class DioxusTeamStats extends LitElement implements Layer {
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;

  private _myTeam: Team | null = null;
  private _shownOnInit = false;

  @property({ type: Boolean }) visible = false;

  @state()
  private isLaunched: boolean = false;

  @state()
  private loading: boolean = false;

  @state()
  private error: string | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    if (!this.game || !this.eventBus) {
      console.error("[DioxusTeamStats] game or eventBus not set");
      return;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  updated(changedProperties: PropertyValues) {
    if (changedProperties.has("visible") && this.visible && this.game) {
      this.updateTeamStats();
    }
  }

  tick() {
    if (!this.game) {
      return;
    }

    if (this.game.config().gameConfig().gameMode !== GameMode.Team) return;

    if (!this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = true;
      this.updateTeamStats();
    }

    if (!this.visible) {
      return;
    }

    if (this.game.ticks() % 10 === 0) {
      this.updateTeamStats();
    }
  }

  private getEntries(): TeamStatsEntry[] {
    if (!this.game) return [];

    const players = this.game.playerViews();
    const grouped: Record<Team, PlayerView[]> = {};

    if (this._myTeam === null) {
      const myPlayer = this.game.myPlayer();
      this._myTeam = myPlayer?.team() ?? null;
    }

    for (const player of players) {
      const team = player.team();
      if (team === null) continue;
      grouped[team] ??= [];
      grouped[team].push(player);
    }

    const entries: TeamStatsEntry[] = Object.entries(grouped)
      .map(([teamStr, teamPlayers]) => {
        let totalGold = 0n;
        let totalMaxTroops = 0;
        let totalScoreSort = 0;
        let totalSAMs = 0;
        let totalLaunchers = 0;
        let totalWarShips = 0;
        let totalCities = 0;

        for (const p of teamPlayers) {
          if (p.isAlive()) {
            totalMaxTroops += this.game!.config().maxTroops(p);
            totalGold += p.gold();
            totalScoreSort += p.numTilesOwned();
            totalLaunchers += p.totalUnitLevels(UnitType.MissileSilo);
            totalSAMs += p.totalUnitLevels(UnitType.SAMLauncher);
            totalWarShips += p.totalUnitLevels(UnitType.Warship);
            totalCities += p.totalUnitLevels(UnitType.City);
          }
        }

        const numTilesWithoutFallout =
          this.game!.numLandTiles() - this.game!.numTilesWithFallout();
        const totalScorePercent = totalScoreSort / numTilesWithoutFallout;

        return {
          teamName: teamStr,
          isMyTeam: teamStr === this._myTeam,
          totalScoreStr: formatPercentage(totalScorePercent),
          totalScoreSort,
          totalGold: renderNumber(totalGold),
          totalMaxTroops: renderTroops(totalMaxTroops),
          totalLaunchers: renderNumber(totalLaunchers),
          totalSams: renderNumber(totalSAMs),
          totalWarShips: renderNumber(totalWarShips),
          totalCities: renderNumber(totalCities),
        };
      })
      .sort((a, b) => b.totalScoreSort - a.totalScoreSort);

    return entries;
  }

  private getTranslations(): TeamStatsTranslations {
    return {
      team: translateText("leaderboard.team"),
      owned: translateText("leaderboard.owned"),
      gold: translateText("leaderboard.gold"),
      maxTroops: translateText("leaderboard.maxtroops"),
      launchers: translateText("leaderboard.launchers"),
      sams: translateText("leaderboard.sams"),
      warships: translateText("leaderboard.warships"),
      cities: translateText("leaderboard.cities"),
      showUnits: translateText("leaderboard.show_units"),
      showControl: translateText("leaderboard.show_control"),
    };
  }

  private async updateTeamStats() {
    const entries = this.getEntries();

    if (!this.isLaunched) {
      await this.launchDioxusComponent(entries);
    } else {
      if (
        !dispatchUiSnapshot({
          type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameTeamStatsEntries,
          scope: "ingame",
          tick: this.game?.ticks(),
          payload: { entries },
        })
      ) {
        console.warn("[DioxusTeamStats] Failed to dispatch runtime snapshot");
      }
    }
  }

  private async launchDioxusComponent(entries: TeamStatsEntry[]) {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();

      await this.updateComplete;

      const translations = this.getTranslations();

      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameTeamStatsLaunch, {
        entries,
        translations,
      });

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusTeamStats] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    if (this.loading) {
      return html`
        <div class="text-white text-xs">Loading team stats...</div>
      `;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-team-stats-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-team-stats": DioxusTeamStats;
  }
}

@customElement("dioxus-game-left-sidebar")
export class DioxusGameLeftSidebar extends LitElement implements Layer {
  public game: GameView;

  private isLeaderboardShow: boolean = false;
  private isTeamLeaderboardShow: boolean = false;
  private isVisible: boolean = false;
  private isPlayerTeamLabelVisible: boolean = false;
  private playerTeam: string | null = null;
  private playerColor: Colord = new Colord("#FFFFFF");
  private _shownOnInit: boolean = false;

  private externalLeaderboard: DioxusLeaderboard | null = null;
  private externalTeamStats: DioxusTeamStats | null = null;
  private runtimeUnsubscribe?: () => void;

  @state()
  private isLaunched: boolean = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    if (this.isTeamGame) {
      this.isPlayerTeamLabelVisible = true;
    }
    if (window.innerWidth >= 1024) {
      this._shownOnInit = true;
    }

    this.externalLeaderboard = document.querySelector(
      "dioxus-leader-board",
    ) as DioxusLeaderboard | null;

    this.externalTeamStats = document.querySelector(
      "dioxus-team-stats",
    ) as DioxusTeamStats | null;

    this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [
        UI_RUNTIME_EVENTS.uiInGameGameLeftSidebarToggleLeaderboard,
        UI_RUNTIME_EVENTS.uiInGameGameLeftSidebarToggleTeam,
      ],
      (event) => {
        if (
          event.type ===
          UI_RUNTIME_EVENTS.uiInGameGameLeftSidebarToggleLeaderboard
        ) {
          this.handleToggleLeaderboard();
          return;
        }
        if (event.type === UI_RUNTIME_EVENTS.uiInGameGameLeftSidebarToggleTeam) {
          this.handleToggleTeam();
        }
      },
    );

    this.launchDioxusComponent();
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  tick() {
    if (!this.playerTeam && this.game.myPlayer()?.team()) {
      this.playerTeam = this.game.myPlayer()!.team();
      if (this.playerTeam) {
        this.playerColor = this.game.config().theme().teamColor(this.playerTeam);
      }
    }

    if (this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = false;
      this.isLeaderboardShow = true;
      this.updateExternalLeaderboardVisibility();
    }

    if (!this.game.inSpawnPhase()) {
      this.isPlayerTeamLabelVisible = false;
    }

    this.updateDioxusState();
  }

  private handleToggleLeaderboard = () => {
    this.isLeaderboardShow = !this.isLeaderboardShow;
    this.updateExternalLeaderboardVisibility();
  };

  private handleToggleTeam = () => {
    this.isTeamLeaderboardShow = !this.isTeamLeaderboardShow;
    this.updateExternalTeamStatsVisibility();
  };

  private updateExternalLeaderboardVisibility(): void {
    if (this.externalLeaderboard) {
      this.externalLeaderboard.visible = this.isLeaderboardShow;
    }
  }

  private updateExternalTeamStatsVisibility(): void {
    if (this.externalTeamStats) {
      this.externalTeamStats.visible =
        this.isTeamLeaderboardShow && this.isTeamGame;
    }
  }

  private get isTeamGame(): boolean {
    return this.game?.config().gameConfig().gameMode === GameMode.Team;
  }

  private getTranslatedPlayerTeamLabel(): string {
    if (!this.playerTeam) return "";
    const translationKey = `team_colors.${this.playerTeam.toLowerCase()}`;
    const translated = translateText(translationKey);
    return translated === translationKey ? this.playerTeam : translated;
  }

  private updateDioxusState(): void {
    if (!this.isLaunched) return;

    const state = {
      isVisible: this.isVisible,
      isLeaderboardShow: this.isLeaderboardShow,
      isTeamLeaderboardShow: this.isTeamLeaderboardShow,
      isTeamGame: this.isTeamGame,
      playerTeamLabelVisible: this.isPlayerTeamLabelVisible,
      yourTeamText: translateText("help_modal.ui_your_team"),
      playerTeamName: this.getTranslatedPlayerTeamLabel(),
      playerTeamColor: this.playerColor.toRgbString(),
      leaderboardRegularIcon: leaderboardRegularIcon,
      leaderboardSolidIcon: leaderboardSolidIcon,
      teamRegularIcon: teamRegularIcon,
      teamSolidIcon: teamSolidIcon,
    };

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameGameLeftSidebar,
        scope: "ingame",
        tick: this.game?.ticks(),
        payload: { state },
      })
    ) {
      console.warn("[DioxusGameLeftSidebar] Failed to dispatch runtime snapshot");
    }
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();

      this.requestUpdate();
      await this.updateComplete;

      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameGameLeftSidebarLaunch,
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));

      this.isLaunched = true;
      this.requestUpdate();

      this.reparentExternalComponents();
    } catch (err) {
      console.error("[DioxusGameLeftSidebar] Failed to launch:", err);
    }
  }

  private reparentExternalComponents(): void {
    const observer = new MutationObserver(() => {
      const leaderboardContainer = document.getElementById(
        "leaderboard-container",
      );
      const teamStatsContainer = document.getElementById("team-stats-container");

      if (leaderboardContainer || teamStatsContainer) {
        if (
          this.externalLeaderboard &&
          leaderboardContainer &&
          this.externalLeaderboard.parentElement !== leaderboardContainer
        ) {
          leaderboardContainer.appendChild(this.externalLeaderboard);
        }
        if (
          this.externalTeamStats &&
          teamStatsContainer &&
          this.externalTeamStats.parentElement !== teamStatsContainer
        ) {
          teamStatsContainer.appendChild(this.externalTeamStats);
        }
        observer.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    const leaderboardContainer = document.getElementById(
      "leaderboard-container",
    );
    const teamStatsContainer = document.getElementById("team-stats-container");
    if (
      this.externalLeaderboard &&
      leaderboardContainer &&
      this.externalLeaderboard.parentElement !== leaderboardContainer
    ) {
      leaderboardContainer.appendChild(this.externalLeaderboard);
    }
    if (
      this.externalTeamStats &&
      teamStatsContainer &&
      this.externalTeamStats.parentElement !== teamStatsContainer
    ) {
      teamStatsContainer.appendChild(this.externalTeamStats);
      observer.disconnect();
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-game-left-sidebar-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-game-left-sidebar": DioxusGameLeftSidebar;
  }
}
