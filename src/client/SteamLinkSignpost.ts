import { html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { steamSDK } from "./SteamSDK";
import { translateText } from "./Utils";

const SEEN_KEY = "steam_link_signpost_seen";

/**
 * One-time first-launch signpost for the Steam desktop build. Account
 * linking (matching a Steam player to an existing web OpenFront account)
 * isn't implemented yet — a fresh install on Steam always creates a new
 * account. This tells the player that once, so they aren't surprised, and
 * never shows again once dismissed (or once seen, since `dismiss()` is the
 * only way the seen-flag gets set).
 *
 * Self-hides off Steam, so mounting it unconditionally (web + desktop) is
 * safe.
 */
@customElement("steam-link-signpost")
export class SteamLinkSignpost extends LitElement {
  createRenderRoot() {
    return this;
  }

  shouldShow(): boolean {
    return steamSDK.isOnSteam() && localStorage.getItem(SEEN_KEY) !== "1";
  }

  dismiss(): void {
    localStorage.setItem(SEEN_KEY, "1");
    this.requestUpdate();
  }

  render() {
    if (!this.shouldShow()) return nothing;

    return html`
      <div
        class="fixed bottom-4 left-4 right-4 z-[10000] sm:left-auto sm:right-4 sm:w-[300px] bg-surface border border-white/10 rounded-xl shadow-[var(--shadow-malibu-blue)] p-3"
        role="dialog"
        aria-label=${translateText("steam.link_signpost")}
      >
        <p class="text-xs text-white/80 mb-2">
          ${translateText("steam.link_signpost")}
        </p>
        <button
          class="w-full px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-transparent bg-malibu-blue text-white shadow-[var(--shadow-malibu-blue-pill)] hover:bg-aquarius transition-all cursor-pointer"
          @click=${() => this.dismiss()}
        >
          ${translateText("common.got_it")}
        </button>
      </div>
    `;
  }
}
