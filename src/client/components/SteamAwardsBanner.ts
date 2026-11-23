import { html, LitElement, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { isSteamShell } from "../DesktopShell";
import { translateText } from "../Utils";

/**
 * When Steam Awards nominations close: "until 30 NOV, 10 GMT-8" on
 * store.steampowered.com/steamawards. The banner is gone after this.
 */
export const STEAM_AWARDS_NOMINATIONS_END = Date.parse("2026-11-30T18:00:00Z");

/**
 * Our Steam news post asking for the nomination. It is a "Steam Award
 * nomination request" event, so Steam puts the nominate box on the post
 * itself.
 */
export const STEAM_AWARDS_POST_URL =
  "https://store.steampowered.com/news/app/3560670/view/711166768421274599";

/** localStorage key set when the player closes the banner. */
export const STEAM_AWARDS_DISMISSED_KEY = "steamAwards2026Dismissed";

/**
 * Whether the nomination banner shows: in the Steam app only (the players who
 * own the game on Steam, so can nominate it), until nominations close, and
 * until the player closes it.
 */
export function steamAwardsBannerShown(
  inSteamApp: boolean,
  dismissed: boolean,
  now: number = Date.now(),
): boolean {
  return inSteamApp && !dismissed && now < STEAM_AWARDS_NOMINATIONS_END;
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(STEAM_AWARDS_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** {@link steamAwardsBannerShown} for this client. */
export function showSteamAwardsBanner(now: number = Date.now()): boolean {
  return steamAwardsBannerShown(isSteamShell(), dismissed(), now);
}

/**
 * Asks Steam players to nominate OpenFront for the Steam Awards' "Just Five
 * More Minutes" award. Opens our news post, which carries Steam's nominate
 * box. Fires `steam-awards-dismissed`
 * (bubbling) when closed.
 */
@customElement("steam-awards-banner")
export class SteamAwardsBanner extends LitElement {
  createRenderRoot() {
    return this;
  }

  private dismiss(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    try {
      localStorage.setItem(STEAM_AWARDS_DISMISSED_KEY, "1");
    } catch {
      // Private storage: it closes for this page only.
    }
    this.dispatchEvent(
      new CustomEvent("steam-awards-dismissed", { bubbles: true }),
    );
  }

  render() {
    if (!showSteamAwardsBanner()) return nothing;
    return html`<div
      data-steam-awards-banner
      class="relative overflow-hidden rounded-lg border border-cyber-yellow/50 bg-gradient-to-r from-deep-navy via-[#3b2a08] to-[#8a6410] shadow-[0_4px_20px_rgba(255,200,40,0.25)]"
    >
      <a
        href=${STEAM_AWARDS_POST_URL}
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-3 py-2 pl-3 pr-9 transition-[filter] hover:brightness-110"
      >
        <svg
          class="h-8 w-8 shrink-0 text-cyber-yellow drop-shadow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
          <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
        </svg>
        <span class="flex min-w-0 flex-1 flex-col leading-tight">
          <span
            class="truncate text-base font-black uppercase tracking-wide text-white"
            >${translateText("steam_awards.title")}</span
          >
          <span class="text-xs font-semibold text-amber-100/90"
            >${translateText("steam_awards.desc")}</span
          >
        </span>
        <span
          class="hidden shrink-0 rounded-md bg-cyber-yellow px-2 py-1 text-xs font-black uppercase text-deep-navy shadow-md shadow-black/40 sm:inline"
          >${translateText("steam_awards.cta")}</span
        >
      </a>
      <button
        data-steam-awards-dismiss
        class="absolute right-1.5 top-1.5 p-1 text-white/50 transition-colors hover:text-white"
        aria-label=${translateText("news_box.dismiss")}
        @click=${(event: Event) => this.dismiss(event)}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
          <path
            d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
          />
        </svg>
      </button>
    </div>`;
  }
}
