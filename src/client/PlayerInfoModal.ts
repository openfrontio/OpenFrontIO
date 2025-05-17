import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { TokenPayload, UserMeResponse } from "../core/ApiSchemas";
import {
  achievementsData,
  RankStyle,
  rankStyles,
  RoleStyle,
  roleStyles,
} from "./Utils";

type BuildingStat = {
  built: number;
  destroyed: number;
  lost: number;
  captured: number;
};
type ShipStat = { sent: number; destroyed: number; arrived: number };
type NukeStat = { built: number; destroyed: number; hits: number };

type AllBuildingStats = {
  city: BuildingStat;
  port: BuildingStat;
  defense: BuildingStat;
  sam: BuildingStat;
  warship: ShipStat;
  transportShip: ShipStat;
  tradeShip: ShipStat;
  atom: NukeStat;
  hydrogen: NukeStat;
  mirv: NukeStat;
  silo: NukeStat;
};

@customElement("player-info-modal")
export class PlayerInfoModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };
  @state() private isLoggedIn: boolean = false;
  @state() private discordUserName: string = "";
  @state() private discordAvatarUrl: string = "";

  @state() private playerName: string = "";
  @state() private flag: string = "";
  @state() private highestRole: string = "";
  @state() private flagWrapper: string = "";
  @state() private nameText: string = "";

  @state() private roles: string[] = ["cho"];

  @state() private currentRank: string = "New Player";
  @state() private rankList: string[] = [
    "New Player",
    "Logged-in Player",
    "Seen Player",
    "Known Player",
    "Well-Known Player",
    "Veteran Player",
    "Best-Known Player",
    "Elite Player",
    "Legend",
    "Mythic Player",
  ];

  @state() private isDebugMode: boolean = false;

  @state() private wins: number = 57;
  @state() private playTimeSeconds: number = 5 * 3600 + 33 * 60;
  @state() private progressPercent: number = 62;
  @state() private gamesPlayed: number = 119;
  @state() private losses: number = 62;
  @state() private lastActive: string = "1992/4/27";

  @state() private buildingStats: AllBuildingStats = {
    city: { built: 0, destroyed: 0, lost: 0, captured: 0 },
    port: { built: 0, destroyed: 0, lost: 0, captured: 0 },
    defense: { built: 0, destroyed: 0, lost: 0, captured: 0 },
    sam: { built: 0, destroyed: 0, lost: 0, captured: 0 },
    warship: { sent: 0, destroyed: 0, arrived: 0 },
    transportShip: { sent: 0, destroyed: 0, arrived: 0 },
    tradeShip: { sent: 0, destroyed: 0, arrived: 0 },
    atom: { built: 0, destroyed: 0, hits: 0 },
    hydrogen: { built: 0, destroyed: 0, hits: 0 },
    mirv: { built: 0, destroyed: 0, hits: 0 },
    silo: { built: 0, destroyed: 0, hits: 0 },
  };
  @state() private achievements: string[] = [];

  @state() private recentPlayers: {
    gameName: string;
    flag: string;
    rank: string;
  }[] = [
    { gameName: "[CHOCO]chocolate", flag: "us", rank: "Elite Player" },
    { gameName: "dot_tungsten_dot", flag: "jp", rank: "Veteran Player" },
    { gameName: "evan", flag: "un", rank: "Legend" },
  ];

  @state() private recentGames: {
    gameId: string;
    won: boolean;
    gameMode: "ffa" | "team";
    teamCount?: number;
    teamColor?: string;
  }[] = [
    { gameId: "tGadjhgg", won: true, gameMode: "ffa" },
    {
      gameId: "I7XQ63rt",
      won: false,
      gameMode: "team",
      teamCount: 2,
      teamColor: "blue",
    },
    {
      gameId: "Chocolat",
      won: true,
      gameMode: "team",
      teamCount: 3,
      teamColor: "red",
    },
  ];

  private colorClassMap: Record<string, string> = {
    red: "text-red-300",
    blue: "text-blue-300",
    green: "text-green-300",
    yellow: "text-yellow-300",
    purple: "text-purple-300",
  };

  private viewPlayer(player: {
    gameName: string;
    flag: string;
    rank: string;
  }): void {
    console.log("Viewing player:", player);
  }

  private viewGame(game: {
    gameId: string;
    won: boolean;
    gameMode: "ffa" | "team";
    teamCount?: number;
  }): void {
    console.log("Viewing game:", game);
  }

  private getNextRank(): string {
    const currentIndex = this.rankList.indexOf(this.currentRank);
    return this.rankList[currentIndex + 1] || "Max Rank Achieved";
  }

  private formatPlayTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  private toggleRole(role: string, checked: boolean) {
    if (checked && !this.roles.includes(role)) {
      this.roles = [...this.roles, role];
    } else if (!checked) {
      this.roles = this.roles.filter((r) => r !== role);
    }

    this.updateRoleStyles();
  }

  private updateRoleStyles(): void {
    this.highestRole = this.getHighestRole(this.roles);
    const { flagWrapper, nameText } = this.getRoleStyle(this.highestRole);
    this.flagWrapper = flagWrapper;
    this.nameText = nameText;

    this.requestUpdate();
  }

  private getAllRolesSorted(): Record<string, any> {
    const allRoles = [
      "adm", // Admin
      "og0", // OG
      "cre", // Creator
      "bot", // Bots
      "cha", // Challenger
      "og1", // OG100
      "ctr", // Contributor
      "pin", // Ping
      "dsp", // Development Stream Ping
      "bst", // Server Booster
      "ccr", // Content Creator
      "bet", // Beta Tester
      "mhr", // Money Haters
      "eas", // Early Access Supporter
      "mod", // Mod
      "sta", // Support Staff
      "rst", // Retired Staff
      "dca", // DevChatAccess
      "mem", // Member
      "cor", // Core Contributor
      "act", // Active Contributor
      "ass", // Admin Assistant
      "tra", // Translator
      "trd", // Translator Dev
      "htr", // Head Translator
      "cho", // Chocolate!
    ];

    const sortedRoles = allRoles
      .map((role) => ({
        role,
        priority: this.getRoleStyle(role).priority,
      }))
      .sort((a, b) => a.priority - b.priority);

    return Object.fromEntries(
      sortedRoles.map(({ role }) => [role, this.getRoleStyle(role)]),
    );
  }

  createRenderRoot() {
    return this;
  }

  private getStoredFlag(): string {
    const storedFlag = localStorage.getItem("flag");
    return storedFlag || "";
  }

  private getStoredName(): string {
    const storedName = localStorage.getItem("username");
    return storedName || "";
  }

  private getRoleStyle(role: string): RoleStyle {
    return roleStyles[role] ?? roleStyles.mem;
  }

  private getRankStyle(rank: string): RankStyle {
    return (
      rankStyles[rank] || {
        bg: "bg-gray-500/20",
        border: "border-gray-400/30",
        text: "text-gray-300",
        flagWrapper: "p-[3px] rounded-full bg-gray-500",
        nameText: "text-xl font-bold text-gray-300",
      }
    );
  }

  private getHighestRole(roles: string[]): string {
    return (
      roles
        .map((role) => ({
          role,
          priority: this.getRoleStyle(role).priority,
        }))
        .sort((a, b) => a.priority - b.priority)[0]?.role ?? "user"
    );
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
    return buildingNames[building] || building;
  }

  private getProgressBarColor(progress: number): string {
    if (progress >= 80) {
      return "rgba(34, 197, 94, 1)";
    } else if (progress >= 50) {
      return "rgba(234, 179, 8, 1)";
    } else {
      return "rgba(239, 68, 68, 1)";
    }
  }

  private advanceRank(): void {
    const currentIndex = this.rankList.indexOf(this.currentRank);
    if (currentIndex < this.rankList.length - 1) {
      this.currentRank = this.rankList[currentIndex + 1];
    }
  }

  onUserMe(userMeResponse: UserMeResponse) {
    const { user, player } = userMeResponse;
    const { username, id, avatar } = user;
    if (player) {
      const { publicId, roles, flares } = player;
      if (publicId) {
        // ...
      }
      if (roles) {
        // ...
      }
      if (flares) {
        // ...
      }
    }
    this.discordUserName = username;
    this.discordAvatarUrl = avatar
      ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.${avatar.startsWith("a_") ? "gif" : "png"}`
      : `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator) % 5}.png`;
    this.requestUpdate();
  }

  onLoggedOut() {
    this.discordUserName = ".w.";
    this.discordAvatarUrl = "https://cdn.discordapp.com/embed/avatars/1.png";
    this.roles = [];
    this.isLoggedIn = false;
  }

  onLoggedIn(claims: TokenPayload) {
    const { rol } = claims;
    this.roles = rol;
    this.highestRole = this.getHighestRole(this.roles);
    const { flagWrapper, nameText } = this.getRoleStyle(this.highestRole);
    this.flagWrapper = flagWrapper;
    this.nameText = nameText;
    this.isLoggedIn = true;
  }

  private async getUserInfo(): Promise<void> {
    this.playerName = this.getStoredName();
    this.flag = this.getStoredFlag();

    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    this.getUserInfo();

    window.addEventListener("keydown", this.handleKeyDown.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    window.removeEventListener("keydown", this.handleKeyDown.bind(this));
  }

  private debugIndex = 0;
  private readonly debugSequence = ["d", "e", "b", "u", "g"];

  private handleKeyDown(event: KeyboardEvent): void {
    const allowedRoles = ["sta", "mod", "ass", "adm", "cre"];
    const key = event.key.toLowerCase();

    if (key === this.debugSequence[this.debugIndex]) {
      this.debugIndex++;

      if (this.debugIndex === this.debugSequence.length) {
        if (this.roles.some((role) => allowedRoles.includes(role))) {
          this.isDebugMode = true;
          this.requestUpdate();
        }
        this.debugIndex = 0;
      }
    } else {
      this.debugIndex = 0;
    }
  }

  private getAchievementStats() {
    const total = achievementsData.length;
    const unlocked = this.achievements.length;

    const difficultyCounts = achievementsData.reduce(
      (acc, achievement) => {
        if (this.achievements.includes(achievement.id)) {
          acc[achievement.difficulty] = (acc[achievement.difficulty] || 0) + 1;
        }
        return acc;
      },
      { easy: 0, medium: 0, hard: 0, impossible: 0 } as Record<string, number>,
    );

    const difficultyTotals = achievementsData.reduce(
      (acc, achievement) => {
        acc[achievement.difficulty] = (acc[achievement.difficulty] || 0) + 1;
        return acc;
      },
      { easy: 0, medium: 0, hard: 0, impossible: 0 } as Record<string, number>,
    );

    const secretTotal = achievementsData.filter((a) => a.secret).length;
    const secretUnlocked = achievementsData.filter(
      (a) => a.secret && this.achievements.includes(a.id),
    ).length;

    return {
      total,
      unlocked,
      unlockedRatio: (unlocked / total) * 100,
      difficultyCounts,
      difficultyTotals,
      secretTotal,
      secretUnlocked,
      secretUnlockedRatio: (secretUnlocked / secretTotal) * 100,
    };
  }

  render() {
    return html`
      <o-modal id="playerInfoModal" title="Player Info">
        <div class="flex flex-col items-center mt-2 mb-4">
          ${!this.isLoggedIn
            ? html` <div
                class="bg-yellow-300/20 border border-yellow-400 text-yellow-200 text-sm px-3 py-1 rounded"
              >
                ⚠️ You are not logged in. Some features will be unavailable.
              </div>`
            : null}
          <br />
          <div class="flex justify-center items-center gap-3">
            <div class="${this.getRankStyle(this.currentRank).flagWrapper}">
              <img
                class="size-[48px] rounded-full block"
                src="/flags/${this.flag || "xx"}.svg"
                alt="Flag"
              />
            </div>
            <div class="${this.getRankStyle(this.currentRank).nameText}">
              ${this.playerName}
            </div>
            ${this.isLoggedIn
              ? html` <span>|</span>
                  <div class="${this.nameText}">${this.discordUserName}</div>
                  <div class="${this.flagWrapper}">
                    <img
                      class="size-[48px] rounded-full block"
                      src="${this.discordAvatarUrl}"
                      alt="Discord Avatar"
                    />
                  </div>`
              : null}
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="flex flex-wrap justify-center gap-2">
            <span
              class="text-sm border px-2 py-1 rounded-full flex items-center gap-1 ${this.getRankStyle(
                this.currentRank,
              ).bg} ${this.getRankStyle(this.currentRank)
                .border} ${this.getRankStyle(this.currentRank)
                .text} ${this.getRankStyle(this.currentRank).glow
                ? "glow-effect"
                : ""}"
            >
              ${this.currentRank}
            </span>
          </div>

          ${this.isLoggedIn
            ? html` <hr class="w-2/3 border-gray-600 my-2" />

                <div class="flex flex-wrap justify-center gap-2">
                  ${this.roles
                    .map((role) => ({
                      role,
                      priority: this.getRoleStyle(role).priority,
                    }))
                    .sort((a, b) => a.priority - b.priority)
                    .map(({ role }) => {
                      const { label, roleText, badgeBg } =
                        this.getRoleStyle(role);
                      const isOwner = role === "cre";
                      return html`
                        <span
                          class="${roleText} ${badgeBg} ${isOwner
                            ? "text-base border-2 shadow-md shadow-yellow-300/30 px-3 py-1.5"
                            : "text-sm border px-2 py-1"} rounded-full flex items-center gap-1"
                        >
                          ${isOwner ? "👑" : ""} ${label}
                        </span>
                      `;
                    })}
                </div>`
            : null}

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
                ${((this.wins / this.gamesPlayed) * 100).toFixed(1)}%
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

          <div class="text-sm text-gray-300 mb-2">
            📈 Your rank increases based on play time and number of wins.
          </div>

          <div
            class="progress-bar-container w-2/3 bg-white/10 h-3 rounded-full overflow-hidden mb-1 relative"
          >
            <div
              class="progress-bar h-full"
              style="
    width: ${this.progressPercent ?? 0}%;
    background-color: ${this.getProgressBarColor(this.progressPercent)};
  "
            ></div>
          </div>

          <div class="w-2/3 text-right text-xs text-gray-400 italic">
            Next rank: ${this.getNextRank() ?? "???"}
          </div>

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
                ${Object.entries(this.buildingStats)
                  .filter(([b]) =>
                    ["city", "port", "defense", "sam"].includes(b),
                  )
                  .map(([building, stats]) => {
                    const typedStats = stats as BuildingStat;
                    return html`
                      <tr>
                        <td>${this.getBuildingName(building)}</td>
                        <td class="text-center">${typedStats.built ?? 0}</td>
                        <td class="text-center">
                          ${typedStats.destroyed ?? 0}
                        </td>
                        <td class="text-center">${typedStats.captured ?? 0}</td>
                        <td class="text-center">${typedStats.lost ?? 0}</td>
                      </tr>
                    `;
                  })}
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
                ${["transportShip", "tradeShip", "warship"].map((ship) => {
                  const stats = this.buildingStats[ship] as ShipStat;
                  return html`
                    <tr>
                      <td>${this.getBuildingName(ship)}</td>
                      <td class="text-center">${stats.sent ?? 0}</td>
                      <td class="text-center">${stats.destroyed ?? 0}</td>
                      <td class="text-center">${stats.arrived ?? 0}</td>
                    </tr>
                  `;
                })}
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
                ${Object.entries(this.buildingStats)
                  .filter(([b]) =>
                    ["atom", "hydrogen", "mirv", "silo"].includes(b),
                  )
                  .map(([building, stats]) => {
                    const typedStats = stats as NukeStat;
                    return html`
                      <tr>
                        <td>${this.getBuildingName(building)}</td>
                        <td class="text-center">${typedStats.built ?? 0}</td>
                        <td class="text-center">
                          ${typedStats.destroyed ?? 0}
                        </td>
                        <td class="text-center">${typedStats.hits ?? 0}</td>
                      </tr>
                    `;
                  })}
              </tbody>
            </table>
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="mt-4 w-full max-w-md">
            <div class="text-sm text-gray-400 font-semibold mb-1">
              🏅 Achievements
            </div>
            <!-- text-green-400 text-purple-400 -->

            ${(() => {
              const stats = this.getAchievementStats();
              return html`
                <div class="text-sm text-gray-300 mb-2">
                  Unlocked: ${stats.unlocked}/${stats.total}
                  (${stats.unlockedRatio.toFixed(1)}%)
                </div>

                <div
                  class="progress-bar-container w-full bg-white/10 h-3 rounded-full overflow-hidden mb-2 relative"
                >
                  <div
                    class="progress-bar h-full bg-green-500"
                    style="width: ${stats.unlockedRatio}%;"
                  ></div>
                </div>

                <div class="text-sm text-gray-300 mb-2">
                  Secret Achievements:
                  ${stats.secretUnlocked}/${stats.secretTotal}
                  (${stats.secretUnlockedRatio.toFixed(1)}%)
                </div>
                <div
                  class="progress-bar-container w-full bg-white/10 h-3 rounded-full overflow-hidden mb-2 relative"
                >
                  <div
                    class="progress-bar h-full bg-gray-500"
                    style="width: ${stats.secretUnlockedRatio}%;"
                  ></div>
                </div>

                <div class="text-sm text-gray-300 mb-2">
                  Difficulty Breakdown:
                  <ul class="list-disc list-inside">
                    <li class="flex items-center gap-4">
                      <span class="w-1/2 text-green-400">
                        Easy: ${stats.difficultyCounts.easy} /
                        ${stats.difficultyTotals.easy}
                        (${(
                          (stats.difficultyCounts.easy /
                            stats.difficultyTotals.easy) *
                          100
                        ).toFixed(1)}%)
                      </span>
                      <div
                        class="progress-bar-container w-1/2 bg-white/10 h-2 rounded-full overflow-hidden"
                      >
                        <div
                          class="progress-bar h-full bg-green-500"
                          style="width: ${(
                            (stats.difficultyCounts.easy /
                              stats.difficultyTotals.easy) *
                            100
                          ).toFixed(1)}%;"
                        ></div>
                      </div>
                    </li>
                    <li class="flex items-center gap-4">
                      <span class="w-1/2 text-yellow-400">
                        Medium: ${stats.difficultyCounts.medium} /
                        ${stats.difficultyTotals.medium}
                        (${(
                          (stats.difficultyCounts.medium /
                            stats.difficultyTotals.medium) *
                          100
                        ).toFixed(1)}%)
                      </span>
                      <div
                        class="progress-bar-container w-1/2 bg-white/10 h-2 rounded-full overflow-hidden"
                      >
                        <div
                          class="progress-bar h-full bg-yellow-500"
                          style="width: ${(
                            (stats.difficultyCounts.medium /
                              stats.difficultyTotals.medium) *
                            100
                          ).toFixed(1)}%;"
                        ></div>
                      </div>
                    </li>
                    <li class="flex items-center gap-4">
                      <span class="w-1/2 text-red-400">
                        Hard: ${stats.difficultyCounts.hard} /
                        ${stats.difficultyTotals.hard}
                        (${(
                          (stats.difficultyCounts.hard /
                            stats.difficultyTotals.hard) *
                          100
                        ).toFixed(1)}%)
                      </span>
                      <div
                        class="progress-bar-container w-1/2 bg-white/10 h-2 rounded-full overflow-hidden"
                      >
                        <div
                          class="progress-bar h-full bg-red-500"
                          style="width: ${(
                            (stats.difficultyCounts.hard /
                              stats.difficultyTotals.hard) *
                            100
                          ).toFixed(1)}%;"
                        ></div>
                      </div>
                    </li>
                    <li class="flex items-center gap-4">
                      <span class="w-1/2 text-purple-400">
                        Impossible: ${stats.difficultyCounts.impossible} /
                        ${stats.difficultyTotals.impossible}
                        (${(
                          (stats.difficultyCounts.impossible /
                            stats.difficultyTotals.impossible) *
                          100
                        ).toFixed(1)}%)
                      </span>
                      <div
                        class="progress-bar-container w-1/2 bg-white/10 h-2 rounded-full overflow-hidden"
                      >
                        <div
                          class="progress-bar h-full bg-purple-500"
                          style="width: ${(
                            (stats.difficultyCounts.impossible /
                              stats.difficultyTotals.impossible) *
                            100
                          ).toFixed(1)}%;"
                        ></div>
                      </div>
                    </li>
                  </ul>
                </div>
              `;
            })()}

            <div
              class="flex gap-4 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900"
            >
              ${achievementsData
                .sort((a, b) => {
                  const aUnlocked = this.achievements.includes(a.id);
                  const bUnlocked = this.achievements.includes(b.id);
                  if (aUnlocked !== bUnlocked) {
                    return aUnlocked ? -1 : 1;
                  }

                  const difficultyOrder = [
                    "easy",
                    "medium",
                    "hard",
                    "impossible",
                  ];
                  const diffA = difficultyOrder.indexOf(a.difficulty);
                  const diffB = difficultyOrder.indexOf(b.difficulty);
                  if (diffA !== diffB) {
                    return diffA - diffB;
                  }

                  if (a.secret !== b.secret) {
                    return a.secret ? 1 : -1;
                  }

                  return 0;
                })
                .map((achievement) => {
                  const difficultyStyles = {
                    easy: "border-green-500 bg-green-500/10 shadow-green-500/30",
                    medium:
                      "border-yellow-500 bg-yellow-500/10 shadow-yellow-500/30",
                    hard: "border-red-500 bg-red-500/10 shadow-red-500/30",
                    impossible:
                      "border-purple-500 bg-purple-500/10 shadow-purple-500/30 impossible-animation",
                  };

                  const lockedStyle = {
                    easy: "border-green-500 bg-green-500/5 shadow-green-500/10",
                    medium:
                      "border-yellow-500 bg-yellow-500/5 shadow-yellow-500/10",
                    hard: "border-red-500 bg-red-500/5 shadow-red-500/10",
                    impossible:
                      "border-purple-500 bg-purple-500/5 shadow-purple-500/10 impossible-animation",
                  };

                  const difficultyStyle = this.achievements.includes(
                    achievement.id,
                  )
                    ? difficultyStyles[achievement.difficulty] ||
                      "border-gray-500 bg-gray-500/10 shadow-gray-500/30"
                    : lockedStyle[achievement.difficulty] ||
                      "border-gray-500 bg-gray-500/5 shadow-gray-500/10";

                  return html`
                    <div
                      class="flex-shrink-0 w-48 p-4 rounded-lg border transition-transform duration-300 hover:scale-105 ${difficultyStyle}"
                      style="transform: scale(0.9);"
                      @mouseover=${(e: Event) =>
                        ((e.currentTarget as HTMLElement).style.transform =
                          "scale(0.95)")}
                      @mouseout=${(e: Event) =>
                        ((e.currentTarget as HTMLElement).style.transform =
                          "scale(0.9)")}
                    >
                      ${achievement.secret
                        ? html`<div
                            class="absolute top-1 right-2 text-[10px] text-red-400 font-bold"
                          >
                            Hidden Achievement
                          </div>`
                        : null}
                      <span
                        class="text-2xl ${this.achievements.includes(
                          achievement.id,
                        )
                          ? "text-white"
                          : "text-gray-400"}"
                      >
                        ${this.achievements.includes(achievement.id)
                          ? "✅"
                          : "🔒"}
                      </span>
                      <div
                        class="mt-2 font-semibold ${this.achievements.includes(
                          achievement.id,
                        )
                          ? "text-white"
                          : "text-gray-400"} text-lg"
                      >
                        ${achievement.secret &&
                        !this.achievements.includes(achievement.id)
                          ? "???"
                          : achievement.title}
                      </div>
                      <div
                        class="text-xs ${this.achievements.includes(
                          achievement.id,
                        )
                          ? "text-gray-300"
                          : "text-gray-500"}"
                      >
                        ${achievement.secret &&
                        !this.achievements.includes(achievement.id)
                          ? "Unlock to reveal"
                          : achievement.description}
                      </div>
                      <div
                        class="text-xs mt-1 ${this.achievements.includes(
                          achievement.id,
                        )
                          ? "text-gray-400"
                          : `text-${
                              achievement.difficulty === "easy"
                                ? "green-400"
                                : achievement.difficulty === "medium"
                                  ? "yellow-400"
                                  : achievement.difficulty === "hard"
                                    ? "red-400"
                                    : "purple-400"
                            }`}"
                      >
                        Difficulty: ${achievement.difficulty}
                      </div>
                    </div>
                  `;
                })}
            </div>
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="mt-4 w-full max-w-md">
            <div class="text-sm text-gray-400 font-semibold mb-1">
              🎮 Recent Players
            </div>
            <div class="flex flex-col gap-2">
              ${this.recentPlayers.map((player) => {
                const rankStyle = this.getRankStyle(player.rank);
                return html`
                  <div
                    class="flex items-center justify-between px-4 py-2 rounded border ${rankStyle.border} ${rankStyle.bgLight}"
                  >
                    <div class="flex items-center gap-3">
                      <img
                        class="w-8 h-8 rounded-full ${rankStyle.flagWrapper}"
                        src="/flags/${player.flag}.svg"
                        alt="${player.flag} flag"
                      />
                      <div>
                        <div class="text-sm font-semibold ${rankStyle.text}">
                          ${player.gameName}
                        </div>
                        <div class="text-xs ${rankStyle.text}">
                          ${player.rank}
                        </div>
                      </div>
                    </div>
                    <button
                      class="text-sm text-gray-300 bg-gray-700 px-3 py-1 rounded"
                      @click=${() => this.viewPlayer(player)}
                    >
                      View
                    </button>
                  </div>
                `;
              })}
            </div>
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="mt-4 w-full max-w-md">
            <div class="text-sm text-gray-400 font-semibold mb-1">
              🎮 Recent Games
            </div>
            <div class="flex flex-col gap-2">
              ${this.recentGames.map(
                (game) => html`
                  <div
                    class="flex items-center justify-between bg-white/5 px-4 py-2 rounded border border-white/10"
                  >
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
                        ? (() => {
                            const className =
                              this.colorClassMap[game.teamColor] ||
                              "text-white";
                            return html`
                              <div class="${className} text-xs font-semibold">
                                Player Team Color: ${game.teamColor}
                              </div>
                            `;
                          })()
                        : null}
                      <div
                        class="text-xs ${game.won
                          ? "text-green-400"
                          : "text-red-400"}"
                      >
                        ${game.won ? "Victory" : "Defeat"}
                      </div>
                    </div>
                    <button
                      class="text-sm text-gray-300 bg-gray-700 px-3 py-1 rounded"
                      @click=${() => this.viewGame(game)}
                    >
                      View
                    </button>
                  </div>
                `,
              )}
            </div>
          </div>

          ${this.isDebugMode
            ? html`
                <hr class="w-2/3 border-gray-600 my-2" />

                <div class="mt-4 w-full max-w-md">
                  <div class="text-sm text-gray-400 font-semibold mb-1">
                    🛠️ Debug: Set Roles
                  </div>
                  <div class="flex flex-wrap gap-2">
                    ${Object.keys(this.getAllRolesSorted()).map((role) => {
                      const isSelected = this.roles.includes(role);
                      return html`
                        <label
                          class="flex items-center gap-1 text-xs bg-white/5 px-2 py-1 rounded border border-white/10 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            class="accent-white"
                            .checked=${isSelected}
                            @change=${(e: Event) =>
                              this.toggleRole(
                                role,
                                (e.target as HTMLInputElement).checked,
                              )}
                          />
                          ${this.getRoleStyle(role).label}
                        </label>
                      `;
                    })}
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      .value=${this.progressPercent}
                      @input=${(e: Event) =>
                        (this.progressPercent = Number(
                          (e.target as HTMLInputElement).value,
                        ))}
                      class="w-full"
                    />
                    <span class="text-sm text-gray-300"
                      >${this.progressPercent}%</span
                    >
                  </div>
                </div>
                <div class="mt-4 w-full max-w-md">
                  <button
                    class="text-sm text-gray-300 bg-gray-700 px-3 py-1 rounded"
                    @click=${this.advanceRank}
                  >
                    Advance Rank
                  </button>
                  <div class="flex flex-wrap gap-2">
                    ${achievementsData
                      .slice()
                      .sort((a, b) => {
                        const difficultyOrder = [
                          "easy",
                          "medium",
                          "hard",
                          "impossible",
                        ];
                        const diffA = difficultyOrder.indexOf(a.difficulty);
                        const diffB = difficultyOrder.indexOf(b.difficulty);

                        if (diffA !== diffB) {
                          return diffA - diffB;
                        }

                        return a.id.localeCompare(b.id);
                      })
                      .map((achievement) => {
                        const isUnlocked = this.achievements.includes(
                          achievement.id,
                        );
                        return html`
                          <label
                            class="flex items-center gap-1 text-xs bg-white/5 px-2 py-1 rounded border border-white/10 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              class="accent-white"
                              .checked=${isUnlocked}
                              @change=${(e: Event) =>
                                this.toggleAchievement(
                                  achievement.id,
                                  (e.target as HTMLInputElement).checked,
                                )}
                            />
                            ${achievement.title}
                          </label>
                        `;
                      })}
                  </div>
                </div>
              `
            : null}
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

  private toggleAchievement(achievementId: string, checked: boolean): void {
    if (checked && !this.achievements.includes(achievementId)) {
      this.achievements = [...this.achievements, achievementId];
    } else if (!checked) {
      this.achievements = this.achievements.filter(
        (id) => id !== achievementId,
      );
    }
    this.requestUpdate();
  }
}
