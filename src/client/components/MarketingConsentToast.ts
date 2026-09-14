import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { UserMeResponse } from "../../core/ApiSchemas";
import { setMarketingConsent } from "../Api";
import { translateText } from "../Utils";

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
  @state() private errored = false;

  // Set once the player acts on the prompt this session (answers or dismisses)
  // so it doesn't reappear until the next load. Not persisted — a dismissal
  // leaves the server decision at no_response, so it asks again next visit.
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

  // Record an explicit decision ("Yes please" -> approved, "No thanks" ->
  // denied). Awaits the write and disables the buttons while it's in flight, so
  // a failure surfaces (the toast stays, with an error) instead of a silent
  // false success that would re-nag on the next load.
  private async decide(consented: boolean) {
    if (this.busy) return;
    this.busy = true;
    this.errored = false;
    const ok = await setMarketingConsent(consented);
    this.busy = false;
    if (ok) {
      this.answered = true;
      this.visible = false;
    } else {
      this.errored = true;
    }
  }

  // A subtle close (the X) is not an objection: it records nothing and leaves
  // the server decision at no_response, only hiding the prompt for this session
  // so it asks again on a later visit. Only "No thanks" records a denial.
  private dismiss() {
    if (this.busy) return;
    this.answered = true;
    this.visible = false;
  }

  render() {
    if (!this.visible) return nothing;

    return html`
      <div
        class="fixed top-16 z-[10000] left-4 right-4 w-auto sm:left-auto sm:right-4 sm:w-[236px] bg-surface border border-white/10 rounded-xl shadow-[var(--shadow-malibu-blue)] p-3"
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
            @click=${() => this.dismiss()}
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
        ${this.errored
          ? html`<div class="mt-2 text-[10px] text-red-400">
              ${translateText("marketing_consent.error")}
            </div>`
          : nothing}
      </div>
    `;
  }
}
