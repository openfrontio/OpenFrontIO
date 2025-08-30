import { EventBus, GameEvent } from "../../../core/EventBus";
import { GameView, PlayerView, UnitView } from "../../../core/game/GameView";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Layer } from "./Layer";
import { renderNumber } from "../../Utils";
import { repeat } from "lit/directives/repeat.js";
import { translateText } from "../../../client/Utils";

type Entry = {
  name: string;
  position: number;
  score: string;
  gold: string;
  troops: string;
  isMyPlayer: boolean;
  player: PlayerView;
};

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
  private _sortKey: "tiles" | "gold" | "troops" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  createRenderRoot() {
    return this; // use light DOM for Tailwind support
  }

  init() {}

  tick() {
    if (this.game === null) throw new Error("Not initialized");
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
        player,
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
        class="max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh]  ${this
          .visible
          ? ""
          : "hidden"}"
        @contextmenu=${(e: Event) => e.preventDefault()}
        style="
          background: rgba(26, 26, 26, 0.9); 
          border: 2px solid rgba(74, 103, 65, 0.3); 
          border-radius: 4px; 
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        "
      >
        <div
          class="grid w-full text-xs md:text-xs lg:text-sm"
          style="
            grid-template-columns: 30px 100px 70px 55px 75px; 
            background: rgba(74, 103, 65, 0.8);
          "
        >
          <div class="contents font-bold">
            <div 
              class="py-1 md:py-2 text-center border-b" 
              style="
                border-color: rgba(74, 103, 65, 0.6); 
                color: #f0f0f0; 
                font-weight: 700; 
                text-transform: uppercase; 
                letter-spacing: 0.5px;
              "
            >
              #
            </div>
            <div 
              class="py-1 md:py-2 text-center border-b" 
              style="
                border-color: rgba(74, 103, 65, 0.6); 
                color: #f0f0f0; 
                font-weight: 700; 
                text-transform: uppercase; 
                letter-spacing: 0.5px;
              "
            >
              ${translateText("leaderboard.player")}
            </div>
            <div
              class="py-1 md:py-2 text-center border-b cursor-pointer whitespace-nowrap"
              style="
                border-color: rgba(74, 103, 65, 0.6); 
                color: #f0f0f0; 
                font-weight: 700; 
                text-transform: uppercase; 
                letter-spacing: 0.5px;
              "
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
              class="py-1 md:py-2 text-center border-b cursor-pointer whitespace-nowrap"
              style="
                border-color: rgba(74, 103, 65, 0.6); 
                color: #f0f0f0; 
                font-weight: 700; 
                text-transform: uppercase; 
                letter-spacing: 0.5px;
              "
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
              class="py-1 md:py-2 text-center border-b cursor-pointer whitespace-nowrap"
              style="
                border-color: rgba(74, 103, 65, 0.6); 
                color: #f0f0f0; 
                font-weight: 700; 
                text-transform: uppercase; 
                letter-spacing: 0.5px;
              "
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
                class="contents cursor-pointer ${player.isMyPlayer
                  ? "font-bold"
                  : ""}"
                style="background: ${player.isMyPlayer ? "rgba(74, 103, 65, 0.3)" : "rgba(42, 42, 42, 0.7)"};"
                @click=${() => this.handleRowClickPlayer(player.player)}
                @mouseenter=${(e: MouseEvent) => {
                  const target = e.currentTarget as HTMLElement;
                  target.style.background = player.isMyPlayer ? "rgba(74, 103, 65, 0.5)" : "rgba(52, 52, 52, 0.8)";
                }}
                @mouseleave=${(e: MouseEvent) => {
                  const target = e.currentTarget as HTMLElement;
                  target.style.background = player.isMyPlayer
                    ? "rgba(74, 103, 65, 0.3)"
                    : "rgba(42, 42, 42, 0.7)";
                }}
              >
                <div 
                  class="py-1 md:py-2 text-center border-b"
                  style="border-color: rgba(74, 103, 65, 0.6); color: #f0f0f0; font-weight: 600;"
                >
                  ${player.position}
                </div>
                <div
                  class="py-1 md:py-2 text-center border-b truncate"
                  style="border-color: rgba(74, 103, 65, 0.6); color: #e6e6e6; font-weight: 500;"
                >
                  ${player.name}
                </div>
                <div 
                  class="py-1 md:py-2 text-center border-b"
                  style="border-color: rgba(74, 103, 65, 0.6); color: #e6e6e6; font-weight: 600;"
                >
                  ${player.score}
                </div>
                <div 
                  class="py-1 md:py-2 text-center border-b"
                  style="border-color: rgba(74, 103, 65, 0.6); color: #e6e6e6; font-weight: 600;"
                >
                  ${player.gold}
                </div>
                <div 
                  class="py-1 md:py-2 text-center border-b"
                  style="border-color: rgba(74, 103, 65, 0.6); color: #e6e6e6; font-weight: 600;"
                >
                  ${player.troops}
                </div>
              </div>
            `,
          )}
        </div>
      </div>

      <button
        class="mt-1 px-1.5 py-0.5 md:px-2 md:py-0.5 text-xs md:text-xs lg:text-sm mx-auto block"
        style="
          border: 1px solid rgba(74, 103, 65, 0.6); 
          background: rgba(74, 103, 65, 0.2); 
          color: #f0f0f0; 
          text-transform: uppercase; 
          letter-spacing: 0.5px; 
          font-weight: 600; 
          transition: all 0.2s ease;
        "
        @mouseenter=${(e: MouseEvent) => {
          const target = e.currentTarget as HTMLElement;
          target.style.background = "rgba(74, 103, 65, 0.4)";
          target.style.borderColor = "rgba(74, 103, 65, 0.8)";
        }}
        @mouseleave=${(e: MouseEvent) => {
          const target = e.currentTarget as HTMLElement;
          target.style.background = "rgba(74, 103, 65, 0.2)";
          target.style.borderColor = "rgba(74, 103, 65, 0.6)";
        }}
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

function formatPercentage(value: number): string {
  const perc = value * 100;
  if (Number.isNaN(perc)) return "0%";
  return perc.toFixed(1) + "%";
}
