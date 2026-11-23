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

/**
 * Whether the nomination banner shows: in the Steam app only (the players who
 * own the game on Steam, so can nominate it), until nominations close. It
 * can't be closed.
 */
export function steamAwardsBannerShown(
  inSteamApp: boolean,
  now: number = Date.now(),
): boolean {
  return inSteamApp && now < STEAM_AWARDS_NOMINATIONS_END;
}

/** {@link steamAwardsBannerShown} for this client. */
export function showSteamAwardsBanner(now: number = Date.now()): boolean {
  return steamAwardsBannerShown(isSteamShell(), now);
}

/**
 * Asks Steam players to nominate OpenFront for the Steam Awards' "Just Five
 * More Minutes" award. Opens our news post, which carries Steam's nominate
 * box.
 */
@customElement("steam-awards-banner")
export class SteamAwardsBanner extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    if (!showSteamAwardsBanner()) return nothing;
    return html`<a
      data-steam-awards-banner
      href=${STEAM_AWARDS_POST_URL}
      target="_blank"
      rel="noopener noreferrer"
      class="flex items-center gap-3 overflow-hidden rounded-lg border border-cyber-yellow/50 bg-gradient-to-r from-deep-navy via-[#3b2a08] to-[#8a6410] px-3 py-2 shadow-[0_4px_20px_rgba(255,200,40,0.25)] transition-[filter] hover:brightness-110"
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
    </a>`;
  }
}
