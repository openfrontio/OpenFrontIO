import { html, nothing, TemplateResult } from "lit";
import { clampPrestige } from "../../Progression";
import { translateText } from "../../Translate";
import { splitAccountUsername, usernameText } from "../ui/UsernameText";

// Who a player is, as the profile card shows it: the clan tag, the name and
// the "PRESTIGE 3 · LEVEL 47" line. Shared by <profile-card> and the player
// card strip so the two read the same.

export interface LevelLineProgress {
  prestige: number;
  level: number;
  legend: boolean;
}

// "PRESTIGE 3 · LEVEL 47", "LEVEL 47", or "LEGEND · PRESTIGE 10".
export function levelLineTemplate(
  progress: LevelLineProgress,
  compact: boolean,
): TemplateResult {
  const size = compact
    ? "text-sm tracking-wider"
    : "text-lg tracking-widest sm:text-xl";
  const prestige = clampPrestige(progress.prestige);
  if (progress.legend) {
    return html`<div
      data-profile-level-line
      class="bg-gradient-to-r from-yellow-300 via-fuchsia-300 to-yellow-300 bg-clip-text font-black uppercase text-transparent ${size}"
    >
      ${translateText("progression.legend")}
      <span class="text-white/40">·</span>
      ${translateText("progression.prestige", { prestige })}
    </div>`;
  }
  return html`<div
    data-profile-level-line
    class="font-black uppercase text-white ${size}"
  >
    ${
      prestige > 0
        ? html`<span class="text-yellow-300"
              >${translateText("progression.prestige", { prestige })}</span
            >
            <span class="text-white/30">·</span>`
        : nothing
    }
    ${translateText("progression.level", { level: progress.level })}
  </div>`;
}

// Segments the XP bar is drawn in, as on the end-of-game screen.
const BAR_SEGMENTS = 10;

// The segmented XP bar. `fill` is 0–1.
export function xpBarTemplate(fill: number, compact: boolean): TemplateResult {
  return html`<div
    data-xp-bar
    class="relative w-full overflow-hidden rounded-sm bg-white/15 ${
      compact ? "h-2" : "h-3"
    }"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow=${Math.round(fill * 100)}
  >
    <div
      data-xp-bar-fill
      class="h-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]"
      style="width: ${fill * 100}%"
    ></div>
    ${Array.from(
      { length: BAR_SEGMENTS - 1 },
      (_, i) =>
        html`<span
          aria-hidden="true"
          class="absolute top-0 h-full w-[2px] -translate-x-1/2 bg-[#0b1424]"
          style="left: ${((i + 1) * 100) / BAR_SEGMENTS}%"
        ></span>`,
    )}
  </div>`;
}

export function clanTemplate(
  clanTag: string | null,
  compact: boolean,
): TemplateResult | typeof nothing {
  if (clanTag === null) return nothing;
  return html`<span
    data-profile-clan
    class="font-black tracking-wider text-aquarius ${
      compact ? "shrink-0 text-sm" : "block text-sm"
    }"
    >[${clanTag}]</span
  >`;
}

// `sizeClass` sets the type size: the compact profile card and the card
// strip use different ones.
export function nameTemplate(
  username: string,
  sizeClass: string,
): TemplateResult {
  const { base, discriminator } = splitAccountUsername(username);
  const plainName = discriminator === null ? base : `${base}#${discriminator}`;
  return html`<span
    data-profile-name
    class="truncate font-black leading-tight ${sizeClass}"
    title=${plainName}
    >${usernameText(username, "")}</span
  >`;
}
