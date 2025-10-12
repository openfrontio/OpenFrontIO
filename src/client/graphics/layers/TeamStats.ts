import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameMode, Team, UnitType } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { renderNumber, translateText } from "../../Utils";
import { Layer } from "./Layer";

interface TeamEntry {
  teamName: string;
  totalScoreStr: string;
  totalGold: string;
  totalTroops: string;
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

  createRenderRoot() {
    return this; // use light DOM for Tailwind
  }

  init() {}

  tick() {
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) return;

    if (!this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = true;
      this.updateTeamStats();
    }

    if (!this.visible) return;

    if (this.game.ticks() % 10 === 0) {
      this.updateTeamStats();
    }
  }

  private updateTeamStats() {
    const players = this.game.playerViews();
    const grouped: Record<Team, PlayerView[]> = {};

    for (const player of players) {
      const team = player.team();
      if (team === null) continue;
      grouped[team] ??= [];
      grouped[team].push(player);
    }

    this.teams = Object.entries(grouped)
      .map(([teamStr, teamPlayers]) => {
        let totalGold = 0n;
        let totalTroops = 0;
        let totalScoreSort = 0;
        let totalSAMs = 0;
        let totalLaunchers = 0;
        let totalWarShips = 0;
        let totalCities = 0;

        for (const p of teamPlayers) {
          if (p.isAlive()) {
            totalTroops += p.troops();
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
          teamName: teamStr,
          totalScoreStr: formatPercentage(totalScorePercent),
          totalScoreSort,
          totalGold: renderNumber(totalGold),
          totalTroops: renderNumber(totalTroops / 10),
          players: teamPlayers,

          totalLaunchers: renderNumber(totalLaunchers),
          totalSAMs: renderNumber(totalSAMs),
          totalWarShips: renderNumber(totalWarShips),
          totalCities: renderNumber(totalCities),
        };
      })
      .sort((a, b) => b.totalScoreSort - a.totalScoreSort);

    this.requestUpdate();
  }

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div
        class="max-h-[30vh] overflow-y-auto grid bg-slate-800/70 w-full text-white text-xs md:text-sm"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="grid w-full"
          style="grid-template-columns: repeat(${this.showUnits ? 5 : 4}, 1fr);"
        >
          <!-- Header -->
          <div class="contents font-bold bg-slate-700/50">
            <div class="py-1.5 md:py-2.5 text-center border-b border-slate-500">
              ${translateText("leaderboard.team")}
            </div>
            ${this.showUnits
              ? html`
                  <div class="py-1.5 text-center border-b border-slate-500">
                    ${translateText("leaderboard.launchers")}
                  </div>
                  <div class="py-1.5 text-center border-b border-slate-500">
                    ${translateText("leaderboard.sams")}
                  </div>
                  <div class="py-1.5 text-center border-b border-slate-500">
                    ${translateText("leaderboard.warships")}
                  </div>
                  <div class="py-1.5 text-center border-b border-slate-500">
                    ${translateText("leaderboard.cities")}
                  </div>
                `
              : html`
                  <div class="py-1.5 text-center border-b border-slate-500">
                    ${translateText("leaderboard.owned")}
                  </div>
                  <div class="py-1.5 text-center border-b border-slate-500">
                    ${translateText("leaderboard.gold")}
                  </div>
                  <div class="py-1.5 text-center border-b border-slate-500">
                    ${translateText("leaderboard.troops")}
                  </div>
                `}
          </div>

          <!-- Data rows -->
          ${this.teams.map((team) =>
            this.showUnits
              ? html`
                  <div
                    class="contents hover:bg-slate-600/60 text-center cursor-pointer"
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
                    class="contents hover:bg-slate-600/60 text-center cursor-pointer"
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
                      ${team.totalTroops}
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

function formatPercentage(value: number): string {
  const perc = value * 100;
  if (Number.isNaN(perc)) return "0%";
  return perc.toPrecision(2) + "%";
}
