import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { UserMeResponse } from "../../core/ApiSchemas";
import { translateText } from "../Utils";
import "./baseComponents/Modal";
import type { OModal } from "./baseComponents/Modal";

type Ban = NonNullable<NonNullable<UserMeResponse["ban"]>>;

/**
 * Shows a banned player *why* they're banned. The game server already refuses a
 * banned account's WebSocket ("Account Banned"); this surfaces the rich reason
 * the API returns on GET /users/@me (`ban`) — a localized category, the
 * moderator's player-facing reason, and when the ban lifts (or that it's
 * permanent).
 *
 * Reads the `userMeResponse` document event (dispatched after login / on load),
 * like <marketing-consent-toast>. It opens the modal once; if the player closes
 * it, it stays closed for the session (they still can't play — the server
 * enforces that — but they aren't trapped behind the dialog).
 */
@customElement("banned-modal")
export class BannedModal extends LitElement {
  @state() private ban: Ban | null = null;
  @query("o-modal") private modalEl?: OModal;
  private opened = false;

  private onUserMeResponse = (event: Event) => {
    const detail = (event as CustomEvent<UserMeResponse | false>).detail;
    // No ban (or @me failed) clears the notice — e.g. an unban that lands in
    // the same session — and re-arms `opened` so a later re-ban reopens it.
    if (detail === false || !detail.ban) {
      this.ban = null;
      this.opened = false;
      return;
    }
    this.ban = detail.ban;
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMeResponse);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("userMeResponse", this.onUserMeResponse);
  }

  updated() {
    // Open once. The `open` guard keeps this resilient where <o-modal> isn't
    // registered (unit tests) and stops a re-open after the player closes it.
    if (this.ban && !this.opened && typeof this.modalEl?.open === "function") {
      this.opened = true;
      this.modalEl.open();
    }
  }

  // Map the server category to its label, falling back to the generic ToS
  // wording for a value a newer server introduced that this client can't name.
  private categoryLabel(category: string): string {
    const key = `ban_notice.category.${category}`;
    const label = translateText(key);
    return label === key ? translateText("ban_notice.category.other") : label;
  }

  render() {
    const ban = this.ban;
    if (!ban) return html``;
    return html`
      <o-modal title=${translateText("ban_notice.title")}>
        <div style="max-width: 32rem; line-height: 1.5;">
          <p style="font-weight: 600; font-size: 1.05rem; margin: 0 0 0.5rem;">
            ${this.categoryLabel(ban.category)}
          </p>
          ${ban.reason
            ? html`<p style="margin: 0 0 0.5rem;">
                ${translateText("ban_notice.reason", { reason: ban.reason })}
              </p>`
            : null}
          <p style="margin: 0 0 0.75rem;">
            ${ban.expiresAt
              ? translateText("ban_notice.until", {
                  date: new Date(ban.expiresAt).toLocaleString(),
                })
              : translateText("ban_notice.permanent")}
          </p>
          <p style="margin: 0; opacity: 0.8;">
            ${translateText("ban_notice.appeal")}
          </p>
        </div>
      </o-modal>
    `;
  }
}
