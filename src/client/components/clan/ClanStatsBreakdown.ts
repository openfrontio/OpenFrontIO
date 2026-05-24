import { html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  RANKED_BREAKDOWN_KEYS,
  TEAM_BREAKDOWN_KEYS,
  type ClanMemberStats,
  type ClanMemberWL,
} from "../../../core/ClanApiSchemas";
import { translateText } from "../../Utils";
import { renderWLBarRow } from "./ClanShared";

type SubKey =
  | (typeof TEAM_BREAKDOWN_KEYS)[number]
  | (typeof RANKED_BREAKDOWN_KEYS)[number];

const LEVEL_LEFT_PAD: Record<0 | 1 | 2, string> = {
  0: "pl-1.5",
  1: "pl-5",
  2: "pl-9",
};

function labelForSubKey(key: SubKey): string {
  switch (key) {
    case "duos":
      return translateText("clan_modal.stats_duos");
    case "trios":
      return translateText("clan_modal.stats_trios");
    case "quads":
      return translateText("clan_modal.stats_quads");
    case "1v1":
      return translateText("clan_modal.stats_1v1");
    default:
      return translateText("clan_modal.stats_team_count", { count: key });
  }
}

function hasGames(wl: ClanMemberWL): boolean {
  return wl.wins > 0 || wl.losses > 0;
}

@customElement("clan-stats-breakdown")
export class ClanStatsBreakdown extends LitElement {
  @property({ type: Object }) stats!: ClanMemberStats;
  @state() private expandedTotal = false;
  @state() private expandedTeam = false;
  @state() private expandedRanked = false;

  createRenderRoot() {
    return this;
  }

  private get teamSubKeys(): readonly (typeof TEAM_BREAKDOWN_KEYS)[number][] {
    return TEAM_BREAKDOWN_KEYS.filter((k) => hasGames(this.stats[k]));
  }

  private get rankedSubKeys(): readonly (typeof RANKED_BREAKDOWN_KEYS)[number][] {
    return RANKED_BREAKDOWN_KEYS.filter((k) => hasGames(this.stats[k]));
  }

  public setAllExpanded(expanded: boolean) {
    this.expandedTotal = expanded;
    this.expandedTeam = expanded;
    this.expandedRanked = expanded;
  }

  private toggleTotal = () => {
    this.expandedTotal = !this.expandedTotal;
  };

  private toggleTeam = () => {
    this.expandedTeam = !this.expandedTeam;
  };

  private toggleRanked = () => {
    this.expandedRanked = !this.expandedRanked;
  };

  private renderRow(
    label: string,
    wl: ClanMemberWL,
    level: 0 | 1 | 2,
    expand?: { expanded: boolean; onToggle: () => void; disabled: boolean },
  ): TemplateResult {
    const row = renderWLBarRow(label, wl.wins, wl.losses);
    const toggleVisible = !!expand && !expand.disabled;
    const toggleIcon = html`
      <span
        class="w-3 h-3 shrink-0 flex items-center justify-center text-white/40 transition-transform duration-150
          ${expand?.expanded ? "rotate-90" : ""}"
        aria-hidden="true"
      >
        ${toggleVisible
          ? html`<svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-2.5 h-2.5"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>`
          : ""}
      </span>
    `;
    const padding = `${LEVEL_LEFT_PAD[level]} pr-1.5 py-0.5`;
    if (!expand || expand.disabled) {
      return html`
        <div class="flex items-center gap-2 ${padding}">
          ${toggleIcon}
          <div class="flex-1 min-w-0">${row}</div>
        </div>
      `;
    }
    const title = translateText(
      expand.expanded ? "clan_modal.stats_collapse" : "clan_modal.stats_expand",
    );
    return html`
      <button
        type="button"
        class="w-full flex items-center gap-2 ${padding} text-left rounded-md transition-colors cursor-pointer
          hover:bg-white/10 focus-visible:bg-white/10 focus:outline-none
          ${expand.expanded ? "bg-white/5" : ""}"
        @click=${expand.onToggle}
        title=${title}
        aria-expanded=${expand.expanded}
      >
        ${toggleIcon}
        <div class="flex-1 min-w-0">${row}</div>
      </button>
    `;
  }

  render() {
    if (!this.stats) return html``;
    const teamKeys = this.teamSubKeys;
    const rankedKeys = this.rankedSubKeys;
    return html`
      <div class="space-y-0">
        ${this.renderRow(
          translateText("clan_modal.stats_total"),
          this.stats.total,
          0,
          {
            expanded: this.expandedTotal,
            onToggle: this.toggleTotal,
            disabled: false,
          },
        )}
        ${this.expandedTotal
          ? html`
              ${this.renderRow(
                translateText("clan_modal.stats_ffa"),
                this.stats.ffa,
                1,
              )}
              ${this.renderRow(
                translateText("clan_modal.stats_team"),
                this.stats.team,
                1,
                {
                  expanded: this.expandedTeam,
                  onToggle: this.toggleTeam,
                  disabled: teamKeys.length === 0,
                },
              )}
              ${this.expandedTeam
                ? html`${teamKeys.map((k) =>
                    this.renderRow(labelForSubKey(k), this.stats[k], 2),
                  )}`
                : ""}
              ${this.renderRow(
                translateText("clan_modal.stats_hvn"),
                this.stats.hvn,
                1,
              )}
              ${this.renderRow(
                translateText("clan_modal.stats_ranked"),
                this.stats.ranked,
                1,
                {
                  expanded: this.expandedRanked,
                  onToggle: this.toggleRanked,
                  disabled: rankedKeys.length === 0,
                },
              )}
              ${this.expandedRanked
                ? html`${rankedKeys.map((k) =>
                    this.renderRow(labelForSubKey(k), this.stats[k], 2),
                  )}`
                : ""}
            `
          : ""}
      </div>
    `;
  }
}
