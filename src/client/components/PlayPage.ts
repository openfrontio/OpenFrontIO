import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("play-page")
export class PlayPage extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        id="page-play"
        class="flex flex-col gap-2 w-full max-w-6xl mx-auto px-0 sm:px-4 transition-all duration-300 my-auto min-h-0"
      >
        <token-login class="absolute"></token-login>

        <!-- Header / Identity Section -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-2 lg:gap-6 w-full">
          <div
            class="lg:col-span-9 flex flex-row flex-nowrap gap-x-2 h-[60px] items-center bg-slate-900/80 backdrop-blur-md p-3 rounded-xl relative z-20 text-sm sm:text-base shrink-0"
          >
            <!-- Flag -->
            <div
              class="h-[40px] sm:h-[50px] shrink-0 aspect-[4/3] flex items-center justify-center lg:hidden"
            >
              <!-- Hamburger (Mobile) -->
              <button
                id="hamburger-btn"
                class="lg:hidden flex w-full h-full bg-slate-800/40 text-white/90 hover:bg-slate-700/40 p-0 rounded-md items-center justify-center cursor-pointer transition-all duration-200"
                data-i18n-aria-label="main.menu"
                aria-expanded="false"
                aria-controls="sidebar-menu"
                aria-haspopup="dialog"
                data-i18n-title="main.menu"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="w-8 h-8"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                </svg>
              </button>
            </div>

            <!-- Username -->
            <div class="flex-1 min-w-0 h-[40px] sm:h-[50px] flex items-center">
              <username-input
                class="relative w-full h-full block text-ellipsis overflow-hidden whitespace-nowrap"
              ></username-input>
            </div>

            <!-- Pattern button (Mobile - inside bar, Desktop - hidden here) -->
            <pattern-input
              id="pattern-input-mobile"
              show-select-label
              class="aspect-square h-[50px] sm:h-[50px] lg:hidden shrink-0"
            ></pattern-input>
          </div>

          <!-- Pattern & Flag buttons (Desktop only - separate column) -->
          <div class="hidden lg:flex lg:col-span-3">
            <div class="w-full h-[60px] flex gap-2">
              <pattern-input
                id="pattern-input-desktop"
                show-select-label
                class="flex-1 h-full"
              ></pattern-input>
              <flag-input
                id="flag-input-desktop"
                show-select-label
                class="flex-1 h-full"
              ></flag-input>
            </div>
          </div>
        </div>

        <!-- Game Mode Selector -->
        <game-mode-selector></game-mode-selector>
      </div>
    `;
  }
}
