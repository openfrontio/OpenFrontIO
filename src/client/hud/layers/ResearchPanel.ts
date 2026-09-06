import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import {
  BASE_RESEARCH_COST,
  RESEARCH_TYPES,
  researchBonusBasisPoints,
  researchFirstLevelBasisPoints,
  researchProductionBasisPoints,
  researchRequirement,
  ResearchType,
} from "../../../core/game/Research";
import { Controller } from "../../Controller";
import { PurchaseResearchIntentEvent } from "../../Transport";
import { renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";
import { researchIcons } from "../ResearchIcons";

@customElement("research-panel")
export class ResearchPanel extends LitElement implements Controller {
  public game!: GameView;
  public eventBus!: EventBus;
  @state() private open = false;

  createRenderRoot() {
    return this;
  }

  tick(): void {
    this.requestUpdate();
  }

  render() {
    const player = this.game?.myPlayer();
    if (!player || this.game.inSpawnPhase() || !player.isAlive()) return null;

    const readonly = this.game.config().isReplay();
    const snapshot = player.state.research;
    const points = snapshot?.points ?? 0n;
    const facilityLevels = player.totalUnitLevels(UnitType.ResearchFacility);
    const productionBasisPoints = researchProductionBasisPoints(
      facilityLevels,
      player.researchLevel(ResearchType.Scientific),
    );

    return html`
      <button
        class="h-10 px-3 flex items-center gap-2 rounded-bl-lg min-[1200px]:rounded-lg bg-gray-800/92 hover:bg-cyan-800 backdrop-blur-sm shadow-xs text-white text-sm pointer-events-auto"
        title=${translateText("research.title")}
        aria-label=${translateText("research.title")}
        @click=${() => (this.open = true)}
      >
        <img
          class="size-5"
          src=${researchIcons[ResearchType.Scientific]}
          alt=""
        />
        <span class="hidden sm:inline">${translateText("research.title")}</span>
        <span class="font-semibold text-cyan-300">${renderNumber(points)}</span>
      </button>
      ${this.open
        ? html`
            <div
              class="fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center p-3 pointer-events-auto"
              @click=${(event: Event) => {
                if (event.target === event.currentTarget) this.open = false;
              }}
            >
              <section
                class="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg bg-gray-900 text-white shadow-2xl p-4"
              >
                <header class="flex justify-between items-start gap-3 mb-3">
                  <div>
                    <h2 class="text-xl font-bold">
                      ${translateText("research.title")}
                    </h2>
                    <p class="text-sm text-cyan-300 tabular-nums">
                      ${renderNumber(points)}
                      ${translateText("research.points")} ·
                      ${this.renderRate(productionBasisPoints)}
                      ${translateText("research.points_per_second")}
                    </p>
                    <p class="text-xs text-gray-400">
                      ${translateText("research.facility_levels")}:
                      ${facilityLevels}
                    </p>
                  </div>
                  <button
                    class="text-2xl px-2"
                    aria-label=${translateText("common.close")}
                    @click=${() => (this.open = false)}
                  >
                    ×
                  </button>
                </header>
                <div
                  class="divide-y divide-white/10 rounded border border-white/15 bg-gray-800/50"
                >
                  ${RESEARCH_TYPES.map((type) =>
                    this.renderBranch(type, points, readonly),
                  )}
                </div>
                ${readonly
                  ? html`<p class="mt-3 text-sm text-amber-300">
                      ${translateText("research.replay_readonly")}
                    </p>`
                  : null}
              </section>
            </div>
          `
        : null}
    `;
  }

  private renderBranch(type: ResearchType, points: bigint, readonly: boolean) {
    const snapshot = this.game.myPlayer()!.state.research;
    if (!snapshot) return null;

    const level = snapshot.levels[type];
    const cost = researchRequirement(BASE_RESEARCH_COST, level);
    const firstLevelBonus = researchFirstLevelBasisPoints(type);
    const currentBonus = researchBonusBasisPoints(level, firstLevelBonus) / 100;
    const nextBonus =
      researchBonusBasisPoints(level + 1, firstLevelBonus) / 100;
    const affordable = points >= cost;
    const progress =
      cost === 0n
        ? 100
        : Math.min(100, Number((points * 10_000n) / cost) / 100);

    return html`
      <article
        class="grid gap-3 p-3 grid-cols-[2.5rem_minmax(0,1fr)] items-start"
      >
        <img
          class="size-9 rounded bg-gray-950/50 p-1.5"
          src=${researchIcons[type]}
          alt=""
        />
        <div class="min-w-0">
          <div class="flex justify-between gap-2">
            <strong>${translateText(`research.${type}`)}</strong>
            <span class="text-sm whitespace-nowrap">
              ${translateText("research.level")} ${level}
            </span>
          </div>
          <div class="flex justify-between gap-2 text-xs mb-2">
            <span class="text-cyan-300">+${currentBonus.toFixed(2)}%</span>
            <span class="text-gray-400">
              ${translateText("research.next_bonus")}: +${nextBonus.toFixed(2)}%
            </span>
          </div>
          <div class="h-2 rounded bg-gray-700 overflow-hidden">
            <div
              class="h-full ${affordable ? "bg-green-500" : "bg-cyan-500"}"
              style=${`width:${progress}%`}
            ></div>
          </div>
          <div class="mt-2 flex items-center justify-between gap-3">
            <span class="text-xs text-gray-400 tabular-nums">
              ${translateText("research.cost")}: ${renderNumber(cost)}
              ${translateText("research.points")}
            </span>
            <button
              type="button"
              class="rounded px-3 py-1.5 text-sm font-semibold ${affordable &&
              !readonly
                ? "bg-cyan-700 hover:bg-cyan-600 text-white"
                : "bg-gray-700 text-gray-400 cursor-not-allowed"}"
              ?disabled=${readonly || !affordable}
              @click=${() => this.purchase(type)}
            >
              ${translateText("research.purchase")}
            </button>
          </div>
        </div>
      </article>
    `;
  }

  private renderRate(productionBasisPoints: bigint): string {
    const whole = productionBasisPoints / 10_000n;
    const hundredths = (productionBasisPoints % 10_000n) / 100n;
    return `${whole}.${hundredths.toString().padStart(2, "0")}`;
  }

  private purchase(type: ResearchType): void {
    this.eventBus.emit(new PurchaseResearchIntentEvent(type));
  }
}
