import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { renderNumber } from "../../Utils";
import { Layer } from "./Layer";

interface Entry {
  name: string;
  position: number;
  score: string;
  gold: string;
  isMyPlayer: boolean;
  player: PlayerView;
}

export class GoToPlayerEvent implements GameEvent {
  constructor(public player: PlayerView) {}
}

@customElement("leader-board")
export class Leaderboard extends LitElement implements Layer {
  public game: GameView;
  public clientID: ClientID;
  public eventBus: EventBus;

  init() {}

  tick() {
    if (!this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = true;
      this.showLeaderboard();
      this.updateLeaderboard();
    }
    if (this._leaderboardHidden) {
      return;
    }

    if (this.game.ticks() % 10 == 0) {
      this.updateLeaderboard();
    }
  }

  private updateLeaderboard() {
    if (this.clientID == null) {
      return;
    }
    const myPlayer = this.game
      .playerViews()
      .find((p) => p.clientID() == this.clientID);

    const sorted = this.game
      .playerViews()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    this.players = sorted.slice(0, 5).map((player, index) => ({
      name: player.displayName(),
      position: index + 1,
      score: formatPercentage(player.numTilesOwned() / numTilesWithoutFallout),
      gold: renderNumber(player.gold()),
      isMyPlayer: player == myPlayer,
      player: player,
    }));

    if (myPlayer != null && this.players.find((p) => p.isMyPlayer) == null) {
      let place = 0;
      for (const p of sorted) {
        place++;
        if (p == myPlayer) {
          break;
        }
      }

      this.players.pop();
      this.players.push({
        name: myPlayer.displayName(),
        position: place,
        score: formatPercentage(
          myPlayer.numTilesOwned() / this.game.numLandTiles(),
        ),
        gold: renderNumber(myPlayer.gold()),
        isMyPlayer: true,
        player: myPlayer,
      });
    }

    this.requestUpdate();
  }

  private handleRowClick(player: PlayerView) {
    this.eventBus.emit(new GoToPlayerEvent(player));
  }

  renderLayer(context: CanvasRenderingContext2D) {}
  shouldTransform(): boolean {
    return false;
  }

  static styles = css`
    :host {
      display: block;
    }
    img.emoji {
      height: 1em;
      width: auto;
    }
    .leaderboard {
      position: fixed;
      top: 10px;
      left: 10px;
      z-index: 9999;
      background-color: rgb(31 41 55 / 0.7);
      padding: 10px;
      padding-top: 0px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      max-width: 300px;
      max-height: 80vh;
      overflow-y: auto;
      width: 300px;
      backdrop-filter: blur(5px);
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
      color: white;
    }
    th {
      background-color: rgb(31 41 55 / 0.5);
      color: white;
    }
    .myPlayer {
      font-weight: bold;
      font-size: 1.2em;
    }
    .otherPlayer {
      font-size: 1em;
    }
    tr:nth-child(even) {
      background-color: rgb(31 41 55 / 0.5);
    }
    tbody tr {
      cursor: pointer;
      transition: background-color 0.2s;
    }
    tbody tr:hover {
      background-color: rgba(78, 78, 78, 0.8);
    }
    .hidden {
      display: none !important;
    }
    .leaderboard-button {
      position: fixed;
      left: 10px;
      top: 10px;
      z-index: 9999;
      background-color: rgb(31 41 55 / 0.7);
      color: white;
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
    }

    .leaderboard-close-button {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
    }

    .player-name {
      max-width: 10ch;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    @media (max-width: 1000px) {
      .leaderboard {
        top: 60px;
      }

      .leaderboard-button {
        left: 0px;
        top: 52px;
      }
    }
  `;

  players: Entry[] = [];

  @state()
  private _leaderboardHidden = true;

  private _shownOnInit = false;

  render() {
    return html`
      <button
        @click=${() => this.toggleLeaderboard()}
        class="leaderboard-button ${this._shownOnInit && this._leaderboardHidden
          ? ""
          : "hidden"}"
      >
        Leaderboard
      </button>
      <div
        class="leaderboard ${this._leaderboardHidden ? "hidden" : ""}"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <button
          class="leaderboard-close-button"
          @click=${() => this.hideLeaderboard()}
        >
          Hide
        </button>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Owned</th>
              <th>Gold</th>
            </tr>
          </thead>
          <tbody>
            ${this.players.map(
              (player) => html`
                <tr
                  class="${player.isMyPlayer ? "myPlayer" : "otherPlayer"}"
                  @click=${() => this.handleRowClick(player.player)}
                >
                  <td>${player.position}</td>
                  <td class="player-name">${unsafeHTML(player.name)}</td>
                  <td>${player.score}</td>
                  <td>${player.gold}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  toggleLeaderboard() {
    this._leaderboardHidden = !this._leaderboardHidden;
    this.requestUpdate();
  }

  hideLeaderboard() {
    this._leaderboardHidden = true;
    this.requestUpdate();
  }

  showLeaderboard() {
    this._leaderboardHidden = false;
    this.requestUpdate();
  }

  get isVisible() {
    return !this._leaderboardHidden;
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
