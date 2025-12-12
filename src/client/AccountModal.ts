import { html, LitElement, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  PlayerGame,
  PlayerStatsTree,
  UserMeResponse,
} from "../core/ApiSchemas";
import "./components/baseComponents/stats/DiscordUserHeader";
import "./components/baseComponents/stats/GameList";
import "./components/baseComponents/stats/PlayerStatsTable";
import "./components/baseComponents/stats/PlayerStatsTree";
import "./components/Difficulties";
import "./components/PatternButton";
import {
  discordLogin,
  fetchPlayerById,
  getApiBase,
  getUserMe,
  logOut,
} from "./jwt";
import { isInIframe, translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private email: string = "";
  @state() private isLoadingUser: boolean = false;

  private loggedInEmail: string | null = null;
  private loggedInDiscord: string | null = null;
  private userMeResponse: UserMeResponse | null = null;
  private playerId: string | null = null;
  private statsTree: PlayerStatsTree | null = null;
  private recentGames: PlayerGame[] = [];

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        this.userMeResponse = customEvent.detail as UserMeResponse;
        this.playerId = this.userMeResponse?.player?.publicId;
        if (this.playerId === undefined) {
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
    return html`
      <o-modal
        id="account-modal"
        title="${translateText("account_modal.title") || "Account"}"
      >
        ${this.renderInner()}
      </o-modal>
    `;
  }

  private renderInner() {
    if (this.isLoadingUser) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-2">${translateText("account_modal.fetching_account")}</p>
          <div
            class="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
          ></div>
        </div>
      `;
    }
    if (this.loggedInDiscord) {
      return this.renderLoggedInDiscord();
    } else if (this.loggedInEmail) {
      return this.renderLoggedInEmail();
    } else {
      return this.renderLoginOptions();
    }
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

  private renderLoggedInDiscord() {
    return html`
      <div class="p-6">
        <div class="mb-4 text-center">
          <p class="text-white mb-4">
            Logged in with Discord as ${this.loggedInDiscord}
          </p>
          ${this.logoutButton()}
        </div>
        <div class="flex flex-col items-center mt-2 mb-4">
          <discord-user-header
            .data=${this.userMeResponse?.user?.discord ?? null}
          ></discord-user-header>
          <player-stats-tree-view
            .statsTree=${this.statsTree}
          ></player-stats-tree-view>
          <hr class="w-2/3 border-gray-600 my-2" />
          <game-list
            .games=${this.recentGames}
            .onViewGame=${(id: string) => this.viewGame(id)}
          ></game-list>
        </div>
      </div>
    `;
  }

  private renderLoggedInEmail(): TemplateResult {
    return html`
      <div class="p-6">
        <div class="mb-4">
          <p class="text-white text-center mb-4">
            Logged in as ${this.loggedInEmail}
          </p>
        </div>
        ${this.logoutButton()}
      </div>
    `;
  }

  private logoutButton(): TemplateResult {
    return html`
      <button
        @click="${this.handleLogout}"
        class="px-6 py-3 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors duration-200"
      >
        Log Out
      </button>
    `;
  }

  private renderLoginOptions() {
    return html`
      <div class="p-6">
        <div class="mb-6">
          <h3 class="text-lg font-medium text-white mb-4 text-center">
            Choose your login method
          </h3>

          <!-- Discord Login Button -->
          <div class="mb-6">
            <button
              @click="${this.handleDiscordLogin}"
              class="w-full px-6 py-3 text-sm font-medium text-white bg-[#5865F2] border border-transparent rounded-md hover:bg-[#4752C4] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#5865F2] transition-colors duration-200 flex items-center justify-center space-x-2"
            >
              <img
                src="/images/DiscordLogo.svg"
                alt="Discord"
                class="w-5 h-5"
              />
              <span
                >${translateText("main.login_discord") ||
                "Login with Discord"}</span
              >
            </button>
          </div>

          <!-- Divider -->
          <div class="relative mb-6">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-gray-300"></div>
            </div>
            <div class="relative flex justify-center text-sm">
              <span class="px-2 bg-gray-800 text-gray-300">or</span>
            </div>
          </div>

          <!-- Email Recovery -->
          <div class="mb-4">
            <label
              for="email"
              class="block text-sm font-medium text-white mb-2"
            >
              Recover account by email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              .value="${this.email}"
              @input="${this.handleEmailInput}"
              class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
              placeholder="Enter your email address"
              required
            />
          </div>
        </div>

        <div class="flex justify-end space-x-3">
          <button
            @click="${this.close}"
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            @click="${this.handleSubmit}"
            class="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Submit
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
      alert("Please enter an email address");
      return;
    }

    try {
      const apiBase = getApiBase();
      const response = await fetch(`${apiBase}/magic-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          redirectDomain: window.location.origin,
          email: this.email,
        }),
      });

      if (response.ok) {
        alert(
          translateText("account_modal.recovery_email_sent", {
            email: this.email,
          }),
        );
        this.close();
      } else {
        console.error(
          "Failed to send recovery email:",
          response.status,
          response.statusText,
        );
        alert("Failed to send recovery email. Please try again.");
      }
    } catch (error) {
      console.error("Error sending recovery email:", error);
      alert("Error sending recovery email. Please try again.");
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
          this.loggedInEmail = userMe.user.email ?? null;
          this.loggedInDiscord = userMe.user.discord?.global_name ?? null;
          if (this.playerId) {
            this.loadFromApi(this.playerId);
          }
        } else {
          this.loggedInEmail = null;
          this.loggedInDiscord = null;
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

  private async loadFromApi(playerId: string): Promise<void> {
    try {
      const data = await fetchPlayerById(playerId);
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
      buttonTitle = translateText("account_modal.logged_in_as", {
        email: this.loggedInEmail,
      });
    } else if (this.loggedInDiscord) {
      buttonTitle = translateText("account_modal.logged_in_with_discord");
    }

    return html`
      <div class="fixed top-4 right-4 z-[9998]">
        <button
          @click="${this.open}"
          class="w-12 h-12 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-200 flex items-center justify-center text-xl focus:outline-none focus:ring-4 focus:ring-red-500 focus:ring-offset-4"
          title="${buttonTitle}"
        >
          ${this.renderIcon()}
        </button>
      </div>
      <account-modal></account-modal>
    `;
  }

  private renderIcon() {
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

  private open() {
    this.recoveryModal?.open();
  }

  public close() {
    this.isVisible = false;
    this.recoveryModal?.close();
    this.requestUpdate();
  }
}
