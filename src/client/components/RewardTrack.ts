import { html, LitElement, nothing, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  ProgressionConfig,
  Reward,
  TrackFlare,
} from "../../core/ApiSchemas";
import {
  clampPrestige,
  isMilestoneLevel,
  MAX_LEVEL,
  MAX_PRESTIGE,
} from "../Progression";
import { prefersReducedMotion } from "../utilities/ReducedMotion";
import { translateText } from "../Utils";
import "./baseComponents/Button";
import "./CapIcon";
import {
  describeFlareCosmetic,
  type FlareCosmeticView,
  plainFlareCosmetic,
} from "./FlareCosmetic";
import "./LevelBadge";
import "./PlutoniumIcon";

// The profile's reward track: what each level of the current prestige run
// pays (Caps, Plutonium, a cosmetic), where the player is on it, and what the
// end of the run gives. A strip of the whole run above a scrolling track of
// level nodes. The owner also sees which levels are claimed, and can claim
// the ones waiting.

// The reasons the API pays a level reward under (RewardSchema.reason).
const LEVEL_REWARD_REASONS: ReadonlySet<string> = new Set([
  "level_up",
  "level_milestone",
]);

export function isLevelReward(reward: Reward): boolean {
  return LEVEL_REWARD_REASONS.has(reward.reason);
}

/**
 * claimed — passed, and nothing waiting (a passed level with no reward row
 *           was claimed already: /users/@me lists only unclaimed ones);
 * ready   — passed, with a reward still to claim;
 * locked  — not reached yet;
 * passed  — reached, for a visitor, who doesn't see claim status.
 */
export type TrackNodeStatus = "claimed" | "ready" | "locked" | "passed";

export interface TrackNode {
  level: number;
  caps: number;
  plutonium: number;
  // The cosmetic flare reaching this level grants on this run, if any.
  flare: TrackFlare | null;
  milestone: boolean;
  current: boolean;
  status: TrackNodeStatus;
}

export interface TrackEnd {
  // A P10 run ends in Legend rather than another rank.
  legend: boolean;
  // The rank entered after level 100 (unused for Legend).
  rank: number;
  // The Caps that prestige grants; null when the config doesn't say, and
  // for Legend.
  caps: number | null;
  // The next rank's (or Legend's) exclusive cosmetic, if staff set one.
  flare: TrackFlare | null;
}

export interface TrackClaim {
  ids: string[];
  caps: bigint;
  plutonium: bigint;
}

export interface RewardTrackModel {
  run: number;
  level: number;
  owner: boolean;
  nodes: TrackNode[];
  end: TrackEnd;
  // The owner's unclaimed level rewards on this run; null for a visitor.
  claim: TrackClaim | null;
}

interface TrackProgress {
  prestige: number;
  level: number;
  legend: boolean;
}

/** True when the config says what levels pay (an older API doesn't). */
export function trackHasRewards(config: ProgressionConfig): boolean {
  return (
    config.levels.some(
      (l) => l.caps !== undefined || l.plutonium !== undefined,
    ) || config.flares.some((f) => f.kind === "level" && f.cosmetic)
  );
}

function amount(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * The run's level cosmetics by level: flares for this run, or for every run
 * (prestige null). A run-specific flare wins over an every-run one.
 */
export function levelFlares(
  config: ProgressionConfig,
  run: number,
): Map<number, TrackFlare> {
  const out = new Map<number, TrackFlare>();
  for (const f of config.flares) {
    if (f.kind !== "level" || f.level === null || !f.cosmetic) continue;
    if (f.prestige !== null && f.prestige !== run) continue;
    if (!out.has(f.level) || f.prestige === run) out.set(f.level, f);
  }
  return out;
}

/** What finishing this run gives: the next rank, or Legend after the last. */
export function trackEnd(config: ProgressionConfig, run: number): TrackEnd {
  const maxPrestige =
    config.maxPrestige > 0 ? config.maxPrestige : MAX_PRESTIGE;
  if (run >= maxPrestige) {
    return {
      legend: true,
      rank: run,
      caps: null,
      flare:
        config.flares.find((f) => f.kind === "legend" && f.cosmetic) ?? null,
    };
  }
  const rank = run + 1;
  return {
    legend: false,
    rank,
    caps: config.prestige?.caps ?? null,
    flare:
      config.flares.find(
        (f) => f.kind === "prestige" && f.prestige === rank && f.cosmetic,
      ) ?? null,
  };
}

/**
 * Everything the track draws. `rewards` is the owner's unclaimed rewards
 * from /users/@me, or null for a visitor. Only this run's level rewards
 * count: earlier runs' are claimed from the account's rewards list.
 */
export function rewardTrackModel(
  progress: TrackProgress,
  config: ProgressionConfig,
  rewards: readonly Reward[] | null,
): RewardTrackModel {
  const run = clampPrestige(progress.prestige);
  const current = Math.min(
    MAX_LEVEL,
    Math.max(
      1,
      Number.isFinite(progress.level) ? Math.floor(progress.level) : 1,
    ),
  );
  const owner = rewards !== null;
  const mine = (rewards ?? []).filter(
    (r) => isLevelReward(r) && r.prestige === run,
  );
  const waiting = new Set(
    mine.flatMap((r) => (r.level === undefined ? [] : [r.level])),
  );
  const amounts = new Map(config.levels.map((l) => [l.level, l]));
  const flares = levelFlares(config, run);
  const nodes: TrackNode[] = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const row = amounts.get(level);
    const passed = level <= current;
    let status: TrackNodeStatus;
    if (!passed) status = "locked";
    else if (!owner) status = "passed";
    else status = waiting.has(level) ? "ready" : "claimed";
    nodes.push({
      level,
      caps: Math.max(0, row?.caps ?? 0),
      plutonium: Math.max(0, row?.plutonium ?? 0),
      flare: flares.get(level) ?? null,
      milestone: isMilestoneLevel(level),
      current: level === current,
      status,
    });
  }
  const claim: TrackClaim | null = owner
    ? {
        ids: mine.map((r) => r.id),
        caps: mine
          .filter((r) => r.currencyType === "soft")
          .reduce((sum, r) => sum + amount(r.amount), 0n),
        plutonium: mine
          .filter((r) => r.currencyType === "hard")
          .reduce((sum, r) => sum + amount(r.amount), 0n),
      }
    : null;
  return {
    run,
    level: current,
    owner,
    nodes,
    end: trackEnd(config, run),
    claim,
  };
}

/** Where a level sits on the 1–100 strip, as a percentage. */
export function stripPercent(level: number): number {
  return ((level - 1) / (MAX_LEVEL - 1)) * 100;
}

// Past this level the "You" label would run into the end label: they merge.
export const STRIP_MERGE_AFTER = 85;

export interface ClaimAllDetail {
  ids: string[];
}

const CHECK = html`<svg
  viewBox="0 0 24 24"
  width="12"
  height="12"
  fill="none"
  stroke="#34d399"
  stroke-width="3.2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M5 12.5l4.5 4.5L19 7.5" />
</svg>`;

const LOCK = html`<svg
  viewBox="0 0 24 24"
  width="11"
  height="11"
  fill="none"
  stroke="rgba(255,255,255,.45)"
  stroke-width="2.4"
  stroke-linecap="round"
  aria-hidden="true"
>
  <rect x="5" y="11" width="14" height="10" rx="2" />
  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
</svg>`;

const arrow = (side: "prev" | "next") =>
  html`<svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d=${side === "prev" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </svg>`;

const SECTION =
  "rounded-xl border border-white/10 bg-white/5 px-5 py-[18px] mb-4 last:mb-0";
const SECTION_TITLE =
  "mb-3 text-xs font-bold uppercase tracking-[0.12em] text-white/45";

@customElement("reward-track")
export class RewardTrack extends LitElement {
  @property({ attribute: false }) progress: TrackProgress | null = null;
  @property({ attribute: false }) config: ProgressionConfig | null = null;
  // The owner's unclaimed rewards; null for a visitor.
  @property({ attribute: false }) rewards: Reward[] | null = null;
  @property({ type: Boolean }) claiming = false;

  // Replaceable for tests and previews.
  describeCosmetic: (flare: TrackFlare) => Promise<FlareCosmeticView | null> =
    describeFlareCosmetic;

  // The catalog's view of each flare's cosmetic, once it resolves.
  @state() private views = new Map<string, FlareCosmeticView>();
  // The levels the track shows right now (the strip's window).
  @state() private range: { lo: number; hi: number } = { lo: 1, hi: 15 };
  @state() private atStart = true;
  @state() private atEnd = false;

  private model: RewardTrackModel | null = null;
  private requested = new Set<string>();
  private scrolledToLevel = false;
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private dragging = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureRewardTrackStyles();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.onLayout());
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    if (
      changed.has("progress") ||
      changed.has("config") ||
      changed.has("rewards")
    ) {
      this.model =
        this.progress === null || this.config === null
          ? null
          : rewardTrackModel(this.progress, this.config, this.rewards);
      if (changed.has("progress")) this.scrolledToLevel = false;
      this.resolveCosmetics();
    }
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    const scroller = this.scroller();
    if (scroller !== null && this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
      this.resizeObserver.observe(scroller);
    }
    this.onLayout();
  }

  private scroller(): HTMLElement | null {
    return this.querySelector<HTMLElement>("[data-track-scroller]");
  }

  // Looks up each cosmetic in the catalog once; until then (or without a
  // catalog) the flare's own name shows.
  private resolveCosmetics(): void {
    const model = this.model;
    if (model === null) return;
    const flares = model.nodes.flatMap((n) => (n.flare ? [n.flare] : []));
    if (model.end.flare) flares.push(model.end.flare);
    for (const flare of flares) {
      if (this.requested.has(flare.flareName)) continue;
      this.requested.add(flare.flareName);
      void this.describeCosmetic(flare)
        .then((view) => {
          if (view === null) return;
          this.views = new Map(this.views).set(flare.flareName, view);
        })
        .catch(() => {});
    }
  }

  private view(flare: TrackFlare): FlareCosmeticView | null {
    return this.views.get(flare.flareName) ?? plainFlareCosmetic(flare);
  }

  // ------------------------------------------------------------------ layout

  private nodeWidth(scroller: HTMLElement): { w: number; pad: number } {
    const first = scroller.querySelector<HTMLElement>("[data-level]");
    // Not laid out yet (jsdom, a hidden page): the CSS width.
    const measured = first?.offsetWidth ?? 0;
    const w = measured > 0 ? measured : 40;
    return { w, pad: first?.offsetLeft ?? 0 };
  }

  // After a render or a resize: the first time the track has a size, bring
  // the player's level into view (a little left of centre, so more of what's
  // ahead shows), then sync the strip and the callouts to the scroll.
  private onLayout(): void {
    const scroller = this.scroller();
    const model = this.model;
    if (scroller === null || model === null || scroller.clientWidth === 0) {
      return;
    }
    if (!this.scrolledToLevel) {
      this.scrolledToLevel = true;
      const { w, pad } = this.nodeWidth(scroller);
      scroller.scrollLeft = Math.max(
        0,
        pad + (model.level - 1) * w + w / 2 - scroller.clientWidth * 0.3,
      );
    }
    this.syncToScroll();
  }

  private onScroll = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.syncToScroll();
    });
  };

  private syncToScroll(): void {
    const scroller = this.scroller();
    if (scroller === null || scroller.clientWidth === 0) return;
    const { w, pad } = this.nodeWidth(scroller);
    const left = scroller.scrollLeft;
    const width = scroller.clientWidth;
    const lo = Math.min(
      MAX_LEVEL,
      Math.max(1, Math.ceil((left - pad) / w - 0.25) + 1),
    );
    const hi = Math.min(
      MAX_LEVEL,
      Math.max(lo, Math.floor((left + width - pad) / w + 0.25)),
    );
    if (lo !== this.range.lo || hi !== this.range.hi) this.range = { lo, hi };
    const atStart = left <= 1;
    const atEnd = left + width >= scroller.scrollWidth - 1;
    if (atStart !== this.atStart) this.atStart = atStart;
    if (atEnd !== this.atEnd) this.atEnd = atEnd;
    this.placeCallouts(scroller, w);
  }

  // A callout is centred over its node, unless that would run it off the
  // track's visible edge: then it opens toward the middle, keeping its stem
  // under it.
  private placeCallouts(scroller: HTMLElement, w: number): void {
    const width = scroller.clientWidth;
    const edge = 6;
    for (const callout of scroller.querySelectorAll<HTMLElement>(
      "[data-callout]",
    )) {
      const node = callout.closest<HTMLElement>("[data-level]");
      if (node === null) continue;
      const cx = node.offsetLeft + w / 2 - scroller.scrollLeft;
      const cw = callout.offsetWidth;
      let left = cx - cw / 2;
      left = Math.min(left, width - cw - edge);
      left = Math.max(left, edge);
      left = Math.min(Math.max(left, cx - cw + 14), cx - 14);
      const shift = Math.round(left - (cx - cw / 2));
      callout.style.setProperty("--shift", `${shift}px`);
    }
  }

  private behavior(): ScrollBehavior {
    return prefersReducedMotion() ? "auto" : "smooth";
  }

  private scrollTrackTo(left: number, smooth: boolean): void {
    const scroller = this.scroller();
    if (scroller === null) return;
    const target = Math.max(0, left);
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({
        left: target,
        behavior: smooth ? this.behavior() : "auto",
      });
    } else {
      scroller.scrollLeft = target;
    }
  }

  private page(direction: -1 | 1): void {
    const scroller = this.scroller();
    if (scroller === null) return;
    const { w } = this.nodeWidth(scroller);
    const step = Math.max(w, scroller.clientWidth - 2 * w);
    this.scrollTrackTo(scroller.scrollLeft + direction * step, true);
  }

  /** Centres the track on `level`. */
  jumpTo(level: number, smooth = true): void {
    const scroller = this.scroller();
    if (scroller === null) return;
    const { w, pad } = this.nodeWidth(scroller);
    const clamped = Math.min(MAX_LEVEL, Math.max(1, Math.round(level)));
    this.scrollTrackTo(
      pad + (clamped - 1) * w + w / 2 - scroller.clientWidth / 2,
      smooth,
    );
  }

  private levelAt(event: PointerEvent): number {
    const rail = this.querySelector<HTMLElement>("[data-strip-rail]");
    if (rail === null) return 1;
    const box = rail.getBoundingClientRect();
    if (box.width === 0) return 1;
    const fraction = Math.min(
      1,
      Math.max(0, (event.clientX - box.left) / box.width),
    );
    return 1 + Math.round(fraction * (MAX_LEVEL - 1));
  }

  private onStripDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.jumpTo(this.levelAt(event), true);
  };

  private onStripMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.jumpTo(this.levelAt(event), false);
  };

  private onStripUp = (): void => {
    this.dragging = false;
  };

  private onStripKey = (event: KeyboardEvent): void => {
    const middle = Math.round((this.range.lo + this.range.hi) / 2);
    const span = Math.max(1, this.range.hi - this.range.lo);
    let target: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      target = middle - 5;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      target = middle + 5;
    } else if (event.key === "PageUp") target = middle - span;
    else if (event.key === "PageDown") target = middle + span;
    else if (event.key === "Home") target = 1;
    else if (event.key === "End") target = MAX_LEVEL;
    if (target === null) return;
    event.preventDefault();
    this.jumpTo(target, true);
  };

  private claimAll(): void {
    const claim = this.model?.claim;
    if (!claim || claim.ids.length === 0 || this.claiming) return;
    this.dispatchEvent(
      new CustomEvent<ClaimAllDetail>("claim-all", {
        detail: { ids: [...claim.ids] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ------------------------------------------------------------------ render

  render() {
    const model = this.model;
    if (model === null) return nothing;
    const claim = model.claim;
    return html`
      <section class=${SECTION} data-reward-track>
        <h3 class=${SECTION_TITLE}>
          ${model.run === 0
            ? translateText("reward_track.title_first_run")
            : translateText("reward_track.title", { prestige: model.run })}
        </h3>
        ${claim !== null && claim.ids.length > 0
          ? this.renderClaimBar(claim)
          : nothing}
        ${this.renderStrip(model)} ${this.renderTrack(model)}
        ${model.owner ? this.renderKey() : nothing}
      </section>
    `;
  }

  private renderClaimBar(claim: TrackClaim): TemplateResult {
    const showPlutonium = claim.plutonium > 0n;
    return html`<div class="rt-claim" data-track-claim data-pp>
      <div class="flex shrink-0 items-center gap-0.5">
        <cap-icon .size=${26}></cap-icon>
        ${showPlutonium
          ? html`<plutonium-icon .size=${22}></plutonium-icon>`
          : nothing}
      </div>
      <div class="min-w-0 flex-[1_1_180px]">
        <div class="text-sm font-bold text-white" data-claim-count>
          ${translateText("reward_track.claim_count", {
            count: claim.ids.length,
          })}
        </div>
        <div class="mt-px text-xs font-extrabold">
          <span class="text-amber-700" data-claim-caps
            >${translateText("reward_track.claim_caps", {
              amount: claim.caps.toLocaleString(),
            })}</span
          >${showPlutonium
            ? html`<span class="text-white/35"> · </span
                ><span class="text-green-400" data-claim-plutonium
                  >${translateText("reward_track.claim_plutonium", {
                    amount: claim.plutonium.toLocaleString(),
                  })}</span
                >`
            : nothing}
        </div>
      </div>
      <o-button
        data-claim-all
        variant="primary"
        size="sm"
        translationKey="account_modal.claim_all"
        .disable=${this.claiming}
        @click=${() => this.claimAll()}
      ></o-button>
    </div>`;
  }

  private renderStrip(model: RewardTrackModel): TemplateResult {
    const end = model.end;
    const endText = end.legend
      ? translateText("reward_track.strip_end_legend")
      : translateText("reward_track.strip_end_prestige", { rank: end.rank });
    const youText = model.owner
      ? translateText("reward_track.strip_you", { level: model.level })
      : translateText("reward_track.strip_level", { level: model.level });
    const merged = model.level > STRIP_MERGE_AFTER;
    const pct = (level: number) => `${stripPercent(level)}%`;
    const { lo, hi } = this.range;
    return html`<div
      class="rt-strip"
      data-track-strip
      data-pp
      role="slider"
      tabindex="0"
      aria-label=${translateText("reward_track.strip_label")}
      aria-valuemin="1"
      aria-valuemax=${MAX_LEVEL}
      aria-valuenow=${Math.round((lo + hi) / 2)}
      aria-valuetext=${translateText("reward_track.strip_value", { lo, hi })}
      @pointerdown=${this.onStripDown}
      @pointermove=${this.onStripMove}
      @pointerup=${this.onStripUp}
      @pointercancel=${this.onStripUp}
      @keydown=${this.onStripKey}
    >
      <div class="rt-labels" aria-hidden="true">
        ${model.level >= 10
          ? html`<span class="rt-label-start" data-strip-start
              >${translateText("reward_track.strip_start")}</span
            >`
          : nothing}
        ${merged
          ? nothing
          : html`<span
              class="rt-label-you"
              data-strip-you
              style="left:${pct(model.level)}"
              >${youText}</span
            >`}
        <span class="rt-label-end" data-strip-end ?data-legend=${end.legend}
          >${merged
            ? html`<span class="rt-label-you-merged">${youText}</span
                ><span class="text-white/35"> · </span>`
            : nothing}<span class="rt-label-end-text">${endText}</span></span
        >
      </div>
      <div class="rt-rail" data-strip-rail>
        <div class="rt-rail-fill" style="width:${pct(model.level)}"></div>
        ${[10, 20, 30, 40, 50, 60, 70, 80, 90].map(
          (t) =>
            html`<div
              class="rt-tick"
              data-strip-tick=${t}
              style="left:${pct(t)}"
            ></div>`,
        )}
        ${model.nodes.map((n) =>
          n.flare !== null
            ? html`<div
                class="rt-mark-cosmetic"
                data-strip-cosmetic=${n.level}
                style="left:${pct(n.level)}"
              ></div>`
            : n.plutonium > 0
              ? html`<div
                  class="rt-mark-plutonium"
                  data-strip-plutonium=${n.level}
                  style="left:${pct(n.level)}"
                ></div>`
              : nothing,
        )}
        <div
          class="rt-window"
          data-strip-window
          style="left:calc(${pct(lo)} - 4px);width:calc(${stripPercent(hi) -
          stripPercent(lo)}% + 8px)"
        ></div>
        <div
          class="rt-knob"
          data-strip-knob
          style="left:${pct(model.level)}"
        ></div>
      </div>
    </div>`;
  }

  private renderTrack(model: RewardTrackModel): TemplateResult {
    return html`<div class="rt-track" data-track-row data-pp>
      <button
        type="button"
        class="rt-arrow"
        data-track-prev
        aria-label=${translateText("reward_track.earlier")}
        ?disabled=${this.atStart}
        @click=${() => this.page(-1)}
      >
        ${arrow("prev")}
      </button>
      <div class="rt-scroller" data-track-scroller @scroll=${this.onScroll}>
        <div
          class="rt-row"
          role="list"
          aria-label=${translateText("reward_track.levels_label")}
        >
          <div class="rt-line" aria-hidden="true"></div>
          <div
            aria-hidden="true"
            class="rt-line-fill"
            style="width:calc(${model.level - 1} * var(--rt-w))"
          ></div>
          ${model.nodes.map((n) => this.renderNode(n, model))}
          ${this.renderEnd(model)}
        </div>
      </div>
      <button
        type="button"
        class="rt-arrow"
        data-track-next
        aria-label=${translateText("reward_track.later")}
        ?disabled=${this.atEnd}
        @click=${() => this.page(1)}
      >
        ${arrow("next")}
      </button>
    </div>`;
  }

  private renderNode(node: TrackNode, model: RewardTrackModel): TemplateResult {
    const legendBadge = this.progress?.legend === true && node.level === 100;
    let dot: TemplateResult;
    if (node.current) {
      dot = html`<div class="rt-you-ring">
        <level-badge
          .level=${node.level}
          .prestige=${model.run}
          .legend=${legendBadge}
          .size=${40}
        ></level-badge>
      </div>`;
    } else if (node.milestone) {
      dot = html`<level-badge
        class=${node.status === "locked" ? "rt-badge-locked" : ""}
        .level=${node.level}
        .prestige=${model.run}
        .legend=${legendBadge}
        .size=${34}
      ></level-badge>`;
    } else {
      dot = html`<div
        class="rt-dot"
        ?data-passed=${node.status !== "locked"}
        ?data-pu=${node.plutonium > 0}
      >
        ${node.level}
      </div>`;
    }
    return html`<div
      class="rt-node"
      data-level=${node.level}
      data-status=${node.status}
      ?data-current=${node.current}
      aria-label=${this.nodeLabel(node)}
      role="listitem"
    >
      <div class="rt-top">${this.renderAbove(node)}</div>
      <div class="rt-dotwrap">${dot}</div>
      <div class="rt-under">
        <div class="rt-caps" data-node-caps>
          ${node.caps > 0
            ? html`<cap-icon .size=${12}></cap-icon
                >${node.caps.toLocaleString()}`
            : html`<span class="text-white/35">—</span>`}
        </div>
        ${model.owner
          ? html`<div class="rt-status">${this.renderStatus(node, model)}</div>`
          : nothing}
      </div>
    </div>`;
  }

  private nodeLabel(node: TrackNode): string {
    const parts = [translateText("progression.level", { level: node.level })];
    if (node.caps > 0) {
      parts.push(
        translateText("reward_track.claim_caps", {
          amount: node.caps.toLocaleString(),
        }),
      );
    }
    if (node.plutonium > 0) {
      parts.push(
        translateText("reward_track.claim_plutonium", {
          amount: node.plutonium.toLocaleString(),
        }),
      );
    }
    if (node.flare !== null) {
      const view = this.view(node.flare);
      if (view !== null) parts.push(view.name);
    }
    if (node.status === "claimed") {
      parts.push(translateText("reward_track.key_claimed"));
    } else if (node.status === "ready") {
      parts.push(translateText("reward_track.key_ready"));
    } else if (node.status === "locked") {
      parts.push(translateText("reward_track.key_locked"));
    }
    return parts.join(", ");
  }

  private renderAbove(node: TrackNode): TemplateResult | typeof nothing {
    if (node.flare !== null) {
      const view = this.view(node.flare);
      if (view === null) return nothing;
      return html`<div class="rt-callout" data-callout=${node.level}>
          <div class="rt-preview">${view.preview}</div>
          <div class="min-w-0">
            <div class="rt-cname" data-callout-name>${view.name}</div>
            ${view.typeLabel === ""
              ? nothing
              : html`<div class="rt-ctype" data-callout-type>
                  ${view.typeLabel}
                </div>`}
          </div>
          ${node.plutonium > 0
            ? html`<div class="rt-callout-pu" data-callout-plutonium>
                <plutonium-icon .size=${14}></plutonium-icon>${translateText(
                  "reward_track.plus",
                  { amount: node.plutonium },
                )}
              </div>`
            : nothing}
        </div>
        <div class="rt-stem rt-stem-cosmetic"></div>`;
    }
    if (node.plutonium > 0) {
      return html`<div class="rt-chip" data-plutonium-chip=${node.level}>
          <plutonium-icon .size=${16}></plutonium-icon>${translateText(
            "reward_track.plus",
            { amount: node.plutonium },
          )}
        </div>
        <div class="rt-stem rt-stem-plutonium"></div>`;
    }
    return nothing;
  }

  private renderStatus(
    node: TrackNode,
    model: RewardTrackModel,
  ): TemplateResult | typeof nothing {
    if (!model.owner) return nothing;
    if (node.current) {
      return html`<span class="rt-you-label" data-you
        >${translateText("reward_track.you")}</span
      >`;
    }
    switch (node.status) {
      case "claimed":
        return html`<span data-claimed>${CHECK}</span>`;
      case "ready":
        return html`<span class="rt-ready" data-ready></span>`;
      case "locked":
        return html`<span data-locked>${LOCK}</span>`;
      default:
        return nothing;
    }
  }

  private renderEnd(model: RewardTrackModel): TemplateResult {
    const end = model.end;
    const view = end.flare === null ? null : this.view(end.flare);
    return html`<div class="rt-end-col" role="listitem">
      <div class="rt-end" data-track-end ?data-legend=${end.legend}>
        <div class="rt-end-head">
          ${end.legend
            ? html`<level-badge
                .level=${100}
                .prestige=${model.run}
                .legend=${true}
                .size=${44}
              ></level-badge>`
            : html`<level-badge
                .level=${1}
                .prestige=${end.rank}
                .size=${44}
              ></level-badge>`}
          <div class="leading-tight whitespace-nowrap">
            <div class="rt-kicker">
              ${translateText("reward_track.after_level_100")}
            </div>
            <div class="rt-end-title" data-end-title>
              ${end.legend
                ? translateText("progression.legend")
                : translateText("progression.prestige", {
                    prestige: end.rank,
                  })}
            </div>
            ${end.legend
              ? html`<div class="rt-end-sub" data-end-sub>
                  ${translateText("reward_track.legend_sub")}
                </div>`
              : end.caps !== null
                ? html`<div class="rt-end-caps" data-end-caps>
                    <cap-icon .size=${14}></cap-icon>${translateText(
                      "reward_track.caps_amount",
                      { amount: end.caps.toLocaleString() },
                    )}
                  </div>`
                : nothing}
          </div>
        </div>
        ${view === null
          ? nothing
          : html`<div class="rt-tag" data-end-tag>
              <div class="rt-preview">${view.preview}</div>
              <div class="min-w-0">
                <div class="rt-cname" data-end-tag-name>${view.name}</div>
                ${view.typeLabel === ""
                  ? nothing
                  : html`<div class="rt-ctype">${view.typeLabel}</div>`}
                <div class="rt-tag-for" data-end-tag-for>
                  ${end.legend
                    ? translateText("reward_track.legend_reward")
                    : translateText("reward_track.prestige_reward", {
                        rank: end.rank,
                      })}
                </div>
              </div>
            </div>`}
      </div>
    </div>`;
  }

  private renderKey(): TemplateResult {
    return html`<div class="rt-key" data-track-legend data-pp>
      <span class="rt-key-item"
        >${CHECK}${translateText("reward_track.key_claimed")}</span
      ><span class="rt-key-item"
        ><span class="rt-ready rt-ready-small"></span>${translateText(
          "reward_track.key_ready",
        )}</span
      ><span class="rt-key-item"
        >${LOCK}${translateText("reward_track.key_locked")}</span
      >
    </div>`;
  }
}

const STYLE_ID = "reward-track-styles";

function ensureRewardTrackStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = REWARD_TRACK_CSS;
  document.head.appendChild(style);
}

const REWARD_TRACK_CSS = /* css */ `
reward-track { display: block; --rt-w: 40px; }
reward-track .rt-claim {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 8px 12px; margin-bottom: 10px; border-radius: 10px;
  border: 1px solid rgba(250, 204, 21, 0.35);
  background: linear-gradient(90deg, rgba(250, 204, 21, 0.14), rgba(250, 204, 21, 0.04));
}

/* The run strip: levels 1-100 at a glance. */
reward-track .rt-strip {
  position: relative; margin: 0 4px 8px; padding: 21px 0 6px;
  touch-action: none; cursor: pointer; user-select: none; outline: none;
}
reward-track .rt-strip:focus-visible .rt-rail {
  box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.9);
}
reward-track .rt-labels {
  position: absolute; left: 0; right: 0; top: 0; height: 12px; line-height: 12px;
  font-size: 10px; font-weight: 800; color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
}
reward-track .rt-labels > span { position: absolute; top: 0; }
reward-track .rt-label-start { left: 0; }
reward-track .rt-label-you { transform: translateX(-50%); color: #facc15; }
reward-track .rt-label-end { right: 0; color: #facc15; }
reward-track .rt-label-you-merged { color: #facc15; }
reward-track .rt-label-end[data-legend] .rt-label-end-text { color: #f0abfc; }
reward-track .rt-rail {
  position: relative; height: 8px; border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
}
reward-track .rt-rail-fill {
  position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px;
  background: linear-gradient(90deg, #a16207, #facc15);
}
reward-track .rt-tick {
  position: absolute; top: -2px; width: 1px; height: 12px;
  background: rgba(255, 255, 255, 0.2);
}
reward-track .rt-mark-plutonium {
  position: absolute; top: 50%; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px;
  border-radius: 9px; background: #4ade80; box-shadow: 0 0 5px #22c55e;
}
reward-track .rt-mark-cosmetic {
  position: absolute; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px;
  transform: rotate(45deg); background: #c084fc; border: 1px solid #f5d0fe;
  box-shadow: 0 0 6px #a855f7;
}
reward-track .rt-window {
  position: absolute; top: -6px; bottom: -6px; border-radius: 6px;
  border: 2px solid rgba(125, 211, 252, 0.95); background: rgba(125, 211, 252, 0.12);
  pointer-events: none;
}
reward-track .rt-knob {
  position: absolute; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px;
  border-radius: 99px; background: #facc15; border: 2px solid #fff;
  box-shadow: 0 0 8px rgba(250, 204, 21, 0.9); pointer-events: none;
}

/* The track: [<] nodes [>], the arrows in their own gutters. */
reward-track .rt-track {
  display: flex; align-items: flex-start; gap: 6px; margin: 0 -4px;
}
reward-track .rt-arrow {
  flex: 0 0 auto; margin-top: 44px; width: 30px; height: 52px; border-radius: 10px;
  display: grid; place-items: center; color: #fff; cursor: pointer;
  background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  transition: opacity 0.15s, background-color 0.15s;
}
reward-track .rt-arrow:hover:not(:disabled) { background: rgba(255, 255, 255, 0.18); }
reward-track .rt-arrow:disabled { opacity: 0.3; cursor: default; }
reward-track .rt-scroller {
  position: relative; flex: 1 1 auto; min-width: 0;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
  -webkit-mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent);
  mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent);
}
reward-track .rt-scroller::-webkit-scrollbar { display: none; }
reward-track .rt-row {
  position: relative; display: flex; align-items: flex-start; width: max-content;
  padding: 0 6px 8px;
}
reward-track .rt-line, reward-track .rt-line-fill {
  position: absolute; top: 68px; height: 4px; border-radius: 2px;
  left: calc(6px + var(--rt-w) / 2);
}
reward-track .rt-line { width: calc(99 * var(--rt-w)); background: rgba(255, 255, 255, 0.12); }
reward-track .rt-line-fill {
  background: linear-gradient(90deg, #facc15, #fbbf24);
  box-shadow: 0 0 8px rgba(250, 204, 21, 0.6);
}
reward-track .rt-node {
  position: relative; width: var(--rt-w); flex: 0 0 var(--rt-w);
  display: flex; flex-direction: column; align-items: center;
}
reward-track .rt-top { position: relative; height: 50px; width: 100%; }
reward-track .rt-stem {
  position: absolute; bottom: 0; left: 50%; width: 2px; height: 7px; margin-left: -1px;
}
reward-track .rt-stem-plutonium { background: rgba(74, 222, 128, 0.85); }
reward-track .rt-stem-cosmetic { background: rgba(192, 132, 252, 0.9); }
reward-track .rt-chip {
  position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 2px; padding: 2px 7px 2px 3px;
  border-radius: 999px; border: 1px solid rgba(74, 222, 128, 0.65);
  background: rgba(20, 83, 45, 0.9); color: #4ade80;
  font-weight: 900; font-size: 11px; white-space: nowrap;
}
reward-track .rt-callout, reward-track .rt-tag {
  display: flex; align-items: center; gap: 6px; padding: 3px 9px 3px 3px;
  border-radius: 9px; border: 1px solid rgba(192, 132, 252, 0.8);
  background: linear-gradient(90deg, rgba(90, 20, 160, 0.92), rgba(40, 15, 70, 0.95));
  box-shadow: 0 0 12px rgba(168, 85, 247, 0.45); white-space: nowrap;
}
reward-track .rt-callout {
  position: absolute; bottom: 6px; left: 50%; z-index: 3;
  transform: translateX(calc(-50% + var(--shift, 0px)));
}
reward-track .rt-preview {
  width: 34px; height: 34px; flex: 0 0 34px; padding: 1px; border-radius: 6px;
  overflow: hidden; display: grid; place-items: center;
  background: rgba(0, 0, 0, 0.25); --tier: #c084fc;
}
reward-track .rt-preview svg { max-width: 100%; max-height: 100%; }
reward-track .rt-cname { color: #fff; font-weight: 900; font-size: 11px; line-height: 1.15; }
reward-track .rt-ctype {
  color: #d8b4fe; font-size: 9px; font-weight: 800; line-height: 1.15;
  letter-spacing: 0.06em; text-transform: uppercase;
}
reward-track .rt-tag-for {
  color: #facc15; font-size: 9px; font-weight: 800; line-height: 1.15; letter-spacing: 0.04em;
}
reward-track .rt-callout-pu {
  display: flex; align-items: center; gap: 2px; padding-left: 6px; margin-left: 2px;
  border-left: 1px solid rgba(255, 255, 255, 0.18);
  color: #4ade80; font-weight: 900; font-size: 11px;
}
reward-track .rt-dotwrap {
  height: 40px; display: grid; place-items: center; position: relative; z-index: 1;
}
reward-track .rt-dot {
  width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center;
  font-weight: 800; font-size: 12px; background: #1f2330; color: rgba(255, 255, 255, 0.7);
  border: 2px solid rgba(255, 255, 255, 0.22);
}
reward-track .rt-dot[data-passed] { background: #facc15; color: #1a1300; border-color: #fde68a; }
reward-track .rt-dot[data-pu] { box-shadow: 0 0 0 2px #4ade80, 0 0 9px rgba(74, 222, 128, 0.65); }
reward-track .rt-you-ring {
  display: grid; border-radius: 999px;
  box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.95), 0 0 16px rgba(250, 204, 21, 0.75);
}
reward-track .rt-badge-locked { opacity: 0.6; }
reward-track .rt-under {
  margin-top: 3px; display: flex; flex-direction: column; align-items: center; gap: 1px;
}
reward-track .rt-node[data-status="locked"] .rt-under { opacity: 0.65; }
reward-track .rt-caps {
  display: flex; align-items: center; gap: 2px; height: 14px; white-space: nowrap;
  color: #fff; font-weight: 800; font-size: 11px;
}
reward-track .rt-status { height: 13px; display: flex; align-items: center; }
reward-track .rt-you-label {
  color: #facc15; font-weight: 900; font-size: 10px; letter-spacing: 0.08em;
  text-transform: uppercase;
}
reward-track .rt-ready {
  display: inline-block; width: 8px; height: 8px; border-radius: 9px;
  background: #facc15; box-shadow: 0 0 6px #facc15;
}
reward-track .rt-ready-small { width: 7px; height: 7px; box-shadow: none; }

/* The end of the run, centred on the node line. */
reward-track .rt-end-col {
  flex: 0 0 auto; height: 0; margin-top: 70px; padding: 0 6px 0 16px;
}
reward-track .rt-end {
  transform: translateY(-50%); display: flex; flex-direction: column; gap: 7px;
  padding: 8px 12px 8px 8px; border-radius: 12px;
  border: 1px solid rgba(250, 204, 21, 0.6);
  background: linear-gradient(160deg, rgba(250, 204, 21, 0.2), rgba(255, 255, 255, 0.03));
}
reward-track .rt-end[data-legend] {
  border-color: rgba(232, 121, 249, 0.6);
  background: linear-gradient(160deg, rgba(217, 70, 239, 0.2), rgba(255, 255, 255, 0.03));
}
reward-track .rt-end-head { display: flex; align-items: center; gap: 10px; }
reward-track .rt-kicker {
  color: #facc15; font-weight: 800; font-size: 9px; letter-spacing: 0.14em;
  text-transform: uppercase;
}
reward-track .rt-end[data-legend] .rt-kicker { color: #f0abfc; }
reward-track .rt-end-title { color: #fff; font-weight: 900; font-size: 14px; }
reward-track .rt-end-sub { margin-top: 1px; color: rgba(255, 255, 255, 0.6); font-size: 11px; }
reward-track .rt-end-caps {
  display: flex; align-items: center; gap: 3px; margin-top: 2px;
  color: #fff; font-weight: 900; font-size: 12px;
}
reward-track .rt-tag { align-self: stretch; }

reward-track .rt-key {
  margin-top: 6px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
  color: rgba(255, 255, 255, 0.45); font-size: 11px;
}
reward-track .rt-key-item { display: inline-flex; align-items: center; gap: 5px; }

@media (max-width: 520px) {
  reward-track .rt-track { gap: 3px; margin: 0 -10px; }
  reward-track .rt-arrow { width: 24px; height: 44px; margin-top: 48px; }
}
`;

declare global {
  interface HTMLElementTagNameMap {
    "reward-track": RewardTrack;
  }
}
