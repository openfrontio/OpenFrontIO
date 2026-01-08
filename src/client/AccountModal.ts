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
import { copyToClipboard, translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends LitElement {
  @property({ type: Boolean }) inline = false;
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private email: string = "";
  @state() private isLoadingUser: boolean = false;
  @state() private showCopied: boolean = false;

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

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.handleKeyDown);
    super.disconnectedCallback();
  }

  private async copyIdToClipboard() {
    const id = this.userMeResponse?.player?.publicId;
    if (!id) return;

    await copyToClipboard(
      id,
      () => (this.showCopied = true),
      () => (this.showCopied = false),
    );
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

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
        title=""
        ?hideCloseButton=${true}
        ?inline=${this.inline}
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  private renderInner() {
    const isLoggedIn = !!this.userMeResponse?.user;
    const title = translateText("account_modal.title") || "Account";

    return html`
      <div
        class="h-full flex flex-col bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden"
      >
        <div
          class="flex items-center mb-6 pb-2 border-b border-white/10 gap-2 shrink-0 p-6"
        >
          <div class="flex items-center gap-4 flex-1">
            <button
              @click=${() => this.close()}
              class="group flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/10"
              aria-label="Back"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5 text-gray-400 group-hover:text-white transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            <span
              class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest"
            >
              ${title}
            </span>
          </div>
          ${isLoggedIn
            ? html`
                <div class="flex items-center gap-2">
                  <span
                    class="text-xs text-blue-400 font-bold uppercase tracking-wider"
                    >ID:</span
                  >
                  <button
                    @click=${this.copyIdToClipboard}
                    class="text-xs text-white/60 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/5 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                    title="${translateText("common.click_to_copy")}"
                  >
                    ${this.showCopied
                      ? translateText("common.copied")
                      : (this.userMeResponse?.player?.publicId ??
                        translateText("account_modal.not_found"))}
                  </button>
                </div>
              `
            : ""}
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar mr-1">
          ${isLoggedIn ? this.renderAccountInfo() : this.renderLoginOptions()}
        </div>
      </div>
    `;
  }

  private renderAccountInfo() {
    const me = this.userMeResponse?.user;
    const isLinked = me?.discord ?? me?.email;

    if (!isLinked) {
      return html`
        <div class="p-6 flex justify-center items-start min-h-full">
          <div class="w-full max-w-2xl">${this.renderLinkAccountSection()}</div>
        </div>
      `;
    }

    return html`
      <div class="p-6">
        <div class="flex flex-col gap-6">
          <!-- Top Row: Connected As -->
          <div class="bg-white/5 rounded-xl border border-white/10 p-6">
            <div class="flex flex-col items-center gap-4">
              <div
                class="text-xs text-white/40 uppercase tracking-widest font-bold border-b border-white/5 pb-2 px-8"
              >
                ${translateText("account_modal.connected_as")}
              </div>
              <div class="flex items-center gap-8 justify-center flex-wrap">
                <discord-user-header
                  .data=${this.userMeResponse?.user?.discord ?? null}
                ></discord-user-header>
                ${this.renderLoggedInAs()}
              </div>
            </div>
          </div>

          <!-- Middle Row: Stats Section -->
          <div class="bg-white/5 rounded-xl border border-white/10 p-6">
            <h3
              class="text-lg font-bold text-white mb-4 flex items-center gap-2"
            >
              <span class="text-blue-400">📊</span>
              ${translateText("account_modal.stats_overview")}
            </h3>
            <player-stats-tree-view
              .statsTree=${this.statsTree}
            ></player-stats-tree-view>
          </div>

          <!-- Bottom Row: Recent Games Section -->
          <div class="bg-white/5 rounded-xl border border-white/10 p-6">
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
              ${translateText("account_modal.save_progress_title")}
            </h3>
            <p class="text-sm text-white/60 mt-1">
              ${translateText("account_modal.save_progress_desc")}
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <button
            @click="${this.handleDiscordLogin}"
            class="w-full px-4 py-3 text-white bg-[#5865F2] hover:bg-[#4752C4] border border-transparent rounded-xl focus:outline-none transition-all duration-200 flex items-center justify-center gap-2 group relative overflow-hidden shadow-lg hover:shadow-xl"
          >
            <img
              src="/images/DiscordLogo.svg"
              alt="Discord"
              class="w-5 h-5 relative z-10"
            />
            <span class="font-bold text-sm relative z-10 tracking-wide"
              >${translateText("main.login_discord") ||
              translateText("account_modal.link_discord")}</span
            >
          </button>

          <div class="relative group w-full">
            <div class="flex gap-2">
              <input
                type="email"
                .value="${this.email}"
                @input="${this.handleEmailInput}"
                class="flex-1 min-w-0 px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500 transition-all font-medium"
                placeholder="${translateText(
                  "account_modal.link_via_email_placeholder",
                )}"
              />
              <button
                @click="${this.handleSubmit}"
                class="px-5 py-2 text-sm font-bold text-white uppercase bg-blue-600 hover:bg-blue-500 rounded-lg transition-all border border-blue-500/50 hover:shadow-[0_0_15px_rgba(37,99,235,0.3)] shrink-0"
              >
                ${translateText("account_modal.link_button")}
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
            translateText("account_modal.link_discord")}</span
          >
        </button>

        <div class="relative group">
          <div class="flex gap-2">
            <input
              type="email"
              .value="${this.email}"
              @input="${this.handleEmailInput}"
              class="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:border-blue-500 transition-all font-medium"
              placeholder="${translateText(
                "account_modal.link_via_email_placeholder",
              )}"
            />
            <button
              @click="${this.handleSubmit}"
              class="px-4 py-2 text-sm font-bold text-white uppercase bg-blue-600 hover:bg-blue-500 rounded-lg transition-all"
            >
              ${translateText("account_modal.link_button")}
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
        ${translateText("account_modal.log_out")}
      </button>
    `;
  }

  private renderLoginOptions() {
    return html`
      <div class="flex items-center justify-center p-6 min-h-full">
        <div
          class="w-full max-w-md bg-white/5 rounded-2xl border border-white/10 p-8"
        >
          <div class="text-center mb-8">
            <div
              class="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/10 shadow-inner"
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
            <h3
              class="text-xl font-bold text-white uppercase tracking-widest mb-2"
            >
              ${translateText("account_modal.welcome_back")}
            </h3>
            <p class="text-white/50 text-sm font-medium">
              ${translateText("account_modal.sign_in_desc")}
            </p>
          </div>

          <div class="space-y-6">
            <!-- Discord Login Button -->
            <button
              @click="${this.handleDiscordLogin}"
              class="w-full px-6 py-4 text-white bg-[#5865F2] hover:bg-[#4752C4] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#5865F2] transition-colors duration-200 flex items-center justify-center gap-3 group relative overflow-hidden shadow-lg hover:shadow-[#5865F2]/20"
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
                translateText("account_modal.link_discord")}</span
              >
            </button>

            <!-- Divider -->
            <div class="flex items-center gap-4 py-2">
              <div class="h-px bg-white/10 flex-1"></div>
              <span
                class="text-[10px] uppercase tracking-widest text-white/30 font-bold"
              >
                ${translateText("account_modal.or")}
              </span>
              <div class="h-px bg-white/10 flex-1"></div>
            </div>

            <!-- Email Recovery -->
            <div class="space-y-3">
              <div class="relative group">
                <input
                  type="email"
                  id="email"
                  name="email"
                  .value="${this.email}"
                  @input="${this.handleEmailInput}"
                  class="w-full pl-4 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all font-medium hover:bg-white/10"
                  placeholder="${translateText(
                    "account_modal.email_placeholder",
                  )}"
                  required
                />
                <div
                  class="absolute right-4 top-1/2 -translate-y-1/2 text-white/20"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                    ></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                </div>
              </div>
              <button
                @click="${this.handleSubmit}"
                class="w-full px-6 py-3 text-sm font-bold text-white uppercase tracking-wider bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-xl transition-all shadow-lg hover:shadow-blue-900/40 border border-white/5"
              >
                ${translateText("account_modal.get_magic_link")}
              </button>
            </div>
          </div>

          <div class="mt-8 text-center border-t border-white/10 pt-6">
            <button
              @click="${this.handleLogout}"
              class="text-[10px] font-bold text-white/20 hover:text-red-400 transition-colors uppercase tracking-widest pb-0.5"
            >
              ${translateText("account_modal.clear_session")}
            </button>
          </div>
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
    if (this.inline) {
      if ((window as any).showPage) {
        (window as any).showPage("page-play");
      }
    } else {
      this.modalEl?.close();
    }
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
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
