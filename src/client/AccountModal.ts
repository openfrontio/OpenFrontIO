import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import {
  PlayerGame,
  PlayerStatsTree,
  UserMeResponse,
} from "../core/ApiSchemas";
import { assetUrl } from "../core/AssetUrls";
import { Cosmetics } from "../core/CosmeticSchemas";
import { fetchPlayerById, getUserMe } from "./Api";
import {
  discordLogin,
  googleLogin,
  linkGoogle,
  logOut,
  sendMagicLink,
} from "./Auth";
import "./components/baseComponents/stats/DiscordUserHeader";
import "./components/baseComponents/stats/GameList";
import "./components/baseComponents/stats/PlayerStatsTable";
import "./components/baseComponents/stats/PlayerStatsTree";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/CurrencyDisplay";
import "./components/Difficulties";
import "./components/FriendsList";
import "./components/SubscriptionPanel";
import { modalHeader } from "./components/ui/ModalHeader";
import { fetchCosmetics, SUBSCRIPTIONS_ENABLED } from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends BaseModal {
  protected routerName = "account";

  @state() private email: string = "";
  @state() private isLoadingUser: boolean = false;

  private userMeResponse: UserMeResponse | null = null;
  private cosmetics: Cosmetics | null = null;
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

  private hasAnyStats(): boolean {
    if (!this.statsTree) return false;
    // Check if statsTree has any data
    return (
      Object.keys(this.statsTree).length > 0 &&
      Object.values(this.statsTree).some(
        (gameTypeStats) =>
          gameTypeStats && Object.keys(gameTypeStats).length > 0,
      )
    );
  }

  protected renderHeaderSlot() {
    const isLoggedIn = !!this.userMeResponse?.user;
    const publicId = this.userMeResponse?.player?.publicId ?? "";
    const displayId = publicId || translateText("account_modal.not_found");
    return modalHeader({
      title: translateText("account_modal.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent:
        isLoggedIn && !this.isLoadingUser
          ? html`
              <div class="flex items-center gap-2">
                <span
                  class="text-xs text-blue-400 font-bold uppercase tracking-wider"
                  >${translateText("account_modal.public_player_id")}</span
                >
                <copy-button
                  .lobbyId=${publicId}
                  .copyText=${publicId}
                  .displayText=${displayId}
                ></copy-button>
              </div>
            `
          : undefined,
    });
  }

  private isLinkedAccount(): boolean {
    const me = this.userMeResponse?.user;
    return !!(me?.discord ?? me?.google ?? me?.email);
  }

  protected modalConfig() {
    if (this.isLoadingUser || !this.isLinkedAccount()) {
      return {};
    }
    return {
      tabs: [
        { key: "account", label: translateText("account_modal.tab_account") },
        { key: "stats", label: translateText("account_modal.tab_stats") },
        { key: "games", label: translateText("account_modal.tab_games") },
        { key: "friends", label: translateText("account_modal.tab_friends") },
      ],
    };
  }

  protected renderBody(tab: string) {
    if (this.isLoadingUser) {
      return this.renderLoadingSpinner(
        translateText("account_modal.fetching_account"),
      );
    }
    if (!this.isLinkedAccount()) {
      return html`<div class="custom-scrollbar mr-1">
        ${this.renderLoginOptions()}
      </div>`;
    }
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6">${this.renderTab(tab)}</div>
      </div>
    `;
  }

  private renderTab(tab: string): TemplateResult {
    switch (tab) {
      case "stats":
        return this.renderStatsTab();
      case "games":
        return this.renderGamesTab();
      case "friends":
        return this.renderFriendsTab();
      default:
        return this.renderAccountTab();
    }
  }

  private renderFriendsTab(): TemplateResult {
    const myPublicId = this.userMeResponse?.player?.publicId ?? "";
    return html`<friends-list .myPublicId=${myPublicId}></friends-list>`;
  }

  private renderAccountTab(): TemplateResult {
    return html`
      <div class="flex flex-col gap-6">
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
        ${this.renderSubscriptionPanel()}
      </div>
    `;
  }

  private renderStatsTab(): TemplateResult {
    if (!this.hasAnyStats()) {
      return this.renderEmptyState(
        "📊",
        translateText("account_modal.no_stats"),
      );
    }
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span class="text-blue-400">📊</span>
          ${translateText("account_modal.stats_overview")}
        </h3>
        <player-stats-tree-view
          .statsTree=${this.statsTree}
        ></player-stats-tree-view>
      </div>
    `;
  }

  private renderGamesTab(): TemplateResult {
    if (this.recentGames.length === 0) {
      return this.renderEmptyState(
        "🎮",
        translateText("account_modal.no_games"),
      );
    }
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span class="text-blue-400">🎮</span>
          ${translateText("game_list.recent_games")}
        </h3>
        <game-list
          .games=${this.recentGames}
          .onViewGame=${(id: string) => void this.viewGame(id)}
        ></game-list>
      </div>
    `;
  }

  private renderEmptyState(icon: string, message: string): TemplateResult {
    return html`
      <div
        class="bg-white/5 rounded-xl border border-white/10 p-12 flex flex-col items-center justify-center text-center"
      >
        <div class="text-4xl mb-3">${icon}</div>
        <p class="text-white/60 text-sm">${message}</p>
      </div>
    `;
  }

  private renderSubscriptionPanel(): TemplateResult | "" {
    if (!SUBSCRIPTIONS_ENABLED) return "";
    const sub = this.userMeResponse?.player?.subscription;
    if (!sub) return "";
    const cosmetic = this.cosmetics?.subscriptions?.[sub.tier] ?? null;
    return html`<subscription-panel
      .sub=${sub}
      .cosmetic=${cosmetic}
    ></subscription-panel>`;
  }

  private renderCurrency(): TemplateResult {
    const currency = this.userMeResponse?.player?.currency;
    if (!currency) return html``;

    return html`
      <currency-display
        .hard=${currency.hard}
        .soft=${currency.soft}
      ></currency-display>
    `;
  }

  private renderLoggedInAs(): TemplateResult {
    const me = this.userMeResponse?.user;
    if (me?.discord) {
      return html`
        <div class="flex flex-col items-center gap-3 w-full">
          ${this.renderCurrency()} ${this.renderLinkGoogleButton()}
          ${this.renderLogoutButton()}
        </div>
      `;
    } else if (me?.google) {
      return html`
        <div class="flex flex-col items-center gap-3 w-full">
          <div class="text-white text-lg font-medium">
            ${translateText("account_modal.linked_account", {
              account_name: me.google.email,
            })}
          </div>
          ${this.renderCurrency()} ${this.renderLogoutButton()}
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
          ${this.renderCurrency()} ${this.renderLinkGoogleButton()}
          ${this.renderLogoutButton()}
        </div>
      `;
    }
    return html``;
  }

  // Shown when logged in without a Google identity yet. Lets the user attach
  // Google to their existing account (we never auto-merge by email).
  private renderLinkGoogleButton(): TemplateResult {
    if (this.userMeResponse?.user?.google) return html``;
    return html`
      <button
        @click=${this.handleLinkGoogle}
        class="w-full px-6 py-3 text-[#1f1f1f] bg-white hover:bg-[#f7f8f8] border border-[#dadce0] rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#4285F4] transition-colors duration-200 flex items-center justify-center gap-3 shadow-lg"
      >
        <img
          src=${assetUrl("images/GoogleLogo.svg")}
          alt=${translateText("account_modal.google_alt")}
          class="w-5 h-5"
        />
        <span class="font-bold tracking-wide"
          >${translateText("account_modal.link_google")}</span
        >
      </button>
    `;
  }

  private async viewGame(gameId: string): Promise<void> {
    this.close();
    const encodedGameId = encodeURIComponent(gameId);
    const newUrl = `/${ClientEnv.workerPath(gameId)}/game/${encodedGameId}`;

    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(
      new CustomEvent("join-changed", { detail: { gameId: encodedGameId } }),
    );
  }

  private renderLogoutButton(): TemplateResult {
    return html`
      <o-button
        variant="danger"
        size="md"
        translationKey="account_modal.log_out"
        @click=${this.handleLogout}
      ></o-button>
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
            <p class="text-white/50 text-sm font-medium">
              ${translateText("account_modal.sign_in_desc")}
            </p>
            ${this.renderCurrency()}
          </div>

          <div class="space-y-6">
            <!-- Discord Login Button -->
            <button
              @click="${this.handleDiscordLogin}"
              class="w-full px-6 py-4 text-white bg-[#5865F2] hover:bg-[#4752C4] border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#5865F2] transition-colors duration-200 flex items-center justify-center gap-3 group relative overflow-hidden shadow-lg hover:shadow-[#5865F2]/20"
            >
              <img
                src=${assetUrl("images/DiscordLogo.svg")}
                alt="Discord"
                class="w-6 h-6 relative z-10"
              />
              <span class="font-bold relative z-10 tracking-wide"
                >${translateText("main.login_discord") ||
                translateText("account_modal.link_discord")}</span
              >
            </button>

            <!-- Google Login Button (Google brand guidelines: white surface,
                 dark text, the multicolor "G" mark) -->
            <button
              @click="${this.handleGoogleLogin}"
              class="w-full px-6 py-4 text-[#1f1f1f] bg-white hover:bg-[#f7f8f8] border border-[#dadce0] rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#4285F4] transition-colors duration-200 flex items-center justify-center gap-3 group relative overflow-hidden shadow-lg"
            >
              <img
                src=${assetUrl("images/GoogleLogo.svg")}
                alt="Google"
                class="w-6 h-6 relative z-10"
              />
              <span class="font-bold relative z-10 tracking-wide"
                >${translateText("main.login_google")}</span
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
                  class="w-full pl-4 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10"
                  placeholder="${translateText(
                    "account_modal.email_placeholder",
                  )}"
                  required
                />
              </div>
              <o-button
                variant="primary"
                width="block"
                size="md"
                translationKey="account_modal.get_magic_link"
                @click=${this.handleSubmit}
              ></o-button>
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

  private handleGoogleLogin() {
    googleLogin();
  }

  private async handleLinkGoogle(): Promise<void> {
    // On success linkGoogle navigates to Google; the result comes back as a
    // `link=...` router arg handled in handleLinkResult. A false return means we
    // couldn't start it.
    const started = await linkGoogle();
    if (!started) {
      alert(translateText("account_modal.link_google_failed"));
    }
  }

  // The Google link callback returns us to #modal=account&link=<result>, so the
  // router reopens this modal with a `link` arg. Surface the outcome, then strip
  // the one-shot param from the URL so a refresh/re-open doesn't replay it.
  private handleLinkResult(args?: Record<string, unknown>): void {
    const link = typeof args?.link === "string" ? args.link : undefined;
    if (link === undefined) return;

    // replaceState doesn't fire hashchange, so removing the param won't re-route.
    const params = new URLSearchParams(window.location.hash.slice(1));
    params.delete("link");
    const rest = params.toString();
    history.replaceState(
      null,
      "",
      rest ? `#${rest}` : window.location.pathname + window.location.search,
    );

    // Defer so the modal paints before the (blocking) alert. "cancel" needs no
    // feedback — the user chose to back out.
    if (link === "google") {
      setTimeout(
        () => alert(translateText("account_modal.link_google_success")),
        0,
      );
    } else if (link === "already_linked") {
      setTimeout(
        () => alert(translateText("account_modal.link_google_already_linked")),
        0,
      );
    } else if (link === "error") {
      setTimeout(
        () => alert(translateText("account_modal.link_google_error")),
        0,
      );
    }
  }

  protected onOpen(args?: Record<string, unknown>): void {
    this.isLoadingUser = true;
    this.handleLinkResult(args);

    if (SUBSCRIPTIONS_ENABLED) {
      void fetchCosmetics().then((cosmetics) => {
        this.cosmetics = cosmetics;
        this.requestUpdate();
      });
    }

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

  protected onClose(): void {
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
