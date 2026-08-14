import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { NavNotificationsController } from "./NavNotificationsController";

/**
 * The news bell and help "?" as icon buttons, with their notification dots.
 *
 * Shared by the desktop nav bar and the mobile top bar so both read as the same
 * cluster next to the profile control — they're notification affordances, not
 * page links, which is why they've left the nav item lists.
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
      </div>
    `;
  }
}
