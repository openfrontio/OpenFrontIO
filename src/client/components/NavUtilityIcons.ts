import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { desktopQuit, requestDesktopQuit } from "../DesktopShell";
import { NavNotificationsController } from "./NavNotificationsController";

/**
 * The news bell, help "?", settings cogwheel and (on the desktop shell) an
 * exit door as icon buttons, with the notification dots the first two carry.
 *
 * Shared by the desktop nav bar and the mobile top bar so both read as the same
 * cluster next to the profile control — they're utility affordances rather than
 * page links, which is why they've left the nav item lists. The cogwheel sits
 * last among the page links, immediately left of the profile control, and is a
 * plain page link with no auth dependency: it looks and behaves the same
 * signed in or out. The exit door, when it renders, sits right after it.
 */
@customElement("nav-utility-icons")
export class NavUtilityIcons extends LitElement {
  /** Mobile trims the hit area to fit the top bar beside the logo. */
  @property({ type: String }) size: "desktop" | "mobile" = "desktop";

  private _notifications = new NavNotificationsController(this);

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);
  }

  disconnectedCallback() {
    window.removeEventListener("showPage", this._onShowPage);
    super.disconnectedCallback();
  }

  // The active page drives the highlight, and Navigation only updates
  // `.nav-menu-item` classes for elements that exist at click time.
  private _onShowPage = () => {
    this.requestUpdate();
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
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    `;
  }

  private renderDot(color: string): TemplateResult {
    return html`
      <span
        class="absolute top-0 right-0 w-2 h-2 ${color} rounded-full animate-ping"
      ></span>
      <span class="absolute top-0 right-0 w-2 h-2 ${color} rounded-full"></span>
    `;
  }

  render(): TemplateResult {
    const currentPage = window.currentPageId;
    return html`
      <div class="flex items-center gap-1">
        <div class="relative">
          <button
            class="${this.buttonClass()} ${currentPage === "page-news"
              ? "active"
              : ""}"
            data-page="page-news"
            data-i18n-aria-label="main.news"
            data-i18n-title="main.news"
            @click=${this._notifications.onNewsClick}
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
          ${this._notifications.showNewsDot()
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
