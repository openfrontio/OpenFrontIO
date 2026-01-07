import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  PlayerGame,
  PlayerStatsTree,
  UserMeResponse,
} from "../core/ApiSchemas";
import { fetchPlayerById, getUserMe } from "./Api";
import { discordLogin, logOut, sendMagicLink } from "./Auth";
import "./components/baseComponents/stats/DiscordUserHeader";
import "./components/baseComponents/stats/GameList";
import "./components/baseComponents/stats/PlayerStatsTable";
import "./components/baseComponents/stats/PlayerStatsTree";
import "./components/Difficulties";
import "./components/PatternButton";
import { isInIframe, translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends LitElement {
  @property({ type: Boolean }) inline = false;
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private email: string = "";
  @state() private isLoadingUser: boolean = false;

  private userMeResponse: UserMeResponse | null = null;
  private statsTree: PlayerStatsTree | null = null;
  private recentGames: PlayerGame[] = [];

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        this.userMeResponse = customEvent.detail as UserMeResponse;
        if (this.userMeResponse?.player?.publicId === undefined) {
          this.statsTree = null;
          this.recentGames = [];
        }
      } else {
        this.statsTree = null;
        this.recentGames = [];
        this.requestUpdate();
      }
    });
  }

  createRenderRoot() {
    return this;
  }

  render() {
    const content = this.isLoadingUser
      ? html`
          <div
            class="flex flex-col items-center justify-center p-12 text-white bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 h-full min-h-[400px]"
          >
            <div
              class="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4"
            ></div>
            <p class="text-white/60 font-medium tracking-wide animate-pulse">
              ${translateText("account_modal.fetching_account")}
            </p>
          </div>
        `
      : this.renderInner();

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="account-modal"
        title="${translateText("account_modal.title") || "Account"}"
        ?inline=${this.inline}
      >
        ${content}
      </o-modal>
    `;
  }

  private renderInner() {
    if (this.userMeResponse?.user) {
      return this.renderAccountInfo();
    } else {
      return this.renderLoginOptions();
    }
  }

  private renderAccountInfo() {
    const me = this.userMeResponse?.user;
    const isLinked = me?.discord ?? me?.email;

    return html`
      <div
        class="h-full flex flex-col bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 p-6 shadow-xl overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex items-center justify-between pb-6 border-b border-white/10 gap-4 mb-0 shrink-0"
        >
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400 border border-blue-500/20"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-6 h-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <div>
              <h2
                class="text-2xl font-bold text-white uppercase tracking-widest leading-none"
              >
                ${translateText("account_modal.title") || "Account"}
              </h2>
              <div class="flex items-center gap-2 mt-1.5">
                <span
                  class="text-xs text-blue-400 font-bold uppercase tracking-wider"
                  >ID:</span
                >
                <span
                  class="text-xs text-white/60 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/5"
                >
                  ${this.userMeResponse?.player?.publicId ??
                  translateText("account_modal.not_found")}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Scrollable Content -->
        <div class="flex-1 overflow-y-auto custom-scrollbar pr-2 mt-6">
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <!-- Left Sidebar: Profile & Link -->
            <div class="lg:col-span-4 space-y-6 lg:sticky lg:top-0">
              ${isLinked
                ? html`
                    <div
                      class="bg-black/20 rounded-xl border border-white/10 p-6 flex flex-col gap-4"
                    >
                      <div
                        class="text-xs text-white/40 uppercase tracking-widest font-bold text-center border-b border-white/5 pb-2"
                      >
                        Connected As
                      </div>
                      <div class="flex flex-col items-center gap-4 py-2">
                        <discord-user-header
                          .data=${this.userMeResponse?.user?.discord ?? null}
                        ></discord-user-header>
                        ${this.renderLoggedInAs()}
                      </div>
                    </div>
                  `
                : this.renderLinkAccountSection()}
            </div>

            <!-- Right Content: Stats & Games -->
            <div class="lg:col-span-8 flex flex-col gap-8">
              <!-- Stats Section -->
              <div class="bg-black/20 rounded-xl border border-white/10 p-6">
                <h3
                  class="text-lg font-bold text-white mb-4 flex items-center gap-2"
                >
                  <span class="text-blue-400">📊</span>
                  Stats Overview
                </h3>
                <player-stats-tree-view
                  .statsTree=${this.statsTree}
                ></player-stats-tree-view>
              </div>

              <!-- Recent Games Section -->
              <div class="bg-black/20 rounded-xl border border-white/10 p-6">
                <h3
                  class="text-lg font-bold text-white mb-4 flex items-center gap-2"
                >
                  <span class="text-blue-400">🎮</span>
                  ${translateText("game_list.recent_games")}
                </h3>
                <game-list
                  .games=${this.recentGames}
                  .onViewGame=${(id: string) => this.viewGame(id)}
                ></game-list>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderLinkAccountSection(): TemplateResult {
    return html`
      <div class="bg-blue-500/10 rounded-xl border border-blue-500/20 p-6">
        <div class="flex items-start gap-4 mb-6">
          <div
            class="p-3 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/20"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-6 h-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.7l-1.2 4 6 3.2-2 2-4-1.5L1 16l7.4 1.6c.7.1 1.4-.1 1.9-.4l4.1-4.1 3.4 4.5c.5.6 1.1.7 1.3.6l.5-.6c.2-.2.2-.7-.4-1.4z"
              />
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-bold text-white uppercase tracking-wider">
              Save Your Progress
            </h3>
            <p class="text-sm text-white/60 mt-1">
              Link your account to keep your stats, rank, and cosmetics safe.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            @click="${this.handleDiscordLogin}"
            class="px-4 py-3 text-white bg-[#5865F2] hover:bg-[#4752C4] border border-transparent rounded-xl focus:outline-none transition-all duration-200 flex items-center justify-center gap-2 group relative overflow-hidden shadow-lg hover:shadow-xl"
          >
            <img
              src="/images/DiscordLogo.svg"
              alt="Discord"
              class="w-5 h-5 relative z-10"
            />
            <span class="font-bold text-sm relative z-10 tracking-wide"
              >${translateText("main.login_discord") ||
              "Link Discord Account"}</span
            >
          </button>

          <div class="relative group h-full">
            <div class="flex gap-2 h-full">
              <input
                type="email"
                .value="${this.email}"
                @input="${this.handleEmailInput}"
                class="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500 transition-all font-medium h-full"
                placeholder="Link via Email"
              />
              <button
                @click="${this.handleSubmit}"
                class="px-6 py-2 text-sm font-bold text-white uppercase bg-blue-600 hover:bg-blue-500 rounded-lg transition-all border border-blue-500/50 hover:shadow-[0_0_15px_rgba(37,99,235,0.3)] h-full"
              >
                Link
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderLoggedInAs(): TemplateResult {
    const me = this.userMeResponse?.user;
    if (me?.discord) {
      return html`
        <div class="flex flex-col items-center gap-3 w-full">
          ${this.renderLogoutButton()}
        </div>
      `;
    } else if (me?.email) {
      return html`
        <div class="flex flex-col items-center gap-3 w-full">
          <div class="text-white text-lg font-medium">
            ${translateText("account_modal.linked_account", {
              account_name: me.email,
            })}
          </div>
          ${this.renderLogoutButton()}
        </div>
      `;
    }

    // "Mini" Login Options for linking account
    return html`
      <div class="w-full space-y-3">
        <button
          @click="${this.handleDiscordLogin}"
          class="w-full px-4 py-3 text-white bg-[#5865F2] hover:bg-[#4752C4] border border-transparent rounded-xl focus:outline-none transition-colors duration-200 flex items-center justify-center gap-2 group relative overflow-hidden"
        >
          <img
            src="/images/DiscordLogo.svg"
            alt="Discord"
            class="w-5 h-5 relative z-10"
          />
          <span class="font-bold text-sm relative z-10 tracking-wide"
            >${translateText("main.login_discord") ||
            "Link Discord Account"}</span
          >
        </button>

        <div class="relative group">
          <div class="flex gap-2">
            <input
              type="email"
              .value="${this.email}"
              @input="${this.handleEmailInput}"
              class="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500 transition-all font-medium"
              placeholder="Link via Email"
            />
            <button
              @click="${this.handleSubmit}"
              class="px-4 py-2 text-sm font-bold text-white uppercase bg-blue-600 hover:bg-blue-500 rounded-lg transition-all"
            >
              Link
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private viewGame(gameId: string): void {
    this.close();
    const path = location.pathname;
    const { search } = location;
    const hash = `#join=${encodeURIComponent(gameId)}`;
    const newUrl = `${path}${search}${hash}`;

    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  private renderLogoutButton(): TemplateResult {
    return html`
      <button
        @click="${this.handleLogout}"
        class="px-6 py-2 text-sm font-bold text-white uppercase tracking-wider bg-red-600/80 hover:bg-red-600 border border-red-500/50 rounded-lg transition-all shadow-lg hover:shadow-red-900/40"
      >
        Log Out
      </button>
    `;
  }

  private renderLoginOptions() {
    return html`
      <div
        class="h-full flex flex-col bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 p-8 shadow-xl max-w-md mx-auto"
      >
        <div class="text-center mb-10">
          <div
            class="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-blue-500/20"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-8 h-8 text-blue-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
              <polyline points="10 17 15 12 10 7"></polyline>
              <line x1="15" y1="12" x2="3" y2="12"></line>
            </svg>
          </div>
          <h2
            class="text-3xl font-bold text-white uppercase tracking-widest mb-2"
          >
            ${translateText("account_modal.title") || "Login"}
          </h2>
          <p class="text-white/40 text-sm">
            Sign in to save your stats and progress
          </p>
        </div>

        <div class="space-y-8">
          <!-- Discord Login Button -->
          <button
            @click="${this.handleDiscordLogin}"
            class="w-full px-6 py-4 text-white bg-[#5865F2] hover:bg-[#4752C4] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#5865F2] transition-colors duration-200 flex items-center justify-center gap-3 group relative overflow-hidden"
          >
            <div
              class="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"
            ></div>
            <img
              src="/images/DiscordLogo.svg"
              alt="Discord"
              class="w-6 h-6 relative z-10"
            />
            <span class="font-bold relative z-10 tracking-wide"
              >${translateText("main.login_discord") ||
              "Login with Discord"}</span
            >
          </button>

          <!-- Divider -->
          <div class="flex items-center gap-4">
            <div class="h-px bg-white/10 flex-1"></div>
            <span class="text-xs uppercase tracking-widest text-white/40">
              or continue with email
            </span>
            <div class="h-px bg-white/10 flex-1"></div>
          </div>

          <!-- Email Recovery -->
          <div class="space-y-4">
            <div class="relative group">
              <input
                type="email"
                id="email"
                name="email"
                .value="${this.email}"
                @input="${this.handleEmailInput}"
                class="w-full pl-4 pr-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-medium"
                placeholder="Enter your email address"
                required
              />
            </div>
            <button
              @click="${this.handleSubmit}"
              class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg shadow-blue-900/20"
              style="box-shadow: none;"
            >
              Submit
            </button>
          </div>
        </div>

        <div class="mt-auto pt-10 text-center">
          <button
            @click="${this.handleLogout}"
            class="text-xs font-medium text-red-400 hover:text-red-300 transition-colors uppercase tracking-widest border-b border-transparent hover:border-red-400/50 pb-0.5"
          >
            ${translateText("account_modal.clear_session")}
          </button>
        </div>
      </div>
    `;
  }

  private handleEmailInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.email = target.value;
  }

  private async handleSubmit() {
    if (!this.email) {
      alert(translateText("account_modal.enter_email_address"));
      return;
    }

    const success = await sendMagicLink(this.email);
    if (success) {
      alert(
        translateText("account_modal.recovery_email_sent", {
          email: this.email,
        }),
      );
    } else {
      alert(translateText("account_modal.failed_to_send_recovery_email"));
    }
  }

  private handleDiscordLogin() {
    discordLogin();
  }

  public open() {
    this.modalEl?.open();
    this.isLoadingUser = true;

    void getUserMe()
      .then((userMe) => {
        if (userMe) {
          this.userMeResponse = userMe;
          if (this.userMeResponse?.player?.publicId) {
            this.loadPlayerProfile(this.userMeResponse.player.publicId);
          }
        }
        this.isLoadingUser = false;
        this.requestUpdate();
      })
      .catch((err) => {
        console.warn("Failed to fetch user info in AccountModal.open():", err);
        this.isLoadingUser = false;
        this.requestUpdate();
      });
    this.requestUpdate();
  }

  public close() {
    this.modalEl?.close();
  }

  private async handleLogout() {
    await logOut();
    this.close();
    // Refresh the page after logout to update the UI state
    window.location.reload();
  }

  private async loadPlayerProfile(publicId: string): Promise<void> {
    try {
      const data = await fetchPlayerById(publicId);
      if (!data) {
        this.requestUpdate();
        return;
      }

      this.recentGames = data.games;
      this.statsTree = data.stats;

      this.requestUpdate();
    } catch (err) {
      console.warn("Failed to load player data:", err);
      this.requestUpdate();
    }
  }
}

@customElement("account-button")
export class AccountButton extends LitElement {
  @state() private loggedInEmail: string | null = null;
  @state() private loggedInDiscord: string | null = null;

  private isVisible = true;

  @query("account-modal") private recoveryModal: AccountModal;

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;

      if (customEvent.detail) {
        const userMeResponse = customEvent.detail as UserMeResponse;
        if (userMeResponse.user.email) {
          this.loggedInEmail = userMeResponse.user.email;
          this.requestUpdate();
        } else if (userMeResponse.user.discord) {
          this.loggedInDiscord = userMeResponse.user.discord.id;
          this.requestUpdate();
        }
      } else {
        // Clear the logged in states when user logs out
        this.loggedInEmail = null;
        this.loggedInDiscord = null;
        this.requestUpdate();
      }
    });
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (isInIframe()) {
      return html``;
    }

    if (!this.isVisible) {
      return html``;
    }

    let buttonTitle = "";
    if (this.loggedInEmail) {
      buttonTitle = translateText("account_modal.linked_account", {
        account_name: this.loggedInEmail,
      });
    } else if (this.loggedInDiscord) {
      buttonTitle = translateText("account_modal.linked_account");
    }

    return html`
      <div class="fixed top-4 right-4 z-[9998] hidden">
        <button
          @click="${this.open}"
          class="w-12 h-12 bg-orange-700 hover:bg-orange-800 text-white rounded-none shadow-lg transition-all duration-200 flex items-center justify-center text-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 border border-orange-500"
          title="${buttonTitle}"
        >
          ${this.renderIcon()}
        </button>
      </div>
      <account-modal></account-modal>
    `;
  }

  public renderIcon() {
    if (this.loggedInDiscord) {
      return html`<img
        src="/images/DiscordLogo.svg"
        alt="Discord"
        class="w-6 h-6"
      />`;
    } else if (this.loggedInEmail) {
      return html`<img
        src="/images/EmailIcon.svg"
        alt="Email"
        class="w-6 h-6"
      />`;
    }
    return html`<img
      src="/images/LoggedOutIcon.svg"
      alt="Logged Out"
      class="w-6 h-6"
    />`;
  }

  public open() {
    this.recoveryModal?.open();
  }

  public close() {
    this.isVisible = false;
    this.recoveryModal?.close();
    this.requestUpdate();
  }
}
