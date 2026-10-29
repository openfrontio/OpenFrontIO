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
  | "tribe"
  | "boat"
  | "nation";

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "spawn",
  "expand",
  "troops",
  "tribe",
  "boat",
  "nation",
];

/**
 * Landmarks of the Tutorial map (map-generator/assets/maps/tutorial), in
 * tiles: where the player may spawn, and the empty islet of the boat step.
 */
export const SPAWN_ZONE = { x: 98, y: 98, radius: 15 };
export const ISLET = { x: 144, y: 140, radius: 14 };

/**
 * An attack or boat that would leave the player under this share of their
 * max troops waits until troops grow back, and the player is warned. Troops
 * grow slower the fewer there are, so a burst of clicks that sent the whole
 * army would leave a new player waiting for long; this stops it at the
 * third click or so (they start at about 20%).
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
  bordersTribe: boolean;
  /** Clicked "Got it" on the troop bar step. */
  troopsSeen: boolean;
  tribeAlive: boolean;
  ownsIslet: boolean;
  nationAlive: boolean;
}

/** The step the player is on, or "won" once the tribe and nation are gone. */
export function stepFor(p: OnboardingProgress): OnboardingStep | "won" {
  if (!p.hasSpawned) return "spawn";
  if (p.tribeAlive) {
    if (!p.bordersTribe) return "expand";
    return p.troopsSeen ? "tribe" : "troops";
  }
  if (!p.nationAlive) return "won";
  return p.ownsIslet ? "nation" : "boat";
}

/** Who or what an attack or boat goes after. */
export type OnboardingTarget = "free" | "islet" | "tribe" | "nation" | "other";

export type OnboardingAction =
  | { kind: "spawn"; inZone: boolean }
  | { kind: "attack" | "boat"; target: OnboardingTarget };

export type OnboardingVerdict = "ok" | "wrong_target" | "low_troops";

const ATTACK_TARGETS: Record<OnboardingStep, readonly OnboardingTarget[]> = {
  spawn: [],
  expand: ["free", "islet", "tribe"],
  troops: ["free", "islet", "tribe"],
  tribe: ["free", "islet", "tribe"],
  boat: ["free", "islet"],
  nation: ["free", "islet", "nation"],
};

const BOAT_TARGETS: Record<OnboardingStep, readonly OnboardingTarget[]> = {
  spawn: [],
  expand: [],
  troops: [],
  tribe: [],
  boat: ["free", "islet"],
  nation: ["free", "islet", "nation"],
};

/**
 * Whether the action may go through on this step. Growing into free land
 * is always fine; boats wait for the boat step and the nation for the last.
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
  const allowed = (action.kind === "attack" ? ATTACK_TARGETS : BOAT_TARGETS)[
    step
  ];
  if (!allowed.includes(action.target)) return "wrong_target";
  return troopShareAfter < LOW_TROOP_SHARE ? "low_troops" : "ok";
}
