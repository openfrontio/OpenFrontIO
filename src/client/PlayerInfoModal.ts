import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";

@customElement("player-info-modal")
export class PlayerInfoModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private roles: string[] = ["user", "support"];

  @state() private wins: number = 12;
  @state() private playTimeSeconds: number = 5 * 3600 + 33 * 60;
  @state() private progressPercent: number = 62;
  @state() private nextRank: string = "Well-Known Player";

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
  }

  private getAllRolesSorted(): Record<string, any> {
    const allRoles = [
      "owner",
      "admin",
      "moderator",
      "support",
      "contributor",
      "supporter",
      "patron",
      "og",
      "og100",
      "user",
    ];
    return Object.fromEntries(allRoles.map((r) => [r, this.getRoleStyle(r)]));
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
    const roleStyles: Record<
      string,
      {
        label: string;
        flagWrapper: string;
        nameText: string;
        roleText: string;
        badgeBg: string;
        priority: number;
      }
    > = {
      owner: {
        label: "Owner",
        flagWrapper:
          "p-[3px] rounded-full bg-gradient-to-r from-yellow-200 via-yellow-300 to-yellow-200 animate-shimmer",
        nameText: "text-2xl font-bold text-yellow-200 drop-shadow",
        roleText: "text-yellow-200 font-semibold",
        badgeBg: "bg-yellow-100/20 border-yellow-200/30",
        priority: 120,
      },
      admin: {
        label: "Admin",
        flagWrapper:
          "p-[3px] rounded-full bg-gradient-to-r from-red-500 via-red-600 to-red-500 animate-shimmer",
        nameText: "text-2xl font-bold text-red-400 drop-shadow",
        roleText: "text-red-300 font-semibold",
        badgeBg: "bg-red-500/20 border-red-400/30",
        priority: 100,
      },
      moderator: {
        label: "Moderator",
        flagWrapper:
          "p-[3px] rounded-full bg-gradient-to-r from-orange-400 via-orange-500 to-orange-400 animate-shimmer",
        nameText: "text-2xl font-bold text-orange-300 drop-shadow",
        roleText: "text-orange-300 font-semibold",
        badgeBg: "bg-orange-400/20 border-orange-300/30",
        priority: 90,
      },
      support: {
        label: "Support Staff",
        flagWrapper:
          "p-[3px] rounded-full bg-gradient-to-r from-yellow-300 via-yellow-400 to-yellow-300 animate-shimmer",
        nameText: "text-2xl font-bold text-yellow-300 drop-shadow",
        roleText: "text-yellow-300 font-semibold",
        badgeBg: "bg-yellow-300/20 border-yellow-300/30",
        priority: 70,
      },
      contributor: {
        label: "Contributor",
        flagWrapper:
          "p-[3px] rounded-full bg-gradient-to-r from-green-400 to-green-600 animate-shimmer",
        nameText: "text-2xl font-bold text-green-300 drop-shadow",
        roleText: "text-green-300 font-semibold",
        badgeBg: "bg-green-500/20 border-green-300/30",
        priority: 60,
      },
      supporter: {
        label: "Supporter",
        flagWrapper:
          "p-[3px] rounded-full bg-gradient-to-r from-yellow-500 to-yellow-400 animate-shimmer",
        nameText: "text-2xl font-bold text-yellow-400 drop-shadow",
        roleText: "text-yellow-400 font-semibold",
        badgeBg: "bg-yellow-400/20 border-yellow-300/30",
        priority: 55,
      },
      patron: {
        label: "Patron",
        flagWrapper:
          "p-[3px] rounded-full bg-gradient-to-r from-purple-500 to-purple-700 animate-shimmer",
        nameText: "text-2xl font-bold text-purple-300 drop-shadow",
        roleText: "text-purple-300 font-semibold",
        badgeBg: "bg-purple-500/20 border-purple-400/30",
        priority: 50,
      },
      og: {
        label: "OG",
        flagWrapper:
          "p-[3px] rounded-full bg-gradient-to-r from-yellow-300 to-yellow-200 animate-shimmer",
        nameText: "text-2xl font-bold text-yellow-300 drop-shadow",
        roleText: "text-yellow-300 font-semibold",
        badgeBg: "bg-yellow-200/20 border-yellow-300/30",
        priority: 45,
      },
      og100: {
        label: "OG100",
        flagWrapper:
          "p-[3px] rounded-full bg-gradient-to-r from-lime-300 to-lime-500 animate-shimmer",
        nameText: "text-2xl font-bold text-lime-300 drop-shadow",
        roleText: "text-lime-300 font-semibold",
        badgeBg: "bg-lime-300/20 border-lime-300/30",
        priority: 43,
      },
      user: {
        label: "Player",
        flagWrapper: "p-[3px] rounded-full bg-gray-400",
        nameText: "text-2xl font-bold",
        roleText: "text-gray-300",
        badgeBg: "bg-white/10 border-white/10",
        priority: 0,
      },
    };

    return roleStyles[role] || roleStyles["user"];
  }

  private getHighestRole(roles: string[]): string {
    return (
      roles
        .map((role) => ({
          role,
          priority: this.getRoleStyle(role).priority,
        }))
        .sort((a, b) => b.priority - a.priority)[0]?.role ?? "user"
    );
  }

  render() {
    const playerName = this.getStoredName();
    const flag = this.getStoredFlag();
    const discordUserName = "DiscordName"; // test name
    const discordAvatarUrl =
      "https://cdn.discordapp.com/avatars/212760412582707200/06a64cee00dfb078269181f59a153ae3"; // test link

    const highestRole = this.getHighestRole(this.roles);
    const { flagWrapper, nameText } = this.getRoleStyle(highestRole);

    return html`
      <o-modal id="playerInfoModal" title="Player Info">
        <div class="flex flex-col items-center mt-2 mb-4">
          <div class="flex justify-center items-center gap-3">
            <div class="${flagWrapper}">
              <img
                class="size-[48px] rounded-full block"
                src="/flags/${flag || "xx"}.svg"
                alt="Flag"
              />
            </div>
            <div class="${nameText}">${playerName}</div>
            <span>|</span>
            <div class="${nameText}">${discordUserName}</div>
            <div class="${flagWrapper}">
              <img
                class="size-[48px] rounded-full block"
                src="${discordAvatarUrl}"
                alt="Discord Avatar"
              />
            </div>
          </div>

          <hr class="w-2/3 border-gray-600 my-2" />

          <div class="flex flex-wrap justify-center gap-2 mb-2">
            ${this.roles
              .map((role) => ({
                role,
                priority: this.getRoleStyle(role).priority,
              }))
              .sort((a, b) => b.priority - a.priority)
              .map(({ role }) => {
                const { label, roleText, badgeBg } = this.getRoleStyle(role);
                const isOwner = role === "owner";
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
            class="w-2/3 bg-white/10 h-3 rounded-full overflow-hidden mb-1 relative"
          >
            <div
              class="bg-green-400 h-full transition-all duration-300"
              style="width: ${this.progressPercent ?? 0}%;"
            ></div>
          </div>

          <div class="w-2/3 text-right text-xs text-gray-400 italic">
            Next rank: ${this.nextRank ?? "???"}
          </div>

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
}
