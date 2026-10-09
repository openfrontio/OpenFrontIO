import {
  html,
  LitElement,
  render as litRender,
  nothing,
  PropertyValues,
  TemplateResult,
} from "lit";
import { customElement, state } from "lit/decorators.js";
import { MAX_PRESTIGE } from "../Progression";
import { translateText } from "../Utils";
import {
  ensureCeremonyStyles,
  prefersReducedMotion,
  renderHoneycomb,
} from "./Ceremony";
import "./LevelBadge";
import { formatXp } from "./XpBar";

// Becoming a Legend (Prestige 10, level 99 to 100): the whole screen, once
// per account. The menu dims, the P10 emblem charges up with gold rays behind
// it and the honeycomb pulsing in toward it, implodes to a point of light, and
// the Legend crown drops in and lands hard: a gold flash, two shockwaves, the
// screen shaking and two gold waves running out across the honeycomb. LEGEND
// slams in and a gold sweep runs through it, then a line on what it took, and
// Continue. At rest the crown breathes and the rays turn slowly.
//
// Any click or key skips to the end; Escape (or Continue) then closes it.
// Emits `legend-ceremony-closed` when it closes.

// The beats, in ms from the start.
const BEATS = {
  charge: 500,
  implode: 2600,
  descend: 2850,
  impact: 3700,
  title: 5000,
  line: 5600,
  done: 6400,
} as const;
type Beat = "intro" | keyof typeof BEATS;
const BEAT_ORDER: Beat[] = [
  "intro",
  "charge",
  "implode",
  "descend",
  "impact",
  "title",
  "line",
  "done",
];
// The crown settles after the impact: the shockwaves and the shake are over.
export const LEGEND_LANDED_MS = BEATS.impact + 1400;
// How long the honeycomb keeps pulsing at rest before it holds still.
export const LEGEND_IDLE_MS = 10_000;
export const LEGEND_CEREMONY_MS = BEATS.done;

export interface LegendMoment {
  lifetimeXp: number;
  // When it happened.
  at: Date;
}

const SEEN_PREFIX = "legendCeremonySeen:";

/** Whether this account has had its Legend ceremony (on this device). */
export function legendCeremonySeen(publicId: string): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + publicId) !== null;
  } catch {
    return false;
  }
}

export function markLegendCeremonySeen(publicId: string): void {
  try {
    localStorage.setItem(SEEN_PREFIX + publicId, "1");
  } catch {
    // Storage off: it may show again, which is better than never.
  }
}

// A translation with one placeholder rendered as markup: "{xp} lifetime XP"
// with the number in bold. MARK is a private-use character no translation
// contains.
const MARK = "\uE000";
function withMarkup(
  key: string,
  param: string,
  value: TemplateResult,
): TemplateResult {
  const [before, after = ""] = translateText(key, { [param]: MARK }).split(
    MARK,
  );
  return html`${before}${value}${after}`;
}

function formatDate(at: Date): string {
  try {
    return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(at);
  } catch {
    return at.toDateString();
  }
}

@customElement("legend-ceremony")
export class LegendCeremony extends LitElement {
  @state() private moment: LegendMoment | null = null;
  @state() private beat: Beat = "intro";
  // Past the impact: the crown at rest, the shockwaves and shake gone.
  @state() private landed = false;
  // At the end without having played there (skipped, or reduced motion):
  // everything fades in in place.
  @state() private skipped = false;
  // The honeycomb holds still after a while at rest.
  @state() private frozen = false;
  private small = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureCeremonyStyles();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.teardown();
  }

  get isOpen(): boolean {
    return this.moment !== null;
  }

  /** Plays the ceremony. Ignored while it's already up. */
  show(moment: LegendMoment): void {
    if (this.moment !== null) return;
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
    window.addEventListener("keydown", this.onKeyDown, true);
    this.small = window.innerWidth < 640;
    this.moment = moment;
    this.landed = false;
    this.frozen = false;
    if (prefersReducedMotion()) {
      this.finish(true);
      return;
    }
    this.skipped = false;
    this.beat = "intro";
    for (const [beat, at] of Object.entries(BEATS) as [Beat, number][]) {
      this.later(at, () => {
        this.beat = beat;
        if (beat === "done") this.rest();
      });
    }
    this.later(LEGEND_LANDED_MS, () => (this.landed = true));
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  // At rest: the honeycomb pulses gently for a while, then holds still.
  private rest(): void {
    this.later(LEGEND_IDLE_MS, () => (this.frozen = true));
  }

  // Straight to the end state.
  private finish(skipped: boolean): void {
    this.clearTimers();
    this.skipped = skipped;
    this.landed = true;
    this.beat = "done";
    this.rest();
  }

  private skip(): void {
    if (this.beat !== "done") this.finish(true);
  }

  close(): void {
    if (this.moment === null) return;
    this.teardown();
    this.dispatchEvent(
      new CustomEvent("legend-ceremony-closed", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private teardown(): void {
    this.clearTimers();
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.moment = null;
    if (this.portal) {
      litRender(nothing, this.portal);
      this.portal.remove();
      this.portal = null;
    }
  }

  // Every key while it's up stays with it. Before the end any key skips;
  // at the end Escape closes and Tab stays on Continue.
  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.moment === null) return;
    e.stopPropagation();
    if (this.beat !== "done") {
      e.preventDefault();
      this.skip();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "Tab") {
      e.preventDefault();
      this.continueButton()?.focus();
    }
  };

  private root(): HTMLElement | null {
    return (
      this.portal?.querySelector<HTMLElement>("[data-legend-ceremony]") ?? null
    );
  }

  private continueButton(): HTMLButtonElement | null {
    return (
      this.portal?.querySelector<HTMLButtonElement>("[data-legend-continue]") ??
      null
    );
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("moment") && this.moment !== null) this.root()?.focus();
    if (changed.has("beat") && this.beat === "done") {
      this.continueButton()?.focus();
    }
  }

  private reached(beat: Beat): boolean {
    return BEAT_ORDER.indexOf(this.beat) >= BEAT_ORDER.indexOf(beat);
  }

  render() {
    if (this.portal) {
      litRender(
        this.moment === null ? nothing : this.renderCeremony(this.moment),
        this.portal,
      );
    }
    return nothing;
  }

  private honeycombMode(): string {
    if (this.beat === "done") {
      return this.frozen ? "lc-hx-idle lc-hx-frozen" : "lc-hx-idle";
    }
    if (this.beat === "charge") return "lc-hx-charge";
    if (this.reached("impact")) return "lc-hx-burst";
    return "";
  }

  private raysMode(): string {
    if (this.beat === "done") return "lc-rays-idle";
    if (this.reached("impact")) return "lc-rays-burst";
    if (this.reached("charge")) return "lc-rays-charge";
    return "";
  }

  private renderCrown(mode: string, inner: string): TemplateResult {
    return html`<div data-legend-crown class="lc-crown ${mode}">
      <div
        aria-hidden="true"
        class="lc-halo ${mode === "lc-crown-drop" ? "" : "lc-halo-in"}"
      ></div>
      <div class="lc-crown-inner ${inner}">
        <level-badge
          .level=${100}
          .prestige=${MAX_PRESTIGE}
          .legend=${true}
          .size=${this.small ? 170 : 220}
        ></level-badge>
      </div>
    </div>`;
  }

  private renderEmblem(): TemplateResult | typeof nothing {
    if (this.beat === "done") {
      return this.renderCrown(
        this.skipped ? "lc-final-in" : "",
        "lc-crown-breathe",
      );
    }
    if (!this.reached("implode")) {
      return html`<div
        class="lc-charge-wrap lc-fade-in ${this.beat === "charge"
          ? "lc-charge"
          : ""}"
      >
        <level-badge
          .level=${99}
          .prestige=${MAX_PRESTIGE}
          .size=${this.small ? 150 : 190}
        ></level-badge>
      </div>`;
    }
    const pinpoint = !this.reached("impact")
      ? html`<div aria-hidden="true" class="lc-pinpoint"></div>`
      : nothing;
    if (this.beat === "implode") {
      return html`<div class="lc-implode">
          <level-badge
            .level=${99}
            .prestige=${MAX_PRESTIGE}
            .size=${this.small ? 150 : 190}
          ></level-badge>
        </div>
        ${pinpoint}`;
    }
    if (this.beat === "descend") {
      return html`${this.renderCrown("lc-crown-drop", "")}${pinpoint}`;
    }
    // From the impact on.
    return html`${this.landed
      ? this.renderCrown("", "lc-crown-breathe")
      : html`${this.renderCrown("lc-crown-land", "")}
          <span aria-hidden="true" class="ceremony-shockwave lc-shock"></span>
          <span
            aria-hidden="true"
            class="ceremony-shockwave lc-shock lc-shock-2"
          ></span>`}`;
  }

  private renderLine(moment: LegendMoment): TemplateResult {
    const final = this.skipped;
    return html`<div
        aria-hidden="true"
        class="lc-rule ${final ? "lc-final-in" : "lc-rule-in"}"
      ></div>
      <div
        data-legend-line
        class="lc-line ${final ? "lc-final-in" : "lc-rise"}"
      >
        <span class="lc-seg"
          >${translateText("legend_ceremony.top_of_track")}</span
        ><span aria-hidden="true" class="lc-dot">·</span
        ><span class="lc-seg"
          >${withMarkup(
            "legend_ceremony.lifetime_xp",
            "xp",
            html`<b>${formatXp(moment.lifetimeXp)}</b>`,
          )}</span
        ><span aria-hidden="true" class="lc-dot">·</span
        ><span class="lc-seg">${formatDate(moment.at)}</span>
      </div>`;
  }

  private renderCeremony(moment: LegendMoment): TemplateResult {
    const done = this.beat === "done";
    const shaking = this.reached("impact") && !this.landed;
    return html`<div
      data-legend-ceremony
      data-beat=${this.beat}
      ?data-skipped=${this.skipped}
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label=${translateText("legend_ceremony.label")}
      class="lc-root ${this.small ? "lc-small" : ""}"
      @click=${() => this.skip()}
    >
      ${LEGEND_STYLES}
      <div class="lc-world ${shaking ? "lc-shake" : ""}">
        <div aria-hidden="true" class="ceremony-backdrop lc-backdrop"></div>
        ${renderHoneycomb(this.honeycombMode(), {
          focusY: 0.42,
          className: "lc-honeycomb",
        })}
        <div aria-hidden="true" class="ceremony-vignette lc-vignette"></div>
        <div aria-hidden="true" class="lc-rays ${this.raysMode()}"></div>
        <div class="lc-stage">
          <div class="lc-emblem">${this.renderEmblem()}</div>
          ${this.reached("title")
            ? html`<div
                data-legend-title
                class="lc-title ${this.skipped
                  ? "lc-title-final lc-final-in"
                  : "lc-title-slam"}"
              >
                ${translateText("progression.legend")}
              </div>`
            : nothing}
          ${this.reached("line") ? this.renderLine(moment) : nothing}
          ${done
            ? html`<div
                class="lc-actions ${this.skipped ? "lc-final-in" : "lc-rise"}"
              >
                <button
                  type="button"
                  data-legend-continue
                  class="lc-continue"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this.close();
                  }}
                >
                  ${translateText("legend_ceremony.continue")}
                </button>
              </div>`
            : nothing}
        </div>
      </div>
      ${this.beat === "implode" || this.beat === "descend"
        ? html`<div
            aria-hidden="true"
            class="ceremony-flash lc-flash lc-flash-small"
          ></div>`
        : nothing}
      ${this.reached("impact") && !this.landed
        ? html`<div aria-hidden="true" class="ceremony-flash lc-flash"></div>`
        : nothing}
    </div>`;
  }
}

const LEGEND_STYLES = html`<style>
  .lc-root {
    position: fixed;
    inset: 0;
    z-index: 10040;
    overflow: hidden;
    color: #fff;
    background: #05080f;
    cursor: pointer;
    outline: none;
    --cy: 34vh;
    --emblem: 230px;
    --hx-color: #fbbf24;
    --hx-glow: #f59e0b;
  }
  .lc-root.lc-small {
    --cy: 30vh;
    --emblem: 190px;
  }
  .lc-root[data-beat="done"] {
    cursor: default;
  }
  .lc-world {
    position: absolute;
    inset: 0;
  }
  .lc-backdrop {
    position: absolute;
    inset: 0;
    animation:
      ceremony-fade-in 500ms ease-out both,
      lc-dim 1600ms ease-in-out 300ms both;
  }
  @keyframes lc-dim {
    from {
      filter: brightness(0.7);
    }
    to {
      filter: brightness(0.32) saturate(0.8);
    }
  }
  .lc-vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      ellipse at 50% 42%,
      rgba(3, 6, 12, 0.25) 0%,
      rgba(3, 6, 12, 0.2) 35%,
      rgba(3, 6, 12, 0.85) 100%
    );
    animation: ceremony-fade-in 500ms ease-out both;
  }
  .lc-fade-in,
  .lc-final-in {
    animation: ceremony-fade-in 500ms ease-out both;
  }
  .lc-final-in {
    animation-duration: 350ms;
  }

  /* The honeycomb, in gold: pulsing in toward the emblem while it charges,
     two waves out at the impact, then a gentle shimmer. */
  .lc-honeycomb {
    filter: drop-shadow(0 0 7px var(--hx-glow));
  }
  .lc-hx-charge .hx {
    animation: lc-hx-pulse 1300ms ease-in-out infinite;
    animation-delay: calc((1 - var(--d)) * 1000ms);
  }
  @keyframes lc-hx-pulse {
    0%,
    100% {
      opacity: 0;
    }
    40% {
      opacity: calc(0.75 * (1 - var(--d)));
    }
  }
  .lc-hx-burst .hx {
    animation: lc-hx-burst 2600ms ease-out both;
    animation-delay: calc(var(--d) * 1100ms);
  }
  @keyframes lc-hx-burst {
    0% {
      opacity: 0;
      stroke: #fff;
    }
    7% {
      opacity: 1;
      stroke: #fff;
    }
    22% {
      opacity: 0.55;
      stroke: #fbbf24;
    }
    34% {
      opacity: 0.95;
      stroke: #fde68a;
    }
    55% {
      opacity: 0.35;
      stroke: #fbbf24;
    }
    100% {
      opacity: 0.08;
      stroke: #f59e0b;
    }
  }
  .lc-hx-idle .hx {
    animation: lc-hx-idle 5s ease-in-out infinite;
    animation-delay: calc(var(--d) * 2.5s);
  }
  .lc-hx-frozen .hx {
    animation-play-state: paused;
  }
  @keyframes lc-hx-idle {
    0%,
    100% {
      opacity: 0.05;
    }
    50% {
      opacity: 0.26;
    }
  }

  /* Gold rays behind the emblem: one turning layer. */
  .lc-rays {
    position: absolute;
    left: 50%;
    top: var(--cy);
    width: 220vmax;
    height: 220vmax;
    margin: -110vmax 0 0 -110vmax;
    opacity: 0;
    pointer-events: none;
    background: repeating-conic-gradient(
      from 0deg,
      rgba(253, 224, 71, 0) 0deg 6deg,
      rgba(253, 224, 71, 0.26) 8deg 10deg,
      rgba(253, 224, 71, 0) 12deg 18deg
    );
    -webkit-mask: radial-gradient(
      circle,
      #000 0,
      rgba(0, 0, 0, 0.75) 9%,
      rgba(0, 0, 0, 0.25) 22%,
      transparent 42%
    );
    mask: radial-gradient(
      circle,
      #000 0,
      rgba(0, 0, 0, 0.75) 9%,
      rgba(0, 0, 0, 0.25) 22%,
      transparent 42%
    );
  }
  .lc-rays-charge {
    animation:
      lc-spin 60s linear infinite,
      lc-rays-in 2000ms ease-in both;
  }
  @keyframes lc-rays-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 0.45;
    }
  }
  .lc-rays-burst {
    animation:
      lc-spin 60s linear infinite,
      lc-rays-burst 1800ms ease-out both;
  }
  @keyframes lc-rays-burst {
    0% {
      opacity: 1;
      transform: scale(1.25);
    }
    100% {
      opacity: 0.55;
      transform: scale(1);
    }
  }
  .lc-rays-idle {
    opacity: 0.5;
    animation: lc-spin 60s linear infinite;
  }
  @keyframes lc-spin {
    to {
      rotate: 360deg;
    }
  }

  .lc-stage {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding-top: calc(var(--cy) - var(--emblem) / 2);
  }
  .lc-emblem {
    position: relative;
    width: var(--emblem);
    height: var(--emblem);
    display: grid;
    place-items: center;
  }
  .lc-emblem > * {
    grid-area: 1 / 1;
  }

  /* The P10 emblem gathering power, then imploding to a point of light. */
  .lc-charge {
    animation:
      lc-shake 2100ms ease-in both,
      lc-glow 2100ms ease-in both;
  }
  @keyframes lc-shake {
    0%,
    35% {
      transform: none;
    }
    45% {
      transform: translate(-1px, 1px) rotate(-1deg);
    }
    55% {
      transform: translate(2px, -1px) rotate(1deg);
    }
    65% {
      transform: translate(-3px, 2px) rotate(-2deg) scale(1.03);
    }
    75% {
      transform: translate(4px, -2px) rotate(2deg) scale(1.06);
    }
    85% {
      transform: translate(-6px, 3px) rotate(-3deg) scale(1.1);
    }
    95% {
      transform: translate(7px, -3px) rotate(3deg) scale(1.15);
    }
    100% {
      transform: scale(1.2);
    }
  }
  @keyframes lc-glow {
    from {
      filter: drop-shadow(0 0 0 transparent) brightness(1);
    }
    to {
      filter: drop-shadow(0 0 50px #facc15) brightness(2);
    }
  }
  .lc-implode {
    animation: lc-implode 260ms cubic-bezier(0.6, 0, 1, 0.6) both;
  }
  @keyframes lc-implode {
    from {
      transform: scale(1.2);
      filter: brightness(2.5) drop-shadow(0 0 60px #fff);
      opacity: 1;
    }
    to {
      transform: scale(0);
      filter: brightness(4);
      opacity: 0;
    }
  }
  .lc-pinpoint {
    width: 18px;
    height: 18px;
    border-radius: 9999px;
    background: #fff;
    box-shadow:
      0 0 30px 12px #fde68a,
      0 0 80px 30px rgba(250, 204, 21, 0.6);
    animation: lc-pinpoint 900ms ease-in-out both;
  }
  @keyframes lc-pinpoint {
    0% {
      transform: scale(0.2);
      opacity: 0;
    }
    20% {
      transform: scale(1.4);
      opacity: 1;
    }
    100% {
      transform: scale(0.6);
      opacity: 0.9;
    }
  }

  /* The crown drops in from above and lands hard, then breathes. */
  .lc-crown {
    position: relative;
    display: grid;
    place-items: center;
  }
  .lc-crown > * {
    grid-area: 1 / 1;
  }
  .lc-crown-drop {
    animation: lc-drop 850ms cubic-bezier(0.55, 0, 0.95, 0.5) both;
  }
  @keyframes lc-drop {
    0% {
      transform: translateY(-75vh) scale(1.7);
      opacity: 0;
    }
    12% {
      opacity: 1;
    }
    100% {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }
  .lc-crown-land {
    animation: lc-land 700ms cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
  }
  @keyframes lc-land {
    0% {
      transform: scale(1.12, 0.8) translateY(8%);
    }
    35% {
      transform: scale(0.94, 1.08);
    }
    65% {
      transform: scale(1.03, 0.97);
    }
    100% {
      transform: none;
    }
  }
  .lc-crown-breathe {
    animation: lc-breathe 3.2s ease-in-out infinite;
  }
  @keyframes lc-breathe {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.035);
    }
  }
  .lc-crown level-badge {
    filter: drop-shadow(0 0 22px rgba(250, 204, 21, 0.85))
      drop-shadow(0 0 60px rgba(245, 158, 11, 0.45));
  }
  .lc-halo {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: 150%;
    height: 150%;
    border-radius: 9999px;
    pointer-events: none;
    background: radial-gradient(
      circle,
      rgba(253, 224, 71, 0.42) 0%,
      rgba(250, 204, 21, 0.14) 38%,
      transparent 68%
    );
  }
  .lc-halo-in {
    animation: ceremony-fade-in 600ms ease-out both;
  }

  /* The impact: two shockwaves, a gold flash, and the screen shaking. */
  .lc-shock {
    --shock-size: 220px;
    --shock-width: 7px;
    --shock-color: #fde68a;
    --shock-from: 0.5;
    --shock-to: 7;
    --shock-ms: 1000ms;
  }
  .lc-shock-2 {
    --shock-color: #ffffff;
    --shock-width: 3px;
    --shock-ms: 1300ms;
    --shock-delay: 140ms;
  }
  .lc-flash {
    --flash-bg: radial-gradient(
      circle at 50% var(--cy),
      #fff 0%,
      #fff7d6 22%,
      rgba(253, 230, 138, 0.7) 48%,
      rgba(250, 204, 21, 0.28) 100%
    );
    --flash-ms: 900ms;
  }
  .lc-flash-small {
    --flash-ms: 500ms;
  }
  .lc-shake {
    animation: lc-shake-screen 520ms linear both;
  }
  @keyframes lc-shake-screen {
    0% {
      transform: translate(0, 0);
    }
    10% {
      transform: translate(-14px, 9px);
    }
    20% {
      transform: translate(12px, -8px);
    }
    30% {
      transform: translate(-9px, -6px);
    }
    40% {
      transform: translate(8px, 6px);
    }
    55% {
      transform: translate(-5px, 3px);
    }
    70% {
      transform: translate(3px, -2px);
    }
    85% {
      transform: translate(-1px, 1px);
    }
    100% {
      transform: none;
    }
  }

  /* LEGEND, slammed in, then a gold sweep through it. */
  .lc-title {
    margin-top: 14px;
    font-size: clamp(60px, min(12vw, 17vh), 150px);
    line-height: 0.95;
    font-weight: 900;
    font-style: italic;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0 0.1em;
    background: linear-gradient(
      100deg,
      #f59e0b 0%,
      #facc15 30%,
      #fde68a 42%,
      #ffffff 50%,
      #fde68a 58%,
      #facc15 70%,
      #f59e0b 100%
    );
    background-size: 300% 100%;
    background-position: 100% 0;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 0 26px rgba(250, 204, 21, 0.65))
      drop-shadow(0 4px 0 rgba(120, 53, 15, 0.55));
  }
  .lc-title-slam {
    animation:
      ceremony-slam 560ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both,
      lc-sweep 1100ms ease-in-out 420ms both;
  }
  @keyframes lc-sweep {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: 0 0;
    }
  }
  .lc-title-final {
    background-position: 0 0;
  }
  .lc-rule {
    width: min(520px, 80vw);
    height: 2px;
    margin-top: 14px;
    background: linear-gradient(
      90deg,
      transparent,
      #facc15 20%,
      #fde68a 50%,
      #facc15 80%,
      transparent
    );
  }
  .lc-rule-in {
    animation: lc-rule 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  @keyframes lc-rule {
    from {
      transform: scaleX(0);
      opacity: 0;
    }
  }
  .lc-line {
    margin-top: 12px;
    padding: 0 16px;
    font-size: clamp(14px, 1.6vw, 18px);
    color: rgba(255, 247, 214, 0.88);
    letter-spacing: 0.02em;
    text-align: center;
  }
  .lc-line b {
    color: #fde68a;
    font-weight: 800;
  }
  .lc-seg {
    white-space: nowrap;
  }
  .lc-dot {
    color: rgba(250, 204, 21, 0.6);
    margin: 0 0.5em;
  }
  .lc-rise {
    animation: lc-rise 600ms ease-out both;
  }
  @keyframes lc-rise {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
  }
  .lc-actions {
    margin-top: 26px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .lc-continue {
    border: 0;
    padding: 12px 44px;
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #1c1917;
    background: linear-gradient(180deg, #fde68a, #f59e0b);
    cursor: pointer;
    clip-path: polygon(
      10px 0,
      100% 0,
      100% calc(100% - 10px),
      calc(100% - 10px) 100%,
      0 100%,
      0 10px
    );
    box-shadow: 0 0 24px rgba(250, 204, 21, 0.45);
  }
  @media (max-width: 640px) {
    .lc-title {
      letter-spacing: 0.03em;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lc-root,
    .lc-root * {
      animation: none !important;
    }
    .lc-root {
      animation: ceremony-fade-in 400ms ease-out both !important;
    }
    .lc-backdrop {
      filter: brightness(0.32) saturate(0.8);
    }
    .lc-hx-idle .hx {
      opacity: 0.2;
    }
  }
</style>`;
