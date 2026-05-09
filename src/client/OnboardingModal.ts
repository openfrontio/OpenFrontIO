import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import "./components/baseComponents/Modal";
import { getTourOverlay } from "./TourOverlay";

const STORAGE_KEY = "openfront-onboarding-v1";
const SHOWN_KEY = "openfront-onboarding-shown";

// ─────────────────────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────────────────────

type Track = "beginner" | "intermediate" | "advanced";

interface OnboardingStep {
  id: number;
  track: Track;
  icon: string;
  title: string;
  subtitle: string;
  tips: string[];
  videoUrl?: string;
  videoLabel?: string;
}

const STEPS: OnboardingStep[] = [
  // ── BEGINNER ────────────────────────────────────────────────────────────────
  {
    id: 0,
    track: "beginner",
    icon: "🌍",
    title: "The Goal: World Domination",
    subtitle:
      "OpenFront is a real-time browser strategy game. Your mission: conquer 80% of the map before anyone else does.",
    tips: [
      "Reach 80% of the map's territory to win. Lose all your territory and you're eliminated.",
      "The game runs in real time — there are no turns. Keep your eye on the action.",
      "You start as a tiny nation and expand by clicking adjacent enemy or neutral tiles.",
      "Gold and troops are your two key resources — everything you build costs one or both.",
    ],
    videoUrl: "https://www.youtube.com/embed/8bxcAsJJXJg",
    videoLabel: "Ultimate Beginner's Guide",
  },
  {
    id: 1,
    track: "beginner",
    icon: "📍",
    title: "Picking Your Spawn",
    subtitle:
      "Where you start matters enormously. The right spawn gives you space to breathe while everyone else fights.",
    tips: [
      "Prefer plains / grasslands (green terrain) — cheapest and fastest to capture.",
      "Avoid the extreme edge of the map: you'll only be able to expand in 1–2 directions.",
      "Center spawns allow 360° expansion but attract more neighbors — good for diplomacy.",
      "Highlands and mountains are slow and expensive early; save them for mid-game fortification.",
      "Look for a spawn with a coast nearby — ports will be crucial later.",
    ],
    videoUrl: "https://www.youtube.com/embed/EdcdsayA_ac?start=375",
    videoLabel: "Picking a Spot (Ultimus_Rex Guide)",
  },
  {
    id: 2,
    track: "beginner",
    icon: "⚔️",
    title: "Troops & Attack Ratio",
    subtitle:
      "The attack ratio slider controls how many troops you commit to each offensive. Mastering it is the difference between a steady conquest and a catastrophic overextension.",
    tips: [
      "Start attacks at ~30% ratio. Going all-in early leaves you exposed to neighbors.",
      "Your population recovers fastest when it sits at 40–50% of your cap — don't drain it.",
      "NEVER send 100% of your troops at once. You will be wiped out by a third party.",
      "The blue bar (bottom-left) shows troops vs. workers — more workers = more gold income.",
      "Raise the ratio for a finishing blow; lower it when you need fast recovery.",
    ],
    videoUrl: "https://www.youtube.com/embed/fKCWgr5_nwo",
    videoLabel: "How to Play (Enzo Plays Beginner Tutorial)",
  },
  {
    id: 3,
    track: "beginner",
    icon: "🏙️",
    title: "Economy: Cities & Workers",
    subtitle:
      "Cities are your power ceiling. Every city you build or capture raises your max population — which directly raises how many troops you can field.",
    tips: [
      "Each city adds 25,000 to your population cap. More cities = larger army ceiling.",
      "Workers generate gold passively. Keeping some workers alive is crucial for sustained growth.",
      "Build your first city in a safe interior tile — not on a contested border.",
      "Gold unlocks everything: buildings, nukes, warships. A broke nation can't compete.",
      "Capturing an enemy's territory inherits all their gold. Rich enemies are worth targeting.",
    ],
    videoUrl: "https://www.youtube.com/embed/fKCWgr5_nwo?start=300",
    videoLabel: "City Importance (Enzo Plays)",
  },
  {
    id: 4,
    track: "beginner",
    icon: "🤖",
    title: "Bots vs. Nations — Easy Prey First",
    subtitle:
      "Not every opponent is equal. Bots are easy targets for early expansion. Learn to tell them apart and prioritize accordingly.",
    tips: [
      "Bots don't counter-attack aggressively — ideal for your first land grabs.",
      "Encircling a bot (surrounding it on all sides) makes it surrender without a fight.",
      "Nations (AI with flags) are harder — only attack them when you massively outnumber them.",
      "Human players are the most dangerous. Ally with them early when possible.",
      "Clearing nearby bots fast creates a secure base before the mid-game fights start.",
    ],
    videoUrl: "https://www.youtube.com/embed/EdcdsayA_ac?start=510",
    videoLabel: "Bot Taking Strategy (Ultimus_Rex)",
  },

  // ── INTERMEDIATE ─────────────────────────────────────────────────────────────
  {
    id: 5,
    track: "intermediate",
    icon: "📈",
    title: "The 42% Rule: Population Science",
    subtitle:
      "Population growth follows a bell curve. It peaks at roughly 42% of your max cap — understanding this is what separates casual players from consistent winners.",
    tips: [
      "Your pop grows fastest at ~42% of your max cap. Don't sit at 1% or 99%.",
      "Conquer territory AND build cities to keep raising your cap — that raises your actual troop ceiling.",
      "Watch the growth color: green = accelerating, yellow = slowing. Adjust your aggression accordingly.",
      "After a big attack that drains you, wait for recovery before launching the next one.",
      "City count is the best proxy for long-term power. Count your cities, count theirs.",
    ],
    videoUrl: "https://www.youtube.com/embed/9LOx9lFJn6I",
    videoLabel: "Population Mechanics Deep-Dive (Enzo Plays)",
  },
  {
    id: 6,
    track: "intermediate",
    icon: "🤝",
    title: "Alliances & the Traitor Mechanic",
    subtitle:
      "Diplomacy can win games. But alliances can also be broken — and the game punishes betrayal with a combat debuff.",
    tips: [
      "Right-click an ally's territory to request/accept an alliance. Allied players can't attack each other.",
      "Breaking an alliance gives you the Traitor debuff — your attack efficiency drops significantly.",
      "Best practice: ally non-threatening neighbors, then break only when you can guarantee a fast kill.",
      "Trade ships from allied ports generate passive income — a financial incentive to stay friendly.",
      "A strong alliance network acts as a deterrent. Others are less likely to attack a well-connected player.",
    ],
    videoUrl: "https://www.youtube.com/embed/1fpszw34sQg",
    videoLabel: "Diplomacy Guide (Risk4Ever)",
  },
  {
    id: 7,
    track: "intermediate",
    icon: "🏗️",
    title: "Buildings Deep Dive",
    subtitle:
      "Four core structures define your mid-game. Know when to build each one — and in what order.",
    tips: [
      "🏙️ Cities (cheapest): Raise max pop cap. Build in safe interior tiles first.",
      "⚓ Ports (250k gold): Generate trade-ship income. Build once you have a coastline.",
      "🛡️ Defense Posts: +5× defensive multiplier on that tile. Place on vulnerable border tiles.",
      "🚀 SAM Launchers: Intercept incoming nukes. Essential once anyone on the map has silos.",
      "Recommended build order: Cities → Ports → Defense Posts → SAM Launchers.",
    ],
    videoUrl: "https://www.youtube.com/embed/jvHEvbko3uw",
    videoLabel: "Buildings Overview",
  },
  {
    id: 8,
    track: "intermediate",
    icon: "🗺️",
    title: "Border Warfare & Chokepoints",
    subtitle:
      "Your attack speed is directly proportional to your shared border with the enemy. Longer borders = faster conquest — but also more exposure.",
    tips: [
      "Larger shared borders mean you send more troops per tick into the fight.",
      "Chokepoints (narrow land bridges, mountain passes) are natural defense lines. Hold them.",
      "Once one border is secure, redirect ALL surplus forces to the active fight.",
      "Multi-front attacks force the enemy to split their defense — they can't hold everywhere.",
      "Never fight on two human-player fronts simultaneously early — consolidate first.",
    ],
    videoUrl: "https://www.youtube.com/embed/EdcdsayA_ac?start=660",
    videoLabel: "Mid-game Strategy (Ultimus_Rex)",
  },
  {
    id: 9,
    track: "intermediate",
    icon: "🌊",
    title: "Naval Warfare Basics",
    subtitle:
      "Ports unlock an entirely separate dimension of the game. Trade ships earn you money; warships let you bypass land defenses entirely.",
    tips: [
      "Build a port as soon as you control a coastline. Trade ships generate passive gold.",
      "Up to 150 trade ships can be active at once — longer routes between allied ports = more gold.",
      "Warships bombard adjacent land tiles. Use them to soften coastal cities before a land push.",
      "Destroyers hunt enemy trade ships — economic warfare can cripple a rich opponent.",
      "Battleships are the strongest offensive naval unit. Protect them; they're expensive.",
    ],
    videoUrl: "https://www.youtube.com/embed/jvHEvbko3uw?start=120",
    videoLabel: "Ports & Naval Units",
  },

  // ── ADVANCED ────────────────────────────────────────────────────────────────
  {
    id: 10,
    track: "advanced",
    icon: "💣",
    title: "Nuclear Strategy",
    subtitle:
      "Nukes change the game the moment the first silo is built. Whether you're launching or defending, you need a nuclear doctrine before you need it.",
    tips: [
      "Atom Bomb: best vs. dense city clusters. Targeted, relatively cheap.",
      "Hydrogen Bomb: massive area devastation. Reserve for eliminating a dominant top player.",
      "MIRV: fires multiple warheads — SAMs can't intercept all of them. The finisher.",
      "SAM Launchers auto-target the nearest incoming nuke. Spread your nukes to overwhelm SAM coverage.",
      "Don't launch nukes reactively. Plan each strike: target high-density cities, not empty wilderness.",
    ],
    videoUrl: "https://www.youtube.com/embed/EdcdsayA_ac?start=35",
    videoLabel: "Nuclear Weapons (Ultimus_Rex)",
  },
  {
    id: 11,
    track: "advanced",
    icon: "🎯",
    title: "Multi-Front Coordination",
    subtitle:
      "The difference between a good player and a great one: great players never fight a fair fight. They always bring overwhelming force to a single front while keeping everyone else quiet.",
    tips: [
      "Attack 2–3 enemy borders at the same time — they can't reinforce all of them.",
      "Coordinate timing with allies: if you hit the north while they hit the south, the enemy collapses.",
      "Keep a token defense on your safe borders — just enough to deter, everything else goes to offense.",
      "After eliminating a player, pause briefly to absorb their gold before the next offensive.",
      "Target the weakest player first, not the strongest — snowball momentum matters.",
    ],
  },
  {
    id: 12,
    track: "advanced",
    icon: "👑",
    title: "Endgame: Closing Out the Win",
    subtitle:
      "Past 60% map control, you're the target. Everyone else will unite against you. The endgame is as much about politics as firepower.",
    tips: [
      "Keep at least one strong ally alive — they divide enemy attention and absorb attacks meant for you.",
      "Use MIRVs to eliminate the top 2 threats, then conventional forces to clean up the rest.",
      "The 80% win threshold means you don't need to eliminate everyone — just dominate the land.",
      "Avoid overextension: holding a huge front line is expensive and risky. Consolidate first.",
      "Watch for the coalition forming — break it by offering the weakest member a better deal.",
    ],
    videoUrl: "https://www.youtube.com/embed/EdcdsayA_ac?start=775",
    videoLabel: "Post-nuclear Endgame (Ultimus_Rex)",
  },
];

const TRACK_META: Record<Track, { label: string; color: string; bg: string }> =
  {
    beginner: {
      label: "Beginner",
      color: "text-emerald-400",
      bg: "bg-emerald-500/20 border-emerald-500/30",
    },
    intermediate: {
      label: "Intermediate",
      color: "text-blue-400",
      bg: "bg-blue-500/20 border-blue-500/30",
    },
    advanced: {
      label: "Advanced",
      color: "text-amber-400",
      bg: "bg-amber-500/20 border-amber-500/30",
    },
  };

// ─────────────────────────────────────────────────────────────────────────────
// Persistence helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadProgress(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as number[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveProgress(completed: Set<number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
  } catch {
    /* ignore */
  }
}

export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(SHOWN_KEY) === "true";
}

function markOnboardingShown() {
  localStorage.setItem(SHOWN_KEY, "true");
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

@customElement("onboarding-modal")
export class OnboardingModal extends BaseModal {
  @state() private currentStep = 0;
  @state() private completed: Set<number> = new Set();
  @state() private videoOpen = false;

  constructor() {
    super();
    this.completed = loadProgress();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  protected onOpen(): void {
    markOnboardingShown();
    this.videoOpen = false;
  }

  protected onClose(): void {
    this.videoOpen = false;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private goTo(index: number) {
    this.currentStep = Math.max(0, Math.min(STEPS.length - 1, index));
    this.videoOpen = false;
  }

  private markComplete(id: number) {
    this.completed = new Set([...this.completed, id]);
    saveProgress(this.completed);
    // Auto-advance to next step
    if (this.currentStep < STEPS.length - 1) {
      this.currentStep += 1;
    }
    this.videoOpen = false;
  }

  private toggleVideo() {
    this.videoOpen = !this.videoOpen;
  }

  private resetProgress() {
    this.completed = new Set();
    saveProgress(this.completed);
    this.currentStep = 0;
    this.videoOpen = false;
  }

  private startTour() {
    const tour = getTourOverlay();
    if (tour) {
      tour.activate(0);
      this.close();
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private renderTrackBadge(track: Track) {
    const meta = TRACK_META[track];
    return html`<span
      class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${meta.bg} ${meta.color}"
    >
      ${meta.label}
    </span>`;
  }

  private renderSidebarStep(step: OnboardingStep, idx: number) {
    const isCurrent = this.currentStep === idx;
    const isDone = this.completed.has(step.id);
    const meta = TRACK_META[step.track];

    return html`
      <button
        @click=${() => this.goTo(idx)}
        class="w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center gap-3 group
          ${isCurrent
          ? "bg-white/10 border border-white/20"
          : "hover:bg-white/5 border border-transparent"}"
      >
        <!-- check / icon -->
        <span class="shrink-0 w-7 h-7 flex items-center justify-center rounded-full
          ${isDone ? "bg-emerald-500/20 text-emerald-400" : isCurrent ? "bg-white/10 text-white" : "text-white/40"}">
          ${isDone
          ? html`<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
              </svg>`
          : html`<span class="text-sm">${step.icon}</span>`}
        </span>

        <!-- title -->
        <span class="flex-1 min-w-0">
          <span class="block text-xs font-semibold truncate
            ${isCurrent ? "text-white" : isDone ? "text-white/60 line-through" : "text-white/70 group-hover:text-white/90"}">
            ${step.title}
          </span>
          <span class="block text-[10px] mt-0.5 ${meta.color}">${meta.label}</span>
        </span>
      </button>
    `;
  }

  private renderStepContent(step: OnboardingStep) {
    const isDone = this.completed.has(step.id);
    const isFirst = this.currentStep === 0;
    const isLast = this.currentStep === STEPS.length - 1;
    const meta = TRACK_META[step.track];
    const totalDone = this.completed.size;
    const allDone = totalDone === STEPS.length;

    return html`
      <div class="flex flex-col h-full overflow-hidden">

        <!-- Header -->
        <div class="shrink-0 px-5 pt-5 pb-4 border-b border-white/10">
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-center gap-3">
              <span class="text-3xl">${step.icon}</span>
              <div>
                <div class="flex items-center gap-2 mb-1">
                  ${this.renderTrackBadge(step.track)}
                  <span class="text-white/30 text-xs">Step ${this.currentStep + 1} of ${STEPS.length}</span>
                </div>
                <h2 class="text-lg font-bold text-white leading-tight">${step.title}</h2>
              </div>
            </div>
            ${isDone
          ? html`<span class="shrink-0 flex items-center gap-1 text-emerald-400 text-xs font-bold">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                </svg>
                Done
              </span>`
          : nothing}
          </div>
        </div>

        <!-- Body -->
        <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5
          scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">

          <!-- Subtitle -->
          <p class="text-white/70 text-sm leading-relaxed">${step.subtitle}</p>

          <!-- Tips -->
          <div class="space-y-2">
            <h3 class="text-xs font-bold uppercase tracking-widest ${meta.color}">Key Tips</h3>
            <ul class="space-y-2">
              ${step.tips.map(
          (tip) => html`
                  <li class="flex items-start gap-2 text-sm text-white/80 leading-relaxed">
                    <span class="shrink-0 mt-1 w-4 h-4 rounded-full ${meta.bg} border flex items-center justify-center">
                      <svg class="w-2.5 h-2.5 ${meta.color}" fill="currentColor" viewBox="0 0 8 8">
                        <circle cx="4" cy="4" r="3"/>
                      </svg>
                    </span>
                    ${tip}
                  </li>
                `,
        )}
            </ul>
          </div>

          <!-- Video section -->
          ${step.videoUrl
          ? html`
              <div>
                <button
                  @click=${this.toggleVideo}
                  class="flex items-center gap-2 text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
                  </svg>
                  ${this.videoOpen ? "Hide Video" : `Watch: ${step.videoLabel ?? "Tutorial Video"}`}
                </button>
                ${this.videoOpen
            ? html`
                    <div class="mt-3 rounded-xl overflow-hidden border border-white/10 aspect-video">
                      <iframe
                        class="w-full h-full"
                        src="${step.videoUrl}"
                        title="Tutorial Video"
                        frameborder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen
                      ></iframe>
                    </div>
                  `
            : nothing}
              </div>
            `
          : nothing}

          <!-- All-done celebration -->
          ${allDone
          ? html`
              <div class="rounded-xl p-4 bg-emerald-500/10 border border-emerald-500/20 text-center">
                <div class="text-2xl mb-1">🎖️</div>
                <p class="text-emerald-300 font-bold text-sm">All ${STEPS.length} lessons complete!</p>
                <p class="text-white/50 text-xs mt-1">You've gone from recruit to commander. Now go win some games.</p>
                <button
                  @click=${this.resetProgress}
                  class="mt-3 text-xs text-white/30 hover:text-white/60 transition-colors underline"
                >Reset progress</button>
              </div>
            `
          : nothing}
        </div>

        <!-- Footer nav -->
        <div class="shrink-0 px-5 py-4 border-t border-white/10 flex items-center justify-between gap-3">
          <button
            ?disabled=${isFirst}
            @click=${() => this.goTo(this.currentStep - 1)}
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white/60 hover:text-white
              hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
            Prev
          </button>

          ${isDone
          ? html`
              <button
                @click=${() => this.goTo(this.currentStep + 1)}
                ?disabled=${isLast}
                class="flex-1 px-4 py-2 rounded-lg text-sm font-bold bg-white/5 hover:bg-white/10
                  text-white/60 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ${isLast ? "All done 🎖️" : "Next lesson →"}
              </button>
            `
          : html`
              <button
                @click=${() => this.markComplete(step.id)}
                class="flex-1 px-4 py-2 rounded-lg text-sm font-bold
                  bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300
                  border border-emerald-500/30 transition-all"
              >
                ✓ Mark Complete
              </button>
            `}

          <button
            ?disabled=${isLast}
            @click=${() => this.goTo(this.currentStep + 1)}
            class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white/60 hover:text-white
              hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  private renderProgressBar() {
    const totalDone = this.completed.size;
    const pct = Math.round((totalDone / STEPS.length) * 100);

    const tracks: Track[] = ["beginner", "intermediate", "advanced"];

    return html`
      <div class="shrink-0 px-5 py-3 border-b border-white/10">
        <!-- Track pills -->
        <div class="flex items-center gap-2 mb-2">
          ${tracks.map((t) => {
      const meta = TRACK_META[t];
      const trackSteps = STEPS.filter((s) => s.track === t);
      const trackDone = trackSteps.filter((s) => this.completed.has(s.id)).length;
      const allTrackDone = trackDone === trackSteps.length;
      return html`
              <span class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border
                ${allTrackDone ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400" : `${meta.bg} ${meta.color}`}">
                ${allTrackDone ? "✓ " : ""}${meta.label} ${trackDone}/${trackSteps.length}
              </span>
            `;
    })}
          <span class="ml-auto text-xs text-white/30 font-mono">${pct}%</span>
        </div>
        <!-- Bar -->
        <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-emerald-500 via-blue-500 to-amber-500"
            style="width: ${pct}%"
          ></div>
        </div>
        <!-- Interactive tour CTA -->
        <button
          @click=${() => this.startTour()}
          class="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white transition-all"
          style="background:linear-gradient(135deg,#7c3aed,#6366f1);box-shadow:0 2px 12px rgba(124,58,237,0.3);"
        >
          🎮 Start Interactive Tour — play & learn in real-time
        </button>
      </div>
    `;
  }

  render() {
    const step = STEPS[this.currentStep];

    const content = html`
      <div class="${this.modalContainerClass} flex flex-row">

        <!-- Sidebar -->
        <div class="hidden md:flex flex-col w-56 shrink-0 border-r border-white/10 overflow-hidden">
          <!-- Header -->
          <div class="px-4 pt-4 pb-3 border-b border-white/10 flex items-center gap-2 shrink-0">
            <span class="text-lg">🎓</span>
            <div>
              <p class="text-xs font-bold text-white/90 uppercase tracking-widest">Learning Path</p>
              <p class="text-[10px] text-white/40">${this.completed.size}/${STEPS.length} complete</p>
            </div>
            <button
              @click=${() => this.close()}
              class="ml-auto text-white/30 hover:text-white/70 transition-colors text-lg leading-none"
              aria-label="Close"
            >✕</button>
          </div>

          <!-- Step list -->
          <div class="flex-1 overflow-y-auto px-2 py-2 space-y-0.5
            scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
            ${STEPS.map((s, i) => this.renderSidebarStep(s, i))}
          </div>
        </div>

        <!-- Main content -->
        <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
          <!-- Mobile close -->
          <div class="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-lg">🎓</span>
              <p class="text-xs font-bold text-white/90 uppercase tracking-widest">Learning Path</p>
            </div>
            <button
              @click=${() => this.close()}
              class="text-white/30 hover:text-white/70 transition-colors text-lg leading-none"
              aria-label="Close"
            >✕</button>
          </div>

          ${this.renderProgressBar()}
          ${this.renderStepContent(step)}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="onboardingModal"
        title="Learning Path"
        ?hideHeader=${true}
        ?hideCloseButton=${true}
      >
        ${content}
      </o-modal>
    `;
  }
}
