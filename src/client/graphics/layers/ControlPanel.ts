import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameMode, Gold, Team } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { AttackRatioEvent } from "../../InputHandler";
import {
  SendEmbargoIntentEvent,
  SendSetTargetTroopRatioEvent,
  SendStopAllTradesIntentEvent,
} from "../../Transport";
import { renderNumber, renderTroops, translateText } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

type TeamInfo = {
  id: string;
  name: string;
  color: string;
  hasEmbargo: boolean;
  isMyTeam: boolean;
  hasPlayers: boolean;
};

@customElement("control-panel")
export class ControlPanel extends LitElement implements Layer {
  public game: GameView;
  public clientID: ClientID;
  public eventBus: EventBus;
  public uiState: UIState;

  @state()
  private attackRatio: number = 0.2;

  @state()
  private targetTroopRatio = 0.95;

  @state()
  private currentTroopRatio = 0.95;

  @state()
  private _population: number;

  @state()
  private _maxPopulation: number;

  @state()
  private popRate: number;

  @state()
  private _troops: number;

  @state()
  private _workers: number;

  @state()
  private _isVisible = false;

  @state()
  private _manpower: number = 0;

  @state()
  private _gold: Gold;

  @state()
  private _goldPerSecond: Gold;

  @state()
  private _showTeamDropdown = false;

  @state()
  private _allTradesStopped = false;

  private _popRateIsIncreasing: boolean = true;

  private _lastPopulationIncreaseRate: number;

  private init_: boolean = false;

  private _clickOutsideHandler: ((e: Event) => void) | null = null;

  init() {
    this.attackRatio = Number(
      localStorage.getItem("settings.attackRatio") ?? "0.2",
    );
    this.targetTroopRatio = Number(
      localStorage.getItem("settings.troopRatio") ?? "0.95",
    );
    this.init_ = true;
    this.uiState.attackRatio = this.attackRatio;
    this.currentTroopRatio = this.targetTroopRatio;
    this.eventBus.on(AttackRatioEvent, (event) => {
      let newAttackRatio =
        (parseInt(
          (document.getElementById("attack-ratio") as HTMLInputElement).value,
        ) +
          event.attackRatio) /
        100;

      if (newAttackRatio < 0.01) {
        newAttackRatio = 0.01;
      }

      if (newAttackRatio > 1) {
        newAttackRatio = 1;
      }

      if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
        // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep a consistency
        newAttackRatio = 0.1;
      }

      this.attackRatio = newAttackRatio;
      this.onAttackRatioChange(this.attackRatio);
    });

    // Add click-outside handler for dropdown
    this._clickOutsideHandler = (e: Event) => {
      if (
        this._showTeamDropdown &&
        e.target instanceof Node &&
        !this.contains(e.target)
      ) {
        this._showTeamDropdown = false;
        this.requestUpdate();
      }
    };
    document.addEventListener("click", this._clickOutsideHandler);
  }

  tick() {
    if (this.init_) {
      this.eventBus.emit(
        new SendSetTargetTroopRatioEvent(this.targetTroopRatio),
      );
      this.init_ = false;
    }

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    if (this.game.ticks() % 5 === 0) {
      this.updatePopulationIncrease();
    }

    this._population = player.population();
    this._maxPopulation = this.game.config().maxPopulation(player);
    this._gold = player.gold();
    this._troops = player.troops();
    this._workers = player.workers();
    this.popRate = this.game.config().populationIncreaseRate(player) * 10;
    this._goldPerSecond = this.game.config().goldAdditionRate(player) * 10n;

    this.currentTroopRatio = player.troops() / player.population();
    this.requestUpdate();
  }

  private updatePopulationIncrease() {
    const player = this.game?.myPlayer();
    if (player === null) return;
    const popIncreaseRate = this.game.config().populationIncreaseRate(player);
    this._popRateIsIncreasing =
      popIncreaseRate >= this._lastPopulationIncreaseRate;
    this._lastPopulationIncreaseRate = popIncreaseRate;
  }

  onAttackRatioChange(newRatio: number) {
    this.uiState.attackRatio = newRatio;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Render any necessary canvas elements
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  targetTroops(): number {
    return this._manpower * this.targetTroopRatio;
  }

  onTroopChange(newRatio: number) {
    this.eventBus.emit(new SendSetTargetTroopRatioEvent(newRatio));
  }

  delta(): number {
    return this._population - this.targetTroops();
  }

  private get isTeamGame(): boolean {
    return this.game?.config().gameConfig().gameMode === GameMode.Team;
  }

  private getTeams() {
    if (!this.isTeamGame) return [];

    const players = this.game.playerViews();
    const teamMap = new Map<string, TeamInfo>();
    const myPlayer = this.game.myPlayer();
    const myTeam = myPlayer?.team() ?? null;

    for (const player of players) {
      const team = player.team();
      if (team !== null) {
        const teamId = team.toString();
        if (!teamMap.has(teamId)) {
          teamMap.set(
            teamId,
            this.createTeamInfo(team, players, myPlayer, myTeam),
          );
        }
      }
    }

    return Array.from(teamMap.values());
  }

  private createTeamInfo(
    team: Team,
    players: PlayerView[],
    myPlayer: PlayerView | null,
    myTeam: Team | null,
  ): TeamInfo {
    const teamColor = this.game.config().theme().teamColor(team);
    const hasEmbargo = this.checkTeamEmbargo(team, players, myPlayer);
    const hasPlayers = this.checkTeamHasPlayers(team, players, myPlayer);

    return {
      id: team.toString(),
      name: `Team ${team.toString()}`,
      color: teamColor.toHex(),
      hasEmbargo,
      isMyTeam: team === myTeam,
      hasPlayers,
    };
  }

  private checkTeamEmbargo(
    team: Team,
    players: PlayerView[],
    myPlayer: PlayerView | null,
  ): boolean {
    return players.some(
      (p) =>
        p.team() === team &&
        myPlayer &&
        myPlayer.hasEmbargoAgainst(p) &&
        p !== myPlayer,
    );
  }

  private checkTeamHasPlayers(
    team: Team,
    players: PlayerView[],
    myPlayer: PlayerView | null,
  ): boolean {
    return players.some(
      (p) => p.team() === team && p !== myPlayer && p.isAlive(),
    );
  }

  private onStopAllTrades() {
    this.eventBus.emit(new SendStopAllTradesIntentEvent());
    this._allTradesStopped = true;
  }

  private onStartAllTrades() {
    try {
      // Send start trade events for all current trading partners
      const myPlayer = this.game.myPlayer();
      if (!myPlayer) {
        console.warn("Cannot start trades: player not found");
        return;
      }

      const allPlayers = this.game.playerViews();
      for (const player of allPlayers) {
        if (
          player !== myPlayer &&
          player.isAlive() &&
          myPlayer.hasEmbargoAgainst(player)
        ) {
          this.eventBus.emit(new SendEmbargoIntentEvent(player, "stop"));
        }
      }
      this._allTradesStopped = false;
    } catch (error) {
      console.error("Error starting all trades:", error);
    }
  }

  private onToggleTeamTrades(teamId: string, hasEmbargo: boolean) {
    try {
      if (hasEmbargo) {
        // Start trades with this team
        const myPlayer = this.game.myPlayer();
        if (!myPlayer) {
          console.warn("Cannot toggle team trades: player not found");
          return;
        }

        const allPlayers = this.game.playerViews();
        for (const player of allPlayers) {
          if (
            player.team()?.toString() === teamId &&
            player !== myPlayer &&
            myPlayer.hasEmbargoAgainst(player)
          ) {
            this.eventBus.emit(new SendEmbargoIntentEvent(player, "stop"));
          }
        }
      } else {
        // Stop trades with this team
        this.eventBus.emit(new SendStopAllTradesIntentEvent(teamId));
      }
      this._showTeamDropdown = false;
    } catch (error) {
      console.error("Error toggling team trades:", error);
      this._showTeamDropdown = false;
    }
  }

  private toggleTeamDropdown(e: Event) {
    e.stopPropagation();
    this._showTeamDropdown = !this._showTeamDropdown;
  }

  private handleTeamClick(e: Event, teamId: string, hasEmbargo: boolean) {
    e.stopPropagation();
    this.onToggleTeamTrades(teamId, hasEmbargo);
  }

  private renderTeamDropdown() {
    if (!this.isTeamGame || this.getTeams().length === 0) {
      return html``;
    }

    return html`
      <div class="relative">
        <button
          @click=${this.toggleTeamDropdown}
          class="w-full px-3 py-2 text-sm bg-red-700/80 hover:bg-red-700 text-white rounded border border-red-600/50 hover:border-red-500 transition-all duration-200 backdrop-blur font-medium flex items-center justify-between"
          title="${translateText(
            "control_panel.stop_team_trades_dropdown_tooltip",
          )}"
        >
          <span>${translateText("control_panel.stop_team_trades")}</span>
          <span
            class="text-xs transition-transform duration-200 ${this
              ._showTeamDropdown
              ? "rotate-180"
              : ""}"
            >▼</span
          >
        </button>

        <!-- Dropdown Menu -->
        ${this._showTeamDropdown
          ? html`
              <div
                class="absolute bottom-full left-0 right-0 mb-1 bg-gray-800/95 backdrop-blur border border-gray-600/50 rounded shadow-lg z-50 max-h-48 overflow-y-auto"
              >
                ${this.getTeams().map(
                  (team) => html`
                    <button
                      @click=${team.isMyTeam || !team.hasPlayers
                        ? null
                        : (e: Event) =>
                            this.handleTeamClick(e, team.id, team.hasEmbargo)}
                      @mousedown=${(e: Event) => e.preventDefault()}
                      class="w-full px-3 py-2 text-left text-sm transition-colors duration-150 flex items-center space-x-3 ${team.isMyTeam ||
                      !team.hasPlayers
                        ? "text-gray-500 cursor-not-allowed bg-gray-800/50"
                        : "text-white hover:bg-gray-700/80 cursor-pointer"}"
                      title="${team.isMyTeam
                        ? translateText("control_panel.your_team_tooltip", {
                            team: team.name,
                          })
                        : !team.hasPlayers
                          ? translateText("control_panel.no_players_tooltip", {
                              team: team.name,
                            })
                          : team.hasEmbargo
                            ? translateText(
                                "control_panel.start_team_trades_tooltip",
                                { team: team.name },
                              )
                            : translateText(
                                "control_panel.stop_team_trades_tooltip",
                                { team: team.name },
                              )}"
                      ?disabled=${team.isMyTeam || !team.hasPlayers}
                    >
                      <div
                        class="w-3 h-3 rounded-full flex-shrink-0 ${team.isMyTeam ||
                        !team.hasPlayers
                          ? "opacity-50"
                          : ""}"
                        style="background-color: ${team.color};"
                      ></div>
                      <span class="flex-1">${team.name}</span>
                      <span class="text-xs flex items-center space-x-1">
                        ${team.isMyTeam
                          ? html`<span class="text-gray-500"
                              >${translateText(
                                "control_panel.team_status_your_team",
                              )}</span
                            >`
                          : !team.hasPlayers
                            ? html`<span class="text-gray-500"
                                >${translateText(
                                  "control_panel.team_status_no_players",
                                )}</span
                              >`
                            : team.hasEmbargo
                              ? html`<span class="text-red-400"
                                  >${translateText(
                                    "control_panel.team_status_blocked",
                                  )}</span
                                >`
                              : html`<span class="text-green-400"
                                  >${translateText(
                                    "control_panel.team_status_trading",
                                  )}</span
                                >`}
                      </span>
                    </button>
                  `,
                )}
              </div>
            `
          : html``}
      </div>
    `;
  }

  render() {
    return html`
      <style>
        input[type="range"] {
          -webkit-appearance: none;
          background: transparent;
          outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        .targetTroopRatio::-webkit-slider-thumb {
          border-color: rgb(59 130 246);
        }
        .targetTroopRatio::-moz-range-thumb {
          border-color: rgb(59 130 246);
        }
        .attackRatio::-webkit-slider-thumb {
          border-color: rgb(239 68 68);
        }
        .attackRatio::-moz-range-thumb {
          border-color: rgb(239 68 68);
        }
      </style>
      <div
        class="${this._isVisible
          ? "w-full sm:max-w-[320px] text-sm sm:text-base bg-gray-800/70 p-2 pr-3 sm:p-4 shadow-lg sm:rounded-lg backdrop-blur"
          : "hidden"}"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div class="block bg-black/30 text-white mb-4 p-2 rounded">
          <div class="flex justify-between mb-1">
            <span class="font-bold"
              >${translateText("control_panel.pop")}:</span
            >
            <span translate="no"
              >${renderTroops(this._population)} /
              ${renderTroops(this._maxPopulation)}
              <span
                class="${this._popRateIsIncreasing
                  ? "text-green-500"
                  : "text-yellow-500"}"
                translate="no"
                >(+${renderTroops(this.popRate)})</span
              ></span
            >
          </div>
          <div class="flex justify-between">
            <span class="font-bold"
              >${translateText("control_panel.gold")}:</span
            >
            <span translate="no"
              >${renderNumber(this._gold)}
              (+${renderNumber(this._goldPerSecond)})</span
            >
          </div>
        </div>

        <div class="relative mb-4 sm:mb-4">
          <label class="block text-white mb-1" translate="no"
            >${translateText("control_panel.troops")}:
            <span translate="no">${renderTroops(this._troops)}</span> |
            ${translateText("control_panel.workers")}:
            <span translate="no">${renderTroops(this._workers)}</span></label
          >
          <div class="relative h-8">
            <!-- Background track -->
            <div
              class="absolute left-0 right-0 top-3 h-2 bg-white/20 rounded"
            ></div>
            <!-- Fill track -->
            <div
              class="absolute left-0 top-3 h-2 bg-blue-500/60 rounded transition-all duration-300"
              style="width: ${this.currentTroopRatio * 100}%"
            ></div>
            <!-- Range input - exactly overlaying the visual elements -->
            <input
              type="range"
              min="1"
              max="100"
              .value=${(this.targetTroopRatio * 100).toString()}
              @input=${(e: Event) => {
                this.targetTroopRatio =
                  parseInt((e.target as HTMLInputElement).value) / 100;
                this.onTroopChange(this.targetTroopRatio);
              }}
              class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer targetTroopRatio"
            />
          </div>
        </div>

        <div class="relative mb-0 sm:mb-4">
          <label class="block text-white mb-1" translate="no"
            >${translateText("control_panel.attack_ratio")}:
            ${(this.attackRatio * 100).toFixed(0)}%
            (${renderTroops(
              (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
            )})</label
          >
          <div class="relative h-8">
            <!-- Background track -->
            <div
              class="absolute left-0 right-0 top-3 h-2 bg-white/20 rounded"
            ></div>
            <!-- Fill track -->
            <div
              class="absolute left-0 top-3 h-2 bg-red-500/60 rounded transition-all duration-300"
              style="width: ${this.attackRatio * 100}%"
            ></div>
            <!-- Range input - exactly overlaying the visual elements -->
            <input
              id="attack-ratio"
              type="range"
              min="1"
              max="100"
              .value=${(this.attackRatio * 100).toString()}
              @input=${(e: Event) => {
                this.attackRatio =
                  parseInt((e.target as HTMLInputElement).value) / 100;
                this.onAttackRatioChange(this.attackRatio);
              }}
              class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer attackRatio"
            />
          </div>
        </div>

        <div class="mt-3 space-y-2">
          <button
            @click=${this._allTradesStopped
              ? this.onStartAllTrades
              : this.onStopAllTrades}
            class="w-full px-3 py-2 text-sm ${this._allTradesStopped
              ? "bg-green-600/80 hover:bg-green-600 border-green-500/50 hover:border-green-400"
              : "bg-yellow-600/80 hover:bg-yellow-600 border-yellow-500/50 hover:border-yellow-400"} text-white rounded border transition-all duration-200 backdrop-blur font-medium"
            title="${this._allTradesStopped
              ? translateText("control_panel.start_all_trades_tooltip")
              : translateText("control_panel.stop_all_trades_tooltip")}"
          >
            ${this._allTradesStopped
              ? translateText("control_panel.start_all_trades")
              : translateText("control_panel.stop_all_trades")}
          </button>

          ${this.renderTeamDropdown()}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._clickOutsideHandler) {
      document.removeEventListener("click", this._clickOutsideHandler);
      this._clickOutsideHandler = null;
    }
  }
}
