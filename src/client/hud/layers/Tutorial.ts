import { GameEvent } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";

/** HUD elements the tutorial can draw attention to. */
export type TutorialHighlight =
  | "troops"
  | "gold"
  | "city"
  | "port"
  | "factory"
  | "warship"
  | "silo"
  | "atom"
  | "hydrogen"
  | "mirv"
  | "tribes"
  | "nation";

/** Emitted whenever the highlighted HUD element changes (null clears it). */
export class TutorialHighlightEvent implements GameEvent {
  constructor(public readonly target: TutorialHighlight | null) {}
}

/** Snapshot of the player's state that the steps are evaluated against. */
export interface TutorialContext {
  hasSpawned: boolean;
  /** Any outgoing attack, wilderness or player. */
  attacking: boolean;
  botsExist: boolean;
  nationsExist: boolean;
  alliancesDisabled: boolean;
  /** The player has at least one active alliance. */
  allied: boolean;
  gold: bigint;
  /** Null until the worker has reported it. */
  cityCost: bigint | null;
  cityDisabled: boolean;
  cities: number;
  portDisabled: boolean;
  ports: number;
  factoryDisabled: boolean;
  factories: number;
  warshipDisabled: boolean;
  warships: number;
  siloDisabled: boolean;
  silos: number;
  atomDisabled: boolean;
  /** An atom bomb of ours is (or was seen) in flight. */
  atomLaunched: boolean;
  hydrogenDisabled: boolean;
  mirvDisabled: boolean;
}

export interface TutorialStep {
  id: string;
  highlight?: TutorialHighlight;
  /**
   * Build steps: the unit this step asks for. While the player can't afford
   * it, the panel shows the generic earn-gold text instead of the step's own.
   */
  unit?: UnitType;
  /** Keybind action whose key is interpolated into the step text as {key}. */
  hotkey?:
    | "buildCity"
    | "buildPort"
    | "buildFactory"
    | "buildWarship"
    | "buildMissileSilo"
    | "buildAtomBomb";
  /**
   * Render these `tutorial.step.*` keys as a bullet list instead of the
   * step's own single text.
   */
  bullets?: string[];
  /** Steps that don't fit this game's config are skipped. Defaults to always. */
  applies?: (ctx: TutorialContext) => boolean;
  /** Informational steps complete when the player clicks "Got it". */
  manual?: true;
  isDone?: (ctx: TutorialContext) => boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: "spawn", isDone: (c) => c.hasSpawned },
  // Any attack counts so a player who hits a bot first doesn't get stuck.
  { id: "attack_wilderness", isDone: (c) => c.attacking },
  { id: "troops", highlight: "troops", manual: true },
  // Long-running: stays up (with the nearest tribes marked with the target
  // crosshair) until the player has banked enough gold for the City step.
  {
    id: "capture_tribes",
    highlight: "tribes",
    applies: (c) => c.botsExist && !c.cityDisabled,
    isDone: (c) =>
      c.cities > 0 || (c.cityCost !== null && c.gold >= c.cityCost),
  },
  {
    id: "buy_city",
    highlight: "city",
    unit: UnitType.City,
    hotkey: "buildCity",
    applies: (c) => !c.cityDisabled,
    isDone: (c) => c.cities > 0,
  },
  // Marks the nearest nation with the target crosshair; done once the
  // nation accepts (nations may decline — Skip is the way past that).
  {
    id: "propose_alliance",
    highlight: "nation",
    applies: (c) => c.nationsExist && !c.alliancesDisabled,
    isDone: (c) => c.allied,
  },
  {
    id: "alliance_info",
    applies: (c) => c.nationsExist && !c.alliancesDisabled,
    manual: true,
  },
  {
    id: "buy_factory",
    highlight: "factory",
    unit: UnitType.Factory,
    hotkey: "buildFactory",
    applies: (c) => !c.factoryDisabled,
    isDone: (c) => c.factories > 0,
  },
  {
    id: "factory_info",
    applies: (c) => !c.factoryDisabled,
    manual: true,
  },
  {
    id: "buy_port",
    highlight: "port",
    unit: UnitType.Port,
    hotkey: "buildPort",
    applies: (c) => !c.portDisabled,
    isDone: (c) => c.ports > 0,
  },
  {
    id: "port_info",
    bullets: ["port_info_ships", "port_info_warships"],
    applies: (c) => !c.portDisabled,
    manual: true,
  },
  // Warships are built from ports, so this step needs one.
  {
    id: "buy_warship",
    highlight: "warship",
    unit: UnitType.Warship,
    hotkey: "buildWarship",
    applies: (c) => !c.warshipDisabled && !c.portDisabled,
    isDone: (c) => c.warships > 0,
  },
  {
    id: "buy_silo",
    highlight: "silo",
    unit: UnitType.MissileSilo,
    hotkey: "buildMissileSilo",
    applies: (c) => !c.siloDisabled,
    isDone: (c) => c.silos > 0,
  },
  // Waits (via the earn-gold text) until the bomb is affordable, then asks
  // for a launch; done as soon as one of ours is in flight.
  {
    id: "launch_atom",
    highlight: "atom",
    unit: UnitType.AtomBomb,
    hotkey: "buildAtomBomb",
    applies: (c) => !c.siloDisabled && !c.atomDisabled,
    isDone: (c) => c.atomLaunched,
  },
  // One stop per weapon, each highlighting its spot in the unit hotbar.
  {
    id: "atom_info",
    highlight: "atom",
    applies: (c) => !c.siloDisabled && !c.atomDisabled,
    manual: true,
  },
  {
    id: "hydrogen_info",
    highlight: "hydrogen",
    applies: (c) => !c.siloDisabled && !c.hydrogenDisabled,
    manual: true,
  },
  {
    id: "mirv_info",
    highlight: "mirv",
    applies: (c) => !c.siloDisabled && !c.mirvDisabled,
    manual: true,
  },
];

/** Ticks a completed step stays on screen (with its checkmark) before advancing. */
export const STEP_DONE_LINGER_TICKS = 15;

/**
 * Cursor over the step list. Pure: feed it a context once per tick and read
 * back the current step. Steps whose `applies` is false for the current
 * context are skipped, so the visible count adapts to the game's config.
 */
export class TutorialProgress {
  private index = 0;
  /** Ticks since the current step completed, or null while it's pending. */
  private doneTicks: number | null = null;

  constructor(
    private readonly steps: readonly TutorialStep[] = TUTORIAL_STEPS,
  ) {}

  current(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  finished(): boolean {
    return this.index >= this.steps.length;
  }

  stepDone(): boolean {
    return this.doneTicks !== null;
  }

  /** 1-based position of the current step among the steps that apply. */
  position(ctx: TutorialContext): number {
    return this.applicable(ctx, this.index) + 1;
  }

  total(ctx: TutorialContext): number {
    return this.applicable(ctx, this.steps.length);
  }

  /** Completes the current step if it's an informational ("Got it") one. */
  acknowledge(): void {
    const step = this.current();
    if (step?.manual && this.doneTicks === null) {
      this.doneTicks = 0;
    }
  }

  /** Moves past the current step without completing it. */
  skip(): void {
    if (this.finished()) return;
    this.index++;
    this.doneTicks = null;
  }

  update(ctx: TutorialContext): void {
    if (this.doneTicks !== null) {
      this.doneTicks++;
      if (this.doneTicks < STEP_DONE_LINGER_TICKS) return;
      this.index++;
      this.doneTicks = null;
    }
    while (!this.finished() && !this.stepApplies(this.index, ctx)) {
      this.index++;
    }
    const step = this.current();
    if (step?.isDone?.(ctx)) {
      this.doneTicks = 0;
    }
  }

  private stepApplies(i: number, ctx: TutorialContext): boolean {
    return this.steps[i].applies?.(ctx) ?? true;
  }

  private applicable(ctx: TutorialContext, before: number): number {
    let n = 0;
    for (let i = 0; i < before; i++) {
      if (this.stepApplies(i, ctx)) n++;
    }
    return n;
  }
}
