import { z } from "zod";
import { UnitType } from "./game/Game";

export const BombUnitSchema = z.union([
  z.literal("abomb"),
  z.literal("hbomb"),
  z.literal("mirv"),
  z.literal("mirvw"),
]);
export type NukeType =
  | UnitType.AtomBomb
  | UnitType.HydrogenBomb
  | UnitType.MIRV
  | UnitType.MIRVWarhead;

export const BoatUnitSchema = z.union([z.literal("trade"), z.literal("trans")]);
export type BoatType = UnitType.TradeShip | UnitType.TransportShip;

export const OtherUnitSchema = z.union([
  z.literal("city"),
  z.literal("defp"),
  z.literal("port"),
  z.literal("wshp"),
  z.literal("silo"),
  z.literal("saml"),
]);
export type OtherUnit =
  | UnitType.City
  | UnitType.DefensePost
  | UnitType.MissileSilo
  | UnitType.Port
  | UnitType.SAMLauncher
  | UnitType.Warship;

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
export type LaunchedLandedIntercepted = z.infer<
  typeof LaunchedLandedInterceptedSchema
>;

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
export type BuiltLostDestroyedCaptured = z.infer<
  typeof BuiltLostDestroyedCapturedSchema
>;

export const PlayerStatsSchema = z.object({
  attacks: IncomingOutgoingCancelledSchema,
  betrayals: z.number().nonnegative(),
  boats: z.record(BoatUnitSchema, SentArrivedDestroyedSchema),
  bombs: z.record(BombUnitSchema, LaunchedLandedInterceptedSchema),
  gold: WorkersTradeWarSchema,
  units: z.record(OtherUnitSchema, BuiltLostDestroyedCapturedSchema),
});
