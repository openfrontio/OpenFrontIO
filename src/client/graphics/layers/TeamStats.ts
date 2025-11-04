import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameMode } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { renderNumber, translateText } from "../../Utils";
import { Layer } from "./Layer";

interface TeamEntry {
  teamName: string;
  totalScoreStr: string;
  totalGold: string;
  totalTroops: string;
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
    const grouped: Record<number, PlayerView[]> = {};

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

        for (const p of teamPlayers) {
          if (p.isAlive()) {
            totalTroops += p.troops();
            totalGold += p.gold();
            totalScoreSort += p.numTilesOwned();
          }
        }

        const totalScorePercent = totalScoreSort / this.game.numLandTiles();

        return {
          teamName: teamStr,
          totalScoreStr: formatPercentage(totalScorePercent),
          totalScoreSort,
          totalGold: renderNumber(totalGold),
          totalTroops: renderNumber(totalTroops / 10),
          players: teamPlayers,
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
    if (!this.visible) {
      return html``;
    }
    return html`
      <div
        class="max-h-[30vh] overflow-y-auto grid bg-slate-800/70 w-full text-white text-xs md:text-sm ${this
          .visible
          ? ""
          : "hidden"}"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div
          class="grid w-full"
          style="grid-template-columns: 1fr 1fr 1fr 1fr;"
        >
          <!-- Header row -->
          <div class="contents font-bold bg-slate-700/50">
            <div
              class="py-1.5 md:py-2.5 text-center border-b border-slate-500 cursor-pointer"
            >
              ${translateText("leaderboard.team")}
            </div>
            <div
              class="py-1.5 md:py-2.5 text-center border-b border-slate-500 cursor-pointer"
            >
              ${translateText("leaderboard.owned")}
            </div>
            <div
              class="py-1.5 md:py-2.5 text-center border-b border-slate-500 cursor-pointer"
            >
              ${translateText("leaderboard.gold")}
            </div>
            <div
              class="py-1.5 md:py-2.5 text-center border-b border-slate-500 cursor-pointer"
            >
              ${translateText("leaderboard.troops")}
            </div>
          </div>
          ${this.teams.map(
            (team) => html`
              <div
                class="contents hover:bg-slate-600/60 text-center cursor-pointer"
              >
                <div
                  class="py-1.5 md:py-2.5 text-center border-b border-slate-500"
                >
                  ${team.teamName}
                </div>
                <div
                  class="py-1.5 md:py-2.5 text-center border-b border-slate-500"
                >
                  ${team.totalScoreStr}
                </div>
                <div
                  class="py-1.5 md:py-2.5 text-center border-b border-slate-500"
                >
                  ${team.totalGold}
                </div>
                <div
                  class="py-1.5 md:py-2.5 text-center border-b border-slate-500"
                >
                  ${team.totalTroops}
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }
}

function formatPercentage(value: number): string {
  const perc = value * 100;
  if (perc > 99.5) return "100%";
  if (perc < 0.01) return "0%";
  if (perc < 0.1) return perc.toPrecision(1) + "%";
  return perc.toPrecision(2) + "%";
}
