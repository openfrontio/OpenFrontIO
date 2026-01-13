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
        <token-login class="w-full hidden"></token-login>

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
                class="lg:hidden flex w-full h-full bg-slate-800/40 text-white/90 border border-blue-400/20 hover:bg-slate-700/40 p-0 rounded-md items-center justify-center cursor-pointer transition-all duration-200"
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

        <!-- Primary Game Actions Area -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full">
          <!-- Left Column: Featured Lobbies / Quick Play -->
          <div class="lg:col-span-9 flex flex-col gap-6 min-w-0">
            <!-- Public Lobby Card -->
            <public-lobby
              class="block w-full transition-all duration-[50ms]"
            ></public-lobby>
          </div>

          <!-- Right Column: Custom Games & Modes -->
          <div class="lg:col-span-3">
            <div
              class="group relative isolate flex flex-col w-full h-40 lg:h-96 overflow-hidden rounded-2xl transition-all duration-300"
            >
              <div
                class="h-full flex flex-col bg-slate-900/40 backdrop-blur-sm rounded-2xl border border-blue-400/10 overflow-hidden"
              >
                <div
                  class="py-2 bg-blue-900/20 border-b border-blue-400/10 text-center text-sm font-bold text-gray-300 uppercase tracking-widest"
                  data-i18n="host_modal.label"
                ></div>
                <div class="flex-1 p-2 flex flex-row lg:flex-col gap-2">
                  <o-button
                    id="single-player"
                    data-i18n-title="main.solo"
                    translationKey="main.solo"
                    fill
                    class="flex-1 transition-transform"
                  ></o-button>

                  <o-button
                    id="host-lobby-button"
                    data-i18n-title="main.create"
                    translationKey="main.create"
                    fill
                    secondary
                    class="flex-1 opacity-90 hover:opacity-100"
                  ></o-button>

                  <o-button
                    id="join-private-lobby-button"
                    data-i18n-title="main.join"
                    translationKey="main.join"
                    fill
                    secondary
                    class="flex-1 opacity-90 hover:opacity-100"
                  ></o-button>
                </div>
              </div>
            </div>
          </div>

          <!-- Matchmaking Buttons (Full Width across entire grid) -->
          <div class="lg:col-span-12 flex flex-col gap-6">
            <!-- Not Logged In Button -->
            <button
              id="matchmaking-button-logged-out"
              class="w-full h-20 bg-purple-600 hover:bg-purple-500 text-white font-black uppercase tracking-widest rounded-xl transition-all duration-200 flex flex-col items-center justify-center border border-purple-500/30 overflow-hidden relative cursor-pointer"
            >
              <span
                class="relative z-10 text-2xl"
                data-i18n="matchmaking_button.login_required"
              ></span>
            </button>

            <!-- Logged In Button -->
            <button
              id="matchmaking-button"
              class="hidden w-full h-20 bg-purple-600 hover:bg-purple-500 text-white font-black uppercase tracking-widest rounded-xl transition-all duration-200 flex flex-col items-center justify-center border border-purple-500/30 group overflow-hidden relative"
              data-i18n-title="matchmaking_modal.title"
            >
              <span
                class="relative z-10 text-2xl"
                data-i18n="matchmaking_button.play_ranked"
              ></span>
              <span
                class="relative z-10 text-xs font-medium text-purple-100 opacity-90 group-hover:opacity-100 transition-opacity"
                data-i18n="matchmaking_button.description"
              ></span>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
