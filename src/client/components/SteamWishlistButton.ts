import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { steamSDK } from "../SteamSDK";
import { translateText } from "../Utils";
import { steamStoreUrl } from "./SteamWishlist";

/**
 * Wide, short promo strip linking to the Steam store page, for slots too short
 * to host the store widget iframe — Steam's widget card is pinned to a fixed
 * 146px, so squashing it into the footer would drop its text to ~4px. This
 * rebuilds the widget's look (slate gradient card, logo, green wishlist CTA) at
 * a height the footer can spare, and stays crisp because it is real DOM rather
 * than a downscaled frame. Colours are lifted from Steam's widget stylesheet.
 *
 * Carries the same UTM campaign tagging as the widget, so footer clicks land in
 * the Steamworks dashboard alongside it. Self-hides inside the Steam desktop
 * build, matching `<steam-wishlist>`.
 */
@customElement("steam-wishlist-button")
export class SteamWishlistButton extends LitElement {
  /** UTM campaign identifying the placement, e.g. "homepage". */
  @property({ type: String }) campaign = "";

  createRenderRoot() {
    return this;
  }

  render() {
    if (steamSDK.isOnSteam()) return nothing;

    return html`
      <a
        href=${steamStoreUrl(this.campaign)}
        target="_blank"
        rel="noopener noreferrer"
        class="group flex w-full items-center justify-center gap-3 rounded border-t border-l border-[#424c5c] bg-[linear-gradient(130deg,#3b4351,#282e39)] px-3 py-2 shadow-md transition-shadow hover:shadow-lg xl:justify-start"
      >
        <img
          src=${assetUrl("images/OpenFrontLogo.svg")}
          alt=""
          class="hidden h-7 w-auto max-w-[120px] shrink-0 object-contain pointer-events-none min-[1600px]:block"
          draggable="false"
        />
        <span class="hidden min-w-0 flex-col leading-tight xl:flex">
          <span class="truncate text-sm font-semibold text-white">
            ${translateText("steam_wishlist.on_steam")}
          </span>
          <span class="truncate text-[11px] text-white/55">
            ${translateText("steam_wishlist.release")}
          </span>
        </span>
        <span
          class="inline-flex shrink-0 items-center gap-1.5 rounded-sm xl:ml-auto bg-[linear-gradient(to_bottom,#8ec72e,#4c7a17)] px-3 py-1.5 text-xs font-bold whitespace-nowrap text-white transition-[filter] group-hover:brightness-110"
        >
          <svg
            class="h-3.5 w-3.5 shrink-0 pointer-events-none"
            viewBox="0 0 91.05 91.21"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M45.45,0C21.49,0,1.87,18.47,0,41.95l24.44,10.11c2.07-1.42,4.57-2.24,7.27-2.24,.24,0,.48,0,.72,.02l10.87-15.76c0-.07,0-.15,0-.22,0-9.48,7.72-17.2,17.2-17.2s17.2,7.72,17.2,17.2-7.72,17.2-17.2,17.2c-.13,0-.26,0-.39,0l-15.5,11.06c0,.2,.01,.41,.01,.61,0,7.12-5.79,12.91-12.91,12.91-6.25,0-11.47-4.46-12.66-10.37L1.57,58.03c5.41,19.14,23,33.18,43.88,33.18,25.19,0,45.6-20.42,45.6-45.6S70.63,0,45.45,0Z"
            />
            <path
              d="M28.58,69.2l-5.6-2.31c.99,2.07,2.71,3.8,4.99,4.75,4.93,2.05,10.61-.29,12.67-5.22,.99-2.39,1-5.02,.01-7.41-.98-2.39-2.84-4.26-5.23-5.25-2.37-.99-4.91-.95-7.14-.11l5.79,2.39c3.64,1.52,5.36,5.69,3.84,9.33-1.51,3.64-5.69,5.36-9.33,3.84Z"
            />
            <path
              d="M71.96,33.85c0-6.32-5.14-11.46-11.46-11.46s-11.46,5.14-11.46,11.46,5.14,11.46,11.46,11.46,11.46-5.14,11.46-11.46Zm-20.05-.02c0-4.75,3.86-8.61,8.61-8.61s8.61,3.85,8.61,8.61-3.85,8.61-8.61,8.61-8.61-3.85-8.61-8.61Z"
            />
          </svg>
          ${translateText("steam_wishlist.cta")}
        </span>
      </a>
    `;
  }
}
