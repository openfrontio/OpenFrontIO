import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { renderTroops, translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { Controller } from "../../Controller";
import { GoToPlayerEvent } from "../../TransformHandler";
import { formatPercentage, renderNumber } from "../../Utils";

interface Entry {
  name: string;
  position: number;
  score: string;
  gold: string;
  maxTroops: string;
  peakTiles: string;
  peakLandPercent: string;
  isMyPlayer: boolean;
  isOnSameTeam: boolean;
  player: PlayerView;
}

type LeaderboardViewMode = "control" | "expanded";

@customElement("leader-board")
export class Leaderboard extends LitElement implements Controller {
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;

  players: Entry[] = [];

  @property({ type: Boolean }) visible = false;
  private showTopFive = true;

  @state()
  private _sortKey: "tiles" | "gold" | "maxtroops" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";
  @state()
  private _viewMode: LeaderboardViewMode = "control";

  private playerPeaks = new Map<
    string,
    { maxTiles: number; maxLandRatio: number }
  >();

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
    this.updatePlayerPeaks();
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
        peakTiles: renderNumber(this.playerPeakTiles(player)),
        peakLandPercent: formatPercentage(this.playerPeakLandRatio(player)),
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
          peakTiles: renderNumber(this.playerPeakTiles(myPlayer)),
          peakLandPercent: formatPercentage(this.playerPeakLandRatio(myPlayer)),
          isMyPlayer: true,
          isOnSameTeam: true,
          player: myPlayer,
        });
      }
    }

    this.requestUpdate();
  }

  private updatePlayerPeaks() {
    if (this.game === null) return;
    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();
    for (const player of this.game.playerViews()) {
      if (!player.isAlive()) continue;
      const playerId = player.id();
      const ownedTiles = player.numTilesOwned();
      const landRatio =
        numTilesWithoutFallout > 0 ? ownedTiles / numTilesWithoutFallout : 0;
      const previous = this.playerPeaks.get(playerId) ?? {
        maxTiles: 0,
        maxLandRatio: 0,
      };
      this.playerPeaks.set(playerId, {
        maxTiles: Math.max(previous.maxTiles, ownedTiles),
        maxLandRatio: Math.max(previous.maxLandRatio, landRatio),
      });
    }
  }

  private playerPeakTiles(player: PlayerView): number {
    return (
      this.playerPeaks.get(player.id())?.maxTiles ?? player.numTilesOwned()
    );
  }

  private playerPeakLandRatio(player: PlayerView): number {
    if (this.game === null) return 0;
    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();
    return (
      this.playerPeaks.get(player.id())?.maxLandRatio ??
      (numTilesWithoutFallout > 0
        ? player.numTilesOwned() / numTilesWithoutFallout
        : 0)
    );
  }

  private toggleViewMode() {
    if (!this.expandedLeaderboardEnabled) {
      this._viewMode = "control";
      return;
    }
    this._viewMode = this._viewMode === "control" ? "expanded" : "control";
  }

  private get expandedLeaderboardEnabled(): boolean {
    return this.game?.config().expandedLeaderboard() ?? false;
  }

  private handleRowClickPlayer(player: PlayerView) {
    if (this.eventBus === null) return;
    this.eventBus.emit(new GoToPlayerEvent(player));
  }

  render() {
    if (!this.visible) {
      return html``;
    }
    const currentViewMode =
      !this.expandedLeaderboardEnabled && this._viewMode === "expanded"
        ? "control"
        : this._viewMode;
    const showExpanded = currentViewMode === "expanded";
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
          style="grid-template-columns:${showExpanded
            ? "minmax(24px, 30px) minmax(60px, 100px) minmax(70px, 95px) minmax(65px, 90px)"
            : "minmax(24px, 30px) minmax(60px, 100px) minmax(45px, 70px) minmax(40px, 55px) minmax(55px, 105px)"};"
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
            ${showExpanded
              ? html`
                  <div
                    class="py-1 md:py-2 text-center border-b border-slate-500 whitespace-nowrap truncate"
                  >
                    ${translateText("leaderboard.max_tiles")}
                  </div>
                  <div
                    class="py-1 md:py-2 text-center border-b border-slate-500 whitespace-nowrap truncate"
                  >
                    ${translateText("leaderboard.max_land")}
                  </div>
                `
              : html`
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
                `}
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
                ${showExpanded
                  ? html`
                      <div
                        class="py-1 md:py-2 text-center ${index <
                        this.players.length - 1
                          ? "border-b border-slate-500"
                          : ""}"
                      >
                        ${player.peakTiles}
                      </div>
                      <div
                        class="py-1 md:py-2 text-center ${index <
                        this.players.length - 1
                          ? "border-b border-slate-500"
                          : ""}"
                      >
                        ${player.peakLandPercent}
                      </div>
                    `
                  : html`
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
                    `}
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
      ${this.expandedLeaderboardEnabled
        ? html`<button
            class="mt-2 p-0.5 px-1.5 md:px-2 text-xs md:text-xs lg:text-sm 
            border rounded-md border-slate-500 transition-colors
            text-white mx-auto block hover:bg-white/10 bg-gray-700/50"
            @click=${() => this.toggleViewMode()}
          >
            ${translateText(
              currentViewMode === "control"
                ? "leaderboard.show_expanded"
                : "leaderboard.show_control",
            )}
          </button>`
        : html``}
    `;
  }
}
