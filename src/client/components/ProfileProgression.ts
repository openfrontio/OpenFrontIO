import type {
  ProgressionConfig,
  PublicProgress,
  Reward,
  TrackFlare,
} from "@openfront/shared/ApiSchemas";
import { html, LitElement, nothing, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { claimReward, getUserMe, invalidateUserMe } from "../Api";
import { showInGameAlert } from "../InGameModal";
import { clampPrestige, MAX_LEVEL, MILESTONE_LEVELS } from "../Progression";
import { fetchProgressionConfig } from "../ProgressionApi";
import { translateText } from "../Utils";
import { prefersReducedMotion } from "../utilities/ReducedMotion";
import { describeFlareCosmetic, type FlareCosmeticView } from "./FlareCosmetic";
import "./LevelBadge";
import type { RewardsChangedDetail } from "./RewardsPanel";

// The profile's Progression tab: the reward track of the current prestige
// run, when each prestige rank was entered, and the milestone levels reached
// in each prestige run. The history and milestones come from the public
// progress response, so they're the same for the player and their visitors;
// the track adds claim status (and a Claim all) for the player themselves.

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

// The pop-in: every item in one sequence, in document order, a step apart;
// items past the cap share its delay.
export const POP_STEP_MS = 55;
export const POP_CAP = 12;
const POP_MS = 380;

// How long the tab waits for the track (the config, and whether this is the
// viewer's own profile) before showing the rest without it.
const TRACK_WAIT_MS = 2500;

type RewardTrackModule = typeof import("./RewardTrack");

// The reward track is most of this tab's code and only ever shows here, so
// it stays out of the startup bundle: fetched the first time the tab opens,
// alongside the data the tab already waits for. A failed fetch is tried
// again the next time.
let rewardTrackModule: Promise<RewardTrackModule> | null = null;
function loadRewardTrack(): Promise<RewardTrackModule> {
  rewardTrackModule ??= import("./RewardTrack").catch((err: unknown) => {
    rewardTrackModule = null;
    throw err;
  });
  return rewardTrackModule;
}

// The tab openings that already popped in, by popKey.
const poppedKeys = new Set<string>();

interface TrackData {
  config: ProgressionConfig;
  // The owner's unclaimed rewards; null when the viewer isn't the player.
  rewards: Reward[] | null;
  model: RewardTrackModule["rewardTrackModel"];
}

@customElement("profile-progression")
export class ProfileProgression extends LitElement {
  @property({ attribute: false }) progress: PublicProgress | null = null;
  // Whose profile this is: the track shows claim status to them alone.
  @property({ attribute: false }) publicId: string | null = null;
  // Names one opening of the profile: the tab pops in once per key, however
  // often it's shown again (a tab switch builds a new element). Without a
  // key it pops in once per element.
  @property({ attribute: false }) popKey: string | undefined = undefined;

  // Replaceable for tests and previews.
  loadConfig: () => Promise<ProgressionConfig | false> = fetchProgressionConfig;
  loadUserMe: typeof getUserMe = getUserMe;
  claim: typeof claimReward = claimReward;
  alert: (message: string) => Promise<unknown> = showInGameAlert;
  describeCosmetic: (flare: TrackFlare) => Promise<FlareCosmeticView | null> =
    describeFlareCosmetic;
  loadTrackModule: () => Promise<RewardTrackModule> = loadRewardTrack;

  @state() private ready = false;
  @state() private track: TrackData | null = null;
  @state() private claiming = false;
  private loadedFor: string | null | undefined = undefined;
  private loadToken = 0;
  private popDecided = false;
  private popping = false;
  private popTimer: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureProfileProgressionStyles();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.popTimer !== null) clearTimeout(this.popTimer);
    this.popTimer = null;
    this.endPop();
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    if (this.progress !== null && this.publicId !== this.loadedFor) {
      this.loadedFor = this.publicId;
      void this.loadTrack(this.publicId);
    }
  }

  // The track needs its own code, the reward config, and whether the viewer
  // is this player (their unclaimed rewards then give each level's status).
  // The tab holds for it, so everything pops in together in order; past
  // TRACK_WAIT_MS the rest shows without it, and the track joins on arrival.
  private async loadTrack(publicId: string | null): Promise<void> {
    const token = ++this.loadToken;
    this.ready = false;
    this.track = null;
    const timer = setTimeout(() => {
      if (token === this.loadToken) this.ready = true;
    }, TRACK_WAIT_MS);
    const [config, me, trackModule] = await Promise.all([
      this.loadConfig().catch(() => false as const),
      this.loadOwnAccount(publicId),
      this.loadTrackModule().catch((err: unknown) => {
        console.warn("ProfileProgression: reward track failed to load", err);
        return null;
      }),
    ]);
    clearTimeout(timer);
    if (token !== this.loadToken) return;
    const rewards =
      me !== false && me.player.publicId === publicId
        ? (me.player.rewards ?? [])
        : null;
    this.track =
      trackModule !== null &&
      config !== false &&
      trackModule.trackHasRewards(config)
        ? { config, rewards, model: trackModule.rewardTrackModel }
        : null;
    this.ready = true;
  }

  // /users/@me when the viewer is this player, else false or another
  // player's account. The page's copy is cached from load and misses the
  // games played since, and a passed level with no reward row reads as
  // claimed, so on the player's own profile it is read afresh.
  private async loadOwnAccount(
    publicId: string | null,
  ): Promise<Awaited<ReturnType<typeof getUserMe>>> {
    if (publicId === null) return false;
    const cached = await this.loadUserMe().catch(() => false as const);
    if (cached === false || cached.player.publicId !== publicId) return cached;
    invalidateUserMe();
    return this.loadUserMe().catch(() => false as const);
  }

  // Claims this run's level rewards one by one — never another kind of
  // reward (a subscription daily, a win's Caps) — then tells the page, like
  // RewardsPanel does.
  private async claimAll(): Promise<void> {
    const track = this.track;
    const progress = this.progress;
    if (this.claiming || track === null || progress === null) return;
    const owned = track.rewards;
    if (owned === null) return;
    const ids = track.model(progress, track.config, owned).claim?.ids ?? [];
    if (ids.length === 0) return;
    this.claiming = true;
    try {
      let currency: RewardsChangedDetail["currency"] = null;
      const claimed = new Set<string>();
      let failed = false;
      let resync = false;
      for (const id of ids) {
        const result = await this.claim(id);
        if (result === false) {
          failed = true;
          break;
        }
        claimed.add(id);
        // Claimed already (another tab or device): credited once all the
        // same, so the account is re-read below.
        if (result === "not_found") resync = true;
        else currency = result.currency;
      }
      if (claimed.size > 0) {
        invalidateUserMe();
        let rewards = owned.filter((r) => !claimed.has(r.id));
        if (resync) {
          const me = await this.loadUserMe().catch(() => false as const);
          if (me !== false) {
            rewards = me.player.rewards ?? [];
            currency = me.player.currency ?? currency;
          }
        }
        if (this.track === track) this.track = { ...track, rewards };
        this.dispatchEvent(
          new CustomEvent<RewardsChangedDetail>("rewards-changed", {
            detail: { currency, rewards },
            bubbles: true,
            composed: true,
          }),
        );
      }
      if (failed) {
        await this.alert(translateText("account_modal.claim_failed"));
      }
    } finally {
      this.claiming = false;
    }
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (!this.ready || this.progress === null) return;
    if (!this.popDecided) {
      this.popDecided = true;
      this.startPop();
    }
    if (this.popping) void this.orderPop();
  }

  // Decided on the first render with content, so nothing shows at rest and
  // then jumps into its entrance.
  private startPop(): void {
    const key = this.popKey;
    if (key !== undefined) {
      if (poppedKeys.has(key)) return;
      poppedKeys.add(key);
    }
    if (prefersReducedMotion()) return;
    this.popping = true;
    this.classList.add("pp-anim");
    // Once every item has popped the sequence is dropped: the items are at
    // rest either way, and a later change (the claim bar going away) can't
    // re-time them.
    this.popTimer = setTimeout(
      () => {
        this.popTimer = null;
        this.endPop();
      },
      POP_CAP * POP_STEP_MS + POP_MS + 200,
    );
  }

  private endPop(): void {
    this.popping = false;
    this.classList.remove("pp-anim");
  }

  // Numbers every item in document order — the track's (a child element, so
  // after its own render), the history's, the milestones' — and starts the
  // next milestone's breathing ring after its own pop.
  private async orderPop(): Promise<void> {
    const track = this.querySelector<LitElement>("reward-track");
    if (track !== null) await track.updateComplete;
    if (!this.popping) return;
    const items = [...this.querySelectorAll<HTMLElement>("[data-pp]")];
    items.forEach((el, n) =>
      el.style.setProperty("--i", String(Math.min(n, POP_CAP))),
    );
    const next = this.querySelector<HTMLElement>("[data-next-milestone]");
    const at = next === null ? 0 : Math.min(items.indexOf(next), POP_CAP);
    this.style.setProperty(
      "--ring-delay",
      `${Math.max(0, at) * POP_STEP_MS + POP_MS}ms`,
    );
  }

  render() {
    const progress = this.progress;
    if (progress === null || !this.ready) return nothing;
    const track = this.track;
    return html`
      ${track === null
        ? nothing
        : html`<reward-track
            .progress=${progress}
            .config=${track.config}
            .rewards=${track.rewards}
            .claiming=${this.claiming}
            .describeCosmetic=${this.describeCosmetic}
            @claim-all=${() => void this.claimAll()}
          ></reward-track>`}
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
          ? html`<p class="text-sm text-white/50" data-no-prestige data-pp>
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
        data-pp
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
    const next = run.current ? run.slots.find((s) => !s.reached) : undefined;
    return html`
      <div
        class="mb-4 last:mb-0"
        data-milestone-run=${run.prestige}
        ?data-current-run=${run.current}
      >
        <h4 class="mb-2.5 mt-1 text-sm font-bold text-white" data-pp>
          ${this.runLabel(run, legend)}
        </h4>
        <div class="flex flex-wrap gap-2.5">
          ${run.slots.map((slot) =>
            this.renderSlot(
              run.prestige,
              slot,
              run.current && legend && slot.level === MAX_LEVEL,
              slot === next,
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
    // The current run's next milestone: less faded, with a breathing ring.
    next: boolean,
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
        ?data-next-milestone=${next}
        data-pp
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

const STYLE_ID = "profile-progression-styles";

function ensureProfileProgressionStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PROFILE_PROGRESSION_CSS;
  document.head.appendChild(style);
}

// One keyframe for every item, filling both ways: hidden through its own
// delay, at rest after. Nothing here is !important, so the pop always owns
// opacity while it runs.
const PROFILE_PROGRESSION_CSS = /* css */ `
profile-progression.pp-anim [data-pp] {
  animation: pp-pop ${POP_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
  animation-delay: calc(var(--i, 0) * ${POP_STEP_MS}ms);
}
@keyframes pp-pop {
  from { opacity: 0; transform: translateY(8px) scale(0.8); }
}
profile-progression [data-next-milestone] { opacity: 0.6; }
profile-progression [data-next-milestone] level-badge {
  border-radius: 9999px;
  outline: 2px dashed rgba(250, 204, 21, 0.6);
  outline-offset: 3px;
  animation: pp-breathe 2.4s ease-in-out var(--ring-delay, 0ms) infinite;
}
@keyframes pp-breathe {
  0%, 100% { outline-color: rgba(250, 204, 21, 0.25); }
  50% { outline-color: rgba(250, 204, 21, 0.85); }
}
@media (prefers-reduced-motion: reduce) {
  profile-progression.pp-anim [data-pp],
  profile-progression [data-next-milestone] level-badge { animation: none; }
}
`;
