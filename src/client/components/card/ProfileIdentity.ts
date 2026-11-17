import { html, nothing, TemplateResult } from "lit";
import { clampPrestige } from "../../Progression";
import { translateText } from "../../Utils";
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
