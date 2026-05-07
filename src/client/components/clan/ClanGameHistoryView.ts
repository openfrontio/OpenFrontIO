import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ClientEnv } from "../../ClientEnv";
import { GameMapType } from "../../../core/game/Game";
import {
  type ClanGame,
  type ClanGameFilter,
  type ClanGamesResponse,
  fetchClanGames,
} from "../../ClanApi";
import { terrainMapFileLoader } from "../../TerrainMapFileLoader";
import { getMapName, renderDuration, translateText } from "../../Utils";
import "../CopyButton";
import {
  renderLoadingSpinner,
  renderServerPagination,
  showToast,
} from "./ClanShared";

type FilterKey = ClanGameFilter | "all";

// "All" is filter-only; FFA and Team reuse the type-label keys (same
// English strings); HvN and Ranked have shorter filter labels than their
// type labels ("Humans vs Nations" / "Ranked 1v1") so keep those split.
const FILTER_TABS: { key: FilterKey; labelKey: string }[] = [
  { key: "all", labelKey: "clan_modal.history_filter_all" },
  { key: "ffa", labelKey: "clan_modal.history_type_ffa" },
  { key: "team", labelKey: "clan_modal.history_type_team" },
  { key: "hvn", labelKey: "clan_modal.history_filter_hvn" },
  { key: "ranked", labelKey: "clan_modal.history_filter_ranked" },
];

export type ClanGameHistoryCache = {
  tag: string;
  page: number;
  filter: FilterKey;
  data: ClanGamesResponse;
};

@customElement("clan-game-history-view")
export class ClanGameHistoryView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property() clanTag = "";
  @property({ type: Object }) cachedState: ClanGameHistoryCache | null = null;

  @state() private games: ClanGame[] = [];
  @state() private total = 0;
  @state() private page = 1;
  @state() private limit = 10;
  @state() private loading = false;
  @state() private loadState: "ok" | "failed" | "forbidden" = "ok";
  @state() private filter: FilterKey = "all";
  private asyncGeneration = 0;

  connectedCallback() {
    super.connectedCallback();
    if (this.cachedState && this.cachedState.tag === this.clanTag) {
      this.games = this.cachedState.data.results;
      this.total = this.cachedState.data.total;
      this.page = this.cachedState.page;
      this.limit = this.cachedState.data.limit;
      this.filter = this.cachedState.filter;
    } else if (this.clanTag) {
      this.loadPage(1);
    }
  }

  private setFilter(filter: FilterKey) {
    if (filter === this.filter) return;
    this.filter = filter;
    this.loadPage(1);
  }

  private async loadPage(page: number) {
    if (!this.clanTag) return;
    const gen = ++this.asyncGeneration;
    this.loading = true;
    this.loadState = "ok";
    const filterParam = this.filter === "all" ? undefined : this.filter;
    const res = await fetchClanGames(
      this.clanTag,
      page,
      this.limit,
      filterParam,
    );
    if (gen !== this.asyncGeneration) return;
    this.loading = false;
    if ("error" in res) {
      this.loadState = res.error;
      this.games = [];
      this.total = 0;
      return;
    }
    if (res.results.length === 0 && page > 1) {
      await this.loadPage(1);
      return;
    }
    this.games = res.results;
    this.total = res.total;
    this.page = page;
    this.dispatchEvent(
      new CustomEvent<ClanGameHistoryCache>("history-updated", {
        detail: { tag: this.clanTag, page, filter: this.filter, data: res },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async watchReplay(gameId: string) {
    try {
      const encoded = encodeURIComponent(gameId);
      const url = `/${ClientEnv.workerPath(gameId)}/game/${encoded}`;
      history.pushState({ join: gameId }, "", url);
      window.dispatchEvent(
        new CustomEvent("join-changed", { detail: { gameId: encoded } }),
      );
      this.dispatchEvent(
        new CustomEvent("close-clan-modal", { bubbles: true, composed: true }),
      );
    } catch {
      showToast(translateText("clan_modal.error_failed"), "red");
    }
  }

  render() {
    if (this.loadState === "forbidden") {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm">
            ${translateText("clan_modal.history_members_only")}
          </p>
        </div>
      `;
    }

    const body = this.renderBody();
    return html`<div class="space-y-3">${this.renderFilters()}${body}</div>`;
  }

  private renderFilters(): TemplateResult {
    return html`
      <div
        role="tablist"
        class="flex flex-wrap gap-1 p-1 bg-white/5 border border-white/10 rounded-xl"
      >
        ${FILTER_TABS.map((tab) => {
          const active = this.filter === tab.key;
          // "All" gets a full row on mobile (basis-full) and normal sizing
          // on sm+. The others use basis-20 so "Ranked" stays comfortable
          // and flex-wrap drops them to a second row when needed.
          const basis =
            tab.key === "all" ? "basis-full sm:basis-20" : "basis-20";
          return html`
            <button
              type="button"
              role="tab"
              aria-selected=${active}
              @click=${() => this.setFilter(tab.key)}
              class="grow ${basis} px-3 py-1.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap rounded-lg transition-colors ${active
                ? "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30"
                : "text-white/50 hover:text-white hover:bg-white/5 border border-transparent"}"
            >
              ${translateText(tab.labelKey)}
            </button>
          `;
        })}
      </div>
    `;
  }

  private renderBody(): TemplateResult {
    if (this.loading && this.games.length === 0) {
      return renderLoadingSpinner();
    }
    if (this.loadState === "failed") {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm mb-3">
            ${translateText("clan_modal.history_unavailable")}
          </p>
          <button
            type="button"
            @click=${() => this.loadPage(1)}
            class="text-xs font-bold text-white/60 hover:text-white uppercase tracking-wider px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors"
          >
            ${translateText("leaderboard_modal.try_again")}
          </button>
        </div>
      `;
    }
    if (this.games.length === 0) {
      return html`
        <div
          class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
        >
          <p class="text-white/40 text-sm">
            ${translateText("clan_modal.history_empty")}
          </p>
        </div>
      `;
    }

    const totalPages = Math.max(1, Math.ceil(this.total / this.limit));
    return html`
      <div class="space-y-3">
        <div class="columns-1 lg:columns-2 gap-3">
          ${this.games.map((game) => this.renderGameRow(game))}
        </div>
        ${totalPages > 1
          ? renderServerPagination(this.page, totalPages, (p) =>
              this.loadPage(p),
            )
          : ""}
      </div>
    `;
  }

  private renderGameRow(game: ClanGame): TemplateResult {
    const mapWebpPath = game.map
      ? terrainMapFileLoader.getMapData(game.map as GameMapType).webpPath
      : null;
    const mapDisplayName = game.map ? (getMapName(game.map) ?? game.map) : null;

    return html`
      <div
        class="bg-white/5 border border-white/10 rounded-xl overflow-hidden mb-3 break-inside-avoid"
      >
        ${mapWebpPath
          ? html`<div
              class="relative w-full aspect-[3/1] overflow-hidden bg-surface"
            >
              <img
                src=${mapWebpPath}
                alt=${mapDisplayName ?? ""}
                draggable="false"
                class="w-full h-full object-cover"
              />
              <div
                class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
              ></div>
              ${mapDisplayName
                ? html`<div
                    class="absolute bottom-2 left-3 text-xs font-bold text-white uppercase tracking-wider drop-shadow"
                  >
                    ${mapDisplayName}
                  </div>`
                : ""}
              <div class="absolute top-2 right-2">
                ${this.renderResultBadge(game)}
              </div>
              <div
                class="absolute bottom-2 right-2 text-xs font-medium text-white bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md whitespace-nowrap"
              >
                ${formatAbsoluteTime(game.start)}
              </div>
            </div>`
          : ""}
        <div
          class="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="text-[10px] font-bold uppercase tracking-wider text-white/40"
              >${translateText("clan_modal.history_game_id")}:</span
            >
            <copy-button
              compact
              .copyText=${game.gameId}
              .displayText=${game.gameId}
              .showVisibilityToggle=${false}
            ></copy-button>
          </div>
          <button
            type="button"
            @click=${() => this.watchReplay(game.gameId)}
            class="shrink-0 px-3 py-1.5 text-xs font-bold text-white uppercase tracking-wider bg-malibu-blue hover:bg-aquarius active:bg-malibu-blue/80 rounded-lg transition-all"
          >
            ${translateText("clan_modal.history_watch_replay")}
          </button>
        </div>
        <div
          class="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 justify-items-center text-center"
        >
          ${this.renderField(
            translateText("clan_modal.history_game_type"),
            this.formatGameType(game),
          )}
          ${mapWebpPath
            ? ""
            : this.renderField(
                translateText("clan_modal.history_map"),
                mapDisplayName ?? "—",
              )}
          ${this.renderPlayersField(game)}
          ${this.renderField(
            translateText("clan_modal.history_duration"),
            renderDuration(game.durationSeconds),
          )}
        </div>
        ${this.renderPlayerLists(game)}
      </div>
    `;
  }

  private renderField(label: string, value: string): TemplateResult {
    return html`
      <div class="min-w-0">
        <div
          class="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-0.5"
        >
          ${label}
        </div>
        <div class="text-sm text-white truncate" title=${value}>${value}</div>
      </div>
    `;
  }

  // For FFA / Ranked 1v1 with multiple clan-mates in the same lobby,
  // calling the whole game a "Victory" because one of 20 won is
  // misleading — 19 lost. The server now stamps `won` per clan player
  // so we count exactly. Team/HvN games still surface Victory/Defeat
  // when the clan plays as a unit (everyone on the winning team won).
  private renderResultBadge(game: ClanGame): TemplateResult {
    const result = game.result;
    if (!result) return html``;

    const clanCount = game.clanPlayers.length;
    const winCount = game.clanPlayers.filter((p) => p.won).length;
    const isIndividual =
      game.mode === "Free For All" ||
      (game.rankedType !== undefined && game.rankedType !== "unranked");
    const isPartial =
      isIndividual && clanCount > 1 && winCount > 0 && winCount < clanCount;

    let label: string;
    let tint: string;
    if (isPartial) {
      label = translateText("clan_modal.history_result_partial", {
        wins: winCount,
        total: clanCount,
      });
      tint = "text-white bg-amber-500 border-amber-400";
    } else if (result === "victory") {
      label = translateText("clan_modal.history_result_victory");
      tint = "text-white bg-green-600 border-green-500";
    } else {
      label = translateText("clan_modal.history_result_defeat");
      tint = "text-white bg-red-600 border-red-500";
    }
    return html`<span
      class="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border shadow-lg ${tint}"
      >${label}</span
    >`;
  }

  // Split the clan roster into winners and non-winners so the user can
  // tell at a glance which clan-mates actually won the match — a single
  // mixed list with crowns was hard to scan, especially in 50v50 lobbies.
  private renderPlayerLists(game: ClanGame): TemplateResult | string {
    if (game.clanPlayers.length === 0) return "";
    const winners = game.clanPlayers.filter((p) => p.won);
    const losers = game.clanPlayers.filter((p) => !p.won);
    return html`
      ${winners.length > 0
        ? this.renderPlayerSection(
            translateText("clan_modal.history_clan_winners"),
            winners,
            "text-green-400",
          )
        : ""}
      ${losers.length > 0
        ? this.renderPlayerSection(
            translateText("clan_modal.history_clan_members"),
            losers,
            "text-white/40",
          )
        : ""}
    `;
  }

  private renderPlayerSection(
    label: string,
    players: ClanGame["clanPlayers"],
    labelClass: string,
  ): TemplateResult {
    return html`
      <div
        class="px-4 py-2 border-t border-white/5 text-xs text-white/60 flex flex-wrap items-center gap-x-1 gap-y-1"
      >
        <span
          class="text-[10px] font-bold uppercase tracking-wider mr-1 ${labelClass}"
          >${label}:</span
        >
        ${players.map(
          (p) => html`
            <copy-button
              compact
              .copyText=${p.publicId}
              .displayText=${p.username ?? p.publicId}
              .showVisibilityToggle=${false}
              .showCopyIcon=${false}
            ></copy-button>
          `,
        )}
      </div>
    `;
  }

  // FFA + Ranked 1v1 cap clan participation at a single player, so
  // "1 / N total" is noise — just show the total. Team/HvN keep the
  // clan-vs-total breakdown.
  private renderPlayersField(game: ClanGame): TemplateResult {
    const isSingleClanSlot =
      game.mode === "Free For All" ||
      (game.rankedType !== undefined && game.rankedType !== "unranked");
    if (isSingleClanSlot) {
      return this.renderField(
        translateText("clan_modal.history_players"),
        `${game.totalPlayers}`,
      );
    }
    return this.renderField(
      translateText("clan_modal.history_clan_players"),
      translateText("clan_modal.history_clan_players_value", {
        clanCount: game.clanPlayers.length,
        total: game.totalPlayers,
      }),
    );
  }

  // FFA / Duos / 7 Teams / Humans vs Nations / Ranked 1v1 — derived from
  // the same fields the bucket filter uses, so the label always agrees
  // with the active tab.
  private formatGameType(game: ClanGame): string {
    if (game.rankedType && game.rankedType !== "unranked") {
      return translateText("clan_modal.history_type_ranked", {
        ranked: game.rankedType,
      });
    }
    if (game.mode === "Free For All") {
      return translateText("clan_modal.history_type_ffa");
    }
    const pt = game.playerTeams;
    if (pt === "Humans Vs Nations") {
      return translateText("clan_modal.history_type_hvn");
    }
    if (pt === "Duos" || pt === "Trios" || pt === "Quads") {
      return translateText(`clan_modal.history_type_${pt.toLowerCase()}`);
    }
    if (pt && /^\d+$/.test(pt)) {
      return translateText("clan_modal.history_type_n_teams", {
        count: Number(pt),
      });
    }
    return translateText("clan_modal.history_type_team");
  }
}

function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return translateText("clan_modal.history_today_at", { time });
  }
  return `${date.toLocaleDateString()} ${time}`;
}
