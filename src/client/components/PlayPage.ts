import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import "./NewsBox";

@customElement("play-page")
export class PlayPage extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        id="page-play"
        class="flex flex-col gap-2 w-full px-0 lg:px-4 min-h-0"
      >
        <token-login class="absolute"></token-login>

        <!-- Mobile: Fixed top bar -->
        <div
          class="lg:hidden fixed left-0 right-0 top-0 z-40 pt-[env(safe-area-inset-top)] bg-surface border-b border-white/10"
        >
          <div
            class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center h-14 px-2 gap-2"
          >
            <button
              id="hamburger-btn"
              class="col-start-1 justify-self-start h-10 shrink-0 aspect-[4/3] flex text-white/90 rounded-md items-center justify-center transition-colors"
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

            <div
              class="col-start-2 flex items-center justify-center text-malibu-blue min-w-0"
            >
              <img
                src=${assetUrl("images/OpenFrontLogo.svg")}
                alt="OpenFront"
                class="h-full w-auto"
              />
            </div>

            <div
              aria-hidden="true"
              class="col-start-3 justify-self-end h-10 shrink-0 aspect-[4/3]"
            ></div>
          </div>
        </div>

        <div
          class="w-full pb-4 lg:pb-0 flex flex-col gap-4 sm:-mx-4 sm:w-[calc(100%+2rem)] lg:mx-0 lg:w-full lg:grid lg:grid-cols-[2fr_1fr] lg:gap-4"
        >
          <!-- Mobile: spacer for fixed top bar -->
          <div
            class="lg:hidden h-[calc(env(safe-area-inset-top)+56px)] lg:col-span-2 -mb-4"
          ></div>

          <!-- News box above username -->
          <news-box class="lg:col-span-2"></news-box>

          <!-- Username: left col -->
          <div
            class="px-2 py-2 bg-surface border-y border-white/10 overflow-visible lg:flex lg:items-center lg:gap-x-2 lg:h-[60px] lg:p-3 lg:relative lg:z-20 lg:border-y-0 lg:rounded-xl"
          >
            <div class="flex items-center gap-2 min-w-0 w-full">
              <username-input
                class="flex-1 min-w-0 h-10 lg:h-[50px]"
              ></username-input>
              <pattern-input
                id="pattern-input-mobile"
                show-select-label
                adaptive-size
                class="shrink-0 lg:hidden"
              ></pattern-input>
              <flag-input
                id="flag-input-mobile"
                show-select-label
                class="shrink-0 lg:hidden h-10 w-10"
              ></flag-input>
            </div>
          </div>

          <!-- Skin + flag: right col -->
          <div class="hidden lg:flex h-[60px] gap-2">
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
