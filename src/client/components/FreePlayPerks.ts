import { html, TemplateResult } from "lit";
import { isDesktopShell } from "../DesktopShell";
import { translateText } from "../Utils";

const PERK_KEYS = [
  "free_play.full_game",
  "free_play.ranked",
  "free_play.custom_lobbies",
  "free_play.account",
];

/**
 * What a player keeps with no subscription at all. Shown wherever the client
 * talks about a subscription ending, so "ends" is never read as "the game
 * stops".
 *
 * The ad-free line is only true in the desktop build, where Main switches ads
 * off for every session regardless of tier; a free player on the website does
 * see ads, so the same list there must not promise otherwise.
 */
export function renderFreePlayPerks(headingKey: string): TemplateResult {
  const keys = isDesktopShell()
    ? [...PERK_KEYS, "free_play.ad_free_steam"]
    : PERK_KEYS;
  return html`
    <div class="flex flex-col gap-1.5">
      <div class="text-[10px] uppercase tracking-wider text-white/50">
        ${translateText(headingKey)}
      </div>
      <ul class="flex flex-col gap-1 text-sm text-white/70">
        ${keys.map(
          (key) => html`
            <li class="flex gap-2 leading-snug">
              <span class="text-emerald-400 shrink-0" aria-hidden="true"
                >✓</span
              >
              <span>${translateText(key)}</span>
            </li>
          `,
        )}
      </ul>
    </div>
  `;
}
