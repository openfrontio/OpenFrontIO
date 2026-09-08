import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { PlayerType, Relation, UnitType } from "../../../core/game/Game";
import { UserSettings } from "../../../core/game/UserSettings";
import { Controller } from "../../Controller";
import { Platform } from "../../Platform";
import { GoToPlayerEvent } from "../../TransformHandler";
import { UIState } from "../../UIState";
import { renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";
import { PlayerView } from "../../view/PlayerView";
import {
  TutorialContext,
  TutorialHighlight,
  TutorialHighlightEvent,
  TutorialProgress,
  TutorialStep,
} from "../Tutorial";

/** How often (in ticks) to ask the worker for current build costs. */
const COST_POLL_TICKS = 10;

/** Units whose costs the panel tracks (the build steps). */
const COST_POLL_TYPES = [
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
  UnitType.DefensePost,
  UnitType.Warship,
  UnitType.MissileSilo,
  UnitType.AtomBomb,
] as const;

/** `unit_type.*` name key per build-step unit, for the earn-gold text. */
const UNIT_NAME_KEYS: Partial<Record<UnitType, string>> = {
  [UnitType.City]: "city",
  [UnitType.Factory]: "factory",
  [UnitType.Port]: "port",
  [UnitType.DefensePost]: "defense_post",
  [UnitType.Warship]: "warship",
  [UnitType.MissileSilo]: "missile_silo",
  [UnitType.AtomBomb]: "atom_bomb",
};
/** Ticks the "you're ready" message stays up before the panel closes. */
const COMPLETE_LINGER_TICKS = 50;

/** How many of the nearest attack targets get a marker during the tribes step. */
const NEARBY_TRIBE_MARK_COUNT = 3;

/** How often (in ticks) to recompute what we share a border with. */
const BORDER_REFRESH_TICKS = 10;

/** Steps that need a coast: until we own one, they ask the player to expand to it. */
const COAST_STEPS = new Set(["send_boat", "buy_port"]);

/**
 * Steps with a `tutorial.step_touch.*` variant: their desktop text leans on
 * hotkeys, clicks and the hotbar (hidden below lg), so touch devices get the
 * tap → radial menu route instead.
 */
const TOUCH_TEXT_STEPS = new Set([
  "spawn",
  "attack_wilderness",
  "buy_city",
  "propose_alliance",
  "buy_factory",
  "send_boat",
  "buy_port",
  "buy_defense_post",
  "buy_warship",
  "buy_silo",
  "launch_atom",
]);

/** Defaults shown when the player hasn't rebound the action (see UnitDisplay). */
const HOTKEY_FALLBACKS = {
  buildCity: "1",
  buildFactory: "2",
  buildPort: "3",
  buildDefensePost: "4",
  buildWarship: "7",
  buildMissileSilo: "5",
  buildAtomBomb: "8",
} as const;

@customElement("tutorial-panel")
export class TutorialPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public userSettings: UserSettings;
  public uiState: UIState;

  @state() private active = false;
  @state() private confirmingClose = false;
  @state() private ctx: TutorialContext | null = null;

  private progress = new TutorialProgress();
  private started = false;
  private costs = new Map<UnitType, bigint>();
  private keybinds: Record<string, { key?: string }> | null = null;
  private mapMarksActive = false;
  /** Latched: an atom bomb of ours was seen in flight at least once. */
  private atomLaunchSeen = false;
  /** Latched: a transport ship of ours was seen afloat at least once. */
  private boatSeen = false;
  /** Attack ratio as of the previous tick, to spot the slider moving. */
  private lastAttackRatio: number | null = null;
  /** Nation smallID → its attitude toward us, fetched during the ally step. */
  private nationRelations = new Map<number, Relation>();
  /** smallIDs we share a border with; null until the first fetch lands. */
  private borderingIds: Set<number> | null = null;
  /**
   * Whether we own a shore tile; null until the first fetch lands. Any water
   * counts: ports and boats work on lakes too, and the map generator drops
   * bodies under 200 tiles, so there are no ponds to exclude.
   */
  @state() private hasCoast: boolean | null = null;
  private borderFetch: Promise<void> | null = null;
  /** Tribes step: every reachable tribe is walled off, so point at nations. */
  @state() private attackNations = false;
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
    if (step && (step.id === "capture_tribes" || COAST_STEPS.has(step.id))) {
      this.refreshBordering(player);
    }
    const target =
      step && !this.progress.stepDone() ? (step.highlight ?? null) : null;
    this.setHighlight(target);
    this.syncMapMarkers(target);
    this.game.setOwnSpawnRing(target === "territory");
  }

  /**
   * Marks players with the target crosshair while a step points at the map
   * (tribes to capture, a nation to ally with); as they die or are captured,
   * the next candidates take their place.
   */
  private syncMapMarkers(target: TutorialHighlight | null) {
    if (target !== "tribes" && target !== "nation") {
      if (this.mapMarksActive) {
        this.mapMarksActive = false;
        this.game.setMarkedPlayers(null);
      }
      return;
    }
    const player = this.game.myPlayer();
    if (player === null) return;
    // Name locations are the position anchor; they're recomputed every ~3s.
    // Keep the last set while ours is missing rather than flashing empty.
    const me = player.nameLocation();
    if (!me || (me.x === 0 && me.y === 0)) return;
    const ids =
      target === "tribes"
        ? this.attackTargets(player, me)
        : this.allianceTarget(me);
    this.game.setMarkedPlayers(new Set(ids));
    this.mapMarksActive = true;
  }

  /** Living players of `type` sorted nearest to `me` first. */
  private nearest(type: PlayerType, me: { x: number; y: number }): number[] {
    const candidates: { id: number; distSquared: number }[] = [];
    for (const p of this.game.playerViews()) {
      if (p.type() !== type || !p.isAlive()) continue;
      const loc = p.nameLocation();
      if (!loc || (loc.x === 0 && loc.y === 0)) continue;
      const dx = loc.x - me.x;
      const dy = loc.y - me.y;
      candidates.push({ id: p.smallID(), distSquared: dx * dx + dy * dy });
    }
    candidates.sort((a, b) => a.distSquared - b.distSquared);
    return candidates.map((c) => c.id);
  }

  /**
   * Tribes step: the tribes we share a border with, nearest first. When
   * nations have walled every tribe off, the nations we border instead
   * (minus allies) — and the step text switches to attacking nations.
   */
  private attackTargets(
    player: PlayerView,
    me: { x: number; y: number },
  ): number[] {
    const bordering = this.borderingIds;
    const bots = this.nearest(PlayerType.Bot, me);
    // Until the first border fetch lands, fall back to plain nearest.
    if (bordering === null) {
      this.attackNations = false;
      return bots.slice(0, NEARBY_TRIBE_MARK_COUNT);
    }
    const borderingBots = bots.filter((id) => bordering.has(id));
    if (borderingBots.length > 0) {
      this.attackNations = false;
      return borderingBots.slice(0, NEARBY_TRIBE_MARK_COUNT);
    }
    const nations = this.nearest(PlayerType.Nation, me).filter(
      (id) =>
        bordering.has(id) &&
        !player.isFriendly(this.game.playerBySmallID(id) as PlayerView),
    );
    this.attackNations = nations.length > 0;
    return this.attackNations
      ? nations.slice(0, NEARBY_TRIBE_MARK_COUNT)
      : bots.slice(0, NEARBY_TRIBE_MARK_COUNT);
  }

  /** Ally step: the nearest nation that doesn't dislike us, if any. */
  private allianceTarget(me: { x: number; y: number }): number[] {
    const nations = this.nearest(PlayerType.Nation, me);
    // Refresh from the pre-filter list: relations decay back toward
    // neutral, so a nation that dipped hostile must stay refreshable or
    // it would be blacklisted forever.
    this.fetchNationRelations(nations.slice(0, 5));
    // Unknown relations count as neutral until their profile fetch lands.
    return nations
      .filter(
        (id) =>
          (this.nationRelations.get(id) ?? Relation.Neutral) >=
          Relation.Neutral,
      )
      .slice(0, 1);
  }

  /**
   * Recompute (once a second, one fetch in flight) who we share a border
   * with and whether any of it is coast.
   */
  private refreshBordering(player: PlayerView) {
    if (
      this.game.ticks() % BORDER_REFRESH_TICKS !== 0 ||
      this.borderFetch !== null
    )
      return;
    this.borderFetch = player.borderTiles().then((bt) => {
      this.borderFetch = null;
      const myID = player.smallID();
      const ids = new Set<number>();
      let coast = false;
      for (const tile of bt.borderTiles) {
        if (this.game.isShore(tile)) coast = true;
        for (const n of this.game.neighbors(tile)) {
          const owner = this.game.ownerID(n);
          if (owner !== 0 && owner !== myID) ids.add(owner);
        }
      }
      this.borderingIds = ids;
      this.hasCoast = coast;
    });
  }

  /**
   * Where the Go-to button flies the camera: our own territory during the
   * spawn-ring step, otherwise the nearest marked player (the marked set is
   * built nearest-first). Null when the step points at nothing on the map.
   */
  private goToTarget(): PlayerView | null {
    if (this.highlight === "territory") return this.game.myPlayer();
    const id = this.game.markedPlayers()?.values().next().value;
    if (id === undefined) return null;
    const p = this.game.playerBySmallID(id);
    return p.isPlayer() ? (p as PlayerView) : null;
  }

  /** Refresh (throttled) how the given nations feel about us. */
  private fetchNationRelations(ids: number[]) {
    if (this.game.ticks() % 20 !== 0) return;
    const me = this.game.myPlayer();
    if (me === null) return;
    for (const id of ids) {
      const nation = this.game.playerBySmallID(id);
      if (!nation.isPlayer()) continue;
      (nation as PlayerView).profile().then((profile) => {
        this.nationRelations.set(
          id,
          profile.relations[me.smallID()] ?? Relation.Neutral,
        );
      });
    }
  }

  private buildContext(player: PlayerView): TutorialContext {
    const attacks = player.outgoingAttacks();
    const attackRatio = this.uiState.attackRatio;
    const attackRatioMoved =
      this.lastAttackRatio !== null && attackRatio !== this.lastAttackRatio;
    this.lastAttackRatio = attackRatio;
    return {
      hasSpawned: player.hasSpawned(),
      attacking: attacks.length > 0,
      attackRatioMoved,
      boatsDisabled: this.game.config().isUnitDisabled(UnitType.TransportShip),
      boatSent: (this.boatSeen ||=
        player.units(UnitType.TransportShip).length > 0),
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
      defensePostDisabled: this.game
        .config()
        .isUnitDisabled(UnitType.DefensePost),
      defensePosts: player.units(UnitType.DefensePost).length,
      factoryDisabled: this.game.config().isUnitDisabled(UnitType.Factory),
      factories: player.units(UnitType.Factory).length,
      warshipDisabled: this.game.config().isUnitDisabled(UnitType.Warship),
      warships: player.units(UnitType.Warship).length,
      siloDisabled: this.game.config().isUnitDisabled(UnitType.MissileSilo),
      silos: player.units(UnitType.MissileSilo).length,
      atomDisabled: this.game.config().isUnitDisabled(UnitType.AtomBomb),
      // Mirrors PlayerImpl.nukeSpawn's ready-silo filter.
      siloReady: player
        .units(UnitType.MissileSilo)
        .some(
          (s) => s.isActive() && !s.isInCooldown() && !s.isUnderConstruction(),
        ),
      atomLaunched: (this.atomLaunchSeen ||=
        player.units(UnitType.AtomBomb).length > 0),
      hydrogenDisabled: this.game
        .config()
        .isUnitDisabled(UnitType.HydrogenBomb),
      mirvDisabled: this.game.config().isUnitDisabled(UnitType.MIRV),
      samDisabled: this.game.config().isUnitDisabled(UnitType.SAMLauncher),
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
      this.game.setOwnSpawnRing(false);
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
        class="pointer-events-auto w-full sm:rounded-lg bg-gray-800/92 backdrop-blur-sm shadow-lg text-white text-base p-2 sm:mb-1"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="flex items-center justify-between gap-2 mb-1">
          <span
            class="font-bold text-cyber-yellow uppercase tracking-wide text-sm"
            >${translateText("tutorial.title")}</span
          >
          <span class="flex items-center gap-2 text-sm text-gray-300">
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

  /** Got it / Go to / Skip live in the header row to keep the panel short. */
  private renderHeaderActions() {
    const step = this.progress.current();
    if (
      step === null ||
      this.completeTicks !== null ||
      this.progress.stepDone()
    )
      return nothing;
    const goTo = this.goToTarget();
    return html`
      ${step.manual
        ? html`<button
            class="rounded bg-malibu-blue hover:bg-aquarius px-2 py-0.5 font-semibold text-white"
            @click=${() => this.progress.acknowledge()}
          >
            ${translateText("tutorial.got_it")}
          </button>`
        : nothing}
      ${goTo
        ? html`<button
            class="rounded bg-malibu-blue hover:bg-aquarius px-2 py-0.5 font-semibold text-white"
            @click=${() => this.eventBus.emit(new GoToPlayerEvent(goTo))}
          >
            ${translateText("tutorial.go_to")}
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
    return html`
      <p class="flex gap-1.5 ${done ? "text-green-400" : ""}">
        ${step.bullets && !done
          ? nothing
          : html`<span class="shrink-0">${done ? "✓" : "•"}</span>`}
        ${step.bullets
          ? html`<ul class="list-disc ml-4 flex flex-col gap-1">
              ${step.bullets.map(
                (b) => html`<li>${translateText(`tutorial.step.${b}`)}</li>`,
              )}
            </ul>`
          : html`<span>${this.stepText(step, done)}</span>`}
      </p>
    `;
  }

  private stepText(step: TutorialStep, done: boolean): string {
    // Boats and ports need shore; landlocked players are sent to get some.
    if (!done && COAST_STEPS.has(step.id) && this.hasCoast === false) {
      return translateText("tutorial.step.no_coast");
    }
    // Build steps: until the unit is affordable, ask for gold instead of
    // telling the player to build something they can't.
    const cost =
      step.unit !== undefined ? this.costs.get(step.unit) : undefined;
    if (
      !done &&
      cost !== undefined &&
      (this.game.myPlayer()?.gold() ?? 0n) < cost
    ) {
      return translateText("tutorial.step.earn_gold", {
        unit: translateText(`unit_type.${UNIT_NAME_KEYS[step.unit!]}`),
        cost: renderNumber(cost),
      });
    }
    // The launch step must not claim the silo is armed while it's still
    // under construction or reloading.
    if (!done && step.id === "launch_atom" && this.ctx?.siloReady === false) {
      return translateText("tutorial.step.silo_loading");
    }
    const id =
      !done && step.id === "capture_tribes" && this.attackNations
        ? "attack_nations"
        : step.id;
    const block =
      Platform.isTouch && TOUCH_TEXT_STEPS.has(id) ? "step_touch" : "step";
    return translateText(`tutorial.${block}.${id}`, {
      cost: renderNumber(this.costs.get(UnitType.City) ?? 0n),
      key: this.hotkeyFor(step),
    });
  }
}
