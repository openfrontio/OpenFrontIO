import type { LevelBadge } from "@openfront/shared/LevelBadgeWire";
import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";
import "../LevelBadge";
import "./CardBackground";

// The winner's card for a Clan Wars win: the winning clan rather than one
// player. Its tag large, the members as chips (badge and name, dimmed if
// they died), and two trackers: the team's territory and how many members
// are still alive. Free: it shows the clan's win, it isn't a cosmetic. The
// same strip size as <player-card size="end">.

export interface ClanWinMember {
  username: string;
  badge: LevelBadge | null;
  alive: boolean;
}

// Chips shown before "+N".
const MAX_CHIPS = 6;

@customElement("clan-win-card")
export class ClanWinCard extends LitElement {
  @property({ type: String }) clanTag = "";
  @property({ attribute: false }) members: ClanWinMember[] = [];
  // The winning team's share of the map at game end, 0–100.
  @property({ type: Number }) territoryPct = 0;

  createRenderRoot() {
    return this;
  }

  render() {
    const shown = this.members.slice(0, MAX_CHIPS);
    const more = this.members.length - shown.length;
    const alive = this.members.filter((m) => m.alive).length;
    return html`<section
      data-clan-win-card
      class="player-card relative min-h-[92px] w-full overflow-hidden rounded-xl border-2 border-sky-300/50 text-white"
    >
      <card-background .background=${null}></card-background>
      <div class="relative flex h-full items-center gap-4 px-4 py-3">
        <div
          data-clan-tag
          class="shrink-0 text-3xl font-black tracking-wider text-aquarius"
        >
          [${this.clanTag}]
        </div>
        <div class="flex min-w-0 flex-1 flex-wrap gap-1.5">
          ${shown.map(
            (m) =>
              html`<span
                data-clan-member
                ?data-dead=${!m.alive}
                class="flex max-w-[9rem] items-center gap-1 rounded-md bg-black/30 px-1.5 py-0.5 text-xs font-bold ${
                  m.alive ? "" : "opacity-40"
                }"
              >
                ${
                  m.badge === null
                    ? nothing
                    : html`<level-badge
                        .level=${m.badge.level}
                        .prestige=${m.badge.prestige}
                        .legend=${m.badge.legend}
                        .size=${20}
                      ></level-badge>`
                }
                <span class="truncate">${m.username}</span>
              </span>`,
          )}
          ${
            more > 0
              ? html`<span
                  data-clan-more
                  class="rounded-md bg-black/30 px-1.5 py-0.5 text-xs font-bold text-white/70"
                  >+${more}</span
                >`
              : nothing
          }
        </div>
        <div class="flex shrink-0 items-stretch">
          <div
            data-card-tracker="territory"
            class="flex min-w-[4.5rem] flex-col items-center justify-center px-3"
          >
            <span class="text-xl font-black tabular-nums leading-none"
              >${Math.round(this.territoryPct)}%</span
            >
            <span
              class="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/55"
              >${translateText("player_card.territory")}</span
            >
          </div>
          <div
            data-card-tracker="members_alive"
            class="flex min-w-[4.5rem] flex-col items-center justify-center border-l border-white/15 px-3"
          >
            <span class="text-xl font-black tabular-nums leading-none"
              >${alive}/${this.members.length}</span
            >
            <span
              class="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/55"
              >${translateText("player_card.members_alive")}</span
            >
          </div>
        </div>
      </div>
    </section>`;
  }
}
