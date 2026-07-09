import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { UserMeResponse } from "../core/ApiSchemas";
import { setMarketingConsent } from "./Api";
import { translateText } from "./Utils";

/**
 * A small, non-blocking prompt docked in the top-right corner that asks a
 * logged-in player whether they want marketing emails.
 *
 * Client-driven consent: it reads the player's consent state from the
 * `userMeResponse` document event (dispatched after login / on load) and only
 * appears when the player has not decided yet (`no_response`) and has an email
 * on file (`hasEmail`). The player's choice is recorded via POST
 * /marketing/consent; once answered it does not reappear. Players with no email
 * are handled in account settings ("link an email to subscribe"), not here.
 */
@customElement("marketing-consent-toast")
export class MarketingConsentToast extends LitElement {
  @state() private visible = false;
  @state() private busy = false;

  // Once the player answers (or we record a dismissal) don't show it again for
  // the rest of this session, even if userMeResponse fires again.
  private answered = false;

  private onUserMeResponse = (event: Event) => {
    if (this.answered || this.visible) return;
    const detail = (event as CustomEvent<UserMeResponse | false>).detail;
    if (detail === false) return;
    const consent = detail.player.marketingConsent;
    if (consent?.consented === "no_response" && consent.hasEmail) {
      this.visible = true;
    }
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

  private async decide(consented: boolean) {
    if (this.busy) return;
    this.busy = true;
    this.answered = true;
    // Hide optimistically so it never nags; the request records the decision.
    void setMarketingConsent(consented);
    this.visible = false;
    this.busy = false;
  }

  render() {
    if (!this.visible) return nothing;

    return html`
      <div
        class="fixed right-4 top-16 z-[10000] w-[236px] max-w-[calc(100vw-2rem)] bg-surface border border-white/10 rounded-xl shadow-[var(--shadow-malibu-blue)] p-3"
        role="dialog"
        aria-label=${translateText("marketing_consent.title")}
      >
        <div class="flex items-start gap-2 mb-2">
          <svg
            class="shrink-0 mt-px text-aquarius"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-bold text-white">
              ${translateText("marketing_consent.title")}
            </div>
            <div class="text-[11px] leading-snug text-white/60 mt-0.5">
              ${translateText("marketing_consent.body")}
            </div>
          </div>
          <button
            class="shrink-0 grid place-items-center w-5 h-5 -mt-0.5 -mr-0.5 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            aria-label=${translateText("marketing_consent.dismiss")}
            ?disabled=${this.busy}
            @click=${() => this.decide(false)}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="flex gap-2">
          <button
            class="flex-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            ?disabled=${this.busy}
            @click=${() => this.decide(false)}
          >
            ${translateText("marketing_consent.no")}
          </button>
          <button
            class="flex-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-transparent bg-malibu-blue text-white shadow-[var(--shadow-malibu-blue-pill)] hover:bg-aquarius transition-all cursor-pointer whitespace-nowrap"
            ?disabled=${this.busy}
            @click=${() => this.decide(true)}
          >
            ${translateText("marketing_consent.yes")}
          </button>
        </div>
      </div>
    `;
  }
}
