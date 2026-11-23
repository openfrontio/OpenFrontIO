import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../../components/card/ClanWinCard";
import type { ClanWinMember } from "../../components/card/ClanWinCard";
import "../../components/card/PlayerCard";
import type { PlayerCardView } from "../../components/card/PlayerCardModel";
import { translateText } from "../../Utils";

// The card section at the top of the end screen, above the XP panel:
//   eliminatedBy  "Eliminated by" and the nemesis line, then the killer's card
//   winner        "Winner", the winner's card, "Edit my card" for owners
//   clan          "Winner", the winning clan's card (a Clan Wars win)
//   none          nothing: today's screen
// Emits `edit-card` when "Edit my card" is clicked.

export type EndCardMode = "none" | "eliminatedBy" | "winner" | "clan";

export interface EndCardClan {
  clanTag: string;
  members: ClanWinMember[];
  territoryPct: number;
}

@customElement("end-card-section")
export class EndCardSection extends LitElement {
  @property({ type: String }) mode: EndCardMode = "none";
  @property({ attribute: false }) view: PlayerCardView | null = null;
  @property({ attribute: false }) clan: EndCardClan | null = null;
  @property({ attribute: false }) nemesis: { count: number } | null = null;
  @property({ type: Boolean }) canEdit = false;

  createRenderRoot() {
    return this;
  }

  private label(text: string) {
    return html`<span
      data-end-card-label
      class="text-[11px] font-black uppercase tracking-[0.2em] text-amber-300"
      >${text}</span
    >`;
  }

  render() {
    if (this.mode === "none") return nothing;
    if (this.mode === "clan") {
      if (this.clan === null) return nothing;
      return html`<div data-end-card class="mb-3">
        <div class="mb-1.5">
          ${this.label(translateText("player_card.winner"))}
        </div>
        <clan-win-card
          .clanTag=${this.clan.clanTag}
          .members=${this.clan.members}
          .territoryPct=${this.clan.territoryPct}
        ></clan-win-card>
      </div>`;
    }
    if (this.view === null) return nothing;
    const eliminated = this.mode === "eliminatedBy";
    return html`<div data-end-card class="mb-3">
      <div class="mb-1.5 flex items-center justify-between gap-3">
        ${this.label(
          translateText(
            eliminated ? "win_modal.eliminated_by" : "player_card.winner",
          ),
        )}
        <div class="flex items-center gap-2">
          ${
            eliminated && this.nemesis !== null
              ? html`<span
                  data-end-card-nemesis
                  class="text-xs font-bold text-rose-300"
                  ><span class="hidden sm:inline"
                    >${translateText("win_modal.nemesis", {
                      n: this.nemesis.count,
                    })}</span
                  ><span class="sm:hidden"
                    >${translateText("win_modal.nemesis_short", {
                      n: this.nemesis.count,
                    })}</span
                  ></span
                >`
              : nothing
          }
        </div>
      </div>
      <player-card .view=${this.view} size="end" animated></player-card>
      ${
        !eliminated && this.canEdit
          ? html`<div class="mt-1 text-right">
              <button
                type="button"
                data-end-card-edit
                class="text-xs font-bold text-sky-300 underline-offset-2 hover:underline"
                @click=${() =>
                  this.dispatchEvent(
                    new CustomEvent("edit-card", {
                      bubbles: true,
                      composed: true,
                    }),
                  )}
              >
                ${translateText("win_modal.edit_card")}
              </button>
            </div>`
          : nothing
      }
    </div>`;
  }
}
