import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { PlayerStats, PlayerStatsSchema } from "../core/StatsSchemas";
import { getServerConfigFromClient } from "../core/configuration/ConfigLoader";

// for test
type PlayerApiResponse = {
  stats?: unknown;
  games?: Array<{
    gameId: string;
    start: string;
    map: string;
    difficulty: string;
    type: string;
    mode?: string;
  }>;
};

@customElement("player-info-modal")
export class PlayerInfoModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private userMeResponse: UserMeResponse | null = null;

  @state() private wins: number = 57;
  @state() private playTimeSeconds: number = 5 * 3600 + 33 * 60;
  @state() private gamesPlayed: number = 119;
  @state() private losses: number = 62;
  @state() private lastActive: string = "1992/4/27";

  @state() private statsPublic: PlayerStats | null = null;
  @state() private statsPrivate: PlayerStats | null = null;
  @state() private statsAll: PlayerStats | null = null;
  @state() private visibility: "all" | "public" | "private" = "all";
  @state() private totalsByVisibility: Record<
    "all" | "public" | "private",
    { wins: number; losses: number; total: number }
  > = {
    all: { wins: 0, losses: 0, total: 0 },
    public: { wins: 0, losses: 0, total: 0 },
    private: { wins: 0, losses: 0, total: 0 },
  };

  @state() private recentGames: {
    gameId: string;
    start: string;
    map: string;
    difficulty: string;
    type: string;
    won: boolean;
    gameMode: "ffa" | "team";
    teamCount?: number;
    teamColor?: string;
  }[] = [
    {
      gameId: "tGadjhgg",
      start: "2025-08-08T10:00:00Z",
      map: "Australia",
      difficulty: "Medium",
      type: "Public",
      won: true,
      gameMode: "ffa",
    },
    {
      gameId: "I7XQ63rt",
      start: "2025-08-07T09:00:00Z",
      map: "Baikal",
      difficulty: "Medium",
      type: "Public",
      won: false,
      gameMode: "team",
      teamCount: 2,
      teamColor: "blue",
    },
    {
      gameId: "Chocolat",
      start: "2025-08-06T11:30:00Z",
      map: "World",
      difficulty: "Medium",
      type: "Private",
      won: true,
      gameMode: "team",
      teamCount: 3,
      teamColor: "red",
    },
  ];

  @state() private expandedGameId: string | null = null;

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

  private getBuildingName(building: string): string {
    const buildingNames: Record<string, string> = {
      city: "City",
      port: "Port",
      defense: "Defense",
      warship: "Warship",
      atom: "Atom Bomb",
      hydrogen: "Hydrogen Bomb",
      mirv: "MIRV",
      silo: "Missile Silo",
      sam: "SAM",
      transportShip: "Transport Ship",
      tradeShip: "Trade Ship",
    };
    return buildingNames[building] ?? building;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  private getDisplayedStats(): PlayerStats | null {
    switch (this.visibility) {
      case "public":
        return this.statsPublic;
      case "private":
        return this.statsPrivate;
      default:
        return this.statsAll;
    }
  }
  private setVisibility(v: "all" | "public" | "private") {
    this.visibility = v;
    const t = this.totalsByVisibility[v];
    this.wins = t.wins;
    this.losses = t.losses;
    this.gamesPlayed = t.total;
    this.requestUpdate();
  }

  private applyBackendStats(rawStats: any): void {
    const pubStats = PlayerStatsSchema.safeParse(
      rawStats?.Public?.["Free For All"]?.Medium?.stats ?? {},
    );
    const prvStats = PlayerStatsSchema.safeParse(
      rawStats?.Private?.["Free For All"]?.Medium?.stats ?? {},
    );
    this.statsPublic = pubStats.success ? pubStats.data : null;
    this.statsPrivate = prvStats.success ? prvStats.data : null;
    if (this.statsPublic && this.statsPrivate) {
      this.statsAll = this.mergePlayerStats(
        this.statsPublic,
        this.statsPrivate,
      );
    } else {
      this.statsAll = this.statsPublic ?? this.statsPrivate;
    }
    const pub = rawStats?.Public?.["Free For All"]?.Medium;
    const prv = rawStats?.Private?.["Free For All"]?.Medium;
    const allWins = Number(pub?.wins ?? 0) + Number(prv?.wins ?? 0);
    const allLosses = Number(pub?.losses ?? 0) + Number(prv?.losses ?? 0);
    const allTotal = Number(pub?.total ?? 0) + Number(prv?.total ?? 0);
    this.totalsByVisibility = {
      all: { wins: allWins, losses: allLosses, total: allTotal },
      public: {
        wins: Number(pub?.wins ?? 0),
        losses: Number(pub?.losses ?? 0),
        total: Number(pub?.total ?? 0),
      },
      private: {
        wins: Number(prv?.wins ?? 0),
        losses: Number(prv?.losses ?? 0),
        total: Number(prv?.total ?? 0),
      },
    };
    const t = this.totalsByVisibility[this.visibility];
    this.wins = t.wins;
    this.losses = t.losses;
    this.gamesPlayed = t.total;
    this.requestUpdate();
  }

  private mergePlayerStats(a: PlayerStats, b: PlayerStats): PlayerStats {
    const safeA = a ?? {};
    const safeB = b ?? {};
    const mergeArrays = (arr1?: any[], arr2?: any[]) => {
      if (!arr1 && !arr2) return undefined;
      if (!arr1) return arr2;
      if (!arr2) return arr1;
      return arr1.map((v, i) => Number(v ?? 0) + Number(arr2[i] ?? 0));
    };
    return {
      attacks: mergeArrays(safeA.attacks, safeB.attacks),
      betrayals: (safeA.betrayals ?? 0n) + (safeB.betrayals ?? 0n),
      boats: { ...(safeA.boats ?? {}), ...(safeB.boats ?? {}) },
      bombs: { ...(safeA.bombs ?? {}), ...(safeB.bombs ?? {}) },
      gold: mergeArrays(safeA.gold, safeB.gold),
      units: { ...(safeA.units ?? {}), ...(safeB.units ?? {}) },
    };
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
    return html`
      <o-modal id="playerInfoModal" title="Player Info" alwaysMaximized>
        <div class="flex flex-col items-center mt-2 mb-4">
          <br />
          <div class="flex items-center gap-2">
            <div class="p-[3px] rounded-full bg-gray-500">
              <img
                class="size-[48px] rounded-full block"
                src="/flags/${flag ?? "xx"}.svg"
                alt="Flag"
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
                      alt="Avatar"
                    />
                  </div>
                `
              : null}
          </div>
          <!-- Visibility toggle under names -->
          <div class="flex gap-2 mt-2">
            <button
              class="text-xs px-2 py-0.5 rounded border ${this.visibility ===
              "all"
                ? "border-white/60 text-white"
                : "border-white/20 text-gray-300"}"
              @click=${() => this.setVisibility("all")}
            >
              All
            </button>
            <button
              class="text-xs px-2 py-0.5 rounded border ${this.visibility ===
              "public"
                ? "border-white/60 text-white"
                : "border-white/20 text-gray-300"}"
              @click=${() => this.setVisibility("public")}
            >
              Public
            </button>
            <button
              class="text-xs px-2 py-0.5 rounded border ${this.visibility ===
              "private"
                ? "border-white/60 text-white"
                : "border-white/20 text-gray-300"}"
              @click=${() => this.setVisibility("private")}
            >
              Private
            </button>
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <div
            class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm text-white text-center mb-2"
          >
            <div>
              <div class="text-xl font-semibold">${this.wins ?? 0}</div>
              <div class="text-gray-400">Wins</div>
            </div>
            <div>
              <div class="text-xl font-semibold">${this.losses}</div>
              <div class="text-gray-400">Losses</div>
            </div>
            <div>
              <div class="text-xl font-semibold">
                ${this.gamesPlayed === 0
                  ? "0.0"
                  : ((this.wins / this.gamesPlayed) * 100).toFixed(1)}%
              </div>
              <div class="text-gray-400">Win Rate</div>
            </div>
            <div>
              <div class="text-xl font-semibold">${this.gamesPlayed}</div>
              <div class="text-gray-400">Games Played</div>
            </div>
            <div>
              <div class="text-xl font-semibold">
                ${this.playTimeSeconds
                  ? this.formatPlayTime(this.playTimeSeconds)
                  : "0h 0m"}
              </div>
              <div class="text-gray-400">Play Time</div>
            </div>
            <div>
              <div class="text-xl font-semibold">${this.lastActive}</div>
              <div class="text-gray-400">Last Active</div>
            </div>
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="mt-4 w-full max-w-md">
            <div class="text-sm text-gray-400 font-semibold mb-1">
              🏗️ Building Statistics
            </div>
            <table class="w-full text-sm text-gray-300 border-collapse">
              <thead>
                <tr class="border-b border-gray-600">
                  <th class="text-left w-1/5">Building</th>
                  <th class="text-center w-1/5">Built</th>
                  <th class="text-center w-1/5">Destroyed</th>
                  <th class="text-center w-1/5">Captured</th>
                  <th class="text-center w-1/5">Lost</th>
                </tr>
              </thead>
              <tbody>
                ${(() => {
                  const stats = this.getDisplayedStats();
                  if (!stats || !stats.units) return null;
                  // units: { city: [built, destroyed, captured, lost], ... }
                  return Object.entries(stats.units)
                    .filter(([unit]) =>
                      ["city", "port", "defp", "saml", "silo"].includes(unit),
                    )
                    .map(([unit, arr]) => {
                      const [built, destroyed, captured, lost] =
                        arr.map(Number);
                      return html`
                        <tr>
                          <td>${this.getBuildingName(unit)}</td>
                          <td class="text-center">${built ?? 0}</td>
                          <td class="text-center">${destroyed ?? 0}</td>
                          <td class="text-center">${captured ?? 0}</td>
                          <td class="text-center">${lost ?? 0}</td>
                        </tr>
                      `;
                    });
                })()}
              </tbody>
            </table>
          </div>

          <div class="mt-4 w-full max-w-md">
            <div class="text-sm text-gray-400 font-semibold mb-1">
              🚢 Ship Arrivals
            </div>
            <table class="w-full text-sm text-gray-300 border-collapse">
              <thead>
                <tr class="border-b border-gray-600">
                  <th class="text-left w-2/5">Ship Type</th>
                  <th class="text-center w-1/5">Sent</th>
                  <th class="text-center w-1/5">Destroyed</th>
                  <th class="text-center w-1/5">Arrived</th>
                </tr>
              </thead>
              <tbody>
                ${(() => {
                  const stats = this.getDisplayedStats();
                  if (!stats || !stats.boats) return null;
                  // boats: { trade: [sent, arrived, captured, destroyed], ... }
                  return Object.entries(stats.boats)
                    .filter(([boat]) =>
                      ["trade", "trans", "wshp"].includes(boat),
                    )
                    .map(([boat, arr]) => {
                      const [sent, arrived, captured, destroyed] =
                        arr.map(Number);
                      return html`
                        <tr>
                          <td>${this.getBuildingName(boat)}</td>
                          <td class="text-center">${sent ?? 0}</td>
                          <td class="text-center">${destroyed ?? 0}</td>
                          <td class="text-center">${arrived ?? 0}</td>
                        </tr>
                      `;
                    });
                })()}
              </tbody>
            </table>
          </div>

          <div class="mt-4 w-full max-w-md">
            <div class="text-sm text-gray-400 font-semibold mb-1">
              ☢️ Nuke Statistics
            </div>
            <table class="w-full text-sm text-gray-300 border-collapse">
              <thead>
                <tr class="border-b border-gray-600">
                  <th class="text-left w-2/5">Weapon</th>
                  <th class="text-center w-1/5">Built</th>
                  <th class="text-center w-1/5">Destroyed</th>
                  <th class="text-center w-1/5">Hits</th>
                </tr>
              </thead>
              <tbody>
                ${(() => {
                  const stats = this.getDisplayedStats();
                  if (!stats || !stats.bombs) return null;
                  // bombs: { abomb: [launched, landed, intercepted], ... }
                  return Object.entries(stats.bombs)
                    .filter(([bomb]) =>
                      ["abomb", "hbomb", "mirv"].includes(bomb),
                    )
                    .map(([bomb, arr]) => {
                      const [launched, landed, intercepted] = arr.map(Number);
                      return html`
                        <tr>
                          <td>${this.getBuildingName(bomb)}</td>
                          <td class="text-center">${launched ?? 0}</td>
                          <td class="text-center">${landed ?? 0}</td>
                          <td class="text-center">${intercepted ?? 0}</td>
                        </tr>
                      `;
                    });
                })()}
              </tbody>
            </table>
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="mt-4 w-full max-w-md">
            <div class="text-sm text-gray-400 font-semibold mb-1">
              🎮 Recent Games
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
                          Game ID: ${game.gameId}
                        </div>
                        <div class="text-xs text-gray-400">
                          Mode:
                          ${game.gameMode === "ffa"
                            ? "Free-for-All"
                            : html`Team (${game.teamCount} teams)`}
                        </div>
                        ${game.gameMode === "team" && game.teamColor
                          ? html`
                              <div class="text-white text-xs font-semibold">
                                Player Team Color: ${game.teamColor}
                              </div>
                            `
                          : null}
                        <div
                          class="text-xs ${game.won
                            ? "text-green-400"
                            : "text-red-400"}"
                        >
                          ${game.won ? "Victory" : "Defeat"}
                        </div>
                      </div>
                      <div class="flex gap-2">
                        <button
                          class="text-sm text-gray-300 bg-gray-700 px-3 py-1 rounded"
                          @click=${() => this.viewGame(game.gameId)}
                        >
                          View
                        </button>
                        <button
                          class="text-sm text-gray-300 bg-gray-600 px-3 py-1 rounded"
                          @click=${() => this.toggleGameDetails(game.gameId)}
                        >
                          Details
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
                        <span class="font-semibold">Started:</span> ${new Date(
                          game.start,
                        ).toLocaleString()}
                      </div>
                      <div>
                        <span class="font-semibold">Mode:</span>
                        ${game.gameMode === "ffa"
                          ? "Free-for-All"
                          : `Team (${game.teamCount ?? "?"} teams)`}
                      </div>
                      <div>
                        <span class="font-semibold">Map:</span> ${game.map}
                      </div>
                      <div>
                        <span class="font-semibold">Difficulty:</span>
                        ${game.difficulty}
                      </div>
                      <div>
                        <span class="font-semibold">Type:</span> ${game.type}
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
    this.requestUpdate();
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }

  onUserMe(userMeResponse: UserMeResponse) {
    this.userMeResponse = userMeResponse;
    const playerId = userMeResponse?.player?.publicId;
    if (playerId) {
      this.loadFromApi(playerId);
    }
    this.requestUpdate();
  }

  onLoggedOut() {
    this.userMeResponse = null;
  }

  private async loadFromApi(playerId: string): Promise<void> {
    try {
      const config = await getServerConfigFromClient();
      const url = new URL(config.jwtIssuer());
      url.pathname = "/player/" + playerId;
      console.log(url);
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.error("API error:", res.status, res.statusText);
        return;
      }
      const data = (await res.json()) as PlayerApiResponse;

      if (data?.stats) {
        this.applyBackendStats(data.stats);
      }

      if (Array.isArray(data?.games)) {
        this.recentGames = data.games.map((g) => ({
          gameId: g.gameId,
          start: g.start,
          map: g.map,
          difficulty: g.difficulty,
          type: g.type,
          won: false,
          gameMode:
            g.mode && String(g.mode).toLowerCase().includes("team")
              ? "team"
              : "ffa",
        }));
      }

      this.requestUpdate();
    } catch (err) {
      console.error("Failed to load player data from API:", err);
    }
  }
}
