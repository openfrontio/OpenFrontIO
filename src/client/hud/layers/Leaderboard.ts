import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { renderTroops, translateText } from "../../../client/Utils";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  LeaderboardColumnKey,
  UserSettings,
} from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { GoToPlayerEvent } from "../../TransformHandler";
import { formatPercentage, renderNumber } from "../../Utils";
import { GameView, PlayerView } from "../../view";

const settingsIcon = assetUrl("images/SettingIconWhite.svg");

interface ColumnDefinition {
  key: LeaderboardColumnKey;
  labelKey: string;
  width: string;
}

const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  {
    key: "tiles",
    labelKey: "leaderboard.owned",
    width: "minmax(45px, 70px)",
  },
  {
    key: "gold",
    labelKey: "leaderboard.gold",
    width: "minmax(40px, 55px)",
  },
  {
    key: "maxtroops",
    labelKey: "leaderboard.maxtroops",
    width: "minmax(55px, 105px)",
  },
];

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

@customElement("leader-board")
export class Leaderboard extends LitElement implements Controller {
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;

  private readonly userSettings = new UserSettings();

  players: Entry[] = [];

  @property({ type: Boolean }) visible = false;
  private showTopFive = true;

  @state()
  private _sortKey: LeaderboardColumnKey = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  @state()
  private showColumnSettings = false;

  @state()
  private visibleColumnKeys = this.userSettings.leaderboardColumns();

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

  private setSort(key: LeaderboardColumnKey) {
    if (this._sortKey === key) {
      this._sortOrder = this._sortOrder === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortOrder = "desc";
    }
    this.updateLeaderboard();
  }

  private visibleColumns(): ColumnDefinition[] {
    const visible = new Set(this.visibleColumnKeys);
    const columns = COLUMN_DEFINITIONS.filter((column) =>
      visible.has(column.key),
    );
    return columns.length > 0 ? columns : [COLUMN_DEFINITIONS[0]];
  }

  private ensureVisibleSortKey(columns: readonly ColumnDefinition[]): void {
    if (!columns.some((column) => column.key === this._sortKey)) {
      this._sortKey = columns[0].key;
      this._sortOrder = "desc";
    }
  }

  private toggleColumn(key: LeaderboardColumnKey) {
    this.visibleColumnKeys = this.userSettings.toggleLeaderboardColumn(key);
    this.ensureVisibleSortKey(this.visibleColumns());
    this.updateLeaderboard();
  }

  private entryValue(entry: Entry, key: LeaderboardColumnKey): string {
    switch (key) {
      case "gold":
        return entry.gold;
      case "maxtroops":
        return entry.maxTroops;
      case "tiles":
        return entry.score;
    }
  }

  private sortIndicator(key: LeaderboardColumnKey) {
    if (this._sortKey !== key) return "";
    return this._sortOrder === "asc" ? "⬆️" : "⬇️";
  }

  private gridTemplateColumns(columns: readonly ColumnDefinition[]): string {
    return [
      "minmax(24px, 30px)",
      "minmax(60px, 100px)",
      ...columns.map((column) => column.width),
    ].join(" ");
  }

  private updateLeaderboard() {
    if (this.game === null) throw new Error("Not initialized");
    const myPlayer = this.game.myPlayer();
    const columns = this.visibleColumns();
    this.ensureVisibleSortKey(columns);

    interface PlayerViewTroopsCache {
      pv: PlayerView;
      maxTroops: number;
    }

    const compare = (a: number, b: number) =>
      this._sortOrder === "asc" ? a - b : b - a;

    const maxTroops = (p: PlayerView) => this.game!.config().maxTroops(p);

    const sorted: PlayerViewTroopsCache[] = this.game
      .playerViews()
      .filter((p) => p.isAlive())
      .map((p) => ({ pv: p, maxTroops: maxTroops(p) }));

    switch (this._sortKey) {
      case "gold":
        sorted.sort((a, b) =>
          compare(Number(a.pv.gold()), Number(b.pv.gold())),
        );
        break;
      case "maxtroops":
        sorted.sort((a, b) => compare(a.maxTroops, b.maxTroops));
        break;
      default:
        sorted.sort((a, b) =>
          compare(a.pv.numTilesOwned(), b.pv.numTilesOwned()),
        );
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    const playersToShow = this.showTopFive ? sorted.slice(0, 5) : sorted;

    this.players = playersToShow.map((playerCache, index) => {
      const player = playerCache.pv;
      const maxTroops = playerCache.maxTroops;
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
        if (p.pv === myPlayer) {
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

  private stopGameInput(event: Event) {
    event.stopPropagation();
  }

  private renderColumnSettings() {
    if (!this.showColumnSettings) return html``;
    const selected = new Set(this.visibleColumnKeys);
    return html`
      <div
        class="mt-2 rounded-md border border-slate-500 bg-gray-800/90 p-2 text-white text-xs md:text-xs lg:text-sm shadow-lg"
      >
        <div class="font-bold mb-1">
          ${translateText("leaderboard.columns")}
        </div>
        <div class="grid grid-cols-2 gap-1">
          ${COLUMN_DEFINITIONS.map(
            (column) => html`
              <label
                class="flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-white/10"
              >
                <input
                  type="checkbox"
                  class="accent-slate-300"
                  .checked=${selected.has(column.key)}
                  .disabled=${selected.size === 1 && selected.has(column.key)}
                  @change=${() => this.toggleColumn(column.key)}
                />
                <span class="truncate">${translateText(column.labelKey)}</span>
              </label>
            `,
          )}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.visible) {
      return html``;
    }
    const columns = this.visibleColumns();
    return html`
      <div
        @click=${this.stopGameInput}
        @pointerdown=${this.stopGameInput}
        @pointerup=${this.stopGameInput}
        @pointercancel=${this.stopGameInput}
        @contextmenu=${(e: Event) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div
          class="max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh] mt-2 ${this
            .visible
            ? ""
            : "hidden"}"
          @contextmenu=${(e: Event) => e.preventDefault()}
        >
          <div
            class="grid bg-gray-800/85 w-full text-xs md:text-xs lg:text-sm rounded-lg overflow-hidden"
            style=${`grid-template-columns: ${this.gridTemplateColumns(columns)};`}
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
              ${columns.map(
                (column) => html`
                  <div
                    class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
                    @click=${() => this.setSort(column.key)}
                  >
                    ${translateText(column.labelKey)}
                    ${this.sortIndicator(column.key)}
                  </div>
                `,
              )}
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
                  ${columns.map(
                    (column) => html`
                      <div
                        class="py-1 md:py-2 text-center ${index <
                        this.players.length - 1
                          ? "border-b border-slate-500"
                          : ""}"
                      >
                        ${this.entryValue(player, column.key)}
                      </div>
                    `,
                  )}
                </div>
              `,
            )}
          </div>
        </div>

        <div class="mt-2 flex items-center justify-center gap-2">
          <button
            class="p-0.5 px-1.5 md:px-2 text-xs md:text-xs lg:text-sm
          border rounded-md border-slate-500 transition-colors
          text-white hover:bg-white/10 bg-gray-700/50"
            @click=${() => {
              this.showTopFive = !this.showTopFive;
              this.updateLeaderboard();
            }}
          >
            ${this.showTopFive ? "+" : "-"}
          </button>
          <button
            class="h-7 w-7 flex items-center justify-center border rounded-md border-slate-500 transition-colors text-white hover:bg-white/10 bg-gray-700/50"
            title=${translateText("leaderboard.configure_columns")}
            aria-label=${translateText("leaderboard.configure_columns")}
            @click=${() => {
              this.showColumnSettings = !this.showColumnSettings;
            }}
          >
            <img src=${settingsIcon} alt="" width="14" height="14" />
          </button>
        </div>
        ${this.renderColumnSettings()}
      </div>
    `;
  }
}
