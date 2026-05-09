import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { GameView } from "../core/game/GameView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type TooltipSide = "top" | "bottom" | "left" | "right" | "center";

interface StepDef {
  id: string;
  emoji: string;
  title: string;
  body: string;
  /** CSS selector for the element to spotlight. Omit for centered card. */
  targetSelector?: string;
  targetPadding?: number;
  tooltipSide?: TooltipSide;
  /** window event name that auto-completes this step */
  completionEvent?: string;
  /** Polling function name — called every 600 ms */
  completionPoll?: "tiles-10" | "allied";
  /** Label for manual "I did it" button (shown in addition to auto-detect) */
  manualCta?: string;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS: StepDef[] = [
  {
    id: "click-play",
    emoji: "🎮",
    title: "Click PLAY",
    body: "Tap the PLAY button in the left sidebar to open the game lobby. That's your gateway to live matches.",
    targetSelector: "[data-page='page-matchmaking']",
    targetPadding: 10,
    tooltipSide: "right",
    completionEvent: "tour:play-clicked",
  },
  {
    id: "join-game",
    emoji: "🌍",
    title: "Join a Game",
    body: "Pick any Free For All game from the list — the World map is great for beginners. Click it to join.",
    targetSelector: "game-mode-selector",
    targetPadding: 16,
    tooltipSide: "bottom",
    completionEvent: "join-lobby",
  },
  {
    id: "spawn",
    emoji: "📍",
    title: "Choose Your Spawn",
    body: "Click any green (plains) land tile to place your nation. Aim for the center of the map — it gives you room to expand in every direction.",
    targetSelector: "canvas",
    targetPadding: 0,
    tooltipSide: "bottom",
    completionEvent: "tour:spawn-clicked",
  },
  {
    id: "expand",
    emoji: "⚔️",
    title: "Conquer 10 Tiles",
    body: "Click neighboring territory to attack it. Keep the attack slider (bottom left) around 20–30%. Reach 10 tiles to continue.",
    targetSelector: "control-panel",
    targetPadding: 12,
    tooltipSide: "top",
    completionPoll: "tiles-10",
  },
  {
    id: "build-city",
    emoji: "🏙️",
    title: "Build Your First City",
    body: "Right-click anywhere on your territory — the build menu opens. Select City to increase your population cap. More pop = more troops every tick.",
    targetSelector: "build-menu",
    targetPadding: 12,
    tooltipSide: "left",
    completionEvent: "tour:city-built",
    manualCta: "I built a city →",
  },
  {
    id: "alliance",
    emoji: "🤝",
    title: "Request an Alliance",
    body: "Right-click a neighboring player's territory and choose Request Alliance. Allied nations can't attack each other — use it to secure your flanks while you grow.",
    targetSelector: "canvas",
    targetPadding: 0,
    tooltipSide: "bottom",
    completionEvent: "tour:alliance-sent",
    manualCta: "Alliance sent →",
  },
  {
    id: "nukes",
    emoji: "☢️",
    title: "The Nuclear Endgame",
    body: "When you control 40%+: right-click your territory → build a Missile Silo (100k gold) → launch at the biggest threat. Target players with no SAM launchers. MIRVs fire multiple warheads and overwhelm any SAM defense. Time your strike when opponents are busy fighting each other.",
    tooltipSide: "center",
    manualCta: "Got it — I'm ready to dominate →",
  },
];

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "openfront-tour-step-v1";

function savedStep(): number {
  return parseInt(localStorage.getItem(STORAGE_KEY) ?? "0", 10) || 0;
}
function saveStep(n: number) {
  localStorage.setItem(STORAGE_KEY, String(n));
}

// ─── Component ────────────────────────────────────────────────────────────────

@customElement("tour-overlay")
export class TourOverlay extends LitElement {
  // Use document for rendering so Tailwind works
  createRenderRoot() {
    return this;
  }

  @state() private active = false;
  @state() private stepIndex = 0;
  @state() private spotRect: Rect | null = null;
  @state() private tooltipPos: { top: number; left: number } | null = null;
  @state() private completed = false;

  private rafId: number | null = null;
  private pollId: ReturnType<typeof setInterval> | null = null;
  private boundHandlers = new Map<string, EventListener>();

  // ── Public API ─────────────────────────────────────────────────────────────

  activate(fromStep = 0) {
    this.stepIndex = fromStep;
    this.completed = false;
    this.active = true;
    saveStep(fromStep);
    this.attachStepListeners();
    this.startRaf();
    this.startPoll();
  }

  deactivate() {
    this.active = false;
    this.stopRaf();
    this.stopPoll();
    this.detachAllListeners();
  }

  // ── Step navigation ────────────────────────────────────────────────────────

  private next() {
    this.detachAllListeners();
    this.stopPoll();
    const nextIdx = this.stepIndex + 1;
    if (nextIdx >= STEPS.length) {
      this.completed = true;
      this.stopRaf();
      saveStep(0);
      return;
    }
    this.stepIndex = nextIdx;
    saveStep(nextIdx);
    this.attachStepListeners();
    this.startPoll();
  }

  // ── Event / poll wiring ───────────────────────────────────────────────────

  private attachStepListeners() {
    const step = STEPS[this.stepIndex];

    // Wire play-button click → dispatch custom event
    if (step.id === "click-play") {
      const btn = document.querySelector(
        "[data-page='page-matchmaking']",
      ) as HTMLElement | null;
      if (btn) {
        const handler = () =>
          window.dispatchEvent(new CustomEvent("tour:play-clicked"));
        btn.addEventListener("click", handler, { once: true });
        this.boundHandlers.set("btn-click", handler as EventListener);
      }
    }

    // Completion via window event
    if (step.completionEvent) {
      const handler = () => this.next();
      window.addEventListener(step.completionEvent, handler, { once: true });
      this.boundHandlers.set("completion-event", handler);
    }
  }

  private detachAllListeners() {
    for (const [, handler] of this.boundHandlers) {
      const step = STEPS[this.stepIndex];
      if (step?.completionEvent) {
        window.removeEventListener(step.completionEvent, handler);
      }
      const btn = document.querySelector("[data-page='page-matchmaking']");
      btn?.removeEventListener("click", handler);
    }
    this.boundHandlers.clear();
  }

  // ── Polling (game-state checks) ────────────────────────────────────────────

  private startPoll() {
    this.stopPoll();
    const step = STEPS[this.stepIndex];
    if (!step.completionPoll) return;
    this.pollId = setInterval(() => {
      if (this.checkPoll(step.completionPoll!)) {
        this.next();
      }
    }, 600);
  }

  private stopPoll() {
    if (this.pollId !== null) {
      clearInterval(this.pollId);
      this.pollId = null;
    }
  }

  private checkPoll(key: string): boolean {
    const gv = (window as unknown as { __tourGameView?: GameView })
      .__tourGameView;
    if (!gv) return false;
    const me = gv.myPlayer();
    if (!me) return false;
    if (key === "tiles-10") return me.numTilesOwned() >= 10;
    if (key === "allied") return me.allies().length > 0;
    return false;
  }

  // ── RAF loop — keeps spotlight synced to live element position ─────────────

  private startRaf() {
    this.stopRaf();
    const tick = () => {
      if (!this.active) return;
      this.updateSpotlight();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRaf() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private updateSpotlight() {
    const step = STEPS[this.stepIndex];
    if (!step.targetSelector) {
      this.spotRect = null;
      this.tooltipPos = null;
      return;
    }
    const el = document.querySelector(step.targetSelector);
    if (!el) {
      this.spotRect = null;
      this.tooltipPos = null;
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = step.targetPadding ?? 8;
    const newRect: Rect = {
      x: r.left - pad,
      y: r.top - pad,
      w: r.width + pad * 2,
      h: r.height + pad * 2,
    };
    // Only trigger re-render when position actually changes
    if (
      !this.spotRect ||
      Math.abs(newRect.x - this.spotRect.x) > 0.5 ||
      Math.abs(newRect.y - this.spotRect.y) > 0.5 ||
      Math.abs(newRect.w - this.spotRect.w) > 0.5 ||
      Math.abs(newRect.h - this.spotRect.h) > 0.5
    ) {
      this.spotRect = newRect;
      this.tooltipPos = this.computeTooltipPos(newRect, step.tooltipSide ?? "bottom");
    }
  }

  private computeTooltipPos(
    spot: Rect,
    side: TooltipSide,
  ): { top: number; left: number } {
    const TW = 320; // tooltip card width
    const TH = 200; // tooltip card estimated height
    const GAP = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top: number;
    let left: number;

    switch (side) {
      case "bottom":
        top = spot.y + spot.h + GAP;
        left = spot.x + spot.w / 2 - TW / 2;
        break;
      case "top":
        top = spot.y - TH - GAP;
        left = spot.x + spot.w / 2 - TW / 2;
        break;
      case "right":
        top = spot.y + spot.h / 2 - TH / 2;
        left = spot.x + spot.w + GAP;
        break;
      case "left":
        top = spot.y + spot.h / 2 - TH / 2;
        left = spot.x - TW - GAP;
        break;
      default:
        top = vh / 2 - TH / 2;
        left = vw / 2 - TW / 2;
    }

    // Clamp within viewport
    left = Math.max(12, Math.min(left, vw - TW - 12));
    top = Math.max(12, Math.min(top, vh - TH - 12));

    return { top, left };
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  disconnectedCallback() {
    super.disconnectedCallback();
    this.deactivate();
  }

  render() {
    if (!this.active) return nothing;

    if (this.completed) {
      return this.renderCompletionCard();
    }

    const step = STEPS[this.stepIndex];
    const spot = this.spotRect;

    return html`
      <!-- Backdrop (pointer-events:none — lets clicks through to spotlit area) -->
      <div
        class="fixed inset-0 pointer-events-none"
        style="z-index:9990;"
      >
        ${spot
          ? html`
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-full h-full"
                style="pointer-events:none;"
              >
                <defs>
                  <mask id="tour-mask" maskUnits="userSpaceOnUse"
                    x="0" y="0"
                    width="100%" height="100%"
                  >
                    <rect x="0" y="0" width="10000" height="10000" fill="white" />
                    <rect
                      x="${spot.x}"
                      y="${spot.y}"
                      width="${spot.w}"
                      height="${spot.h}"
                      rx="8"
                      fill="black"
                    />
                  </mask>
                </defs>
                <!-- Dark overlay with cutout -->
                <rect
                  x="0" y="0" width="10000" height="10000"
                  fill="rgba(0,0,0,0.72)"
                  mask="url(#tour-mask)"
                />
                <!-- Glowing ring around spotlight -->
                <rect
                  x="${spot.x}"
                  y="${spot.y}"
                  width="${spot.w}"
                  height="${spot.h}"
                  rx="8"
                  fill="none"
                  stroke="rgba(139,92,246,0.85)"
                  stroke-width="2"
                  style="filter:drop-shadow(0 0 8px rgba(139,92,246,0.6));"
                />
              </svg>
            `
          : html`
              <!-- No target — full dark backdrop (center card) -->
              <div
                class="absolute inset-0"
                style="background:rgba(0,0,0,0.72);"
              ></div>
            `}
      </div>

      <!-- Tooltip card (pointer-events:auto) -->
      ${this.renderTooltipCard(step)}

      <!-- Skip button (top-right, always visible) -->
      <button
        @click=${() => this.deactivate()}
        class="fixed top-4 right-4 text-white/40 hover:text-white/80 text-xs uppercase tracking-widest transition-colors"
        style="z-index:9999; pointer-events:auto;"
      >
        ✕ Exit Tour
      </button>
    `;
  }

  private renderTooltipCard(step: StepDef) {
    const pos = this.tooltipPos;
    const isCenter = !pos || step.tooltipSide === "center";

    const cardStyle = isCenter
      ? "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:340px;"
      : `position:fixed;top:${pos.top}px;left:${pos.left}px;width:320px;`;

    return html`
      <div
        class="rounded-xl shadow-2xl border border-white/10 p-5 flex flex-col gap-3"
        style="
          ${cardStyle}
          z-index:9999;
          pointer-events:auto;
          background:rgba(18,18,28,0.97);
          backdrop-filter:blur(12px);
        "
      >
        <!-- Progress dots -->
        <div class="flex gap-1.5 items-center">
          ${STEPS.map(
            (_, i) => html`
              <div
                class="rounded-full transition-all duration-300"
                style="
                  width:${i === this.stepIndex ? "20px" : "6px"};
                  height:6px;
                  background:${i < this.stepIndex
                    ? "rgba(139,92,246,0.9)"
                    : i === this.stepIndex
                      ? "rgba(139,92,246,1)"
                      : "rgba(255,255,255,0.15)"};
                "
              ></div>
            `,
          )}
          <span class="text-white/30 text-xs ml-auto"
            >${this.stepIndex + 1} / ${STEPS.length}</span
          >
        </div>

        <!-- Header -->
        <div class="flex items-center gap-2.5">
          <span class="text-2xl">${step.emoji}</span>
          <h3 class="text-white font-bold text-base leading-tight">
            ${step.title}
          </h3>
        </div>

        <!-- Body -->
        <p class="text-white/75 text-sm leading-relaxed">${step.body}</p>

        <!-- Action hint -->
        ${step.completionEvent && !step.manualCta
          ? html`
              <div
                class="flex items-center gap-2 text-violet-400 text-xs animate-pulse"
              >
                <span>👆</span>
                <span>Perform the action above to continue automatically</span>
              </div>
            `
          : nothing}
        ${step.completionPoll
          ? html`
              <div class="flex items-center gap-2 text-violet-400 text-xs">
                <span class="animate-spin">⟳</span>
                <span>Watching for your progress…</span>
              </div>
            `
          : nothing}

        <!-- Buttons -->
        <div class="flex gap-2 mt-1">
          ${this.stepIndex > 0
            ? html`
                <button
                  @click=${() => {
                    this.detachAllListeners();
                    this.stopPoll();
                    this.stepIndex--;
                    saveStep(this.stepIndex);
                    this.attachStepListeners();
                    this.startPoll();
                  }}
                  class="px-3 py-1.5 rounded-lg text-xs text-white/50 hover:text-white/80 border border-white/10 hover:border-white/25 transition-colors"
                >
                  ← Back
                </button>
              `
            : nothing}

          <div class="flex-1"></div>

          ${step.manualCta
            ? html`
                <button
                  @click=${() => this.next()}
                  class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
                  style="background:linear-gradient(135deg,#7c3aed,#6366f1);box-shadow:0 2px 12px rgba(124,58,237,0.4);"
                >
                  ${step.manualCta}
                </button>
              `
            : html`
                <button
                  @click=${() => this.next()}
                  class="px-4 py-1.5 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 border border-white/10 hover:border-white/25 transition-colors"
                >
                  Skip step →
                </button>
              `}
        </div>
      </div>
    `;
  }

  private renderCompletionCard() {
    return html`
      <div
        class="fixed inset-0 flex items-center justify-center"
        style="z-index:9999;background:rgba(0,0,0,0.8);pointer-events:auto;"
      >
        <div
          class="rounded-2xl border border-white/10 p-8 flex flex-col items-center gap-4 max-w-sm text-center"
          style="background:rgba(18,18,28,0.97);backdrop-filter:blur(12px);"
        >
          <div class="text-5xl">🏆</div>
          <h2 class="text-white text-2xl font-bold">Tour Complete!</h2>
          <p class="text-white/70 text-sm leading-relaxed">
            You've learned every layer — from spawn to nukes. Now go build an
            empire. The Learning Path in the nav has deeper tips whenever you
            need them.
          </p>
          <button
            @click=${() => this.deactivate()}
            class="mt-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
            style="background:linear-gradient(135deg,#7c3aed,#6366f1);"
          >
            Let's play →
          </button>
        </div>
      </div>
    `;
  }
}

// Expose singleton accessor for OnboardingModal to call
export function getTourOverlay(): TourOverlay | null {
  return document.querySelector("tour-overlay") as TourOverlay | null;
}
