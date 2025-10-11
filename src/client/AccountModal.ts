import { html, LitElement, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { DiscordUser, UserMeResponse } from "../core/ApiSchemas";
import "./components/Difficulties";
import "./components/PatternButton";
import { discordLogin, getApiBase, getUserMe, logOut } from "./jwt";
import { isInIframe, translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private email: string = "";
  @state() private userMeData: UserMeResponse | null = null;

  constructor() {
    super();
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
    if (this.userMeData) {
      return this.renderUserProfile();
    } else {
      return this.renderLoginOptions();
    }
  }

  private getDiscordAvatarUrl(discord: DiscordUser): string {
    if (!discord.avatar) {
      // Default Discord avatar - fallback to 0 if discriminator is missing or non-numeric
      const defaultAvatarNumber = (Number(discord.discriminator) || 0) % 5;
      return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png?size=128`;
    }

    // Determine format: animated avatars start with "a_" and use .gif, otherwise .png
    const isAnimated = discord.avatar.startsWith("a_");
    const extension = isAnimated ? "gif" : "png";

    return `https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.${extension}?size=128`;
  }

  private renderUserProfile() {
    if (!this.userMeData) return html``;

    const { user, player } = this.userMeData;
    const isDiscordUser = !!user.discord;
    const displayName = isDiscordUser
      ? (user.discord!.global_name ?? user.discord!.username)
      : (user.email ?? "User");
    const avatarUrl = isDiscordUser
      ? this.getDiscordAvatarUrl(user.discord!)
      : "/images/DefaultAvatar.svg";

    return html`
      <div class="p-6">
        <!-- User Profile -->
        <div class="flex flex-col items-center mb-6">
          <!-- Avatar -->
          <div class="mb-4">
            <img
              src="${avatarUrl}"
              alt="${displayName}"
              class="w-24 h-24 rounded-full border-4 border-blue-500 shadow-lg"
              @error="${(e: Event) => {
                const img = e.target as HTMLImageElement;
                img.src = "/images/DefaultAvatar.svg";
              }}"
            />
          </div>

          <!-- User Info -->
          <div class="text-center mb-4">
            ${isDiscordUser
              ? html`
                  <div class="flex items-center justify-center space-x-2 mb-2">
                    <img
                      src="/images/DiscordLogo.svg"
                      alt="Discord"
                      class="w-5 h-5"
                    />
                    <h3 class="text-xl font-bold text-white">${displayName}</h3>
                  </div>
                `
              : html`
                  <h3 class="text-xl font-bold text-white mb-2">
                    ${displayName}
                  </h3>
                `}
            <p class="text-sm text-gray-400">Player ID: ${player.publicId}</p>
          </div>

          <!-- Roles & Flares -->
          ${player.roles && player.roles.length > 0
            ? html`
                <div class="mb-4 w-full">
                  <p
                    class="text-xs font-semibold text-gray-400 mb-2 text-center"
                  >
                    ROLES
                  </p>
                  <div class="flex flex-wrap gap-2 justify-center">
                    ${player.roles.map(
                      (role) => html`
                        <span
                          class="px-3 py-1 bg-purple-600 text-white text-xs rounded-full font-medium"
                        >
                          ${role}
                        </span>
                      `,
                    )}
                  </div>
                </div>
              `
            : ""}
          ${player.flares && player.flares.length > 0
            ? html`
                <div class="mb-4 w-full">
                  <p
                    class="text-xs font-semibold text-gray-400 mb-2 text-center"
                  >
                    FLARES
                  </p>
                  <div class="flex flex-wrap gap-2 justify-center">
                    ${player.flares.map(
                      (flare) => html`
                        <span
                          class="px-3 py-1 bg-blue-600 text-white text-xs rounded-full font-medium"
                        >
                          ${flare}
                        </span>
                      `,
                    )}
                  </div>
                </div>
              `
            : ""}
        </div>

        <!-- Logout Button -->
        <div class="flex justify-center">${this.logoutButton()}</div>
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

  public async open() {
    const userMe = await getUserMe();
    if (userMe) {
      this.userMeData = userMe;
    } else {
      this.userMeData = null;
    }
    this.modalEl?.open();
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
}

@customElement("account-button")
export class AccountButton extends LitElement {
  @state() private loggedInEmail: string | null = null;
  @state() private loggedInDiscord: string | null = null;
  @state() private discordUserData: DiscordUser | null = null;

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
          this.discordUserData = null;
          this.requestUpdate();
        } else if (userMeResponse.user.discord) {
          this.loggedInDiscord = userMeResponse.user.discord.id;
          this.discordUserData = userMeResponse.user.discord;
          this.requestUpdate();
        }
      } else {
        // Clear the logged in states when user logs out
        this.loggedInEmail = null;
        this.loggedInDiscord = null;
        this.discordUserData = null;
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

    const showAvatar = this.loggedInDiscord && this.discordUserData;

    return html`
      <div class="fixed top-4 right-4 z-[9999]">
        <button
          @click="${this.open}"
          class="w-12 h-12 ${showAvatar
            ? "p-0"
            : "bg-blue-600 hover:bg-blue-700"} text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-200 flex items-center justify-center text-xl focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-offset-4 ${showAvatar
            ? "overflow-hidden"
            : ""}"
          title="${buttonTitle}"
        >
          ${this.renderIcon()}
        </button>
      </div>
      <account-modal></account-modal>
    `;
  }

  private getDiscordAvatarUrl(discord: any): string {
    if (!discord.avatar) {
      // Default Discord avatar
      const defaultAvatarNumber = parseInt(discord.discriminator) % 5;
      return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png`;
    }
    return `https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.png?size=64`;
  }

  private renderIcon() {
    if (this.loggedInDiscord && this.discordUserData) {
      const avatarUrl = this.getDiscordAvatarUrl(this.discordUserData);
      return html`<img
        src="${avatarUrl}"
        alt="Discord Avatar"
        class="w-full h-full rounded-full object-cover"
        @error="${(e: Event) => {
          const img = e.target as HTMLImageElement;
          img.src = "/images/DiscordLogo.svg";
        }}"
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
