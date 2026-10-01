import {
  html,
  LitElement,
  render as litRender,
  nothing,
  svg,
  TemplateResult,
} from "lit";
import { customElement, state } from "lit/decorators.js";
import type { PrestigeResponse, Progress } from "../../core/ApiSchemas";
import {
  clampPrestige,
  MAX_PRESTIGE,
  PrestigeTier,
  prestigeTier,
} from "../Progression";
import { prestigeMe } from "../ProgressionApi";
import { translateText } from "../Utils";
import "./CapIcon";
import "./LevelBadge";

// Prestiging, start to finish: the confirmation (the new emblem, where it sits
// on the prestige track, what it unlocks, and that it can't be undone), then a
// full-screen ceremony: the level-100 badge charges up and shatters, the new
// prestige emblem forms out of the flash, and the new rank slams in with its
// rewards. Tapping skips the ceremony to its end.
//
// Emits `prestiged` (detail: PrestigeResponse) as soon as the server agrees,
// so the page behind can update while the ceremony plays.

type Stage = "closed" | "confirm" | "submitting" | "ceremony";

// The ceremony's beats, in ms from its start.
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

// Ranks that come with an exclusive cosmetic (the levels plan, §3.4).
const COSMETIC_RANKS = [1, 5, 10];

const TIER_COLORS: Record<PrestigeTier, string> = {
  none: "#facc15",
  ring: "#f59e0b",
  double: "#e2e8f0",
  sunburst: "#facc15",
  radiant: "#d946ef",
};

// The honeycomb baked into the menu background (resources/images/
// background.webp, 2500x1382): flat-topped hexes with 147px sides, one of
// whose rows of horizontal edges runs along y=1260 with an edge centred on
// x=144. Measured from the image, so traced hexes sit on its own lines when
// drawn over it at the same scale and position (cover, centred). `d` is each
// hex's distance from the middle, 0..1, for the waves.
const HONEYCOMB = (() => {
  const width = 2500;
  const height = 1382;
  const side = 147;
  const halfHeight = (Math.sqrt(3) * side) / 2;
  const originX = 144;
  const originY = 1260 - halfHeight;
  const hexes: { points: string; d: number }[] = [];
  const maxDist = Math.hypot(width / 2, height / 2);
  for (let col = -2; col <= Math.ceil(width / (1.5 * side)) + 1; col++) {
    const cx = originX + col * 1.5 * side;
    const shift = col % 2 === 0 ? 0 : halfHeight;
    for (let row = -2; row <= Math.ceil(height / (2 * halfHeight)) + 2; row++) {
      const cy = originY - shift - row * 2 * halfHeight;
      if (cx < -side || cx > width + side) continue;
      if (cy < -halfHeight * 2 || cy > height + halfHeight * 2) continue;
      const points = [0, 60, 120, 180, 240, 300]
        .map((deg) => {
          const a = (deg * Math.PI) / 180;
          return `${(cx + side * Math.cos(a)).toFixed(1)},${(cy + side * Math.sin(a)).toFixed(1)}`;
        })
        .join(" ");
      const d = Math.min(
        1,
        Math.hypot(cx - width / 2, cy - height / 2) / maxDist,
      );
      hexes.push({ points, d: Number(d.toFixed(3)) });
    }
  }
  return { width, height, hexes };
})();

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

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
  @state() private failed = false;
  @state() private beat: Beat = "charge";
  // True when the ceremony follows the confirmation, whose backdrop it takes
  // over as is: fading in again would show the page behind for a moment.
  private fromConfirm = false;
  // The confirm button's hold: 0..1, and when it started (null when up).
  @state() private holdProgress = 0;
  private holdStart: number | null = null;
  private holdFrame = 0;

  // Replaceable for tests and previews.
  submit: (idempotencyKey: string) => ReturnType<typeof prestigeMe> =
    prestigeMe;

  private portal: HTMLDivElement | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private idempotencyKey = "";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
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
    this.failed = false;
    this.holdProgress = 0;
    let key = pendingKeys.get(progress.prestige);
    if (key === undefined) {
      key = newIdempotencyKey();
      pendingKeys.set(progress.prestige, key);
    }
    this.idempotencyKey = key;
    this.stage = "confirm";
    void this.updateComplete.then(() => this.focusConfirmButton());
  }

  private focusConfirmButton(): void {
    this.portal
      ?.querySelector<HTMLButtonElement>("[data-prestige-confirm-button]")
      ?.focus();
  }

  // Keys while the overlay is up: Escape cancels the confirmation (or skips,
  // then closes, the ceremony), and Tab stays inside the confirmation. The
  // page behind never sees them.
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
    if (e.key === "Tab" && this.stage !== "ceremony") {
      const buttons = [
        ...(this.portal?.querySelectorAll<HTMLButtonElement>(
          "[data-prestige-confirm] button:not([disabled])",
        ) ?? []),
      ];
      if (buttons.length === 0) return;
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        at === -1
          ? 0
          : (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      e.preventDefault();
      e.stopPropagation();
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

  /** Plays the ceremony for a prestige that already happened (previews). */
  celebrate(before: Progress, result: PrestigeResponse): void {
    this.prior = before;
    this.outcome = result;
    this.fromConfirm = false;
    this.startCeremony();
  }

  get isOpen(): boolean {
    return this.stage !== "closed";
  }

  private close(): void {
    this.clearTimers();
    this.endHold();
    this.stage = "closed";
  }

  render() {
    if (this.portal) litRender(this.renderOverlay(), this.portal);
    return nothing;
  }

  private renderOverlay(): TemplateResult | typeof nothing {
    if (this.prior === null) return nothing;
    switch (this.stage) {
      case "closed":
        return nothing;
      case "confirm":
      case "submitting":
        return this.renderConfirm(this.prior);
      case "ceremony":
        return this.renderCeremony(this.prior);
    }
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
    const holding = this.holdProgress > 0 && !submitting;
    return html`<div
      data-prestige-confirm
      role="dialog"
      aria-modal="true"
      aria-labelledby="prestige-confirm-title"
      class="prestige-ceremony fixed inset-0 z-[10020] flex flex-col items-center overflow-y-auto px-4 py-8 text-white"
      style="--tier: ${TIER_COLORS[prestigeTier(rank)]}"
    >
      ${this.renderCeremonyStyles()}
      <div aria-hidden="true" class="prestige-backdrop fixed inset-0"></div>
      ${this.renderHoneycomb("hx-idle")}
      <div aria-hidden="true" class="prestige-vignette fixed inset-0"></div>

      <div
        class="prestige-fade relative my-auto flex w-full max-w-2xl flex-col items-center text-center"
      >
        <h2
          id="prestige-confirm-title"
          class="prestige-title m-0 text-4xl font-black uppercase italic tracking-wide sm:text-6xl"
        >
          ${translateText("prestige.title", { rank })}
        </h2>

        <div class="prestige-float relative mt-10">
          <div
            aria-hidden="true"
            class="absolute -inset-10 rounded-full"
            style="background: radial-gradient(circle, color-mix(in srgb, var(--tier) 40%, transparent) 0%, transparent 70%)"
          ></div>
          <level-badge
            class="prestige-emblem relative"
            .level=${1}
            .prestige=${rank}
            .size=${170}
          ></level-badge>
        </div>

        ${this.renderTrack(clampPrestige(before.prestige), rank)}
        ${this.renderUnlocks(rank)}

        <p class="m-0 mt-6 max-w-md text-sm text-white/75">
          ${translateText("prestige.summary")}
        </p>
        ${this.failed
          ? html`<p
              data-prestige-error
              class="m-0 mt-2 text-sm font-bold text-rose-400"
            >
              ${translateText("prestige.error")}
            </p>`
          : nothing}

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
              style="transform: scaleX(${submitting ? 1 : this.holdProgress})"
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

  // What the new rank unlocks, as tiles.
  private renderUnlocks(rank: number): TemplateResult {
    const tiles: { key: string; icon: TemplateResult; label: string }[] = [
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
        label: translateText("prestige.gain_caps"),
      },
    ];
    if (COSMETIC_RANKS.includes(rank)) {
      tiles.push({
        key: "cosmetic",
        icon: html`<svg
          viewBox="0 0 24 24"
          width="40"
          height="40"
          aria-hidden="true"
        >
          <path
            fill="var(--tier)"
            d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"
          />
        </svg>`,
        label: translateText("prestige.gain_cosmetic"),
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

  // Holding the confirm button fills it; letting go early empties it again.
  // A full hold prestiges.
  private startHold(): void {
    if (this.stage !== "confirm" || this.holdStart !== null) return;
    this.holdStart = performance.now();
    const tick = () => {
      if (this.holdStart === null) return;
      const elapsed = performance.now() - this.holdStart;
      this.holdProgress = Math.min(1, Math.max(0.01, elapsed / HOLD_MS));
      if (this.holdProgress >= 1) {
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
    this.holdProgress = 0;
  }

  private async confirm(): Promise<void> {
    // The stage check stops a second hold from sending twice.
    if (this.stage !== "confirm") return;
    this.failed = false;
    this.stage = "submitting";
    const prior = this.prior;
    const response = await this.submit(this.idempotencyKey);
    if (!response.ok) {
      if (response.refused) {
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
      this.holdProgress = 0;
      this.failed = true;
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
    this.fromConfirm = true;
    this.startCeremony();
  }

  // ---------------------------------------------------------------------------
  // Ceremony
  // ---------------------------------------------------------------------------

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private startCeremony(): void {
    this.clearTimers();
    this.stage = "ceremony";
    if (prefersReducedMotion()) {
      this.beat = "done";
      return;
    }
    this.beat = "charge";
    for (const [beat, at] of Object.entries(BEATS) as [Beat, number][]) {
      this.timers.push(setTimeout(() => (this.beat = beat), at));
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
    const color = TIER_COLORS[prestigeTier(rank)];
    const shattered = this.reached("shatter");
    const revealed = this.reached("reveal");
    const done = this.beat === "done";
    // Per-element angles, so the particles and shards spread evenly.
    const particles = Array.from({ length: 18 }, (_, i) => (i * 360) / 18);
    const shards = Array.from({ length: 14 }, (_, i) => (i * 360) / 14 + 7);
    return html`<div
      data-prestige-ceremony
      role="dialog"
      aria-modal="true"
      aria-label=${translateText("prestige.ceremony_title", { rank })}
      data-beat=${this.beat}
      ?data-from-confirm=${this.fromConfirm}
      class="prestige-ceremony fixed inset-0 z-[10030] flex flex-col items-center justify-center overflow-hidden text-white"
      style="--tier: ${color}"
      @click=${() => this.skipCeremony()}
    >
      ${this.renderCeremonyStyles()}
      <div aria-hidden="true" class="prestige-backdrop absolute inset-0"></div>
      ${this.renderHoneycomb(
        !shattered ? "hx-charge" : done ? "hx-idle" : "hx-burst",
      )}
      <div aria-hidden="true" class="prestige-vignette absolute inset-0"></div>

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
              <span class="prestige-shockwave"></span>
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
                : "prestige-slam"} prestige-title text-5xl font-black uppercase italic tracking-wide sm:text-7xl"
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
        ? html`<div
            aria-hidden="true"
            class="prestige-flash absolute inset-0"
          ></div>`
        : nothing}
    </div>`;
  }

  // The menu's honeycomb, traced in cyan over the background image's own hex
  // lines (see HONEYCOMB) and lit in waves: in toward the badge while it
  // charges, out from it when it shatters, then a slow shimmer.
  private renderHoneycomb(mode: string): TemplateResult {
    return html`<svg
      aria-hidden="true"
      class="prestige-honeycomb absolute inset-0 h-full w-full ${mode}"
      viewBox="0 0 ${HONEYCOMB.width} ${HONEYCOMB.height}"
      preserveAspectRatio="xMidYMid slice"
    >
      ${HONEYCOMB.hexes.map(
        (hex) =>
          svg`<polygon
            class="hx"
            points=${hex.points}
            style="--d: ${hex.d}"
          ></polygon>`,
      )}
    </svg>`;
  }

  private renderCeremonyStyles(): TemplateResult {
    return html`<style>
      /* The menu background, as it sits behind every page, but at full
         strength: the moment has the whole screen to itself. */
      .prestige-backdrop {
        background-color: #070d18;
        background-image: var(--background-image-url);
        background-size: cover;
        background-position: center;
        filter: brightness(0.7);
        animation: prestige-fade-in 400ms ease-out both;
      }
      /* Darker in the middle and at the edges, so the badge and the words
         read over the map. */
      .prestige-vignette {
        background: radial-gradient(
          ellipse at 50% 45%,
          rgba(3, 6, 12, 0.55) 0%,
          rgba(3, 6, 12, 0.15) 45%,
          rgba(3, 6, 12, 0.75) 100%
        );
        animation: prestige-fade-in 400ms ease-out both;
      }
      [data-from-confirm] .prestige-backdrop,
      [data-from-confirm] .prestige-vignette {
        animation: none;
      }
      .prestige-honeycomb {
        filter: drop-shadow(0 0 6px #00c8ff);
      }
      .hx {
        fill: none;
        stroke: #00c8ff;
        stroke-width: 9;
        stroke-linejoin: round;
        opacity: 0;
      }
      /* Inward: the outermost hexes light first, the wave closing on the
         badge, over and over while it charges. */
      .hx-charge .hx {
        animation: hx-pulse 1100ms ease-in-out infinite;
        animation-delay: calc((1 - var(--d)) * 900ms);
      }
      @keyframes hx-pulse {
        0%,
        100% {
          opacity: 0;
        }
        35% {
          opacity: 0.85;
        }
      }
      /* Outward: one burst from the badge to the edges of the screen. */
      .hx-burst .hx {
        animation: hx-burst 1500ms ease-out both;
        animation-delay: calc(var(--d) * 700ms);
      }
      @keyframes hx-burst {
        0% {
          opacity: 0;
          stroke: #ffffff;
        }
        12% {
          opacity: 1;
          stroke: #ffffff;
        }
        40% {
          opacity: 0.9;
          stroke: #00c8ff;
        }
        100% {
          opacity: 0.12;
          stroke: #00c8ff;
        }
      }
      /* At rest: a slow shimmer rolling outward. */
      .hx-idle .hx {
        animation: hx-idle 4s ease-in-out infinite;
        animation-delay: calc(var(--d) * 2s);
      }
      @keyframes hx-idle {
        0%,
        100% {
          opacity: 0.08;
        }
        50% {
          opacity: 0.45;
        }
      }
      @keyframes prestige-fade-in {
        from {
          opacity: 0;
        }
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
      .prestige-flash {
        background: white;
        animation: prestige-flash 700ms ease-out both;
        pointer-events: none;
      }
      @keyframes prestige-flash {
        0% {
          opacity: 0.95;
        }
        100% {
          opacity: 0;
        }
      }
      .prestige-shockwave {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 200px;
        height: 200px;
        margin: -100px 0 0 -100px;
        border-radius: 9999px;
        border: 6px solid var(--tier);
        box-shadow: 0 0 30px var(--tier);
        animation: prestige-shockwave 800ms ease-out both;
      }
      @keyframes prestige-shockwave {
        from {
          transform: scale(0.6);
          opacity: 1;
        }
        to {
          transform: scale(3.2);
          opacity: 0;
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
      .prestige-title {
        background: linear-gradient(90deg, #fde047, var(--tier), #fde047);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        filter: drop-shadow(
          0 0 18px color-mix(in srgb, var(--tier) 70%, transparent)
        );
      }
      .prestige-slam {
        animation: prestige-slam 520ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
      }
      @keyframes prestige-slam {
        0% {
          opacity: 0;
          transform: scale(2.6) skewX(-8deg);
        }
        55% {
          opacity: 1;
          transform: scale(0.94) skewX(-8deg);
        }
        100% {
          transform: none;
        }
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
      .prestige-emblem {
        filter: drop-shadow(0 0 22px var(--tier));
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
        transform-origin: left;
        background: linear-gradient(90deg, #fff3b0, #ffffff);
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
        .hx-charge .hx,
        .hx-burst .hx,
        .hx-idle .hx,
        .prestige-charge,
        .prestige-particle,
        .prestige-reveal,
        .prestige-slam,
        .prestige-fade,
        .prestige-float {
          animation: none;
        }
      }
    </style>`;
  }
}
