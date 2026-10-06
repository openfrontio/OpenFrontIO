import type {
  PrestigeResponse,
  Progress,
  ProgressionConfig,
  TrackFlare,
} from "@openfront/shared/ApiSchemas";
import {
  html,
  LitElement,
  render as litRender,
  nothing,
  PropertyValues,
  TemplateResult,
} from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  clampPrestige,
  MAX_PRESTIGE,
  PrestigeTier,
  prestigeTier,
} from "../Progression";
import { fetchProgressionConfig, prestigeMe } from "../ProgressionApi";
import { translateText } from "../Utils";
import "./CapIcon";
import {
  ensureCeremonyStyles,
  prefersReducedMotion,
  renderHoneycomb,
} from "./Ceremony";
import { describeFlareCosmetic, FlareCosmeticView } from "./FlareCosmetic";
import "./LevelBadge";
import { formatXp } from "./XpBar";

// Prestiging, start to finish: the confirmation (the player's badge as it is
// now, the rank it leads to on the prestige track, what that rank unlocks,
// and that it can't be undone), then a full-screen ceremony: the old badge
// shatters into a flash, the new rank's emblem forms out of it, and the new
// rank slams in. Tapping skips the ceremony to its end.
//
// Holding the confirm button charges the player's badge (it grows, brightens
// and glows with the hold, and trembles near the end). A full hold hands
// straight over to the ceremony with that same badge: the confirmation fades
// away, the badge moves to the middle and keeps charging, its tremble growing
// into a shake, and the ceremony takes over at the flash, once the server has
// answered and the charge has run. The old badge goes under the flash, and
// the new emblem is revealed out of it.
//
// Emits `prestiged` (detail: PrestigeResponse) as soon as the server agrees,
// so the page behind can update while the ceremony plays.

type Stage = "closed" | "confirm" | "submitting" | "ceremony";

// The ceremony's beats, in ms from its start. A ceremony that follows the
// confirmation starts at the shatter: the charge already happened there.
const BEATS = {
  shatter: 1900,
  reveal: 2100,
  title: 2700,
  done: 3500,
} as const;
type Beat = keyof typeof BEATS | "charge";
const BEAT_ORDER: Beat[] = ["charge", "shatter", "reveal", "title", "done"];

// How long the confirm button must be held down to prestige.
export const HOLD_MS = 1500;
// From a full hold to the ceremony's flash, while the emblem keeps charging
// (longer if the server takes longer to answer).
export const HANDOFF_MS = 2200;
// The same, under reduced motion: a quick crossfade.
export const HANDOFF_FADE_MS = 180;
// Past this much of the hold, the emblem trembles.
const HOT_AT = 0.75;
// Where the ceremony's emblem sits: the middle across, this far above the
// middle (its 260px stage over a 224px block for the title and Continue).
const CEREMONY_EMBLEM_LIFT = 112;
// The emblem's move to there.
const HANDOFF_MOVE_MS = 650;

const TIER_COLORS: Record<PrestigeTier, string> = {
  none: "#facc15",
  ring: "#f59e0b",
  double: "#e2e8f0",
  sunburst: "#facc15",
  radiant: "#d946ef",
};

/** The Caps every prestige grants, when the config says. */
export function prestigeCaps(config: ProgressionConfig | null): number | null {
  const caps = config?.prestige?.caps;
  return typeof caps === "number" && caps > 0 ? caps : null;
}

/** The flare staff attached to entering prestige `rank`, if any. */
export function prestigeFlare(
  config: ProgressionConfig | null,
  rank: number,
): TrackFlare | null {
  return (
    config?.flares.find((f) => f.kind === "prestige" && f.prestige === rank) ??
    null
  );
}

// The shake the hold's tremble grows into over the handoff, sharper towards
// the flash. Individual translate/rotate properties, so it never fights the
// move to the middle (which animates transform).
const HANDOFF_SHAKE = (() => {
  const steps = 44;
  const frames: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const a = 1.5 + 7.5 * p * p;
    const sx = [1, -1, 0.6, -0.8][i % 4];
    const sy = [-0.6, 0.8, 1, -1][i % 4];
    frames.push(
      `${(p * 100).toFixed(2)}% { translate: ${(sx * a).toFixed(2)}px ${(sy * a * 0.7).toFixed(2)}px; rotate: ${(sx * (0.2 + 2.6 * p * p)).toFixed(2)}deg; }`,
    );
  }
  return `@keyframes prestige-handoff-shake { ${frames.join(" ")} }`;
})();

// The key for a prestige from each rank, kept until that prestige succeeds.
// Closing and reopening the confirmation must not mint a new one: if an
// earlier request went through but its answer was lost, the same key gets
// that prestige back, where a new key would be refused.
const pendingKeys = new Map<number, string>();

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

@customElement("prestige-flow")
export class PrestigeFlow extends LitElement {
  @state() private stage: Stage = "closed";
  // Progress before prestiging.
  @state() private prior: Progress | null = null;
  @state() private outcome: PrestigeResponse | null = null;
  // Why the last attempt didn't go through, shown on the confirmation.
  @state() private error: "failed" | "signed_out" | null = null;
  @state() private beat: Beat = "charge";
  // True when the ceremony follows the confirmation, whose backdrop it takes
  // over as is.
  @state() private fromConfirm = false;
  // The confirm button's hold, and when it started (null when up). The fill
  // and the emblem's charge (--hold) are written straight to their elements
  // each frame (setFill), so a hold re-renders the overlay only when it starts
  // and ends.
  @state() private holding = false;
  private holdStart: number | null = null;
  private holdFrame = 0;
  // A full hold handing over to the ceremony: "charge" moves and charges the
  // emblem, "fade" (reduced motion) just crossfades. Null otherwise.
  @state() private handoff: "charge" | "fade" | null = null;
  private handoffMove: Animation | null = null;
  // What the new rank grants, from the progression config: the Caps, and a
  // rank-exclusive cosmetic when staff put one on the track.
  @state() private config: ProgressionConfig | null = null;
  @state() private exclusive: FlareCosmeticView | null = null;
  private openToken = 0;

  // Replaceable for tests and previews.
  submit: (idempotencyKey: string) => ReturnType<typeof prestigeMe> =
    prestigeMe;
  fetchConfig: () => Promise<ProgressionConfig | false> =
    fetchProgressionConfig;
  describeCosmetic: (flare: TrackFlare) => Promise<FlareCosmeticView | null> =
    describeFlareCosmetic;

  private portal: HTMLDivElement | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private idempotencyKey = "";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    ensureCeremonyStyles();
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
    // Capture, so the overlay sees keys before the page behind it does.
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("blur", this.onFocusLost);
    document.addEventListener("visibilitychange", this.onFocusLost);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("blur", this.onFocusLost);
    document.removeEventListener("visibilitychange", this.onFocusLost);
    this.clearTimers();
    this.endHold();
    this.stopHandoffMove();
    if (this.portal) {
      litRender(html``, this.portal);
      this.portal.remove();
      this.portal = null;
    }
  }

  /** Opens the confirmation for a player who can prestige. */
  open(progress: Progress): void {
    // Already up (a second press on the card behind it): leave it alone, and
    // never swap the key of a request that's in flight.
    if (this.stage !== "closed" || !progress.canPrestige) return;
    this.prior = progress;
    this.outcome = null;
    this.error = null;
    this.holding = false;
    this.handoff = null;
    this.fromConfirm = false;
    this.config = null;
    this.exclusive = null;
    let key = pendingKeys.get(progress.prestige);
    if (key === undefined) {
      key = newIdempotencyKey();
      pendingKeys.set(progress.prestige, key);
    }
    this.idempotencyKey = key;
    this.stage = "confirm";
    void this.loadRewards(this.nextRank(progress), ++this.openToken);
    void this.updateComplete.then(() => this.focusConfirmButton());
  }

  // The real Caps amount and the rank's exclusive cosmetic, when the config
  // has them; the tiles fall back to what they said before otherwise.
  private async loadRewards(rank: number, token: number): Promise<void> {
    let config: ProgressionConfig | false;
    try {
      config = await this.fetchConfig();
    } catch {
      config = false;
    }
    if (token !== this.openToken || !this.isOpen) return;
    if (!config) return;
    this.config = config;
    const flare = prestigeFlare(config, rank);
    if (flare === null) return;
    let view: FlareCosmeticView | null;
    try {
      view = await this.describeCosmetic(flare);
    } catch {
      view = null;
    }
    if (token !== this.openToken || !this.isOpen) return;
    this.exclusive = view;
  }

  protected updated(changed: PropertyValues): void {
    // Keep keyboard focus inside the overlay: on its root while the request
    // is out (both buttons are disabled) and through the ceremony, then on
    // Continue once the ceremony is done.
    if (
      changed.has("stage") &&
      (this.stage === "submitting" || this.stage === "ceremony")
    ) {
      this.overlayRoot()?.focus();
    }
    if (
      (changed.has("beat") || changed.has("stage")) &&
      this.stage === "ceremony" &&
      this.beat === "done"
    ) {
      this.portal
        ?.querySelector<HTMLButtonElement>("[data-prestige-continue]")
        ?.focus();
    }
  }

  private overlayRoot(): HTMLElement | null {
    return (
      this.portal?.querySelector<HTMLElement>(
        "[data-prestige-confirm], [data-prestige-ceremony]",
      ) ?? null
    );
  }

  private focusConfirmButton(): void {
    this.portal
      ?.querySelector<HTMLButtonElement>("[data-prestige-confirm-button]")
      ?.focus();
  }

  // Keys while the overlay is up: Escape cancels the confirmation (or skips,
  // then closes, the ceremony), and Tab stays inside the overlay in every
  // stage. The page behind never sees them.
  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.stage === "closed") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (this.stage === "confirm") this.close();
      else if (this.stage === "ceremony") {
        if (this.beat === "done") this.close();
        else this.skipCeremony();
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const root = this.overlayRoot();
      const buttons = [
        ...(root?.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])",
        ) ?? []),
      ];
      // Nothing to move between (the request is out, or the ceremony is
      // still playing): keep focus on the overlay itself.
      if (buttons.length === 0) {
        root?.focus();
        return;
      }
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        at === -1
          ? 0
          : (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
  };

  // A hold only counts while the button keeps it: switching window or tab
  // lets go, wherever the key or pointer is released.
  private onFocusLost = (): void => {
    if (document.visibilityState === "hidden" || !document.hasFocus()) {
      this.endHold();
    }
  };

  /**
   * Plays the ceremony for a prestige that already happened, without the
   * confirmation. For previews and tests; the account page goes through
   * open(). Ignored while the flow is up.
   */
  celebrate(before: Progress, result: PrestigeResponse): void {
    if (this.stage !== "closed") return;
    this.prior = before;
    this.outcome = result;
    this.fromConfirm = false;
    this.handoff = null;
    this.startCeremony("charge");
  }

  get isOpen(): boolean {
    return this.stage !== "closed";
  }

  private close(): void {
    this.clearTimers();
    this.endHold();
    this.stopHandoffMove();
    this.handoff = null;
    this.stage = "closed";
  }

  render() {
    if (this.portal) litRender(this.renderOverlay(), this.portal);
    return nothing;
  }

  // One overlay for the whole flow: the backdrop and the honeycomb stay put
  // (never restarting) while the confirmation hands over to the ceremony on
  // top of them.
  private renderOverlay(): TemplateResult | typeof nothing {
    const before = this.prior;
    if (before === null || this.stage === "closed") return nothing;
    const ceremony = this.stage === "ceremony";
    const rank = ceremony
      ? (this.outcome?.progress.prestige ?? this.nextRank(before))
      : this.nextRank(before);
    // The charge layer: the honeycomb pulsing in toward the emblem, over the
    // idle one, while it charges (the handoff, or the ceremony's charge). It
    // fades out at the shatter.
    const charging =
      this.handoff === "charge" || (ceremony && this.beat !== "done");
    const chargeFading = ceremony && this.beat !== "charge";
    return html`<div
      data-prestige-overlay
      class="prestige-ceremony fixed inset-0 z-[10020] text-white"
      style="--tier: ${TIER_COLORS[prestigeTier(rank)]}"
    >
      ${this.renderStyles()}
      <div aria-hidden="true" class="ceremony-backdrop absolute inset-0"></div>
      ${renderHoneycomb(this.honeycombMode(), {
        className: "prestige-honeycomb",
      })}
      ${charging
        ? renderHoneycomb("hx-charge", {
            className: `prestige-honeycomb prestige-charge-comb ${chargeFading ? "is-off" : ""}`,
          })
        : nothing}
      <div aria-hidden="true" class="ceremony-vignette absolute inset-0"></div>
      ${ceremony ? this.renderCeremony(before) : this.renderConfirm(before)}
    </div>`;
  }

  private honeycombMode(): string {
    if (this.stage !== "ceremony") return "hx-idle";
    if (this.beat === "done") return "hx-idle";
    // While the emblem charges, only the charge layer shows.
    if (this.beat === "charge") return "";
    return "hx-burst";
  }

  // ---------------------------------------------------------------------------
  // Confirmation
  // ---------------------------------------------------------------------------

  private nextRank(before: Progress): number {
    return Math.min(MAX_PRESTIGE, clampPrestige(before.prestige) + 1);
  }

  private renderConfirm(before: Progress): TemplateResult {
    const rank = this.nextRank(before);
    const submitting = this.stage === "submitting";
    const holding = this.holding && !submitting;
    return html`<div
      data-prestige-confirm
      data-handoff=${this.handoff ?? nothing}
      ?data-holding=${holding}
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prestige-confirm-title"
      class="absolute inset-0 flex flex-col items-center overflow-y-auto px-4 py-8"
    >
      <div
        class="prestige-fade prestige-body relative my-auto flex w-full max-w-2xl flex-col items-center text-center"
      >
        <h2
          id="prestige-confirm-title"
          class="prestige-title m-0 text-4xl font-black uppercase italic tracking-wide sm:text-6xl"
        >
          ${translateText("prestige.title", { rank })}
        </h2>

        <!-- The player's badge as it is now: the one the hold charges, and
             the one that shatters at the flash. -->
        <div
          class="prestige-float relative mt-10"
          style="--hero: ${TIER_COLORS[
            prestigeTier(clampPrestige(before.prestige))
          ]}"
        >
          <div
            aria-hidden="true"
            class="absolute -inset-10 rounded-full"
            style="background: radial-gradient(circle, color-mix(in srgb, var(--hero) 40%, transparent) 0%, transparent 70%)"
          ></div>
          <level-badge
            class="prestige-emblem relative"
            data-prestige-current-badge
            .level=${before.level}
            .prestige=${before.prestige}
            .legend=${before.legend}
            .size=${170}
          ></level-badge>
        </div>

        ${this.renderTrack(clampPrestige(before.prestige), rank)}
        ${this.renderUnlocks(rank)}

        <p class="m-0 mt-6 max-w-md text-sm text-white/75">
          ${translateText("prestige.summary")}
        </p>
        ${this.error === null
          ? nothing
          : html`<p
              data-prestige-error
              class="m-0 mt-2 text-sm font-bold text-rose-400"
            >
              ${this.error === "signed_out"
                ? translateText("prestige.error_signed_out")
                : translateText("prestige.error")}
            </p>`}

        <div class="mt-6 flex w-full max-w-md gap-3">
          <button
            type="button"
            class="prestige-cut flex-1 border-0 bg-white/10 px-4 py-3 text-sm font-bold uppercase tracking-wider text-white/75 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-50"
            ?disabled=${submitting}
            @click=${() => this.close()}
          >
            ${translateText("common.cancel")}
          </button>
          <button
            type="button"
            data-prestige-confirm-button
            ?data-holding=${holding}
            class="prestige-cut prestige-hold relative flex-[2] select-none border-0 bg-gradient-to-b from-yellow-300 to-amber-500 px-4 py-3 text-sm font-black uppercase tracking-wider text-zinc-900 disabled:cursor-wait disabled:opacity-80"
            ?disabled=${submitting}
            @pointerdown=${(e: PointerEvent) => {
              if (e.button === 0) this.startHold();
            }}
            @pointerup=${() => this.endHold()}
            @pointerleave=${() => this.endHold()}
            @pointercancel=${() => this.endHold()}
            @blur=${() => this.endHold()}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key !== " " && e.key !== "Enter") return;
              e.preventDefault();
              if (!e.repeat) this.startHold();
            }}
            @keyup=${(e: KeyboardEvent) => {
              if (e.key === " " || e.key === "Enter") this.endHold();
            }}
            @contextmenu=${(e: Event) => e.preventDefault()}
          >
            <span
              aria-hidden="true"
              class="prestige-hold-fill"
              ?data-holding=${holding}
            ></span>
            <span class="relative">
              ${submitting
                ? translateText("prestige.submitting")
                : holding
                  ? translateText("prestige.keep_holding")
                  : translateText("prestige.confirm")}
            </span>
          </button>
        </div>
        <p
          class="m-0 mt-3 text-xs font-bold uppercase tracking-wider text-amber-300/90"
        >
          ${translateText("prestige.irreversible")}
        </p>
      </div>
    </div>`;
  }

  // Every rank in a row, Legend at the end: the ones already earned lit, the
  // one about to be entered raised, the rest dimmed.
  private renderTrack(current: number, next: number): TemplateResult {
    const ranks = Array.from({ length: MAX_PRESTIGE }, (_, i) => i + 1);
    const state = (rank: number) =>
      rank === next ? "next" : rank <= current ? "earned" : "locked";
    return html`<ol
      data-prestige-track
      class="m-0 mt-6 flex list-none flex-wrap items-end justify-center gap-1 p-0"
    >
      ${ranks.map(
        (rank) =>
          html`<li
            data-rank=${rank}
            data-state=${state(rank)}
            class="prestige-track-${state(rank)} flex flex-col items-center"
          >
            <level-badge
              .level=${1}
              .prestige=${rank}
              .size=${rank === next ? 42 : 26}
            ></level-badge>
          </li>`,
      )}
      <li data-rank="legend" data-state="locked" class="prestige-track-locked">
        <level-badge .level=${100} .legend=${true} .size=${26}></level-badge>
      </li>
    </ol>`;
  }

  // What the new rank unlocks, as tiles: its emblem, the Caps every prestige
  // grants, and the rank's exclusive cosmetic when there is one.
  private renderUnlocks(rank: number): TemplateResult {
    const caps = prestigeCaps(this.config);
    const tiles: {
      key: string;
      icon: TemplateResult;
      label: TemplateResult | string;
    }[] = [
      {
        key: "emblem",
        icon: html`<level-badge
          .level=${1}
          .prestige=${rank}
          .size=${48}
        ></level-badge>`,
        label: translateText("prestige.gain_emblem", { rank }),
      },
      {
        key: "caps",
        icon: html`<cap-icon .size=${48}></cap-icon>`,
        label:
          caps === null
            ? translateText("prestige.gain_caps")
            : html`<span
                  data-prestige-caps-amount
                  class="block text-lg font-black tracking-normal text-white"
                  >${formatXp(caps)}</span
                ><span class="mt-0.5 block"
                  >${translateText("prestige.caps")}</span
                >`,
      },
    ];
    const exclusive = this.exclusive;
    if (exclusive !== null) {
      tiles.push({
        key: "cosmetic",
        icon: html`<div
          data-prestige-cosmetic-preview
          class="grid h-12 w-12 place-items-center overflow-hidden rounded-md bg-white/5 p-0.5"
        >
          ${exclusive.preview}
        </div>`,
        label: html`<span
            data-prestige-cosmetic-name
            class="block text-[13px] font-black normal-case tracking-normal text-white"
            >${exclusive.name}</span
          ><span class="mt-0.5 block"
            >${exclusive.typeLabel === ""
              ? translateText("prestige.exclusive_untyped", { rank })
              : translateText("prestige.exclusive", {
                  type: exclusive.typeLabel,
                  rank,
                })}</span
          >`,
      });
    }
    return html`<div class="mt-6 w-full">
      <div
        class="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50"
      >
        ${translateText("prestige.unlocks")}
      </div>
      <div class="mt-2 flex flex-wrap justify-center gap-2 sm:gap-3">
        ${tiles.map(
          (tile) =>
            html`<div data-prestige-unlock=${tile.key} class="prestige-tile">
              <div
                class="prestige-tile-inner flex h-full flex-col items-center justify-center gap-2 px-3 py-3"
              >
                <div class="grid h-12 place-items-center">${tile.icon}</div>
                <div
                  class="text-xs font-bold uppercase leading-tight text-white/85"
                >
                  ${tile.label}
                </div>
              </div>
            </div>`,
        )}
      </div>
    </div>`;
  }

  // Holding the confirm button fills it and charges the emblem; letting go
  // early empties both again. A full hold prestiges.
  private startHold(): void {
    if (this.stage !== "confirm" || this.holdStart !== null) return;
    this.holdStart = performance.now();
    this.holding = true;
    const tick = () => {
      if (this.holdStart === null) return;
      const progress = Math.min(
        1,
        (performance.now() - this.holdStart) / HOLD_MS,
      );
      this.setFill(progress);
      if (progress >= 1) {
        this.holdStart = null;
        void this.confirm();
        return;
      }
      this.holdFrame = requestAnimationFrame(tick);
    };
    this.holdFrame = requestAnimationFrame(tick);
  }

  private endHold(): void {
    if (this.holdStart === null) return;
    this.holdStart = null;
    cancelAnimationFrame(this.holdFrame);
    this.holding = false;
    this.setFill(0);
  }

  // How far through the hold, 0..1: the button's fill, and the emblem's
  // charge (--hold on the confirmation, which its styles read), trembling
  // past HOT_AT.
  private setFill(progress: number): void {
    const fill = this.portal?.querySelector<HTMLElement>(
      "[data-prestige-confirm-button] .prestige-hold-fill",
    );
    if (fill) fill.style.transform = `scaleX(${progress})`;
    const root = this.portal?.querySelector<HTMLElement>(
      "[data-prestige-confirm]",
    );
    if (root) {
      root.style.setProperty("--hold", String(progress));
      root.toggleAttribute("data-hot", progress > HOT_AT);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push(setTimeout(resolve, ms));
    });
  }

  private async confirm(): Promise<void> {
    // The stage check stops a second hold from sending twice.
    if (this.stage !== "confirm") return;
    this.error = null;
    this.stage = "submitting";
    this.setFill(1);
    const prior = this.prior;
    const completed = performance.now();
    // The request goes out at once; the handoff plays while it's out.
    const request = this.submit(this.idempotencyKey);
    const reduced = prefersReducedMotion();
    this.handoff = reduced ? "fade" : "charge";
    await this.updateComplete;
    if (!reduced) this.startHandoffMove();
    const response = await request;
    // Closed (or taken off the page) while the request was out.
    if (this.stage !== "submitting") return;
    if (!response.ok) {
      this.reverseHandoff();
      if (response.reason === "refused") {
        // The server won't prestige from here: the page is out of date. Drop
        // the key and let the page reload where the player really is.
        if (prior) pendingKeys.delete(prior.prestige);
        this.close();
        this.dispatchEvent(
          new CustomEvent("prestige-stale", { bubbles: true, composed: true }),
        );
        return;
      }
      // It may or may not have gone through: the same key finds out.
      this.stage = "confirm";
      this.holding = false;
      this.setFill(0);
      this.error = response.reason;
      void this.updateComplete.then(() => this.focusConfirmButton());
      return;
    }
    if (prior) pendingKeys.delete(prior.prestige);
    this.outcome = response.data;
    this.dispatchEvent(
      new CustomEvent<PrestigeResponse>("prestiged", {
        detail: response.data,
        bubbles: true,
        composed: true,
      }),
    );
    // The flash lands when the charge has run, or when the answer arrived if
    // that took longer.
    const left =
      (reduced ? HANDOFF_FADE_MS : HANDOFF_MS) -
      (performance.now() - completed);
    if (left > 0) await this.wait(left);
    if (this.stage !== "submitting") return;
    this.stopHandoffMove();
    this.handoff = null;
    this.fromConfirm = true;
    this.startCeremony(reduced ? "done" : "shatter");
  }

  // The emblem, from wherever it is (bob and tremble included), to where the
  // ceremony's sits; its tremble becomes the handoff's growing shake.
  private startHandoffMove(): void {
    const float = this.portal?.querySelector<HTMLElement>(
      "[data-prestige-confirm] .prestige-float",
    );
    if (!float || typeof float.animate !== "function") return;
    const current = getComputedStyle(float).transform;
    const from = new DOMMatrixReadOnly(
      current === "none" || current === "" ? undefined : current,
    );
    const r = float.getBoundingClientRect();
    const cx = r.left + r.width / 2 - from.e;
    const cy = r.top + r.height / 2 - from.f;
    const tx = window.innerWidth / 2 - cx;
    const ty = window.innerHeight / 2 - CEREMONY_EMBLEM_LIFT - cy;
    float.style.animation = `prestige-handoff-shake ${HANDOFF_MS}ms linear forwards`;
    this.handoffMove = float.animate(
      [
        { transform: from.toString() },
        { transform: `translate(${tx}px, ${ty}px) scale(1.25)` },
      ],
      {
        duration: HANDOFF_MOVE_MS,
        easing: "cubic-bezier(.45,0,.2,1)",
        fill: "forwards",
      },
    );
  }

  // The request failed: the emblem goes back where it was and settles into
  // its hover again, and the confirmation comes back.
  private reverseHandoff(): void {
    const move = this.handoffMove;
    this.handoffMove = null;
    this.handoff = null;
    const float = this.portal?.querySelector<HTMLElement>(
      "[data-prestige-confirm] .prestige-float",
    );
    if (float) float.style.animation = "";
    if (move === null) return;
    move.onfinish = () => move.cancel();
    move.reverse();
  }

  private stopHandoffMove(): void {
    this.handoffMove?.cancel();
    this.handoffMove = null;
  }

  // ---------------------------------------------------------------------------
  // Ceremony
  // ---------------------------------------------------------------------------

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  // Plays the ceremony from `from` (the charge, the shatter when the
  // confirmation's handoff already charged the emblem, or straight to the
  // end under reduced motion).
  private startCeremony(from: Beat): void {
    this.clearTimers();
    this.stage = "ceremony";
    if (prefersReducedMotion() || from === "done") {
      this.beat = "done";
      return;
    }
    this.beat = from;
    const offset = from === "charge" ? 0 : BEATS[from];
    for (const [beat, at] of Object.entries(BEATS) as [Beat, number][]) {
      if (at <= offset) continue;
      this.timers.push(setTimeout(() => (this.beat = beat), at - offset));
    }
  }

  private reached(beat: Beat): boolean {
    return BEAT_ORDER.indexOf(this.beat) >= BEAT_ORDER.indexOf(beat);
  }

  private skipCeremony(): void {
    if (this.beat === "done") return;
    this.clearTimers();
    this.beat = "done";
  }

  private renderCeremony(before: Progress): TemplateResult {
    const after = this.outcome?.progress;
    const rank = after?.prestige ?? this.nextRank(before);
    const shattered = this.reached("shatter");
    const revealed = this.reached("reveal");
    const done = this.beat === "done";
    // Per-element angles, so the particles and shards spread evenly.
    const particles = Array.from({ length: 18 }, (_, i) => (i * 360) / 18);
    const shards = Array.from({ length: 14 }, (_, i) => (i * 360) / 14 + 7);
    return html`<div
      data-prestige-ceremony
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label=${translateText("prestige.ceremony_title", { rank })}
      data-beat=${this.beat}
      ?data-from-confirm=${this.fromConfirm}
      class="absolute inset-0 flex flex-col items-center justify-center overflow-hidden"
      @click=${() => this.skipCeremony()}
    >
      <div class="relative grid h-[260px] w-[260px] place-items-center">
        ${!shattered
          ? html`<div aria-hidden="true" class="absolute inset-0">
                ${particles.map(
                  (deg, i) =>
                    html`<span
                      class="prestige-particle"
                      style="--a: ${deg}deg; animation-delay: ${(i % 6) *
                      0.18}s"
                    ></span>`,
                )}
              </div>
              <div class="prestige-charge relative">
                <level-badge
                  .level=${100}
                  .prestige=${before.prestige}
                  .size=${200}
                ></level-badge>
              </div>`
          : nothing}
        ${shattered && !done
          ? html`<div aria-hidden="true" class="absolute inset-0">
              <span class="ceremony-shockwave"></span>
              ${shards.map(
                (deg) =>
                  html`<span
                    class="prestige-shard"
                    style="--a: ${deg}deg"
                  ></span>`,
              )}
            </div>`
          : nothing}
        ${revealed
          ? html`<div
              class="relative ${done ? "" : "prestige-reveal"}"
              data-prestige-new-badge
            >
              <level-badge
                .level=${after?.level ?? 1}
                .prestige=${rank}
                .size=${220}
              ></level-badge>
            </div>`
          : nothing}
      </div>

      <div class="relative mt-6 flex min-h-[200px] flex-col items-center">
        ${this.reached("title")
          ? html`<div
              data-prestige-title
              class="${done
                ? ""
                : "ceremony-slam"} prestige-title text-5xl font-black uppercase italic tracking-wide sm:text-7xl"
            >
              ${translateText("prestige.ceremony_title", { rank })}
            </div>`
          : nothing}
        ${done
          ? html`<button
              type="button"
              data-prestige-continue
              class="prestige-fade prestige-cut mt-6 border-0 bg-gradient-to-b from-yellow-300 to-amber-500 px-10 py-3 text-base font-black uppercase tracking-wider text-zinc-900 transition-transform hover:-translate-y-0.5"
              @click=${(e: Event) => {
                e.stopPropagation();
                this.close();
              }}
            >
              ${translateText("prestige.continue")}
            </button>`
          : nothing}
      </div>
      ${shattered && !this.reached("title")
        ? html`<div aria-hidden="true" class="ceremony-flash"></div>`
        : nothing}
    </div>`;
  }

  private renderStyles(): TemplateResult {
    return html`<style>
      .prestige-honeycomb {
        --hx-color: #00c8ff;
      }
      /* The charge layer fades in over the idle honeycomb, and out again at
         the shatter. */
      .prestige-charge-comb {
        animation: ceremony-fade-in 500ms ease-out both;
        transition: opacity 400ms ease-out;
      }
      .prestige-charge-comb.is-off {
        opacity: 0;
      }
      /* The level-100 badge gathering power: a growing glow and a shake
         that builds to the shatter. */
      .prestige-charge {
        animation:
          prestige-shake 1900ms ease-in both,
          prestige-glow 1900ms ease-in both;
      }
      @keyframes prestige-shake {
        0%,
        30% {
          transform: none;
        }
        40% {
          transform: translate(-1px, 1px) rotate(-1deg);
        }
        50% {
          transform: translate(2px, -1px) rotate(1deg);
        }
        60% {
          transform: translate(-3px, 2px) rotate(-2deg) scale(1.03);
        }
        70% {
          transform: translate(4px, -2px) rotate(2deg) scale(1.05);
        }
        80% {
          transform: translate(-5px, 3px) rotate(-3deg) scale(1.08);
        }
        90% {
          transform: translate(6px, -3px) rotate(3deg) scale(1.12);
        }
        100% {
          transform: scale(1.18);
        }
      }
      @keyframes prestige-glow {
        from {
          filter: drop-shadow(0 0 0 transparent) brightness(1);
        }
        to {
          filter: drop-shadow(0 0 40px var(--tier)) brightness(1.8);
        }
      }
      /* Light drawn in toward the badge while it charges. */
      .prestige-particle {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 8px;
        height: 8px;
        margin: -4px 0 0 -4px;
        border-radius: 9999px;
        background: var(--tier);
        box-shadow: 0 0 10px var(--tier);
        opacity: 0;
        animation: prestige-converge 1100ms ease-in infinite;
      }
      @keyframes prestige-converge {
        0% {
          opacity: 0;
          transform: rotate(var(--a)) translateX(260px) scale(1.4);
        }
        25% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: rotate(var(--a)) translateX(30px) scale(0.4);
        }
      }
      /* The old badge in pieces, flung outward. */
      .prestige-shard {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 26px;
        height: 34px;
        margin: -17px 0 0 -13px;
        background: linear-gradient(135deg, white, var(--tier));
        clip-path: polygon(50% 0, 100% 100%, 0 80%);
        animation: prestige-shard 900ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
      }
      @keyframes prestige-shard {
        from {
          opacity: 1;
          transform: rotate(var(--a)) translateX(10px) rotate(0deg);
        }
        to {
          opacity: 0;
          transform: rotate(var(--a)) translateX(360px) rotate(540deg);
        }
      }
      /* The new emblem forming out of the flash. */
      .prestige-reveal {
        animation: prestige-reveal 900ms cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
      }
      @keyframes prestige-reveal {
        0% {
          opacity: 0;
          transform: scale(0.2) rotate(-25deg);
          filter: brightness(3) drop-shadow(0 0 40px var(--tier));
        }
        60% {
          opacity: 1;
          transform: scale(1.18) rotate(4deg);
        }
        100% {
          transform: none;
          filter: drop-shadow(0 0 24px var(--tier));
        }
      }
      [data-prestige-new-badge] {
        filter: drop-shadow(0 0 24px var(--tier));
      }
      /* The titles ("Enter Prestige 5", and the ceremony's "Prestige 5") are
         white for every rank: the rank's colour is the emblem's, the glow's
         and the honeycomb's, never the words'. Nothing here reads --tier. */
      .prestige-title {
        color: #ffffff;
        filter: drop-shadow(0 0 18px rgba(255, 255, 255, 0.35));
      }
      .prestige-fade {
        animation: prestige-rise 500ms ease-out both;
      }
      @keyframes prestige-rise {
        from {
          opacity: 0;
          transform: translateY(12px);
        }
      }
      /* The confirmation's emblem, hovering. */
      .prestige-float {
        animation: prestige-float 3.2s ease-in-out infinite;
      }
      @keyframes prestige-float {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-8px);
        }
      }
      /* The hold charges the emblem: it grows, brightens and glows with
         --hold (written by setFill), easing back when let go early. */
      [data-prestige-confirm] {
        transition: --hold 250ms ease-out;
      }
      [data-prestige-confirm][data-holding] {
        transition: none;
      }
      .prestige-emblem {
        /* A block: an inline custom element would ignore the transform. */
        display: block;
        transform: scale(calc(1 + var(--hold, 0) * 0.14));
        filter: drop-shadow(
            0 0 calc(22px + var(--hold, 0) * 46px) var(--hero, var(--tier))
          )
          brightness(calc(1 + var(--hold, 0) * 0.7));
      }
      /* Nearly there: it trembles. */
      [data-prestige-confirm][data-hot] .prestige-float {
        animation: prestige-tremble 90ms linear infinite;
      }
      @keyframes prestige-tremble {
        0% {
          transform: translate(0, 0);
        }
        25% {
          transform: translate(1.5px, -1px);
        }
        50% {
          transform: translate(-1px, 1.5px);
        }
        75% {
          transform: translate(1px, 1px);
        }
      }
      /* The handoff: the confirmation leaves, the emblem stays and keeps
         charging (--hold 1 to 1.75) on its way to the middle. */
      .prestige-body > * {
        transition:
          opacity 260ms ease-out,
          transform 260ms ease-out;
      }
      [data-handoff="charge"] .prestige-body > :not(.prestige-float) {
        opacity: 0;
        transform: translateY(16px);
        pointer-events: none;
      }
      [data-handoff="charge"] .prestige-body > h2 {
        transform: translateY(-18px);
      }
      [data-prestige-confirm][data-handoff="charge"] {
        animation: prestige-overcharge ${HANDOFF_MS}ms
          cubic-bezier(0.5, 0, 0.9, 0.55) forwards;
      }
      @keyframes prestige-overcharge {
        from {
          --hold: 1;
        }
        to {
          --hold: 1.75;
        }
      }
      ${HANDOFF_SHAKE}
      /* Reduced motion: a quick crossfade instead. */
      [data-handoff="fade"] .prestige-body {
        opacity: 0;
        transition: opacity ${HANDOFF_FADE_MS}ms ease-out;
      }
      /* The confirm button, filling while it's held. */
      .prestige-hold {
        touch-action: none;
        -webkit-touch-callout: none;
      }
      .prestige-hold[data-holding] {
        filter: brightness(1.1);
      }
      .prestige-hold-fill {
        position: absolute;
        inset: 0;
        transform: scaleX(0);
        transform-origin: left;
        background: linear-gradient(90deg, #fff3b0, #ffffff);
        box-shadow: 6px 0 14px rgba(255, 255, 255, 0.8);
        opacity: 0.6;
        transition: transform 250ms ease-out;
      }
      .prestige-hold-fill[data-holding] {
        transition: none;
      }
      /* The prestige track. */
      .prestige-track-locked {
        opacity: 0.3;
        filter: grayscale(1);
      }
      .prestige-track-next {
        filter: drop-shadow(0 0 10px var(--tier));
        margin: 0 4px;
      }
      /* Clipped corners on the tiles and buttons. */
      .prestige-cut,
      .prestige-tile,
      .prestige-tile-inner {
        clip-path: polygon(
          10px 0,
          100% 0,
          100% calc(100% - 10px),
          calc(100% - 10px) 100%,
          0 100%,
          0 10px
        );
      }
      .prestige-tile {
        width: 6.75rem;
        padding: 1px;
        background: linear-gradient(
          160deg,
          color-mix(in srgb, var(--tier) 70%, transparent),
          rgba(255, 255, 255, 0.12)
        );
      }
      @media (min-width: 640px) {
        .prestige-tile {
          width: 9rem;
        }
      }
      .prestige-tile-inner {
        background: linear-gradient(180deg, #13223c, #0a1322);
      }
      @media (prefers-reduced-motion: reduce) {
        .prestige-charge,
        .prestige-particle,
        .prestige-reveal,
        .prestige-fade,
        .prestige-float,
        .prestige-charge-comb,
        [data-prestige-confirm][data-hot] .prestige-float {
          animation: none;
        }
        /* The glow still follows the hold; the emblem doesn't move. */
        .prestige-emblem {
          transform: none;
        }
        /* The ceremony's end state fades in where the confirmation was. */
        [data-prestige-ceremony][data-from-confirm] > * {
          animation: ceremony-fade-in 220ms ease-out both;
        }
      }
    </style>`;
  }
}
