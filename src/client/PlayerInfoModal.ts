import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { getUserMe, isLoggedIn } from "./jwt";
import { rankStyles, roleStyles } from "./Utils";

@customElement("player-info-modal")
export class PlayerInfoModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

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
    "Best-Known Player",
    "Legend",
  ];

  private getNextRank(): string {
    const currentIndex = this.rankList.indexOf(this.currentRank);
    return this.rankList[currentIndex + 1] || "Max Rank Achieved";
  }

  @state() private isDebugMode: boolean = true;

  @state() private wins: number = 12;
  @state() private playTimeSeconds: number = 5 * 3600 + 33 * 60;
  @state() private progressPercent: number = 62;

  @state() private buildingStats = {
    city: { built: 0, destroyed: 0, finalCount: 0 },
    defense: { built: 0, destroyed: 0, finalCount: 0 },
    port: { built: 0, destroyed: 0, finalCount: 0 },
    warship: { built: 0, destroyed: 0, finalCount: 0 },
    silo: { built: 0, destroyed: 0, finalCount: 0 },
    sam: { built: 0, destroyed: 0, finalCount: 0 },
    atom: { built: "x", destroyed: "x", finalCount: 0 },
    hydrogen: { built: "x", destroyed: "x", finalCount: 0 },
    mirv: { built: "x", destroyed: "x", finalCount: 0 },
  };

  @state() private achievements = [
    {
      title: "Builder",
      description: "Build 10 structures",
      unlocked: false,
      difficulty: "easy",
    },
    {
      title: "First Win",
      description: "Win your first public game",
      unlocked: false,
      difficulty: "medium",
    },
    {
      title: "5 Win Streak",
      description: "Win 5 games in a row",
      unlocked: false,
      difficulty: "hard",
    },
    {
      title: "Chocolate!",
      description: "Get chocolate role!",
      unlocked: true,
      difficulty: "medium",
    },
  ];

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
      "bst", // Server Booster
      "ccr", // Content Creator
      "bet", // Beta Tester
      "eas", // Early Access Supporter
      "mod", // Mod
      "sta", // Support Staff
      "dca", // DevChatAccess
      "mem", // Member
      "act", // Active Contributor
      "ass", // Admin Assistant
      "tra", // Translator
      "trd", // Translator Dev
      "trh", // Translator Helper
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
  private getRoleStyle(role: string) {
    return roleStyles[role] || roleStyles["member"];
  }

  private getRankStyle(rank: string) {
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
      defense: "Defense",
      port: "Port",
      warship: "Warship",
      silo: "Silo",
      sam: "SAM",
      atom: "Atom",
      hydrogen: "Hydrogen",
      mirv: "MIRV",
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

  private async getUserInfo(): Promise<void> {
    const claims = isLoggedIn();

    if (claims === false) {
      this.discordUserName = ".w.";
      this.discordAvatarUrl = "https://cdn.discordapp.com/embed/avatars/1.png";
      this.roles = [];
    } else {
      const { rol } = claims;
      this.roles = rol;

      const userMeResponse = await getUserMe();
      if (userMeResponse && typeof userMeResponse === "object") {
        const { user } = userMeResponse;
        const { username, id, avatar } = user;
        this.discordUserName = username;
        this.discordAvatarUrl = avatar
          ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.${avatar.startsWith("a_") ? "gif" : "png"}`
          : `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator) % 5}.png`;
      } else {
        this.discordUserName = ".w."; // test name
        this.discordAvatarUrl =
          "https://cdn.discordapp.com/avatars/1198183481545592893/3daf014eddd85cf4dc9c72b86c3d2c57"; // test avatar
      }
    }

    this.playerName = this.getStoredName();
    this.flag = this.getStoredFlag();
    this.highestRole = this.getHighestRole(this.roles);
    const { flagWrapper, nameText } = this.getRoleStyle(this.highestRole);
    this.flagWrapper = flagWrapper;
    this.nameText = nameText;

    this.requestUpdate();
  }

  render() {
    return html`
      <o-modal id="playerInfoModal" title="Player Info">
        <div class="flex flex-col items-center mt-2 mb-4">
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
            <span>|</span>
            <div class="${this.nameText}">${this.discordUserName}</div>
            <div class="${this.flagWrapper}">
              <img
                class="size-[48px] rounded-full block"
                src="${this.discordAvatarUrl}"
                alt="Discord Avatar"
              />
            </div>
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="flex flex-wrap justify-center gap-2 mb-2">
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

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="flex flex-wrap justify-center gap-2 mb-2">
            ${this.roles
              .map((role) => ({
                role,
                priority: this.getRoleStyle(role).priority,
              }))
              .sort((a, b) => a.priority - b.priority)
              .map(({ role }) => {
                const { label, roleText, badgeBg } = this.getRoleStyle(role);
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
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="flex justify-center gap-6 text-sm text-white">
            <div class="flex items-center gap-1">
              <span>🏆</span>
              <span>Wins: ${this.wins ?? 0}</span>
            </div>
            <div class="flex items-center gap-1">
              <span>⏱️</span>
              <span
                >Play Time:
                ${this.formatPlayTime(this.playTimeSeconds ?? 0)}</span
              >
            </div>
          </div>

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
                  <th class="text-left">Building</th>
                  <th class="text-right">Built</th>
                  <th class="text-right">Destroyed</th>
                  <th class="text-right">Final Count</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(this.buildingStats).map(
                  ([building, stats]) => html`
                    <tr>
                      <td>${this.getBuildingName(building)}</td>
                      <td class="text-right">
                        ${stats.built === "x"
                          ? html`<span class="text-gray-500 italic">N/A</span>`
                          : stats.built}
                      </td>
                      <td class="text-right">
                        ${stats.destroyed === "x"
                          ? html`<span class="text-gray-500 italic">N/A</span>`
                          : stats.destroyed}
                      </td>
                      <td class="text-right">${stats.finalCount}</td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="mt-4 w-full max-w-md">
            <div class="text-sm text-gray-400 font-semibold mb-1">
              🏅 Achievements
            </div>
            <div
              class="flex gap-4 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900"
            >
              ${this.achievements.map((achievement) => {
                const difficultyStyles = {
                  easy: "border-green-500 bg-green-500/10 shadow-green-500/30",
                  medium:
                    "border-yellow-500 bg-yellow-500/10 shadow-yellow-500/30",
                  hard: "border-red-500 bg-red-500/10 shadow-red-500/30",
                };

                const lockedStyle = {
                  easy: "border-green-500 bg-green-500/5 shadow-green-500/10",
                  medium:
                    "border-yellow-500 bg-yellow-500/5 shadow-yellow-500/10",
                  hard: "border-red-500 bg-red-500/5 shadow-red-500/10",
                };

                const difficultyStyle = achievement.unlocked
                  ? difficultyStyles[achievement.difficulty]
                  : lockedStyle[achievement.difficulty];

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
                    <span
                      class="text-2xl ${achievement.unlocked
                        ? "text-white"
                        : "text-gray-400"}"
                    >
                      ${achievement.unlocked ? "✅" : "🔒"}
                    </span>
                    <div
                      class="mt-2 font-semibold ${achievement.unlocked
                        ? "text-white"
                        : "text-gray-400"} text-lg"
                    >
                      ${achievement.title}
                    </div>
                    <div
                      class="text-xs ${achievement.unlocked
                        ? "text-gray-300"
                        : "text-gray-500"}"
                    >
                      ${achievement.description}
                    </div>
                    <div
                      class="text-xs mt-1 ${achievement.unlocked
                        ? "text-gray-400"
                        : `text-${
                            achievement.difficulty === "easy"
                              ? "green-400"
                              : achievement.difficulty === "medium"
                                ? "yellow-400"
                                : "red-400"
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

          ${this.isDebugMode
            ? html`
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

  connectedCallback() {
    super.connectedCallback();
    this.getUserInfo();
  }
}
