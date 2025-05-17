import { z } from "zod";
import { UnitType } from "./game/Game";

// TODO: where to put these?
// z.literal(UnitType.SAMMissile),
// z.literal(UnitType.Shell),

export const BombUnitSchema = z.union([
  z.literal(UnitType.AtomBomb),
  z.literal(UnitType.HydrogenBomb),
  z.literal(UnitType.MIRV),
  z.literal(UnitType.MIRVWarhead),
]);
export type NukeType = z.infer<typeof BombUnitSchema>;

export const BoatUnitSchema = z.union([
  z.literal(UnitType.TradeShip),
  z.literal(UnitType.TransportShip),
]);
export type BoatType = z.infer<typeof BoatUnitSchema>;

export const OtherUnitSchema = z.union([
  z.literal(UnitType.City),
  z.literal(UnitType.DefensePost),
  z.literal(UnitType.Port),
  z.literal(UnitType.Warship),
  z.literal(UnitType.MissileSilo),
  z.literal(UnitType.SAMLauncher),
]);
export type OtherUnit = z.infer<typeof OtherUnitSchema>;

// Attacks
export const ATTACK_INDEX_INCOMING = 0;
export const ATTACK_INDEX_OUTGOING = 1;
export const ATTACK_INDEX_CANCELLED = 2;
export const IncomingOutgoingCancelledSchema = z.tuple([
  z.number().nonnegative(), // incoming
  z.number().nonnegative(), // outgoing
  z.number().nonnegative(), // cancelled
]);

// Boats
export const BOAT_INDEX_SENT = 0;
export const BOAT_INDEX_ARRIVED = 1;
export const BOAT_INDEX_DESTROYED = 2;
export const SentArrivedDestroyedSchema = z.tuple([
  z.number().nonnegative(), // sent
  z.number().nonnegative(), // arrived
  z.number().nonnegative(), // destroyed
]);

// Bombs
export const BOMB_INDEX_LAUNCHED = 0;
export const BOMB_INDEX_LANDED = 1;
export const BOMB_INDEX_INTERCEPTED = 2;
export const LaunchedLandedInterceptedSchema = z.tuple([
  z.number().nonnegative(), // launched
  z.number().nonnegative(), // landed
  z.number().nonnegative(), // intercepted
]);

// Gold
export const GOLD_INDEX_WORK = 0;
export const GOLD_INDEX_TRADE = 1;
export const GOLD_INDEX_WAR = 2;
export const WorkersTradeWarSchema = z.tuple([
  z.number().nonnegative(), // workers
  z.number().nonnegative(), // trade
  z.number().nonnegative(), // war
]);

// Other Units
export const OTHER_INDEX_BUILT = 0;
export const OTHER_INDEX_LOST = 1;
export const OTHER_INDEX_DESTROYED = 2;
export const OTHER_INDEX_CAPTURED = 3;
export const BuiltLostDestroyedCapturedSchema = z.tuple([
  z.number().nonnegative(), // built
  z.number().nonnegative(), // lost
  z.number().nonnegative(), // destroyed
  z.number().nonnegative(), // captured
]);

export const PlayerStatsSchema = z.object({
  attacks: IncomingOutgoingCancelledSchema,
  betrayals: z.number().nonnegative(),
  boats: z.record(BoatUnitSchema, SentArrivedDestroyedSchema),
  bombs: z.record(BombUnitSchema, LaunchedLandedInterceptedSchema),
  gold: WorkersTradeWarSchema,
  units: z.record(OtherUnitSchema, BuiltLostDestroyedCapturedSchema),
});
