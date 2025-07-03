import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
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

  @property({ type: Boolean }) visible = false;
  private _shownOnInit = false;
  private showTopFive = true;

  @state()
  private _sortKey: "tiles" | "gold" | "troops" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  createRenderRoot() {
    return this; // use light DOM for Tailwind support
  }

  init() {}

  tick() {
    if (this.game === null) throw new Error("Not initialized");
    if (!this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = true;
      this.updateLeaderboard();
    }
    if (!this.visible) return;
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

  render() {
    if (!this.visible) {
      return html``;
    }
    return html`
      <div
        class="max-h-[35vh] overflow-y-auto text-white text-xs md:text-sm md:max-h-[50vh]  ${this
          .visible
          ? ""
          : "hidden"}"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <button
          class="mb-2 px-2 py-1 md:px-2.5 md:py-1.5 text-xs md:text-sm lg:text-base border border-white/20 hover:bg-white/10"
          @click=${() => {
            this.showTopFive = !this.showTopFive;
            this.updateLeaderboard();
          }}
        >
          ${this.showTopFive
            ? translateText("leaderboard.show_all")
            : translateText("leaderboard.show_top_5")}
        </button>

        <div
          class="grid bg-slate-800/70 w-full text-xs md:text-sm lg:text-base"
          style="grid-template-columns: 35px 100px 85px 65px 65px;"
        >
          <div class="contents font-bold bg-slate-700/50">
            <div class="py-1.5 md:py-2.5 text-center border-b border-slate-500">
              #
            </div>
            <div class="py-1.5 md:py-2.5 text-center border-b border-slate-500">
              ${translateText("leaderboard.player")}
            </div>
            <div
              class="py-1.5 md:py-2.5 text-center border-b border-slate-500 cursor-pointer"
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
              class="py-1.5 md:py-2.5 text-center border-b border-slate-500 cursor-pointer"
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
              class="py-1.5 md:py-2.5 text-center border-b border-slate-500 cursor-pointer"
              @click=${() => this.setSort("troops")}
            >
              ${translateText("leaderboard.troops")}
              ${this._sortKey === "troops"
                ? this._sortOrder === "asc"
                  ? "⬆️"
                  : "⬇️"
                : ""}
            </div>
          </div>

          ${repeat(
            this.players,
            (p) => p.player.id(),
            (player) => html`
              <div
                class="contents hover:bg-slate-600/60 ${player.isMyPlayer
                  ? "font-bold"
                  : ""} cursor-pointer"
                @click=${() => this.handleRowClickPlayer(player.player)}
              >
                <div
                  class="py-1.5 md:py-2.5 text-center border-b border-slate-500"
                >
                  ${player.position}
                </div>
                <div
                  class="py-1.5 md:py-2.5 text-center border-b border-slate-500 truncate"
                >
                  ${player.name}
                </div>
                <div
                  class="py-1.5 md:py-2.5 text-center border-b border-slate-500"
                >
                  ${player.score}
                </div>
                <div
                  class="py-1.5 md:py-2.5 text-center border-b border-slate-500"
                >
                  ${player.gold}
                </div>
                <div
                  class="py-1.5 md:py-2.5 text-center border-b border-slate-500"
                >
                  ${player.troops}
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
  if (Number.isNaN(perc)) return "0%";
  return perc.toPrecision(2) + "%";
}
