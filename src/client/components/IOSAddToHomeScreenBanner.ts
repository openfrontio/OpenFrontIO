import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Platform } from "../Platform";
import { translateText } from "../Utils";

const DISMISSED_KEY = "ios_a2hs_banner_dismissed";

/** Returns major iOS/Safari version number, or 0 if not detectable.
 *
 * iOS 26+ freezes the OS version in UA at "18_6", but still reports
 * the real Safari version via the "Version/XX" token. We use that.
 *
 * Examples:
 *   iOS 26 Safari:  "... Version/26.0 Mobile/15E148 Safari/604.1"  → 26
 *   iOS 18 Safari:  "... Version/18.0 Mobile/15E148 Safari/604.1"  → 18
 *   Chrome on iOS:  "... CriOS/138 ..."  → falls back to OS token  → 26
 */
function getIOSMajorVersion(): number {
  const ua = navigator.userAgent;

  // Primary: Version/XX token (Safari on iOS 18 and 26+)
  const versionMatch = ua.match(/Version\/(\d+)/i);
  if (versionMatch) return parseInt(versionMatch[1], 10);

  // Fallback: OS version token (Chrome/Firefox on iOS report real OS version)
  const osMatch = ua.match(/CPU(?:\s+iPhone)?\s+OS\s+(\d+)_/i);
  if (osMatch) return parseInt(osMatch[1], 10);

  return 0;
}

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
    this.dismissed = localStorage.getItem(DISMISSED_KEY) === "true";
  }

  private never() {
    localStorage.setItem(DISMISSED_KEY, "true");
    this.dismissed = true;
  }

  private later_() {
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

    const iosVersion = getIOSMajorVersion();
    // iOS 26+ moved Share to the "..." menu in the bottom-right corner
    const isIOS26Plus = iosVersion >= 26;

    // Arrow points to bottom-center (iOS ≤18) or bottom-right (iOS 26+)
    const shareLocation = isIOS26Plus
      ? html`the <strong class="text-white">···</strong> menu in the
          <strong class="text-white"
            >${translateText("ios_banner.step_tap_dots_location")}</strong
          >`
      : html`the <strong class="text-white">Share</strong>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="inline w-4 h-4 mb-0.5 text-[#0073b7]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          button at the
          <strong class="text-white"
            >${translateText("ios_banner.step_tap_share_location")}</strong
          >`;

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
          >
            <div class="flex items-center justify-between">
              <h2 class="text-white font-bold text-lg">
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
                <span>Tap ${shareLocation} in Safari</span>
              </li>
              ${isIOS26Plus
                ? html`<li class="flex items-start gap-3">
                    <span
                      class="shrink-0 w-6 h-6 rounded-full bg-[#0073b7] flex items-center justify-center text-white font-bold text-xs"
                      >2</span
                    >
                    <span
                      >${translateText(
                        "ios_banner.step_tap_share_in_menu",
                      )}</span
                    >
                  </li>`
                : nothing}
              <li class="flex items-start gap-3">
                <span
                  class="shrink-0 w-6 h-6 rounded-full bg-[#0073b7] flex items-center justify-center text-white font-bold text-xs"
                  >${isIOS26Plus ? "3" : "2"}</span
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
                  >${isIOS26Plus ? "4" : "3"}</span
                >
                <span>${translateText("ios_banner.step_open")}</span>
              </li>
            </ol>

            <!-- Got it button as speech bubble with tail pointing down -->
            <div class="relative w-full mt-1">
              <button
                class="w-full py-2.5 rounded-lg bg-[#0073b7] hover:bg-sky-500 active:bg-sky-700 text-white font-semibold transition-colors"
                @click=${this.closeGuide}
              >
                ${translateText("ios_banner.got_it")}
              </button>
              <!-- tail: triangle pointing down, aligned center or right -->
              <div
                class="absolute -bottom-3 ${isIOS26Plus
                  ? "right-6"
                  : "left-1/2 -translate-x-1/2"} w-0 h-0"
                style="border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 12px solid #0073b7;"
              ></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    // Only show on iOS, not in standalone (already added to home screen), not dismissed
    if (!Platform.isIOS) return nothing;
    if (this.dismissed || this.later) return nothing;
    // If already running as PWA/standalone, no need to show
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
        <!-- top row: icon + text -->
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

        <!-- buttons full width -->
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
