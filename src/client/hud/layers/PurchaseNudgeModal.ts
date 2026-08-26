import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { UserMeResponse } from "../../../core/ApiSchemas";
import { Controller } from "../../Controller";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { isDesktopShell } from "../../DesktopShell";
import { getGamesPlayed, translateText } from "../../Utils";
import { GameView } from "../../view";

const SHOWN_KEY = "purchaseNudgeShown";
const MIN_GAMES_PLAYED = 50;

// A one-time nudge for long-time players who haven't bought anything: shown
// during the spawn phase once they are past MIN_GAMES_PLAYED games, then never
// again (persisted in localStorage). Ad-free players have already purchased,
// CrazyGames has its own storefront, and the desktop shell never shows ads,
// so none of them see it.
@customElement("purchase-nudge-modal")
export class PurchaseNudgeModal extends LitElement implements Controller {
  public game: GameView;

  @state() private isVisible = false;

  // Only decide once the profile is known: `userMeResponse` fires on load with
  // the profile, or `false` when logged out (who can't be ad-free).
  private profileKnown = false;
  private adFree = false;
  private done = false;

  private onUserMeResponse = (event: Event) => {
    const detail = (event as CustomEvent<UserMeResponse | false>).detail;
    this.profileKnown = true;
    this.adFree = detail !== false && detail.player.adfree === true;
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

  init() {}

  tick() {
    // A spawn-phase nudge only: if the player never clicked it (random spawn,
    // timer ran out), close it rather than leave it over live gameplay.
    if (this.isVisible) {
      if (!this.game.inSpawnPhase()) this.dismiss();
      return;
    }
    if (this.done || !this.game.inSpawnPhase()) return;
    if (
      !this.profileKnown ||
      this.adFree ||
      crazyGamesSDK.isOnCrazyGames() ||
      isDesktopShell() ||
      this.game.config().isReplay() ||
      getGamesPlayed() <= MIN_GAMES_PLAYED ||
      localStorage.getItem(SHOWN_KEY) !== null
    ) {
      return;
    }
    this.done = true;
    localStorage.setItem(SHOWN_KEY, "1");
    this.isVisible = true;
  }

  private visitStore() {
    // A new tab, so the player stays in the game they just joined.
    window.open("/#modal=store", "_blank", "noopener");
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
        @click=${this.dismiss}
      >
        <div
          class="bg-gray-800 text-white rounded-xl shadow-2xl max-w-md w-full p-6"
          role="dialog"
          aria-label=${translateText("purchase_nudge.title")}
          @click=${(e: Event) => e.stopPropagation()}
        >
          <h2 class="text-2xl font-bold mb-3">
            ${translateText("purchase_nudge.title")}
          </h2>
          <p class="mb-6 text-gray-200">
            ${translateText("purchase_nudge.body")}
          </p>
          <div class="flex justify-end gap-3">
            <button
              class="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
              @click=${this.dismiss}
            >
              ${translateText("purchase_nudge.later")}
            </button>
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
