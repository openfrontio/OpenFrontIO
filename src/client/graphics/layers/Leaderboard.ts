import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { translateText } from "../../../client/Utils";
import { getServerConfigFromClient } from "../../../core/configuration/ConfigLoader";
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
  private _sortKey: "tiles" | "gold" | "troops" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  @state()
  private spectatorCount: number = 0;

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
    // Update spectator count every 5 seconds (300 ticks)
    if (this.game.ticks() % 300 === 0) {
      this.updateSpectatorCount();
    }
  }

  private async updateSpectatorCount() {
    if (this.game === null) return;
    // TODO(evapelle): Use intent system instead of polling.
    // When a spectator joins, emit a "SpectatorJoined" intent which updates
    // the `Game` object via an execution (e.g., `game.addSpectator(...)`).
    // Likewise, when a player dies they should become a spectator.
    // Then add a `GameDataUpdate` so data is transferred from `Game` => `GameView`,
    // removing the need for this client-side fetch.
    try {
      const gameID = this.game.gameID();
      const config = await getServerConfigFromClient();
      const response = await fetch(
        `/${config.workerPath(gameID)}/api/game/${gameID}`,
      );
      if (response.ok) {
        const data = await response.json();
        this.spectatorCount = data.spectators?.length ?? 0;
      }
    } catch (error) {
      // Silently fail - spectator count is not critical
      console.debug("Failed to fetch spectator count:", error);
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

    const alivePlayers = sorted.filter((player) => player.isAlive());
    const playersToShow = this.showTopFive
      ? alivePlayers.slice(0, 5)
      : alivePlayers;

    this.players = playersToShow.map((player, index) => {
      const troops = player.troops() / 10;
      return {
        name: player.displayName(),
        position: index + 1,
        score: formatPercentage(
          player.numTilesOwned() / numTilesWithoutFallout,
        ),
        gold: renderNumber(player.gold()),
        troops: renderNumber(troops),
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
        const myPlayerTroops = myPlayer.troops() / 10;
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
      ${this.spectatorCount > 0
        ? html`
            <div
              class="mb-1 px-2 py-1 bg-gray-800/70 text-white text-xs md:text-sm text-center border-b border-slate-500"
            >
              👁️ ${this.spectatorCount}
              ${this.spectatorCount === 1
                ? translateText("leaderboard.spectator")
                : translateText("leaderboard.spectators")}
            </div>
          `
        : null}
      <div
        class="max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh]  ${this
          .visible
          ? ""
          : "hidden"}"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class="grid bg-gray-800/70 w-full text-xs md:text-xs lg:text-sm"
          style="grid-template-columns: 30px 100px 70px 55px 75px;"
        >
          <div class="contents font-bold bg-gray-700/50">
            <div class="py-1 md:py-2 text-center border-b border-slate-500">
              #
            </div>
            <div class="py-1 md:py-2 text-center border-b border-slate-500">
              ${translateText("leaderboard.player")}
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap"
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
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap"
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
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap"
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
                class="contents hover:bg-slate-600/60 ${player.isOnSameTeam
                  ? "font-bold"
                  : ""} cursor-pointer"
                @click=${() => this.handleRowClickPlayer(player.player)}
              >
                <div class="py-1 md:py-2 text-center border-b border-slate-500">
                  ${player.position}
                </div>
                <div
                  class="py-1 md:py-2 text-center border-b border-slate-500 truncate"
                >
                  ${player.name}
                </div>
                <div class="py-1 md:py-2 text-center border-b border-slate-500">
                  ${player.score}
                </div>
                <div class="py-1 md:py-2 text-center border-b border-slate-500">
                  ${player.gold}
                </div>
                <div class="py-1 md:py-2 text-center border-b border-slate-500">
                  ${player.troops}
                </div>
              </div>
            `,
          )}
        </div>
      </div>

      <button
        class="mt-1 px-1.5 py-0.5 md:px-2 md:py-0.5 text-xs md:text-xs lg:text-sm border border-white/20 hover:bg-white/10 text-white mx-auto block"
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
