/**
 * The onboarding tutorial's steps and rules (docs/OnboardingTutorial.md).
 * Pure: OnboardingOverlay feeds it what the player has done and asks it
 * which step they're on and whether an action may go through.
 */

import type { GameEvent } from "@openfront/shared/EventBus";

export type OnboardingStep =
  | "spawn"
  | "expand"
  | "troops"
  | "kingdom"
  | "nuke"
  | "empire";

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "spawn",
  "expand",
  "troops",
  "kingdom",
  "nuke",
  "empire",
];

/**
 * Landmarks of the Tutorial map (map-generator/assets/maps/tutorial), in
 * tiles: where the player may spawn, and the x of the strait. The nation
 * that spawns west of it shares the player's island (the kingdom), the one
 * east of it has its own (the empire); the engine splits them the same way
 * (TutorialSilo.ts STRAIT_X). STRAIT is its middle, between the two islands.
 */
export const SPAWN_ZONE = { x: 98, y: 98, radius: 15 };
export const STRAIT_X = 142;
export const STRAIT = { x: STRAIT_X, y: 84 };

/**
 * The troop bar step comes up this many ticks (3.5s) after the player's
 * first expansion, before their land reaches the kingdom, or when it does
 * if that's sooner.
 */
export const TROOPS_AFTER_TICKS = 35;

/**
 * An attack or boat that would leave the player under this share of their
 * max troops waits until troops grow back, and the player is warned. Troops
 * grow slower the fewer there are, so a burst of clicks that sent the whole
 * army would leave a new player waiting for long; this stops it at the
 * fifth click or so (they start at about half). Only the first time,
 * though: once they've seen the warning they may send what they like.
 */
export const LOW_TROOP_SHARE = 0.1;

/**
 * Emitted when the low-troops warning shows or hides, so the troop bar
 * flashes red along with it.
 */
export class OnboardingLowTroopsEvent implements GameEvent {
  constructor(public readonly low: boolean) {}
}

export function inCircle(
  c: { x: number; y: number; radius: number },
  x: number,
  y: number,
): boolean {
  const dx = x - c.x;
  const dy = y - c.y;
  return dx * dx + dy * dy <= c.radius * c.radius;
}

/** What the player has done so far, as the overlay reads it off the game. */
export interface OnboardingProgress {
  hasSpawned: boolean;
  bordersKingdom: boolean;
  /** Has been expanding for TROOPS_AFTER_TICKS. */
  expandedAWhile: boolean;
  /** Clicked "Got it" on the troop bar step. */
  troopsSeen: boolean;
  kingdomAlive: boolean;
  empireAlive: boolean;
  /** Took the kingdom's missile silo. */
  ownsSilo: boolean;
  /** Has fired an atom bomb. */
  nuked: boolean;
}

/**
 * The step the player is on, or "won" once the kingdom and the empire are
 * gone.
 */
export function stepFor(p: OnboardingProgress): OnboardingStep | "won" {
  if (!p.hasSpawned) return "spawn";
  if (p.kingdomAlive) {
    if (!p.troopsSeen && (p.expandedAWhile || p.bordersKingdom)) {
      return "troops";
    }
    return p.bordersKingdom ? "kingdom" : "expand";
  }
  if (!p.empireAlive) return "won";
  return p.ownsSilo && !p.nuked ? "nuke" : "empire";
}

/** Who or what an attack or boat goes after. */
export type OnboardingTarget = "free" | "kingdom" | "empire" | "other";

export type OnboardingAction =
  | { kind: "spawn"; inZone: boolean }
  | { kind: "attack" | "boat"; target: OnboardingTarget }
  /** `onTarget`: it lands where the arrow points. */
  | { kind: "build"; atomBomb: boolean; onTarget: boolean };

export type OnboardingVerdict = "ok" | "wrong_target" | "low_troops";

const ATTACK_TARGETS: Record<OnboardingStep, readonly OnboardingTarget[]> = {
  spawn: [],
  expand: ["free", "kingdom"],
  troops: ["free", "kingdom"],
  kingdom: ["free", "kingdom"],
  nuke: ["free"],
  empire: ["free", "empire"],
};

const BOAT_TARGETS: Record<OnboardingStep, readonly OnboardingTarget[]> = {
  spawn: [],
  expand: [],
  troops: [],
  kingdom: [],
  nuke: ["free"],
  empire: ["free", "empire"],
};

/**
 * Whether the action may go through on this step. Growing into free land
 * is always fine; boats and the empire wait for the last step, and the
 * nuke step is for the atom bomb alone, the only thing ever built, aimed
 * at the empire's port.
 * `troopShareAfter` is the player's troops over their max once the action
 * has sent its troops.
 */
export function judge(
  step: OnboardingStep,
  action: OnboardingAction,
  troopShareAfter: number,
): OnboardingVerdict {
  if (action.kind === "spawn") {
    return step === "spawn" && action.inZone ? "ok" : "wrong_target";
  }
  if (action.kind === "build") {
    if (!action.atomBomb) return "wrong_target";
    if (step === "nuke") return action.onTarget ? "ok" : "wrong_target";
    return step === "empire" ? "ok" : "wrong_target";
  }
  const allowed = (action.kind === "attack" ? ATTACK_TARGETS : BOAT_TARGETS)[
    step
  ];
  if (!allowed.includes(action.target)) return "wrong_target";
  return troopShareAfter < LOW_TROOP_SHARE ? "low_troops" : "ok";
}
