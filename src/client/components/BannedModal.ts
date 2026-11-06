import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
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

  private detailRow(label: string, value: string) {
    return html`
      <div class="px-4 py-3">
        <dt class="text-xs font-bold uppercase tracking-wider text-white/50">
          ${label}
        </dt>
        <dd class="mt-1 text-sm text-white wrap-anywhere">${value}</dd>
      </div>
    `;
  }

  render() {
    const ban = this.ban;
    if (!ban) return html``;
    return html`
      <o-modal hideHeader fitContent maxWidth="28rem">
        <div class="flex flex-col gap-5 p-6">
          <div class="flex items-center gap-4 pr-6">
            <div
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-red-500/30 bg-red-500/15 text-red-400"
            >
              <svg
                class="h-6 w-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M5.6 5.6l12.8 12.8" />
              </svg>
            </div>
            <div class="min-w-0">
              <h2 class="text-xl font-bold leading-tight text-white">
                ${translateText("ban_notice.title")}
              </h2>
              <p class="mt-1 text-sm font-medium text-red-300">
                ${this.categoryLabel(ban.category)}
              </p>
            </div>
          </div>
          <dl
            class="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/5"
          >
            ${
              ban.reason
                ? this.detailRow(
                    translateText("ban_notice.reason_label"),
                    ban.reason,
                  )
                : null
            }
            ${this.detailRow(
              translateText("ban_notice.expires_label"),
              ban.expiresAt
                ? new Date(ban.expiresAt).toLocaleString(undefined, {
                    dateStyle: "long",
                    timeStyle: "short",
                  })
                : translateText("ban_notice.expires_never"),
            )}
          </dl>
          <div class="flex flex-col gap-3">
            <p class="text-center text-sm text-white/70">
              ${translateText("ban_notice.appeal_prompt")}
            </p>
            <a
              href="https://discord.gg/openfront"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-[#5865F2]/20 transition-all hover:bg-[#4752c4] active:bg-[#3c45a5]"
            >
              <svg
                class="h-5 w-5"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-14.36a.074.074 0 0 0-.032-.027zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.085 2.157 2.418 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.085 2.157 2.418 0 1.334-.946 2.419-2.157 2.419z"
                />
              </svg>
              ${translateText("ban_notice.contact_discord")}
            </a>
          </div>
        </div>
      </o-modal>
    `;
  }
}
