import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { PublicProgress } from "../../core/ApiSchemas";
import { clampPrestige, MAX_LEVEL, MILESTONE_LEVELS } from "../Progression";
import { translateText } from "../Utils";
import "./LevelBadge";

// The profile's Progression tab: when each prestige rank was entered, and the
// milestone levels reached in each prestige run. Read from the public
// progress response, so it's the same for the player and their visitors.

export interface PrestigeTile {
  rank: number;
  // Null when the API doesn't say (an older response, or a rank entered
  // before the history was kept): the tile shows without a date.
  at: string | null;
}

export interface MilestoneSlot {
  level: number;
  reached: boolean;
  at: string | null;
}

export interface MilestoneRun {
  prestige: number;
  current: boolean;
  slots: MilestoneSlot[];
}

// Like the other dates the client shows (account, store, friends): the
// viewer's locale, day month year with a short month. Null for a date this
// browser can't read, so the caller drops it rather than show "Invalid Date".
export function formatProgressDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * One tile per rank entered, 1 up to the player's prestige, dated from the
 * history where it has the rank. Driven by the current prestige rather than
 * the list alone, so a missing or partial history still shows every rank.
 */
export function prestigeTiles(progress: PublicProgress): PrestigeTile[] {
  const dates = new Map<number, string>();
  for (const entry of progress.prestigeHistory ?? []) {
    if (!dates.has(entry.rank)) dates.set(entry.rank, entry.at);
  }
  const tiles: PrestigeTile[] = [];
  for (let rank = 1; rank <= clampPrestige(progress.prestige); rank++) {
    tiles.push({ rank, at: dates.get(rank) ?? null });
  }
  return tiles;
}

/**
 * Milestones grouped by prestige run, newest run first.
 *
 * The current run lists every milestone level: reached ones dated (or undated
 * when the level says it was reached but the list has no record of it), the
 * rest as "not yet". Earlier runs list only what they recorded, and a run
 * that recorded nothing is left out.
 */
export function milestoneRuns(progress: PublicProgress): MilestoneRun[] {
  const current = clampPrestige(progress.prestige);
  const byRun = new Map<number, Map<number, string>>();
  for (const m of progress.milestones ?? []) {
    // Only the milestone levels, and never a run past the current one.
    if (!MILESTONE_LEVELS.includes(m.level)) continue;
    if (!Number.isInteger(m.prestige) || m.prestige < 0) continue;
    if (m.prestige > current) continue;
    let run = byRun.get(m.prestige);
    if (run === undefined) {
      run = new Map();
      byRun.set(m.prestige, run);
    }
    if (!run.has(m.level)) run.set(m.level, m.at);
  }

  const currentRun = byRun.get(current) ?? new Map<number, string>();
  const runs: MilestoneRun[] = [
    {
      prestige: current,
      current: true,
      slots: MILESTONE_LEVELS.map((level) => {
        const at = currentRun.get(level) ?? null;
        return {
          level,
          reached: at !== null || progress.level >= level,
          at,
        };
      }),
    },
  ];
  const earlier = [...byRun.keys()]
    .filter((p) => p < current)
    .sort((a, b) => b - a);
  for (const prestige of earlier) {
    const run = byRun.get(prestige)!;
    runs.push({
      prestige,
      current: false,
      slots: MILESTONE_LEVELS.filter((level) => run.has(level)).map(
        (level) => ({ level, reached: true, at: run.get(level)! }),
      ),
    });
  }
  return runs;
}

const SECTION =
  "rounded-xl border border-white/10 bg-white/5 px-5 py-[18px] mb-4 last:mb-0";
const SECTION_TITLE =
  "mb-3.5 text-xs font-bold uppercase tracking-[0.12em] text-white/45";

@customElement("profile-progression")
export class ProfileProgression extends LitElement {
  @property({ attribute: false }) progress: PublicProgress | null = null;

  createRenderRoot() {
    return this;
  }

  render() {
    const progress = this.progress;
    if (progress === null) return nothing;
    // The 1–100 reward track (what each level grants) joins as a third
    // section, after the milestones, once the reward amounts are set.
    return html`
      ${this.renderHistory(progress)} ${this.renderMilestones(progress)}
    `;
  }

  private renderHistory(progress: PublicProgress): TemplateResult {
    const tiles = prestigeTiles(progress);
    return html`
      <section class=${SECTION} data-prestige-history>
        <h3 class=${SECTION_TITLE}>
          ${translateText("player_profile.prestige_history")}
        </h3>
        ${tiles.length === 0
          ? html`<p class="text-sm text-white/50" data-no-prestige>
              ${translateText("player_profile.no_prestige")}
            </p>`
          : html`<div class="flex flex-wrap gap-3">
              ${tiles.map((tile) => this.renderPrestigeTile(tile))}
            </div>`}
      </section>
    `;
  }

  private renderPrestigeTile(tile: PrestigeTile): TemplateResult {
    const date = tile.at === null ? null : formatProgressDate(tile.at);
    return html`
      <div
        class="flex flex-[1_1_150px] items-center gap-2.5 rounded-[10px] border border-white/[0.06] bg-black/20 px-3.5 py-2.5"
        data-prestige-tile=${tile.rank}
      >
        <level-badge
          .level=${1}
          .prestige=${tile.rank}
          .size=${36}
        ></level-badge>
        <div class="min-w-0">
          <div class="font-bold text-white">
            ${translateText("progression.prestige", { prestige: tile.rank })}
          </div>
          ${date === null
            ? nothing
            : html`<div class="text-xs text-white/50" data-date>${date}</div>`}
        </div>
      </div>
    `;
  }

  private renderMilestones(progress: PublicProgress): TemplateResult {
    return html`
      <section class=${SECTION} data-milestones>
        <h3 class=${SECTION_TITLE}>
          ${translateText("player_profile.milestones")}
        </h3>
        ${milestoneRuns(progress).map((run) =>
          this.renderRun(run, progress.legend),
        )}
      </section>
    `;
  }

  // "Current run · Prestige 3" (or "Current run" before any prestige) for the
  // run being played, "Prestige 2" / "First run" for finished ones. A Legend
  // has no run left to play: theirs is the finished last run, so it's named
  // for that instead, and its level 100 wears the Legend badge.
  private runLabel(run: MilestoneRun, legend: boolean): string {
    if (run.current && legend) {
      return translateText("player_profile.legend_run", {
        prestige: run.prestige,
      });
    }
    if (run.current) {
      return run.prestige === 0
        ? translateText("player_profile.current_run")
        : translateText("player_profile.current_run_prestige", {
            prestige: run.prestige,
          });
    }
    return run.prestige === 0
      ? translateText("player_profile.first_run")
      : translateText("progression.prestige", { prestige: run.prestige });
  }

  private renderRun(run: MilestoneRun, legend: boolean): TemplateResult {
    return html`
      <div
        class="mb-4 last:mb-0"
        data-milestone-run=${run.prestige}
        ?data-current-run=${run.current}
      >
        <h4 class="mb-2.5 mt-1 text-sm font-bold text-white">
          ${this.runLabel(run, legend)}
        </h4>
        <div class="flex flex-wrap gap-2.5">
          ${run.slots.map((slot) =>
            this.renderSlot(
              run.prestige,
              slot,
              run.current && legend && slot.level === MAX_LEVEL,
            ),
          )}
        </div>
      </div>
    `;
  }

  private renderSlot(
    prestige: number,
    slot: MilestoneSlot,
    legend: boolean,
  ): TemplateResult {
    const date = slot.at === null ? null : formatProgressDate(slot.at);
    const caption = slot.reached
      ? date
      : translateText("player_profile.milestone_not_yet");
    return html`
      <div
        class="flex w-[78px] flex-col items-center gap-1.5 ${slot.reached
          ? ""
          : "opacity-30"}"
        data-milestone=${slot.level}
        ?data-reached=${slot.reached}
      >
        <level-badge
          .level=${slot.level}
          .prestige=${prestige}
          .legend=${legend}
          .size=${40}
        ></level-badge>
        ${caption === null
          ? nothing
          : html`<div
              class="text-center text-[11px] text-white/55"
              data-caption
            >
              ${caption}
            </div>`}
      </div>
    `;
  }
}
