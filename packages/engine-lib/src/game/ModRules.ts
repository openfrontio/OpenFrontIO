/**
 * Rules for the modded content: Tanks, Airports, Cargo Planes, Fighter Jets
 * and the Zombie Raid mode.
 *
 * Shared by the authoritative simulation and the client HUD, so both always
 * agree on numbers. Everything here is plain integers: no floats that could
 * drift between clients and none of the approximated Math functions.
 *
 * Time is in ticks (10 per second) unless the name says otherwise.
 */

// ---------------------------------------------------------------------------
// Tank (land unit; the land counterpart of the Warship)
// ---------------------------------------------------------------------------
export const TANK = {
  maxHealth: 400,
  // One tile every this many ticks.
  ticksPerStep: 3,
  // Radius in which a tank picks targets.
  targetingRange: 28,
  // A tank fires once an enemy tank is this close, and holds position there.
  shootRange: 14,
  // An idle tank drives to its patrol tile until it is this close, so a move
  // order sends it there and it parks instead of dithering on the spot.
  holdRadius: 3,
  // Ticks between two shots.
  shotInterval: 20,
  // Health removed from an enemy tank per hit.
  damageToTank: 60,
  // Troops removed from an enemy attack against the tank owner, per hit.
  troopsKilledPerShot: 1500,
  // A tank steals an enemy train when it gets this close to the engine.
  trainCaptureRange: 5,
  // Train cars trail the engine; all of the old owner's cars this close to the
  // engine change hands with it.
  trainCarRange: 12,
  // A tank only defends territory it can reach: an enemy attack counts when
  // one of its target tiles lies within this range of the tank.
  attackDefenseRange: 32,
} as const;

// ---------------------------------------------------------------------------
// Airport / Cargo plane (the air counterpart of the Port / Trade ship)
// ---------------------------------------------------------------------------
export const AIRPORT = {
  // Per-second chance of a plane leaving is 1 / (planeSpawnBase / level).
  planeSpawnBase: 24,
  // Longest route a cargo plane flies (manhattan tiles).
  maxRouteDistance: 450,
  // Routes shorter than this pay almost nothing: no hopping next door.
  minRouteDistance: 25,
  // Tiles per tick.
  planeSpeed: 2,
  // Cap on planes in the air per airport level, to bound simulation cost.
  maxPlanesPerLevel: 4,
} as const;

/** Gold for a completed cargo plane route, before the lobby gold multiplier. */
export function cargoPlaneBaseGold(distance: number): number {
  return 25_000 + 40 * distance;
}

// ---------------------------------------------------------------------------
// Fighter jet
// ---------------------------------------------------------------------------
export const FIGHTER_JET = {
  maxHealth: 180,
  // Tiles per tick.
  speed: 2,
  targetingRange: 60,
  shotInterval: 15,
  damageToJet: 45,
  damageToTank: 35,
  // A jet steals an enemy cargo plane when it gets this close.
  captureRange: 4,
  // How close to its own airport a jet has to be to repair.
  repairRange: 6,
  repairPerTick: 2,
  // Below this share of max health a jet flies home to repair.
  retreatHealthPercent: 35,
} as const;

// ---------------------------------------------------------------------------
// Zombie Raid
// ---------------------------------------------------------------------------
export const ZOMBIE_RAID_DEFAULTS = {
  enabled: false,
  // Minutes of game time (after the spawn phase) until the outbreak.
  outbreakMinutes: 10,
} as const;

export const ZOMBIE_RAID_MIN_MINUTES = 1;
export const ZOMBIE_RAID_MAX_MINUTES = 120;

/** Player id of the zombie faction (the client colours it green by this id). */
export const ZOMBIE_PLAYER_ID = "zombie_raid_horde";

export const ZOMBIE = {
  // Display name of the zombie faction.
  name: "Zombies",
  // Patient-zero sites per player: one per this many owned tiles, at least 1.
  tilesPerEpicenter: 400,
  maxEpicentersPerPlayer: 6,
  // Epicenters infect this many tiles around themselves (flood over owned land).
  epicenterTiles: 90,
  // Troops granted to the horde per owned tile each second, on top of normal
  // regeneration, so it stays a threat while it holds land.
  troopsPerTilePerSecond: 2,
  // Troops the horde starts with, per infected player.
  startingTroopsPerEpicenter: 4_000,
  // Survivor camps placed in zombie territory at the outbreak: one per this many
  // zombie tiles, within these bounds.
  tilesPerSurvivorCamp: 120,
  minSurvivorCamps: 4,
  maxSurvivorCamps: 40,
  // Seconds between the horde sending its next wave of attack.
  // (The attack cadence itself comes from the tribe AI.)
} as const;

// ---------------------------------------------------------------------------
// Cure research
// ---------------------------------------------------------------------------
/** Research points needed to finish the cure. */
export const CURE_TARGET = 100_000;
/** Points per second for each City level (research labs). */
export const CURE_POINTS_PER_CITY_LEVEL = 18;
/** Points per second for each Airport level (shipping samples). */
export const CURE_POINTS_PER_AIRPORT_LEVEL = 10;
/** Research starts when the outbreak does, so there is no head start. */
export const CURE_BASE_POINTS_PER_SECOND = 8;
/** Zombie tiles a cured player heals per second along their border. */
export const CURE_HEAL_TILES_PER_SECOND = 6;

// ---------------------------------------------------------------------------
// Survivor buffs (stackable, permanent)
// ---------------------------------------------------------------------------
export type SurvivorBuffKind = "medic" | "scavenger" | "researcher" | "gunner";

export const SURVIVOR_BUFF_KINDS: readonly SurvivorBuffKind[] = [
  "medic",
  "scavenger",
  "researcher",
  "gunner",
] as const;

/** Each rescued survivor adds this many percent of its buff's effect. */
export const SURVIVOR_BUFF_PERCENT_PER_STACK = 5;

/**
 * The buff a survivor camp carries is a pure function of its tile, so it never
 * has to be stored or sent over the wire.
 */
export function survivorBuffForTile(tile: number): SurvivorBuffKind {
  // Multiplicative hash so neighbouring tiles do not share a buff.
  const h = Math.imul(tile ^ 0x5bd1e995, 0x9e3779b1) >>> 0;
  return SURVIVOR_BUFF_KINDS[(h >>> 16) % SURVIVOR_BUFF_KINDS.length];
}

/** Percent bonus for `stacks` rescued survivors of one kind. */
export function survivorBuffPercent(stacks: number): number {
  return stacks * SURVIVOR_BUFF_PERCENT_PER_STACK;
}

/** Applies a percent bonus to an integer amount, rounding down. */
export function applyPercentBonus(amount: number, percent: number): number {
  return amount + Math.floor((amount * percent) / 100);
}

/** Zero-filled stack counts, indexed like SURVIVOR_BUFF_KINDS. */
export function emptyBuffStacks(): number[] {
  return SURVIVOR_BUFF_KINDS.map(() => 0);
}

export function buffIndex(kind: SurvivorBuffKind): number {
  return SURVIVOR_BUFF_KINDS.indexOf(kind);
}
