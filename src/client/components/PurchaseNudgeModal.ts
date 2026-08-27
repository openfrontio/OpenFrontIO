import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { UserMeResponse } from "../../core/ApiSchemas";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { isDesktopShell } from "../DesktopShell";
import { getGamesPlayed, translateText } from "../Utils";

const SHOWN_KEY = "purchaseNudgeShown";
const MIN_GAMES_PLAYED = 50;

/**
 * A one-time nudge for long-time players who haven't bought anything: shown
 * on the home page as soon as the player's profile is known, once they are
 * past MIN_GAMES_PLAYED games, then never again (persisted in localStorage).
 *
 * It reads the `userMeResponse` document event (dispatched after login / on
 * load, `false` when logged out). Ad-free players have already purchased —
 * seeing one marks the nudge as shown, so it stays off even if they later
 * log out in this browser. CrazyGames has its own storefront and the desktop
 * shell never shows ads, so neither sees it. Closing takes an explicit click
 * on the X (or on "Visit store"); there is no backdrop-click dismissal.
 */
@customElement("purchase-nudge-modal")
export class PurchaseNudgeModal extends LitElement {
  @state() private isVisible = false;

  private onUserMeResponse = (event: Event) => {
    if (this.isVisible) return;
    const detail = (event as CustomEvent<UserMeResponse | false>).detail;
    if (detail !== false && detail.player.adfree === true) {
      // Already purchased: latch the flag now so that a later logged-out
      // visit in this browser (where ad-free is unknown) can't nudge them.
      localStorage.setItem(SHOWN_KEY, "1");
      return;
    }
    if (
      crazyGamesSDK.isOnCrazyGames() ||
      isDesktopShell() ||
      getGamesPlayed() <= MIN_GAMES_PLAYED ||
      localStorage.getItem(SHOWN_KEY) !== null
    ) {
      return;
    }
    localStorage.setItem(SHOWN_KEY, "1");
    this.isVisible = true;
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

  private visitStore() {
    window.location.hash = "modal=store";
    this.dismiss();
  }

  private dismiss() {
    this.isVisible = false;
  }

  render() {
    if (!this.isVisible) return nothing;

    return html`
      <div
        class="fixed inset-0 z-[10000] bg-black/50 flex items-center justify-center p-4"
      >
        <div
          class="bg-gray-800 text-white rounded-xl shadow-2xl max-w-md w-full p-6"
          role="dialog"
          aria-label=${translateText("purchase_nudge.title")}
        >
          <div class="flex items-start justify-between gap-4 mb-3">
            <h2 class="text-2xl font-bold">
              ${translateText("purchase_nudge.title")}
            </h2>
            <button
              class="shrink-0 text-white/70 hover:text-white text-2xl leading-none cursor-pointer"
              aria-label=${translateText("purchase_nudge.close")}
              @click=${this.dismiss}
            >
              ✕
            </button>
          </div>
          <p class="mb-6 text-gray-200">
            ${translateText("purchase_nudge.body")}
          </p>
          <div class="flex justify-end">
            <o-button
              variant="primary"
              translationKey="purchase_nudge.visit_store"
              @click=${this.visitStore}
            ></o-button>
          </div>
        </div>
      </div>
    `;
  }
}
