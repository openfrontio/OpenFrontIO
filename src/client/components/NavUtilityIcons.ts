import { html, LitElement, nothing, render, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { desktopQuit, requestDesktopQuit } from "../DesktopShell";
import { closeMobileSidebar } from "../Navigation";
import { getCurrentLanguage, translateText } from "../Utils";
import { NavNotificationsController } from "./NavNotificationsController";
import { usernameText } from "./ui/UsernameText";

let nextNotificationsPanelId = 0;

const REQUEST_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/**
 * The news bell, help "?", settings cogwheel and (on the desktop shell) a
 * power button as icon buttons, with the notification dots the first two carry.
 *
 * Shared by the desktop nav bar and the mobile top bar so both read as the same
 * cluster next to the profile control — they're utility affordances rather than
 * page links, which is why they've left the nav item lists. The cogwheel sits
 * last among the page links, immediately left of the profile control, and is a
 * plain page link with no auth dependency: it looks and behaves the same
 * signed in or out. The power button, when it renders, sits right after it.
 */
@customElement("nav-utility-icons")
export class NavUtilityIcons extends LitElement {
  /** Mobile trims the hit area to fit the top bar beside the logo. */
  @property({ type: String }) size: "desktop" | "mobile" = "desktop";

  @state() private notificationsOpen = false;

  private _notifications = new NavNotificationsController(this);
  private notificationsPanel: HTMLDivElement | null = null;
  private readonly notificationsPanelId = `nav-notifications-${++nextNotificationsPanelId}`;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);
    document.addEventListener("click", this.handleDocumentClick);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("resize", this.closeNotifications);
  }

  disconnectedCallback() {
    window.removeEventListener("showPage", this._onShowPage);
    document.removeEventListener("click", this.handleDocumentClick);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.closeNotifications);
    this.removeNotificationsPanel();
    super.disconnectedCallback();
  }

  protected updated(): void {
    if (!this.notificationsOpen) {
      this.removeNotificationsPanel();
      return;
    }

    const trigger = this.querySelector<HTMLElement>(
      "[data-notifications-trigger]",
    );
    if (trigger === null) return;

    let panel = this.notificationsPanel;
    let createdPanel = false;
    if (panel === null) {
      createdPanel = true;
      panel = document.createElement("div");
      panel.id = this.notificationsPanelId;
      panel.style.position = "fixed";
      panel.style.zIndex = "41000";
      document.body.appendChild(panel);
      this.notificationsPanel = panel;
    }

    const rect = trigger.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    render(this.renderNotificationsMenu(), panel);
    if (createdPanel) {
      panel.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }

  // The active page drives the highlight, and Navigation only updates
  // `.nav-menu-item` classes for elements that exist at click time.
  private _onShowPage = () => {
    this.notificationsOpen = false;
    this.requestUpdate();
  };

  private removeNotificationsPanel(): void {
    if (this.notificationsPanel === null) return;
    render(nothing, this.notificationsPanel);
    this.notificationsPanel.remove();
    this.notificationsPanel = null;
  }

  private closeNotifications = (): void => {
    this.notificationsOpen = false;
  };

  private handleDocumentClick = (event: MouseEvent): void => {
    if (!this.notificationsOpen) return;
    const path = event.composedPath();
    if (path.includes(this)) return;
    if (
      this.notificationsPanel !== null &&
      path.includes(this.notificationsPanel)
    ) {
      return;
    }
    this.closeNotifications();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.notificationsOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeNotifications();
      this.querySelector<HTMLElement>("[data-notifications-trigger]")?.focus();
      return;
    }
    if (!this.notificationsPanel) return;
    const items = Array.from(
      this.notificationsPanel.querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      ),
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    if (event.key === "ArrowUp") {
      next = (current - 1 + items.length) % items.length;
    }
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next].focus();
  };

  private toggleNotifications = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.notificationsOpen = !this.notificationsOpen;
  };

  private buttonClass(): string {
    const box = this.size === "mobile" ? "w-9 h-9" : "w-10 h-10";
    return (
      `nav-menu-item flex items-center justify-center ${box} rounded-full ` +
      "text-white/70 hover:text-malibu-blue cursor-pointer transition-colors " +
      "[&.active]:text-malibu-blue"
    );
  }

  private handleQuit = () => {
    requestDesktopQuit();
  };

  /**
   * The in-app way out (OPE-402), moved here from the settings modal (OPE-445)
   * so it is a one-click icon beside the cog instead of three menu levels
   * deep (nav cog -> settings modal -> Display tab).
   *
   * Still no confirmation dialog, but the old justification for that -- "no
   * accidental path to a button three levels in" -- no longer holds; moving
   * the button to the nav *is* giving it an accidental path. The reason it
   * still stands: this whole bar sits inside the wrapper carrying
   * `in-[.in-game]:hidden` (index.html, around <desktop-nav-bar>), so the
   * icon is never on screen during a match. An accidental press can only
   * happen at the menu, where quitting costs nothing -- there is no run in
   * progress to lose.
   *
   * Renders nothing on the web, on CrazyGames and on a shell too old to
   * expose quit() -- desktopQuit() is already null in all three, the same
   * feature-detection rule the settings cog's neighbours never needed because
   * they have no shell dependency.
   */
  private renderQuitButton(): TemplateResult | string {
    if (desktopQuit() === null) return "";
    return html`
      <button
        class="${this.buttonClass()}"
        data-i18n-aria-label="main.quit"
        data-i18n-title="main.quit"
        @click=${this.handleQuit}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="w-6 h-6 pointer-events-none"
          aria-hidden="true"
        >
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
      </button>
    `;
  }

  private openFriendRequests = (): void => {
    this.closeNotifications();
    closeMobileSidebar();
    window.location.hash = "modal=account&tab=friends";
  };

  private openReleaseNotes = (): void => {
    this._notifications.markVersionSeen();
    this.closeNotifications();
    closeMobileSidebar();
    window.location.hash = "modal=news";
  };

  private formatRequestDate(iso: string): string {
    return new Date(iso).toLocaleDateString(
      getCurrentLanguage(),
      REQUEST_DATE_FORMAT,
    );
  }

  private renderNotificationsMenu(): TemplateResult {
    const friendRequests = this._notifications.friendRequests();
    const hasNewVersion = this._notifications.hasNewVersion();
    return html`
      <div
        role="menu"
        aria-label=${translateText("notifications.title")}
        class="w-[min(22rem,calc(100vw-1rem))] rounded-xl border border-white/10 bg-zinc-900 shadow-xl overflow-hidden"
      >
        <div
          class="px-4 py-3 border-b border-white/10 text-sm font-bold text-white"
        >
          ${translateText("notifications.title")}
        </div>
        <div class="max-h-[min(28rem,calc(100vh-8rem))] overflow-y-auto">
          ${hasNewVersion
            ? html`
                <button
                  role="menuitem"
                  class="w-full px-4 py-3 flex items-start gap-3 text-left bg-blue-500/10 hover:bg-blue-500/20 transition-colors border-b border-white/5"
                  @click=${this.openReleaseNotes}
                >
                  <span
                    class="mt-1 w-2 h-2 rounded-full bg-red-500 shrink-0"
                    aria-hidden="true"
                  ></span>
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold text-white">
                      ${translateText("notifications.new_version", {
                        version: this._notifications.currentVersion(),
                      })}
                    </span>
                    <span class="block mt-1 text-xs text-white/50">
                      ${translateText("notifications.view_release_notes")}
                    </span>
                  </span>
                </button>
              `
            : ""}
          ${friendRequests.map(
            (request) => html`
              <button
                role="menuitem"
                class="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-white/10 transition-colors border-b border-white/5 last:border-b-0"
                @click=${this.openFriendRequests}
              >
                <span
                  class="mt-0.5 flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/15 text-blue-300 shrink-0"
                  aria-hidden="true"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="w-4 h-4"
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" />
                    <line x1="22" y1="11" x2="16" y2="11" />
                  </svg>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-xs text-white/50">
                    ${translateText("notifications.friend_request")}
                  </span>
                  <span class="block truncate text-sm font-semibold text-white">
                    ${request.username
                      ? usernameText(
                          request.username,
                          "text-white font-semibold",
                        )
                      : request.publicId}
                  </span>
                  <span class="block mt-1 text-[10px] text-white/35">
                    ${this.formatRequestDate(request.createdAt)}
                  </span>
                </span>
              </button>
            `,
          )}
          ${!hasNewVersion && friendRequests.length === 0
            ? html`
                <p class="px-4 py-6 text-center text-sm text-white/50">
                  ${translateText("notifications.empty")}
                </p>
              `
            : ""}
        </div>
        <button
          role="menuitem"
          class="w-full px-4 py-3 text-left text-xs font-semibold text-blue-300 hover:bg-white/10 transition-colors border-t border-white/10"
          title=${translateText("main.news")}
          @click=${this.openReleaseNotes}
        >
          ${translateText("notifications.view_release_notes")}
        </button>
      </div>
    `;
  }

  private renderDot(color: string): TemplateResult {
    return html`
      <span
        class="absolute top-0 right-0 w-2 h-2 ${color} rounded-full animate-ping pointer-events-none"
      ></span>
      <span
        class="absolute top-0 right-0 w-2 h-2 ${color} rounded-full pointer-events-none"
      ></span>
    `;
  }

  render(): TemplateResult {
    const currentPage = window.currentPageId;
    return html`
      <div class="flex items-center gap-1">
        <div class="relative">
          <button
            class="${this.buttonClass()} ${this.notificationsOpen ||
            currentPage === "page-news"
              ? "active"
              : ""}"
            data-notifications-trigger
            aria-label=${translateText("notifications.title")}
            title=${translateText("notifications.title")}
            aria-haspopup="menu"
            aria-expanded=${this.notificationsOpen ? "true" : "false"}
            aria-controls=${this.notificationsPanelId}
            @click=${this.toggleNotifications}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-6 h-6 pointer-events-none"
              aria-hidden="true"
            >
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
          ${this._notifications.showBellDot()
            ? this.renderDot("bg-red-500")
            : ""}
        </div>
        <div class="relative">
          <button
            class="${this.buttonClass()} ${currentPage === "page-help"
              ? "active"
              : ""}"
            data-page="page-help"
            data-i18n-aria-label="main.help"
            data-i18n-title="main.help"
            @click=${this._notifications.onHelpClick}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-6 h-6 pointer-events-none"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4" />
              <line x1="12" y1="17.5" x2="12.01" y2="17.5" />
            </svg>
          </button>
          ${this._notifications.showHelpDot()
            ? this.renderDot("bg-yellow-400")
            : ""}
        </div>
        <button
          class="${this.buttonClass()} ${currentPage === "page-settings"
            ? "active"
            : ""}"
          data-page="page-settings"
          data-i18n-aria-label="main.settings"
          data-i18n-title="main.settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-6 h-6 pointer-events-none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
            />
          </svg>
        </button>
        ${this.renderQuitButton()}
      </div>
    `;
  }
}
