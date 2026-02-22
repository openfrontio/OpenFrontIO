import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { renderTroops, translateText } from "../../../client/Utils";
import { EventBus, GameEvent } from "../../../core/EventBus";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { formatPercentage, renderNumber } from "../../Utils";
import { Layer } from "./Layer";

interface Entry {
  name: string;
  position: number;
  score: string;
  gold: string;
  maxTroops: string;
  isMyPlayer: boolean;
  isOnSameTeam: boolean;
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
  private showTopFive = true;

  @state()
  private _sortKey: "tiles" | "gold" | "maxtroops" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  createRenderRoot() {
    return this; // use light DOM for Tailwind support
  }

  init() {}

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("visible") && this.visible) {
      this.updateLeaderboard();
    }
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    if (this.game === null) throw new Error("Not initialized");
    if (!this.visible) return;
    this.updateLeaderboard();
  }

  private setSort(key: "tiles" | "gold" | "maxtroops") {
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

    const maxTroops = (p: PlayerView) => this.game!.config().maxTroops(p);

    switch (this._sortKey) {
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

    this.players = playersToShow.map((player, index) => {
      const maxTroops = this.game!.config().maxTroops(player);
      return {
        name: player.displayName(),
        position: index + 1,
        score: formatPercentage(
          player.numTilesOwned() / numTilesWithoutFallout,
        ),
        gold: renderNumber(player.gold()),
        maxTroops: renderTroops(maxTroops),
        isMyPlayer: player === myPlayer,
        isOnSameTeam:
          myPlayer !== null &&
          (player === myPlayer || player.isOnSameTeam(myPlayer)),
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

      if (myPlayer.isAlive()) {
        const myPlayerMaxTroops = this.game!.config().maxTroops(myPlayer);
        this.players.pop();
        this.players.push({
          name: myPlayer.displayName(),
          position: place,
          score: formatPercentage(
            myPlayer.numTilesOwned() / this.game.numLandTiles(),
          ),
          gold: renderNumber(myPlayer.gold()),
          maxTroops: renderTroops(myPlayerMaxTroops),
          isMyPlayer: true,
          isOnSameTeam: true,
          player: myPlayer,
        });
      }
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
        class="max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh] mt-2 ${this
          .visible
          ? ""
          : "hidden"}"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="grid bg-gray-800/85 w-full text-xs md:text-xs lg:text-sm rounded-lg overflow-hidden"
          style="grid-template-columns: minmax(24px, 30px) minmax(60px, 100px) minmax(45px, 70px) minmax(40px, 55px) minmax(55px, 105px);"
        >
          <div class="contents font-bold bg-gray-700/60">
            <div class="py-1 md:py-2 text-center border-b border-slate-500">
              #
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 truncate"
            >
              ${translateText("leaderboard.player")}
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
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
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
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
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
              @click=${() => this.setSort("maxtroops")}
            >
              ${translateText("leaderboard.maxtroops")}
              ${this._sortKey === "maxtroops"
                ? this._sortOrder === "asc"
                  ? "⬆️"
                  : "⬇️"
                : ""}
            </div>
          </div>

          ${repeat(
            this.players,
            (p) => p.player.id(),
            (player, index) => html`
              <div
                class="contents hover:bg-slate-600/60 ${player.isOnSameTeam
                  ? "font-bold"
                  : ""} cursor-pointer"
                @click=${() => this.handleRowClickPlayer(player.player)}
              >
                <div
                  class="py-1 md:py-2 text-center ${index <
                  this.players.length - 1
                    ? "border-b border-slate-500"
                    : ""}"
                >
                  ${player.position}
                </div>
                <div
                  class="py-1 md:py-2 text-center ${index <
                  this.players.length - 1
                    ? "border-b border-slate-500"
                    : ""} truncate"
                >
                  ${player.name}
                </div>
                <div
                  class="py-1 md:py-2 text-center ${index <
                  this.players.length - 1
                    ? "border-b border-slate-500"
                    : ""}"
                >
                  ${player.score}
                </div>
                <div
                  class="py-1 md:py-2 text-center ${index <
                  this.players.length - 1
                    ? "border-b border-slate-500"
                    : ""}"
                >
                  ${player.gold}
                </div>
                <div
                  class="py-1 md:py-2 text-center ${index <
                  this.players.length - 1
                    ? "border-b border-slate-500"
                    : ""}"
                >
                  ${player.maxTroops}
                </div>
              </div>
            `,
          )}
        </div>
      </div>

      <button
        class="mt-2 p-0.5 px-1.5 md:px-2 text-xs md:text-xs lg:text-sm 
        border rounded-md border-slate-500 transition-colors
        text-white mx-auto block hover:bg-white/10 bg-gray-700/50"
        @click=${() => {
          this.showTopFive = !this.showTopFive;
          this.updateLeaderboard();
        }}
      >
        ${this.showTopFive ? "+" : "-"}
      </button>
    `;
  }
}
