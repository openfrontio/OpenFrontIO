import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { renderNumber } from "../../Utils";
import { Layer } from "./Layer";

interface Entry {
  name: string;
  position: number;
  score: string;
  gold: string;
  troops: string;
  isMyPlayer: boolean;
  player: PlayerView;
}

export class GoToPlayerEvent implements GameEvent {
  constructor(public player: PlayerView) {}
}

export class GoToPositionEvent implements GameEvent {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export class GoToUnitEvent implements GameEvent {
  constructor(public unit: UnitView) {}
}

@customElement("leader-board")
export class Leaderboard extends LitElement implements Layer {
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;

  players: Entry[] = [];

  @state()
  private _leaderboardHidden = true;
  private _shownOnInit = false;
  private showTopFive = true;

  @state()
  private _sortKey: "tiles" | "gold" | "troops" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  init() {}

  tick() {
    if (this.game === null) throw new Error("Not initialized");
    if (!this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = true;
      this.showLeaderboard();
      this.updateLeaderboard();
    }
    if (this._leaderboardHidden) {
      return;
    }

    if (this.game.ticks() % 10 === 0) {
      this.updateLeaderboard();
    }
  }

  private setSort(key: "tiles" | "gold" | "troops") {
    if (this._sortKey === key) {
      this._sortOrder = this._sortOrder === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortOrder = "desc";
    }
    this.updateLeaderboard();
  }

  private updateLeaderboard() {
    if (this.game === null) throw new Error("Not initialized");
    const myPlayer = this.game.myPlayer();

    let sorted = this.game.playerViews();

    const compare = (a: number, b: number) =>
      this._sortOrder === "asc" ? a - b : b - a;

    switch (this._sortKey) {
      case "gold":
        sorted = sorted.sort((a, b) =>
          compare(Number(a.gold()), Number(b.gold())),
        );
        break;
      case "troops":
        sorted = sorted.sort((a, b) => compare(a.troops(), b.troops()));
        break;
      default:
        sorted = sorted.sort((a, b) =>
          compare(a.numTilesOwned(), b.numTilesOwned()),
        );
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    const playersToShow = this.showTopFive ? sorted.slice(0, 5) : sorted;

    this.players = playersToShow.map((player, index) => {
      let troops = player.troops() / 10;
      if (!player.isAlive()) {
        troops = 0;
      }
      return {
        name: player.displayName(),
        position: index + 1,
        score: formatPercentage(
          player.numTilesOwned() / numTilesWithoutFallout,
        ),
        gold: renderNumber(player.gold()),
        troops: renderNumber(troops),
        isMyPlayer: player === myPlayer,
        player: player,
      };
    });

    if (
      myPlayer !== null &&
      this.players.find((p) => p.isMyPlayer) === undefined
    ) {
      let place = 0;
      for (const p of sorted) {
        place++;
        if (p === myPlayer) {
          break;
        }
      }

      let myPlayerTroops = myPlayer.troops() / 10;
      if (!myPlayer.isAlive()) {
        myPlayerTroops = 0;
      }
      this.players.pop();
      this.players.push({
        name: myPlayer.displayName(),
        position: place,
        score: formatPercentage(
          myPlayer.numTilesOwned() / this.game.numLandTiles(),
        ),
        gold: renderNumber(myPlayer.gold()),
        troops: renderNumber(myPlayerTroops),
        isMyPlayer: true,
        player: myPlayer,
      });
    }

    this.requestUpdate();
  }

  private handleRowClickPlayer(player: PlayerView) {
    if (this.eventBus === null) return;
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
      top: 70px;
      left: 10px;
      z-index: 9998;
      background-color: rgb(31 41 55 / 0.7);
      padding: 0 10px 10px;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      max-width: 500px;
      max-height: 30vh;
      overflow-y: auto;
      backdrop-filter: blur(5px);
    }

    .hidden {
      display: none !important;
    }
    .leaderboard__grid {
      display: grid;
      grid-template-columns: 40px 100px 85px 65px 65px;
      width: 100%;
      font-size: 14px;
    }

    .leaderboard__button {
      position: fixed;
      left: 10px;
      top: 70px;
      z-index: 9998;
      background-color: rgb(31 41 55 / 0.7);
      color: white;
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
    }

    .leaderboard__actionButton {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
    }

    .leaderboard__row {
      display: contents;

      > div {
        display: flex;
        justify-content: center;
        text-align: center;
        align-items: center;
        padding: 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
      }

      &:hover {
        > div {
          background-color: rgba(78, 78, 78, 0.8);
        }
      }
    }
    .leaderboard__row--header {
      > div {
        background-color: rgb(31 41 55 / 0.5);
        font-weight: bold;
        color: white;
      }
    }

    .myPlayer > div {
      font-weight: bold;
    }

    .player-name {
      max-width: 10ch;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    @media (min-width: 980px) {
      .player-name {
        max-width: 14ch;
      }
      .leaderboard {
        top: 10px;
        left: 10px;
      }

      .leaderboard__button {
        left: 10px;
        top: 10px;
      }
    }
    @media (min-width: 1336px) {
      .leaderboard__grid {
        grid-template-columns: 60px 120px 105px 85px 85px;
        font-size: 16px;
      }
    }
  `;

  render() {
    return html`
      <button
        @click=${() => this.toggleLeaderboard()}
        class="leaderboard__button ${this._shownOnInit &&
        this._leaderboardHidden
          ? ""
          : "hidden"}"
      >
        ${translateText("leaderboard.title")}
      </button>
      <div
        class="leaderboard ${this._leaderboardHidden ? "hidden" : ""}"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <button
          class="leaderboard__actionButton"
          @click=${() => this.hideLeaderboard()}
        >
          ${translateText("leaderboard.hide")}
        </button>
        <button
          class="leaderboard__actionButton"
          @click=${() => {
            this.showTopFive = !this.showTopFive;
            this.updateLeaderboard();
          }}
        >
          ${this.showTopFive ? "Show All" : "Show Top 5"}
        </button>
        <div class="leaderboard__grid">
          <div class="leaderboard__row leaderboard__row--header">
            <div>#</div>
            <div>${translateText("leaderboard.player")}</div>
            <div @click=${() => this.setSort("tiles")}>
              ${translateText("leaderboard.owned")}
              ${this._sortKey === "tiles"
                ? this._sortOrder === "asc"
                  ? "⬆️"
                  : "⬇️"
                : ""}
            </div>
            <div @click=${() => this.setSort("gold")}>
              ${translateText("leaderboard.gold")}
              ${this._sortKey === "gold"
                ? this._sortOrder === "asc"
                  ? "⬆️"
                  : "⬇️"
                : ""}
            </div>
            <div @click=${() => this.setSort("troops")}>
              ${translateText("leaderboard.troops")}
              ${this._sortKey === "troops"
                ? this._sortOrder === "asc"
                  ? "⬆️"
                  : "⬇️"
                : ""}
            </div>
          </div>
          ${this.players.map(
            (player) => html`
              <div
                class="leaderboard__row ${player.isMyPlayer
                  ? "myPlayer"
                  : "otherPlayer"}"
                @click=${() => this.handleRowClickPlayer(player.player)}
              >
                <div>${player.position}</div>
                <div class="player-name">${player.name}</div>
                <div>${player.score}</div>
                <div>${player.gold}</div>
                <div>${player.troops}</div>
              </div>
            `,
          )}
        </div>
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
