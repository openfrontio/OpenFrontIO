import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Platform } from "../Platform";
import { translateText } from "../Utils";

const DISMISSED_KEY = "ios_a2hs_banner_dismissed";
const LATER_KEY = "ios_a2hs_banner_later";

@customElement("ios-add-to-home-screen-banner")
export class IOSAddToHomeScreenBanner extends LitElement {
  @state() private dismissed = false;
  @state() private later = false;
  @state() private showGuide = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    try {
      this.dismissed = localStorage.getItem(DISMISSED_KEY) === "true";
    } catch {
      this.dismissed = false;
    }
    try {
      this.later = sessionStorage.getItem(LATER_KEY) === "true";
    } catch {
      this.later = false;
    }
  }

  private never() {
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // localStorage unavailable — dismiss for session only
    }
    this.dismissed = true;
  }

  private later_() {
    try {
      sessionStorage.setItem(LATER_KEY, "true");
    } catch {
      // ignore — this.later still set in memory
    }
    this.later = true;
  }

  private openGuide() {
    this.showGuide = true;
  }

  private closeGuide() {
    this.showGuide = false;
  }

  private renderGuideModal() {
    if (!this.showGuide) return nothing;

    return html`
      <div
        class="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-end sm:items-center justify-center p-4"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.closeGuide();
        }}
      >
        <div class="relative w-full max-w-sm">
          <div
            class="bg-slate-800 border border-slate-600 rounded-2xl w-full p-5 pb-6 flex flex-col gap-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-banner-modal-title"
          >
            <div class="flex items-center justify-between">
              <h2
                id="ios-banner-modal-title"
                class="text-white font-bold text-lg"
              >
                ${translateText("ios_banner.modal_title")}
              </h2>
              <button
                class="text-slate-400 hover:text-white text-2xl leading-none"
                @click=${this.closeGuide}
                aria-label=${translateText("common.close")}
              >
                ×
              </button>
            </div>

            <p class="text-slate-300 text-sm">
              ${translateText("ios_banner.modal_desc")}
            </p>

            <ol class="flex flex-col gap-3 text-sm text-slate-200">
              <li class="flex items-start gap-3">
                <span
                  class="shrink-0 w-6 h-6 rounded-full bg-[#0073b7] flex items-center justify-center text-white font-bold text-xs"
                  >1</span
                >
                <span>${translateText("ios_banner.step_share")}</span>
              </li>
              <li class="flex items-start gap-3">
                <span
                  class="shrink-0 w-6 h-6 rounded-full bg-[#0073b7] flex items-center justify-center text-white font-bold text-xs"
                  >2</span
                >
                <span
                  >${translateText("ios_banner.step_scroll_and_tap")}
                  <strong class="text-white"
                    >${translateText(
                      "ios_banner.step_add_to_home_label",
                    )}</strong
                  ></span
                >
              </li>
              <li class="flex items-start gap-3">
                <span
                  class="shrink-0 w-6 h-6 rounded-full bg-[#0073b7] flex items-center justify-center text-white font-bold text-xs"
                  >3</span
                >
                <span>${translateText("ios_banner.step_open")}</span>
              </li>
            </ol>

            <button
              class="w-full py-2.5 rounded-lg bg-[#0073b7] hover:bg-sky-500 active:bg-sky-700 text-white font-semibold transition-colors"
              @click=${this.closeGuide}
            >
              ${translateText("ios_banner.got_it")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!Platform.isIOS) return nothing;
    if (this.dismissed || this.later) return nothing;
    if (
      (navigator as any).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      return nothing;
    }

    return html`
      ${this.renderGuideModal()}
      <div
        class="flex flex-col gap-3 w-full px-3 py-3 rounded-xl bg-slate-800/90 border border-slate-600 text-sm text-slate-200"
      >
        <div class="flex gap-3 items-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="shrink-0 w-8 h-8 text-[#0073b7]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
          <span>${translateText("ios_banner.text")}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <button
            class="w-full py-1.5 rounded-lg bg-[#0073b7] hover:bg-sky-500 active:bg-sky-700 text-white font-semibold text-sm transition-colors"
            @click=${this.openGuide}
          >
            ${translateText("ios_banner.how")}
          </button>
          <button
            class="w-full py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-slate-300 text-sm transition-colors"
            @click=${this.later_}
          >
            ${translateText("ios_banner.later")}
          </button>
          <button
            class="w-full py-1.5 rounded-lg text-slate-500 hover:text-slate-400 text-xs transition-colors"
            @click=${this.never}
          >
            ${translateText("ios_banner.never")}
          </button>
        </div>
      </div>
    `;
  }
}
