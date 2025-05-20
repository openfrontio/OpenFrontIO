import { z } from "zod";
import { UnitType } from "./game/Game";

export const BombUnitSchema = z.union([
  z.literal("abomb"),
  z.literal("hbomb"),
  z.literal("mirv"),
  z.literal("mirvw"),
]);
export type BombUnit = z.infer<typeof BombUnitSchema>;
export type NukeType =
  | UnitType.AtomBomb
  | UnitType.HydrogenBomb
  | UnitType.MIRV
  | UnitType.MIRVWarhead;

export const BoatUnitSchema = z.union([z.literal("trade"), z.literal("trans")]);
export type BoatUnit = z.infer<typeof BoatUnitSchema>;
export type BoatUnitType = UnitType.TradeShip | UnitType.TransportShip;

export const OtherUnitSchema = z.union([
  z.literal("city"),
  z.literal("defp"),
  z.literal("port"),
  z.literal("wshp"),
  z.literal("silo"),
  z.literal("saml"),
]);
export type OtherUnit = z.infer<typeof OtherUnitSchema>;
export type OtherUnitType =
  | UnitType.City
  | UnitType.DefensePost
  | UnitType.MissileSilo
  | UnitType.Port
  | UnitType.SAMLauncher
  | UnitType.Warship;

// Attacks
export const ATTACK_INDEX_OUTGOING = 0;
export const ATTACK_INDEX_INCOMING = 1;
export const ATTACK_INDEX_CANCELLED = 2;

// Boats
export const BOAT_INDEX_SENT = 0;
export const BOAT_INDEX_ARRIVED = 1;
export const BOAT_INDEX_DESTROYED = 2;

// Bombs
export const BOMB_INDEX_LAUNCHED = 0;
export const BOMB_INDEX_LANDED = 1;
export const BOMB_INDEX_INTERCEPTED = 2;

// Gold
export const GOLD_INDEX_WORK = 0;
export const GOLD_INDEX_TRADE = 1;
export const GOLD_INDEX_WAR = 2;

// Other Units
export const OTHER_INDEX_BUILT = 0;
export const OTHER_INDEX_DESTROYED = 1;
export const OTHER_INDEX_CAPTURED = 2;
export const OTHER_INDEX_LOST = 3;

const AtLeastOneNumberSchema = z.number().array().min(1);
export type AtLeastOneNumber = [number, ...number[]];

export const PlayerStatsSchema = z
  .object({
    attacks: AtLeastOneNumberSchema.optional(),
    betrayals: z.number().positive().optional(),
    boats: z.record(BoatUnitSchema, AtLeastOneNumberSchema).optional(),
    bombs: z.record(BombUnitSchema, AtLeastOneNumberSchema).optional(),
    gold: AtLeastOneNumberSchema.optional(),
    units: z.record(OtherUnitSchema, AtLeastOneNumberSchema).optional(),
  })
  .optional();
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;
