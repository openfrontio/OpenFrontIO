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

/** How often (in ticks) to ask the worker for current build costs. */
const COST_POLL_TICKS = 10;

/** Units whose costs the panel tracks (the build steps). */
const COST_POLL_TYPES = [
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
  UnitType.Warship,
  UnitType.MissileSilo,
  UnitType.AtomBomb,
] as const;

/** `unit_type.*` name key per build-step unit, for the earn-gold text. */
const UNIT_NAME_KEYS: Partial<Record<UnitType, string>> = {
  [UnitType.City]: "city",
  [UnitType.Factory]: "factory",
  [UnitType.Port]: "port",
  [UnitType.Warship]: "warship",
  [UnitType.MissileSilo]: "missile_silo",
  [UnitType.AtomBomb]: "atom_bomb",
};
/** Ticks the "you're ready" message stays up before the panel closes. */
const COMPLETE_LINGER_TICKS = 50;

/** How many of the nearest tribes get a target marker during the tribes step. */
const NEARBY_TRIBE_MARK_COUNT = 3;

/** Map-marker specs per highlight target: which player type, how many. */
const MAP_MARKERS: Partial<
  Record<TutorialHighlight, { type: PlayerType; count: number }>
> = {
  tribes: { type: PlayerType.Bot, count: NEARBY_TRIBE_MARK_COUNT },
  nation: { type: PlayerType.Nation, count: 1 },
};

/** Defaults shown when the player hasn't rebound the action (see UnitDisplay). */
const HOTKEY_FALLBACKS = {
  buildCity: "1",
  buildFactory: "2",
  buildPort: "3",
  buildWarship: "7",
  buildMissileSilo: "5",
  buildAtomBomb: "8",
} as const;

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
  private costs = new Map<UnitType, bigint>();
  private keybinds: Record<string, { key?: string }> | null = null;
  private mapMarksActive = false;
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

    if (this.game.ticks() % COST_POLL_TICKS === 0) {
      player.buildables(undefined, COST_POLL_TYPES).then((buildables) => {
        this.costs = new Map(buildables.map((b) => [b.type, b.cost]));
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
    const target =
      step && !this.progress.stepDone() ? (step.highlight ?? null) : null;
    this.setHighlight(target);
    this.syncMapMarkers(target);
  }

  /**
   * Marks the players nearest to us with the target crosshair while a step
   * points at the map (tribes to capture, a nation to ally with); as they
   * die or are captured, the next nearest take their place.
   */
  private syncMapMarkers(target: TutorialHighlight | null) {
    const spec = target !== null ? MAP_MARKERS[target] : undefined;
    if (spec === undefined) {
      if (this.mapMarksActive) {
        this.mapMarksActive = false;
        this.game.setMarkedPlayers(null);
      }
      return;
    }
    // Name locations are the position anchor; they're recomputed every ~3s.
    // Keep the last set while ours is missing rather than flashing empty.
    const me = this.game.myPlayer()?.nameLocation();
    if (!me || (me.x === 0 && me.y === 0)) return;
    const candidates: { id: number; distSquared: number }[] = [];
    for (const p of this.game.playerViews()) {
      if (p.type() !== spec.type || !p.isAlive()) continue;
      const loc = p.nameLocation();
      if (!loc || (loc.x === 0 && loc.y === 0)) continue;
      const dx = loc.x - me.x;
      const dy = loc.y - me.y;
      candidates.push({ id: p.smallID(), distSquared: dx * dx + dy * dy });
    }
    candidates.sort((a, b) => a.distSquared - b.distSquared);
    this.game.setMarkedPlayers(
      new Set(candidates.slice(0, spec.count).map((c) => c.id)),
    );
    this.mapMarksActive = true;
  }

  private buildContext(player: PlayerView): TutorialContext {
    const attacks = player.outgoingAttacks();
    return {
      hasSpawned: player.hasSpawned(),
      attacking: attacks.length > 0,
      botsExist: this.game
        .playerViews()
        .some((p) => p.type() === PlayerType.Bot && p.isAlive()),
      nationsExist: this.game
        .playerViews()
        .some((p) => p.type() === PlayerType.Nation && p.isAlive()),
      alliancesDisabled: this.game.config().disableAlliances(),
      allied: player.alliances().length > 0,
      gold: player.gold(),
      cityCost: this.costs.get(UnitType.City) ?? null,
      cityDisabled: this.game.config().isUnitDisabled(UnitType.City),
      cities: player.units(UnitType.City).length,
      portDisabled: this.game.config().isUnitDisabled(UnitType.Port),
      ports: player.units(UnitType.Port).length,
      factoryDisabled: this.game.config().isUnitDisabled(UnitType.Factory),
      factories: player.units(UnitType.Factory).length,
      warshipDisabled: this.game.config().isUnitDisabled(UnitType.Warship),
      warships: player.units(UnitType.Warship).length,
      siloDisabled: this.game.config().isUnitDisabled(UnitType.MissileSilo),
      silos: player.units(UnitType.MissileSilo).length,
      atomDisabled: this.game.config().isUnitDisabled(UnitType.AtomBomb),
      atomLaunched: player.units(UnitType.AtomBomb).length > 0,
      hydrogenDisabled: this.game
        .config()
        .isUnitDisabled(UnitType.HydrogenBomb),
      mirvDisabled: this.game.config().isUnitDisabled(UnitType.MIRV),
    };
  }

  private hotkeyFor(step: TutorialStep): string {
    if (!step.hotkey) return "";
    this.keybinds ??= this.userSettings.parsedUserKeybinds();
    return this.keybinds[step.hotkey]?.key ?? HOTKEY_FALLBACKS[step.hotkey];
  }

  private setHighlight(target: TutorialHighlight | null) {
    if (this.highlight === target) return;
    this.highlight = target;
    this.eventBus.emit(new TutorialHighlightEvent(target));
  }

  private setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    // The host sits in the bottom HUD column above the control panel; leave
    // the flow when hidden so it doesn't add a gap there.
    this.classList.toggle("hidden", !active);
    if (!active) {
      this.setHighlight(null);
      this.syncMapMarkers(null);
    }
  }

  private dismissForever() {
    this.userSettings.setTutorialDismissed(true);
    this.setActive(false);
  }

  render() {
    if (!this.active) return nothing;
    return html`
      <div
        class="pointer-events-auto w-full rounded-lg bg-gray-800/92 backdrop-blur-sm shadow-lg text-white text-sm p-2 mb-1"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="flex items-center justify-between gap-2 mb-1">
          <span
            class="font-bold text-cyber-yellow uppercase tracking-wide text-xs"
            >${translateText("tutorial.title")}</span
          >
          <span class="flex items-center gap-2 text-xs text-gray-300">
            ${this.confirmingClose ? nothing : this.renderHeaderActions()}
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

  /** Got it / Skip live in the header row to keep the panel short. */
  private renderHeaderActions() {
    const step = this.progress.current();
    if (
      step === null ||
      this.completeTicks !== null ||
      this.progress.stepDone()
    )
      return nothing;
    return html`
      ${step.manual
        ? html`<button
            class="rounded bg-malibu-blue hover:bg-aquarius px-2 py-0.5 font-semibold text-white"
            @click=${() => this.progress.acknowledge()}
          >
            ${translateText("tutorial.got_it")}
          </button>`
        : nothing}
      <button
        class="text-gray-400 hover:text-white underline"
        @click=${() => this.progress.skip()}
      >
        ${translateText("tutorial.skip")}
      </button>
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
    // Build steps: until the unit is affordable, ask for gold instead of
    // telling the player to build something they can't.
    const cost =
      step.unit !== undefined ? this.costs.get(step.unit) : undefined;
    const needsGold =
      !done &&
      cost !== undefined &&
      (this.game.myPlayer()?.gold() ?? 0n) < cost;
    return html`
      <p class="flex gap-1.5 ${done ? "text-green-400" : ""}">
        ${step.bullets && !done
          ? nothing
          : html`<span class="shrink-0">${done ? "✓" : "▸"}</span>`}
        ${step.bullets
          ? html`<ul class="list-disc ml-4 flex flex-col gap-1">
              ${step.bullets.map(
                (b) => html`<li>${translateText(`tutorial.step.${b}`)}</li>`,
              )}
            </ul>`
          : html`<span
              >${needsGold
                ? translateText("tutorial.step.earn_gold", {
                    unit: translateText(
                      `unit_type.${UNIT_NAME_KEYS[step.unit!]}`,
                    ),
                    cost: renderNumber(cost!),
                  })
                : translateText(`tutorial.step.${step.id}`, {
                    cost: renderNumber(this.costs.get(UnitType.City) ?? 0n),
                    key: this.hotkeyFor(step),
                  })}</span
            >`}
      </p>
    `;
  }
}
