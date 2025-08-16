import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import {
  PlayerIdResponse,
  PlayerIdResponseSchema,
  UserMeResponse,
  PlayerStatsLeaf,
  PlayerStatsTree,
} from "../core/ApiSchemas";
import { GameType, GameTypeValue, DifficultyType, GameMode, GameModeType, Difficulty } from "../core/game/Game";
import { PlayerStats } from "../core/StatsSchemas";
import "./components/baseComponents/PlayerStatsGrid";
import "./components/baseComponents/PlayerStatsTable";
import { getApiBase, getToken } from "./jwt";

async function fetchPlayerById(
  playerId: string,
): Promise<PlayerIdResponse | false> {
  try {
    const base = getApiBase();
    const token = await getToken();
    const url = `${base}/player/${encodeURIComponent(playerId)}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchPlayerById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = PlayerIdResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchPlayerById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchPlayerById: request failed", err);
    return false;
  }
}

@customElement("player-info-modal")
export class PlayerInfoModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private userMeResponse: UserMeResponse | null = null;
  @state() private visibility: GameTypeValue = GameType.Public;
  @state() private expandedGameId: string | null = null;
  @state() private loadError: string | null = null;
  @state() private selectedMode: GameModeType = GameMode.FFA;
  @state() private selectedDifficulty: DifficultyType = Difficulty.Medium;
  @state() private warningMessage: string | null = null;

  private statsTree: PlayerStatsTree | undefined;

  private recentGames: {
    gameId: string;
    start: string;
    map: string;
    difficulty: string;
    type: string;
    gameMode: "ffa" | "team";
    teamCount?: number;
    teamColor?: string;
  }[] = [];

  private viewGame(gameId: string): void {
    this.close();
    const path = location.pathname;
    const search = location.search;
    const hash = `#join=${encodeURIComponent(gameId)}`;
    const newUrl = `${path}${search}${hash}`;

    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  private toggleGameDetails(gameId: string): void {
    this.expandedGameId = this.expandedGameId === gameId ? null : gameId;
  }

  private formatPlayTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  createRenderRoot() {
    return this;
  }

  private getStoredFlag(): string {
    const storedFlag = localStorage.getItem("flag");
    return storedFlag ?? "";
  }

  private getStoredName(): string {
    const storedName = localStorage.getItem("username");
    return storedName ?? "";
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  private getSelectedLeaf(): PlayerStatsLeaf | null {
    const typeKey: GameTypeValue = this.visibility;
    const typeNode = this.statsTree?.[typeKey];
    if (!typeNode) return null;
    const modeNode = typeNode[this.selectedMode];
    if (!modeNode) return null;
    const diffNode = modeNode[this.selectedDifficulty];
    if (!diffNode) return null;
    return diffNode;
  }

  private getDisplayedStats(): PlayerStats | null {
    const leaf = this.getSelectedLeaf();
    if (!leaf || !leaf.stats) return {} as PlayerStats;
    return leaf.stats;
  }

  private setVisibility(v: GameType.Public | GameType.Private) {
    this.visibility = v;
    const typeKey: GameTypeValue = this.visibility;
    const typeNode = this.statsTree?.[typeKey] ?? {};
    const modes = Object.keys(typeNode) as GameModeType[];
    if (modes.length) {
      if (!modes.includes(this.selectedMode)) this.selectedMode = modes[0];
      const selectedModeNode =
        (typeNode as Partial<
          Record<GameModeType, Partial<Record<DifficultyType, PlayerStatsLeaf>>>
        >)[this.selectedMode] ?? {};
      const _diffs = Object.keys(selectedModeNode) as DifficultyType[];
    }
    this.requestUpdate();
  }

  private setMode(m: GameModeType) {
    this.selectedMode = m;

    const typeKey: GameTypeValue = this.visibility;
    const typeNode = this.statsTree?.[typeKey];

    if (!typeNode || !typeNode[m]) {
      this.warningMessage = "player_modal.no_data";
      this.requestUpdate();
      return;
    }

    this.warningMessage = null;
    this.requestUpdate();
  }

  private setDifficulty(d: DifficultyType) {
    this.selectedDifficulty = d;

    const typeKey: GameTypeValue = this.visibility;
    const modeNode = this.statsTree?.[typeKey]?.[this.selectedMode];

    if (!modeNode || !modeNode[d]) {
      this.warningMessage = "player_modal.no_data";
    } else {
      this.warningMessage = null;
    }

    this.requestUpdate();
  }

  private applyBackendStats(rawStats: PlayerStatsTree): void {
    this.statsTree = rawStats;
    const typeKey: GameTypeValue = this.visibility;
    const typeNode = this.statsTree?.[typeKey] ?? {};

    const availableModes = Object.keys(typeNode) as GameModeType[];
    if (availableModes.length > 0) {
      this.selectedMode = availableModes.includes(this.selectedMode)
        ? this.selectedMode
        : availableModes[0];

      const modeNode =
        (typeNode as Partial<
          Record<GameModeType, Partial<Record<DifficultyType, PlayerStatsLeaf>>>
        >)[this.selectedMode] ?? {};
      const availableDiffs = Object.keys(modeNode) as DifficultyType[];
      if (availableDiffs.length > 0) {
        this.selectedDifficulty = availableDiffs.includes(
          this.selectedDifficulty,
        )
          ? this.selectedDifficulty
          : availableDiffs[0];
      }
    }

    this.requestUpdate();
  }

  render() {
    const flag = this.getStoredFlag();
    const playerName = this.getStoredName();

    const u = this.userMeResponse?.user;
    const discordName = u?.username ?? "";
    const avatarUrl = u?.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith("a_") ? "gif" : "png"}`
      : u?.discriminator !== undefined
        ? `https://cdn.discordapp.com/embed/avatars/${Number(u.discriminator) % 5}.png`
        : "";

    const leaf = this.getSelectedLeaf();
    const wins = Number(leaf?.wins ?? 0);
    const losses = Number(leaf?.losses ?? 0);
    const gamesPlayed = Number(leaf?.total ?? 0);
    const wlr = losses === 0 ? wins : wins / losses;
    const lastActive = this.recentGames.length
      ? new Date(
        Math.max(...this.recentGames.map((g) => Date.parse(g.start))),
      ).toLocaleDateString()
      : translateText("player_modal.na");
    const playTimeText = translateText("player_modal.na");

    return html`
      <o-modal
        id="playerInfoModal"
        title="${translateText("player_modal.title")}"
        alwaysMaximized
      >
        <div class="flex flex-col items-center mt-2 mb-4">
          ${this.loadError
            ? html`
                <div
                  class="w-full max-w-md mb-3 px-3 py-2 rounded border text-sm text-center"
                  style="background: rgba(220,38,38,0.15); border-color: rgba(248,113,113,0.6); color: rgb(254,202,202);"
                >
                  ${translateText(this.loadError)}
                </div>
              `
            : null}
          ${this.warningMessage
            ? html`
                <div
                  class="w-full max-w-md mb-3 px-3 py-2 rounded border text-sm text-center"
                  style="background: rgba(202,138,4,0.15); border-color: rgba(253,224,71,0.6); color: rgb(253,224,71);"
                >
                  ${translateText(this.warningMessage)}
                </div>
              `
            : null}
          <br />
          <div class="flex items-center gap-2">
            <div class="p-[3px] rounded-full bg-gray-500">
              <img
                class="size-[48px] rounded-full block"
                src="/flags/${flag ?? "xx"}.svg"
                alt="${translateText("player_modal.flag_alt")}"
              />
            </div>

            <!-- Names -->
            <span class="font-semibold">${playerName}</span>
            <span>|</span>
            <span class="font-semibold">${discordName}</span>

            <!-- Avatar -->
            ${avatarUrl
              ? html`
                  <div class="p-[3px] rounded-full bg-gray-500">
                    <img
                      class="size-[48px] rounded-full block"
                      src="${avatarUrl}"
                      alt="${translateText("player_modal.avatar_alt")}"
                    />
                  </div>
                `
              : null}
          </div>
          <!-- Visibility toggle under names -->
          <div class="flex gap-2 mt-2">
            <button
              class="text-xs px-2 py-0.5 rounded border ${this.visibility ===
              GameType.Public
                ? "border-white/60 text-white"
                : "border-white/20 text-gray-300"}"
              @click=${() => this.setVisibility(GameType.Public)}
            >
              ${translateText("player_modal.public")}
            </button>
            <button
              class="text-xs px-2 py-0.5 rounded border ${this.visibility ===
              GameType.Private
                ? "border-white/60 text-white"
                : "border-white/20 text-gray-300"}"
              @click=${() => this.setVisibility(GameType.Private)}
            >
              ${translateText("player_modal.private")}
            </button>
          </div>

          <!-- Mode selector -->
          <div class="flex gap-2 mt-2">
            ${([GameMode.FFA, GameMode.Team] as const).map(
              (m) => html`
                <button
                  class="text-xs px-2 py-0.5 rounded border ${this
                    .selectedMode === m
                    ? "border-white/60 text-white"
                    : "border-white/20 text-gray-300"}"
                  @click=${() => this.setMode(m)}
                  title=${translateText("player_modal.mode")}
                >
                  ${m === "Free For All"
                    ? translateText("player_modal.mode_ffa")
                    : translateText("player_modal.mode_team")}
                </button>
              `,
            )}
          </div>

          <!-- Difficulty selector -->
          <div class="flex gap-2 mt-2">
            ${([Difficulty.Easy, Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible] as const).map(
              (d) => html`
                <button
                  class="text-xs px-2 py-0.5 rounded border ${this
                    .selectedDifficulty === d
                    ? "border-white/60 text-white"
                    : "border-white/20 text-gray-300"}"
                  @click=${() => this.setDifficulty(d)}
                  title=${translateText("player_modal.difficulty")}
                >
                  ${d}
                </button>
              `,
            )}
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <player-stats-grid
            .titles=${[
              translateText("player_modal.stats_wins"),
              translateText("player_modal.stats_losses"),
              translateText("player_modal.stats_wlr"),
              translateText("player_modal.stats_games_played"),
              translateText("player_modal.stats_play_time"),
              translateText("player_modal.stats_last_active"),
            ]}
            .values=${[
              wins,
              losses,
              wlr,
              gamesPlayed,
              playTimeText,
              lastActive,
            ]}
          ></player-stats-grid>

          <hr class="w-2/3 border-gray-600 my-2" />

          <hr class="w-2/3 border-gray-600 my-2" />

          <player-stats-table
            .stats=${this.getDisplayedStats()}
          ></player-stats-table>

          <hr class="w-2/3 border-gray-600 my-2" />

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="mt-4 w-full max-w-md">
            <div class="text-sm text-gray-400 font-semibold mb-1">
              🎮 ${translateText("player_modal.recent_games")}
            </div>
            <div class="flex flex-col gap-2">
              ${this.recentGames.map(
                (game) => html`
                  <div
                    class="bg-white/5 rounded border border-white/10 overflow-hidden transition-all duration-300"
                  >
                    <!-- header row -->
                    <div class="flex items-center justify-between px-4 py-2">
                      <div>
                        <div class="text-sm font-semibold text-white">
                          ${translateText("player_modal.game_id")}:
                          ${game.gameId}
                        </div>
                        <div class="text-xs text-gray-400">
                          ${translateText("player_modal.mode")}:
                          ${game.gameMode === "ffa"
                            ? translateText("player_modal.mode_ffa")
                            : html`${translateText("player_modal.mode_team")}
                              (${game.teamCount}
                              ${translateText("player_modal.teams")})`}
                        </div>
                        ${game.gameMode === "team" && game.teamColor
                          ? html`
                              <div class="text-white text-xs font-semibold">
                                ${translateText(
                                  "player_modal.player_team_color",
                                )}:
                                ${game.teamColor}
                              </div>
                            `
                          : null}
                      </div>
                      <div class="flex gap-2">
                        <button
                          class="text-sm text-gray-300 bg-gray-700 px-3 py-1 rounded"
                          @click=${() => this.viewGame(game.gameId)}
                        >
                          ${translateText("player_modal.view")}
                        </button>
                        <button
                          class="text-sm text-gray-300 bg-gray-600 px-3 py-1 rounded"
                          @click=${() => this.toggleGameDetails(game.gameId)}
                        >
                          ${translateText("player_modal.details")}
                        </button>
                      </div>
                    </div>
                    <!-- collapsible details inside the same card -->
                    <div
                      class="px-4 pb-2 text-xs text-gray-300 transition-all duration-300"
                      style="max-height: ${this.expandedGameId === game.gameId
                        ? "200px"
                        : "0"};
                             ${this.expandedGameId === game.gameId
                                ? ""
                                : "padding-top:0;padding-bottom:0;"}"
                    >
                      <div>
                        <span class="font-semibold"
                          >${translateText("player_modal.started")}:</span
                        >
                        ${new Date(game.start).toLocaleString()}
                      </div>
                      <div>
                        <span class="font-semibold"
                          >${translateText("player_modal.mode")}:</span
                        >
                        ${game.gameMode === "ffa"
                          ? translateText("player_modal.mode_ffa")
                          : `${translateText("player_modal.mode_team")} (${game.teamCount ?? "?"} ${translateText("player_modal.teams")})`}
                      </div>
                      <div>
                        <span class="font-semibold"
                          >${translateText("player_modal.map")}:</span
                        >
                        ${game.map}
                      </div>
                      <div>
                        <span class="font-semibold"
                          >${translateText("player_modal.difficulty")}:</span
                        >
                        ${game.difficulty}
                      </div>
                      <div>
                        <span class="font-semibold"
                          >${translateText("player_modal.type")}:</span
                        >
                        ${game.type}
                      </div>
                    </div>
                  </div>
                `,
              )}
            </div>
          </div>
        </div>
      </o-modal>
    `;
  }

  public open() {
    this.loadError = null;
    this.requestUpdate();
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  onUserMe(userMeResponse: UserMeResponse | null) {
    this.userMeResponse = userMeResponse;
    const playerId = userMeResponse?.player?.publicId;
    if (playerId) {
      this.loadFromApi(playerId);
    }
    this.requestUpdate();
  }

  private async loadFromApi(playerId: string): Promise<void> {
    try {
      this.loadError = null;

      const data = await fetchPlayerById(playerId);
      if (!data) {
        this.loadError = "player_modal.error.load";
        this.requestUpdate();
        return;
      }

      this.applyBackendStats(data.stats);

      this.recentGames = data.games.map((g) => ({
        gameId: g.gameId,
        start: g.start,
        map: g.map,
        difficulty: g.difficulty,
        type: g.type,
        gameMode:
          g.mode && String(g.mode).toLowerCase().includes("team")
            ? "team"
            : "ffa",
      }));

      this.requestUpdate();
    } catch (err) {
      console.warn("Failed to load player data:", err);
      this.loadError = "player_modal.error.load";
      this.requestUpdate();
    }
  }
}