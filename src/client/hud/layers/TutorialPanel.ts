import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerType, UnitType } from "../../../core/game/Game";
import { UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";
import { PlayerView } from "../../view/PlayerView";
import {
  TutorialContext,
  TutorialHighlight,
  TutorialHighlightEvent,
  TutorialProgress,
  TutorialStateEvent,
} from "./Tutorial";

/** How often (in ticks) to ask the worker for the current city cost. */
const CITY_COST_POLL_TICKS = 10;
/** Ticks the "you're ready" message stays up before the panel closes. */
const COMPLETE_LINGER_TICKS = 50;

@customElement("tutorial-panel")
export class TutorialPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public userSettings: UserSettings;

  @state() private active = false;
  @state() private confirmingClose = false;
  @state() private ctx: TutorialContext | null = null;

  private progress = new TutorialProgress();
  private started = false;
  private cityCost: bigint | null = null;
  private completeTicks: number | null = null;
  private highlight: TutorialHighlight | null = null;

  createRenderRoot() {
    return this;
  }

  tick() {
    // Deferred to the first tick so every controller's init() has already
    // subscribed to TutorialStateEvent.
    if (!this.started) {
      this.started = true;
      this.setActive(!this.userSettings.tutorialDismissed());
    }
    if (!this.active) return;

    const player = this.game.myPlayer();
    if (
      this.game.config().isReplay() ||
      player === null ||
      (player.hasSpawned() && !player.isAlive())
    ) {
      this.setActive(false);
      return;
    }

    if (this.completeTicks !== null) {
      if (++this.completeTicks >= COMPLETE_LINGER_TICKS) this.dismissForever();
      return;
    }

    if (this.game.ticks() % CITY_COST_POLL_TICKS === 0) {
      player.buildables(undefined, [UnitType.City]).then((buildables) => {
        this.cityCost =
          buildables.find((b) => b.type === UnitType.City)?.cost ?? null;
      });
    }

    const ctx = this.buildContext(player);
    this.progress.update(ctx);
    this.ctx = ctx;

    if (this.progress.finished()) {
      this.completeTicks = 0;
      this.setHighlight(null);
      return;
    }
    const step = this.progress.current();
    this.setHighlight(
      step && !this.progress.stepDone() ? (step.highlight ?? null) : null,
    );
  }

  private buildContext(player: PlayerView): TutorialContext {
    const attacks = player.outgoingAttacks();
    return {
      hasSpawned: player.hasSpawned(),
      attacking: attacks.length > 0,
      attackingBot: attacks.some((a) => this.isBot(a.targetID)),
      botsExist: this.game
        .playerViews()
        .some((p) => p.type() === PlayerType.Bot && p.isAlive()),
      gold: player.gold(),
      cityCost: this.cityCost,
      cityDisabled: this.game.config().isUnitDisabled(UnitType.City),
      cities: player.units(UnitType.City).length,
    };
  }

  private isBot(smallID: number): boolean {
    if (smallID === 0) return false;
    try {
      const target = this.game.playerBySmallID(smallID);
      return target.isPlayer() && target.type() === PlayerType.Bot;
    } catch {
      return false;
    }
  }

  private setHighlight(target: TutorialHighlight | null) {
    if (this.highlight === target) return;
    this.highlight = target;
    this.eventBus.emit(new TutorialHighlightEvent(target));
  }

  private setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.setHighlight(null);
    this.eventBus.emit(new TutorialStateEvent(active));
  }

  private dismissForever() {
    this.userSettings.setTutorialDismissed(true);
    this.setActive(false);
  }

  render() {
    if (!this.active) return nothing;
    return html`
      <div
        class="fixed z-[210] pointer-events-auto w-[min(20rem,calc(100vw-1rem))] rounded-lg bg-gray-800/92 backdrop-blur-sm shadow-lg text-white text-sm p-3 top-14 left-1/2 -translate-x-1/2 lg:top-auto lg:left-4 lg:bottom-4 lg:translate-x-0"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="font-bold text-cyber-yellow uppercase tracking-wide"
            >${translateText("tutorial.title")}</span
          >
          <span class="flex items-center gap-2 text-xs text-gray-300">
            ${this.ctx && !this.progress.finished()
              ? translateText("tutorial.step_counter", {
                  current: this.progress.position(this.ctx),
                  total: this.progress.total(this.ctx),
                })
              : nothing}
            <button
              class="text-gray-400 hover:text-white text-base leading-none px-1"
              title=${translateText("tutorial.close")}
              aria-label=${translateText("tutorial.close")}
              @click=${() => (this.confirmingClose = !this.confirmingClose)}
            >
              ✕
            </button>
          </span>
        </div>
        ${this.confirmingClose ? this.renderCloseChoice() : this.renderStep()}
      </div>
    `;
  }

  private renderCloseChoice() {
    return html`
      <div class="flex flex-col gap-1.5">
        <button
          class="rounded-md border border-gray-500 hover:bg-gray-700 px-2 py-1"
          @click=${() => this.setActive(false)}
        >
          ${translateText("tutorial.hide_for_game")}
        </button>
        <button
          class="rounded-md border border-gray-500 hover:bg-gray-700 px-2 py-1"
          @click=${() => this.dismissForever()}
        >
          ${translateText("tutorial.never_show")}
        </button>
      </div>
    `;
  }

  private renderStep() {
    if (this.completeTicks !== null) {
      return html`<p>${translateText("tutorial.complete")}</p>`;
    }
    const step = this.progress.current();
    if (step === null) return nothing;
    const done = this.progress.stepDone();
    return html`
      <p class="flex gap-1.5 ${done ? "text-green-400" : ""}">
        <span class="shrink-0">${done ? "✓" : "▸"}</span>
        <span
          >${translateText(`tutorial.step.${step.id}`, {
            cost: renderNumber(this.cityCost ?? 0n),
          })}</span
        >
      </p>
      ${step.manual && !done
        ? html`<button
            class="mt-2 rounded-md bg-malibu-blue hover:bg-aquarius px-3 py-1 font-semibold"
            @click=${() => this.progress.acknowledge()}
          >
            ${translateText("tutorial.got_it")}
          </button>`
        : nothing}
    `;
  }
}
