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
        class="flex flex-col gap-2 w-full lg:max-w-6xl mx-auto px-0 lg:px-4 lg:my-auto min-h-0"
      >
        <token-login class="absolute"></token-login>

        <div
          class="grid grid-cols-1 lg:grid-cols-12 gap-2 w-full sticky top-0 z-30 lg:static pb-4 lg:pb-0"
        >
          <div
            class="lg:col-span-9 flex gap-x-2 h-[60px] items-center p-3 relative z-20 bg-[color-mix(in_oklab,var(--frenchBlue)_75%,black)] lg:rounded-xl"
          >
            <button
              id="hamburger-btn"
              class="h-10 lg:h-[50px] shrink-0 aspect-[4/3] lg:hidden flex text-white/90 rounded-md items-center justify-center transition-colors"
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
                class="size-8"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>

            <username-input
              class="flex-1 min-w-0 h-10 lg:h-[50px]"
            ></username-input>

            <pattern-input
              id="pattern-input-mobile"
              show-select-label
              class="size-[50px] lg:hidden shrink-0"
            ></pattern-input>
          </div>

          <div class="hidden lg:flex lg:col-span-3 h-[60px] gap-2">
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

        <game-mode-selector></game-mode-selector>
      </div>
    `;
  }
}
