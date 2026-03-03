import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameMode, Team, UnitType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { GoToPlayerEvent } from "./Leaderboard";
import {
  formatPercentage,
  renderNumber,
  renderTroops,
  translateText,
} from "../../Utils";
import { Layer } from "./Layer";

interface TeamEntry {
  teamName: string;
  isMyTeam: boolean;
  totalScoreStr: string;
  totalGold: string;
  totalMaxTroops: string;
  totalSAMs: string;
  totalLaunchers: string;
  totalWarShips: string;
  totalCities: string;
  totalScoreSort: number;
  players: PlayerView[];
}

@customElement("team-stats")
export class TeamStats extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @property({ type: Boolean }) visible = false;
  teams: TeamEntry[] = [];
  private _shownOnInit = false;
  private showUnits = false;
  private _myTeam: Team | null = null;

  @state()
  @state()
  private _sortKey: "tiles" | "gold" | "maxtroops" | "launchers" | "sams" | "warships" | "cities" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  createRenderRoot() {
    return this; // use light DOM for Tailwind
  }

  init() {}

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) return;

    if (!this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = true;
      this.updateTeamStats();
    }

    if (!this.visible) return;

    this.updateTeamStats();
  }

  private setSort(key: "tiles" | "gold" | "maxtroops" | "launchers" | "sams" | "warships" | "cities") {
    if (this._sortKey === key) {
      this._sortOrder = this._sortOrder === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortOrder = "desc";
    }
    this.updateTeamStats();
  }

  private updateTeamStats() {
    const players = this.game.playerViews();
    const grouped: Record<Team, PlayerView[]> = {};

    if (this._myTeam === null) {
      const myPlayer = this.game.myPlayer();
      this._myTeam = myPlayer?.team() ?? null;
    }

    for (const player of players) {
      const rawTeam = player.team();
      if (rawTeam === null) continue;
      grouped[rawTeam] ??= [];
      grouped[rawTeam].push(player);
    }

    this.teams = Object.entries(grouped)
      .map(([rawTeam, teamPlayers]) => {
        const key = `team_colors.${rawTeam.toLowerCase()}`;
        const translated = translateText(key);
        const teamName = translated !== key ? translated : rawTeam;

        let totalGold = 0n;
        let totalMaxTroops = 0;
        let totalScoreSort = 0;
        let totalSAMs = 0;
        let totalLaunchers = 0;
        let totalWarShips = 0;
        let totalCities = 0;

        for (const p of teamPlayers) {
          if (p.isAlive()) {
            totalMaxTroops += this.game.config().maxTroops(p);
            totalGold += p.gold();
            totalScoreSort += p.numTilesOwned();
            totalLaunchers += p.totalUnitLevels(UnitType.MissileSilo);
            totalSAMs += p.totalUnitLevels(UnitType.SAMLauncher);
            totalWarShips += p.totalUnitLevels(UnitType.Warship);
            totalCities += p.totalUnitLevels(UnitType.City);
          }
        }

        const numTilesWithoutFallout =
          this.game.numLandTiles() - this.game.numTilesWithFallout();
        const totalScorePercent = totalScoreSort / numTilesWithoutFallout;

        return {
          teamName,
          isMyTeam: rawTeam === this._myTeam,
          totalScoreStr: formatPercentage(totalScorePercent),
          totalScoreSort,
          totalGold: renderNumber(totalGold),
          totalMaxTroops: renderTroops(totalMaxTroops),
          players: teamPlayers,

          totalLaunchers: renderNumber(totalLaunchers),
          totalSAMs: renderNumber(totalSAMs),
          totalWarShips: renderNumber(totalWarShips),
          totalCities: renderNumber(totalCities),
        };
      })
      .sort((a, b) => {
        const compare = (v1: number, v2: number) =>
          this._sortOrder === "asc" ? v1 - v2 : v2 - v1;

        switch (this._sortKey) {
          case "gold":
            return compare(parseFloat(a.totalGold.replace(/,/g, "")), parseFloat(b.totalGold.replace(/,/g, "")));
          case "maxtroops":
            return compare(parseFloat(a.totalMaxTroops.replace(/,/g, "")), parseFloat(b.totalMaxTroops.replace(/,/g, "")));
          case "launchers":
            return compare(parseFloat(a.totalLaunchers.replace(/,/g, "")), parseFloat(b.totalLaunchers.replace(/,/g, "")));
          case "sams":
            return compare(parseFloat(a.totalSAMs.replace(/,/g, "")), parseFloat(b.totalSAMs.replace(/,/g, "")));
          case "warships":
            return compare(parseFloat(a.totalWarShips.replace(/,/g, "")), parseFloat(b.totalWarShips.replace(/,/g, "")));
          case "cities":
            return compare(parseFloat(a.totalCities.replace(/,/g, "")), parseFloat(b.totalCities.replace(/,/g, "")));
          default:
            return compare(a.totalScoreSort, b.totalScoreSort);
        }
      });

    this.requestUpdate();
  }

  private handleTeamClick(team: TeamEntry) {
    if (this.eventBus === null || team.players.length === 0) return;

    // Identify the player with the most tiles
    const strongestPlayer = [...team.players]
      .filter((p) => p.isAlive())
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];

    if (strongestPlayer) {
      this.eventBus.emit(new GoToPlayerEvent(strongestPlayer));
    }
  }
  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div
        class="max-h-[30vh] overflow-x-hidden overflow-y-auto grid bg-slate-800/85 w-full text-white text-xs md:text-sm mt-2 rounded-lg"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="grid w-full"
          style="grid-template-columns: ${this.showUnits 
            ? "minmax(50px, 70px) minmax(60px, 120px) minmax(60px, 80px) minmax(60px, 110px) minmax(60px, 90px)" 
            : "minmax(50px, 70px) minmax(60px, 100px) minmax(60px, 100px) minmax(60px, 120px)"};"
        >
          <!-- Header -->
          <div class="contents font-bold bg-slate-700/60">
            <div class="p-1.5 md:p-2.5 text-center border-b border-slate-500">
              ${translateText("leaderboard.team")}
            </div>
            ${this.showUnits
              ? html`
                  <div
                    class="p-1.5 md:p-2.5 text-center border-b border-slate-500"
                    @click=${() => this.setSort("launchers")}
                  >
                    ${translateText("leaderboard.launchers")}
                    ${this._sortKey === "launchers"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>
                  <div
                    class="p-1.5 md:p-2.5 text-center border-b border-slate-500"
                    @click=${() => this.setSort("sams")}
                  >
                    ${translateText("leaderboard.sams")}
                    ${this._sortKey === "sams"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>
                  <div
                    class="p-1.5 md:p-2.5 text-center border-b border-slate-500"
                    @click=${() => this.setSort("warships")}
                  >
                    ${translateText("leaderboard.warships")}
                    ${this._sortKey === "warships"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>
                  <div
                    class="p-1.5 md:p-2.5 text-center border-b border-slate-500"
                  @click=${() => this.setSort("cities")}
                  >
                    ${translateText("leaderboard.cities")}
                    ${this._sortKey === "cities"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>
                `
              : html`
                  <div
                    class="p-1.5 md:p-2.5 text-center border-b border-slate-500"
                    @click=${() => this.setSort("tiles")}
                  >
                    ${translateText("leaderboard.owned")}
                    ${this._sortKey === "tiles"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>
                  <div
                    class="p-1.5 md:p-2.5 text-center border-b border-slate-500"
                    @click=${() => this.setSort("gold")}
                  >
                    ${translateText("leaderboard.gold")}
                    ${this._sortKey === "gold"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>
                  <div
                    class="p-1.5 md:p-2.5 text-center border-b border-slate-500"
                    @click=${() => this.setSort("maxtroops")}
                  >
                    ${translateText("leaderboard.maxtroops")}
                    ${this._sortKey === "maxtroops"
                      ? this._sortOrder === "asc"
                        ? "⬆️"
                        : "⬇️"
                      : ""}
                  </div>
                `}
          </div>

          <!-- Data rows -->
          ${this.teams.map((team) =>
            this.showUnits
              ? html`
                  <div
                    class="contents hover:bg-slate-600/60 text-center cursor-pointer ${team.isMyTeam
                      ? "font-bold"
                      : ""}"
                    @click=${() => this.handleTeamClick(team)}
                  >
                    <div class="py-1.5 border-b border-slate-500">
                      ${team.teamName}
                    </div>
                    <div class="py-1.5 border-b border-slate-500">
                      ${team.totalLaunchers}
                    </div>
                    <div class="py-1.5 border-b border-slate-500">
                      ${team.totalSAMs}
                    </div>
                    <div class="py-1.5 border-b border-slate-500">
                      ${team.totalWarShips}
                    </div>
                    <div class="py-1.5 border-b border-slate-500">
                      ${team.totalCities}
                    </div>
                  </div>
                `
              : html`
                  <div
                    class="contents hover:bg-slate-600/60 text-center cursor-pointer ${team.isMyTeam
                      ? "font-bold"
                      : ""}"
                    @click=${() => this.handleTeamClick(team)}
                  >
                    <div class="py-1.5 border-b border-slate-500">
                      ${team.teamName}
                    </div>
                    <div class="py-1.5 border-b border-slate-500">
                      ${team.totalScoreStr}
                    </div>
                    <div class="py-1.5 border-b border-slate-500">
                      ${team.totalGold}
                    </div>
                    <div class="py-1.5 border-b border-slate-500">
                      ${team.totalMaxTroops}
                    </div>
                  </div>
                `,
          )}
        </div>
        <button
          class="team-stats-button"
          aria-pressed=${String(this.showUnits)}
          @click=${() => {
            this.showUnits = !this.showUnits;
            this.requestUpdate();
          }}
        >
          ${this.showUnits
            ? translateText("leaderboard.show_control")
            : translateText("leaderboard.show_units")}
        </button>
      </div>
    `;
  }
}
