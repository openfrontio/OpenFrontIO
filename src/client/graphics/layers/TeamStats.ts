import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameMode } from "../../../core/game/Game";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { renderNumber } from "../../Utils";
import { Layer } from "./Layer";

interface TeamEntry {
  teamName: string;
  totalScoreStr: string;
  totalGold: string;
  totalTroops: string;
  players: PlayerView[];
}

@customElement("team-stats")
export class TeamStats extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  teams: TeamEntry[] = [];

  @state()
  private _teamStatsHidden = true;
  private _shownOnInit = false;

  init() {}

  tick() {
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      return;
    }

    if (!this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = true;
      this._teamStatsHidden = false;
      this.updateTeamStats();
    }

    if (this._teamStatsHidden) return;

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
      if (!grouped[team]) grouped[team] = [];
      grouped[team].push(player);
    }

    this.teams = Object.entries(grouped)
      .map(([teamStr, teamPlayers]) => {
        let totalGold = 0n;
        let totalTroops = 0;
        let totalScoreSort = 0;

        for (const p of teamPlayers) {
          totalGold += p.gold();
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

  static styles = css`
    :host {
      display: block;
    }
    .team-stats {
      position: fixed;
      top: 10px;
      left: 450px;
      z-index: 9999;
      background-color: rgb(31 41 55 / 0.7);
      padding: 10px;
      padding-top: 0px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      max-width: 250px;
      max-height: 30vh;
      overflow-y: auto;
      width: 400px;
      backdrop-filter: blur(5px);
    }

    .teamStats-close-button {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 5px;
      text-align: center;
      border-bottom: 1px solid rgba(51, 51, 51, 0.2);
      color: var(--text-color, white);
    }

    th {
      background-color: rgb(31 41 55 / 0.5);
      color: white;
    }

    .hidden {
      display: none !important;
    }

    .team-stats-button {
      position: fixed;
      left: 450px;
      top: 10px;
      z-index: 9999;
      background-color: rgb(31 41 55 / 0.7);
      color: white;
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
    }
  `;

  render() {
    return html`
      <button
        @click=${() => this.toggleTeamStats()}
        class="team-stats-button ${this._shownOnInit && this._teamStatsHidden
          ? ""
          : "hidden"}"
      >
        Team Stats
      </button>
      <div
        class="team-stats ${this._teamStatsHidden ? "hidden" : ""}"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <button
          class="teamStats-close-button"
          @click=${() => this.hideTeamStats()}
        >
          Hide
        </button>
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>Owned</th>
              <th>Gold</th>
              <th>Troops</th>
            </tr>
          </thead>
          <tbody>
            ${this.teams.map(
              (team) => html`
                <tr class="">
                  <td>${team.teamName}</td>
                  <td>${team.totalScoreStr}</td>
                  <td>${team.totalGold}</td>
                  <td>${team.totalTroops}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  toggleTeamStats() {
    this._teamStatsHidden = !this._teamStatsHidden;
  }

  hideTeamStats() {
    this._teamStatsHidden = true;
    this.requestUpdate();
  }

  showTeamStats() {
    this._teamStatsHidden = true;
    this.requestUpdate();
  }

  get isVisible() {
    return !this._teamStatsHidden;
  }
}

function formatPercentage(value: number): string {
  const perc = value * 100;
  if (perc > 99.5) {
    return "100%";
  }
  if (perc < 0.01) {
    return "0%";
  }
  if (perc < 0.1) {
    return perc.toPrecision(1) + "%";
  }
  return perc.toPrecision(2) + "%";
}
