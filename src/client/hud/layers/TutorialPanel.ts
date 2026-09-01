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
  TutorialStep,
} from "./Tutorial";

/** How often (in ticks) to ask the worker for the current city cost. */
const CITY_COST_POLL_TICKS = 10;
/** Ticks the "you're ready" message stays up before the panel closes. */
const COMPLETE_LINGER_TICKS = 50;

/** Defaults shown when the player hasn't rebound the action (see UnitDisplay). */
const HOTKEY_FALLBACKS = {
  buildCity: "1",
  buildFactory: "2",
  buildPort: "3",
} as const;

@customElement("tutorial-panel")
export class TutorialPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public userSettings: UserSettings;

  @state() private active = false;
  @state() private confirmingClose = false;
  @state() private ctx: TutorialContext | null = null;
  /** Viewport position once the player has dragged the panel; null = docked. */
  @state() private dragPos: { x: number; y: number } | null = null;
  private dragOffset: { x: number; y: number } | null = null;

  private progress = new TutorialProgress();
  private started = false;
  private cityCost: bigint | null = null;
  private keybinds: Record<string, { key?: string }> | null = null;
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
      portDisabled: this.game.config().isUnitDisabled(UnitType.Port),
      ports: player.units(UnitType.Port).length,
      factoryDisabled: this.game.config().isUnitDisabled(UnitType.Factory),
      factories: player.units(UnitType.Factory).length,
    };
  }

  private hotkeyFor(step: TutorialStep): string {
    if (!step.hotkey) return "";
    this.keybinds ??= this.userSettings.parsedUserKeybinds();
    return this.keybinds[step.hotkey]?.key ?? HOTKEY_FALLBACKS[step.hotkey];
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
    // The host sits in the top-right flex stack; leave the flow when hidden
    // so it doesn't add a gap under the control bar.
    this.classList.toggle("hidden", !active);
    if (!active) this.setHighlight(null);
  }

  private dismissForever() {
    this.userSettings.setTutorialDismissed(true);
    this.setActive(false);
  }

  private onDragStart(e: PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    const panel = e.currentTarget as HTMLElement;
    const rect = panel.parentElement!.getBoundingClientRect();
    this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    panel.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private onDragMove(e: PointerEvent) {
    if (this.dragOffset === null) return;
    const panel = (e.currentTarget as HTMLElement).parentElement!;
    const maxX = window.innerWidth - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;
    this.dragPos = {
      x: Math.max(0, Math.min(maxX, e.clientX - this.dragOffset.x)),
      y: Math.max(0, Math.min(maxY, e.clientY - this.dragOffset.y)),
    };
  }

  private onDragEnd(e: PointerEvent) {
    this.dragOffset = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  render() {
    if (!this.active) return nothing;
    const dragged = this.dragPos !== null;
    return html`
      <div
        class="pointer-events-auto w-[min(20rem,calc(100vw-1rem))] rounded-lg bg-gray-800/92 backdrop-blur-sm shadow-lg text-white text-sm p-3 ${dragged
          ? "fixed"
          : ""}"
        style=${dragged
          ? `left: ${this.dragPos!.x}px; top: ${this.dragPos!.y}px;`
          : ""}
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="flex items-center justify-between gap-2 mb-1.5 cursor-move select-none"
          style="touch-action: none;"
          @pointerdown=${(e: PointerEvent) => this.onDragStart(e)}
          @pointermove=${(e: PointerEvent) => this.onDragMove(e)}
          @pointerup=${(e: PointerEvent) => this.onDragEnd(e)}
          @pointercancel=${(e: PointerEvent) => this.onDragEnd(e)}
        >
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
            key: this.hotkeyFor(step),
          })}</span
        >
      </p>
      ${done
        ? nothing
        : html`<div class="mt-2 flex items-center gap-2">
            ${step.manual
              ? html`<button
                  class="rounded-md bg-malibu-blue hover:bg-aquarius px-3 py-1 font-semibold"
                  @click=${() => this.progress.acknowledge()}
                >
                  ${translateText("tutorial.got_it")}
                </button>`
              : nothing}
            <button
              class="text-gray-400 hover:text-white underline px-1 py-1"
              @click=${() => this.progress.skip()}
            >
              ${translateText("tutorial.skip")}
            </button>
          </div>`}
    `;
  }
}
