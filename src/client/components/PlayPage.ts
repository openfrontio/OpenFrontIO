import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import "./CosmeticBackground";
import "./NavAccountMenu";
import "./NavUtilityIcons";
import "./NewsBox";
import "./SteamWishlist";
import "./StreamingNow";

@customElement("play-page")
export class PlayPage extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        id="page-play"
        class="flex flex-col gap-2 w-full px-0 lg:px-4 min-h-0 lg:flex-1"
      >
        <token-login class="absolute"></token-login>
        <rewards-modal class="absolute"></rewards-modal>

        <!-- Mobile: Fixed top bar -->
        <div
          class="lg:hidden fixed left-0 right-0 top-[var(--top-ad-height,0px)] z-40 pt-[env(safe-area-inset-top)] bg-surface border-b border-white/10"
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

            <!-- Right slot: bell, help and the profile control. The menu is
                 the account affordance on every platform now — on CrazyGames
                 its "Sign in" item hands off to their SDK prompt. -->
            <div
              class="col-start-3 justify-self-end shrink-0 flex items-center gap-0.5"
            >
              <nav-utility-icons size="mobile"></nav-utility-icons>
              <nav-account-menu variant="mobile"></nav-account-menu>
            </div>
          </div>
        </div>

        <!-- Two thirds / one third, matching the play surface below, so the
             columns line up down the page. Always split now: the streams panel
             stays put when nobody is live. -->
        <div
          class="w-full flex flex-col gap-4 px-4 lg:px-0 lg:grid lg:grid-cols-3 lg:gap-4 lg:items-stretch"
        >
          <!-- Mobile: spacer for fixed top bar -->
          <div
            class="lg:hidden h-[calc(env(safe-area-inset-top)+56px)] -mb-4"
          ></div>

          <!-- Left column: news banner, then the identity row. An empty news
               box would otherwise leave its gap behind and shorten the row. -->
          <div class="lg:col-span-2 flex flex-col gap-4 min-w-0">
            <!-- Square corners and top/bottom borders only, so on a phone it
                 wants the full width; the row's padding is cancelled rather
                 than leaving it inset with gaps down its sides. -->
            <news-box class="[&:empty]:hidden -mx-4 lg:mx-0"></news-box>

            <!-- Identity row: username over the currently selected cosmetic
                 background. Overflow stays visible and the row sits above what
                 follows it: the clan-tag dropdown opens out of this box. Each
                 layer rounds itself instead. -->
            <div
              class="relative z-20 flex flex-1 items-center min-h-12 min-w-0 rounded-xl border border-white/10"
            >
              <!-- Selected skin/pattern fills the bubble like the player's territory in game. -->
              <cosmetic-background
                class="absolute inset-0 z-0 rounded-xl overflow-hidden pointer-events-none"
              ></cosmetic-background>
              <div
                class="relative z-10 flex h-full w-full min-w-0 items-center rounded-xl bg-surface/80 px-1"
              >
                <username-input class="flex-1 min-w-0 h-10"></username-input>
              </div>
            </div>
          </div>

          <!-- Desktop only: a phone has no room to spare for it. -->
          <streaming-now
            class="hidden lg:flex lg:h-full lg:flex-col w-full min-w-0"
          ></streaming-now>
        </div>

        <!-- The lobby counting down, the queue beside it and the play buttons. -->
        <game-mode-selector
          class="lg:flex lg:flex-col lg:flex-1 lg:min-h-0"
        ></game-mode-selector>

        <!-- Desktop gets the compact footer button instead. -->
        <steam-wishlist
          campaign="home_mobile"
          class="block px-2 pb-4 lg:hidden"
        ></steam-wishlist>
      </div>
    `;
  }
}
