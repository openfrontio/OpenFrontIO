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
      class="player-card @container relative min-h-[92px] w-full overflow-hidden rounded-xl border-2 border-sky-300/50 text-white"
    >
      <card-background .background=${null}></card-background>
      <!-- Narrower than 32rem (a phone's end screen) the row wraps: tag and
           trackers on top, the chips on a line of their own. -->
      <div
        data-clan-win-row
        class="relative flex h-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 @lg:flex-nowrap @lg:gap-4 @lg:px-4"
      >
        <div
          data-clan-tag
          class="min-w-0 shrink text-2xl font-black tracking-wider break-all text-aquarius @lg:shrink-0 @lg:text-3xl"
        >
          [${this.clanTag}]
        </div>
        <div
          data-clan-members
          class="order-last flex min-w-0 basis-full flex-wrap gap-1.5 @lg:order-none @lg:flex-1 @lg:basis-0"
        >
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
        <div class="ml-auto flex shrink-0 items-stretch">
          <div
            data-card-tracker="territory"
            class="flex min-w-[3.5rem] flex-col items-center justify-center px-2 @lg:min-w-[4.5rem] @lg:px-3"
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
            class="flex min-w-[3.5rem] flex-col items-center justify-center border-l border-white/15 px-2 @lg:min-w-[4.5rem] @lg:px-3"
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
