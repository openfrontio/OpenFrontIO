import { z } from "zod/v4";
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

export const unitTypeToBombUnit = {
  [UnitType.AtomBomb]: "abomb",
  [UnitType.HydrogenBomb]: "hbomb",
  [UnitType.MIRV]: "mirv",
  [UnitType.MIRVWarhead]: "mirvw",
} as const satisfies Record<NukeType, BombUnit>;

export const BoatUnitSchema = z.union([z.literal("trade"), z.literal("trans")]);
export type BoatUnit = z.infer<typeof BoatUnitSchema>;
export type BoatUnitType = UnitType.TradeShip | UnitType.TransportShip;

// export const unitTypeToBoatUnit = {
//   [UnitType.TradeShip]: "trade",
//   [UnitType.TransportShip]: "trans",
// } as const satisfies Record<BoatUnitType, BoatUnit>;

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

export const unitTypeToOtherUnit = {
  [UnitType.City]: "city",
  [UnitType.DefensePost]: "defp",
  [UnitType.MissileSilo]: "silo",
  [UnitType.Port]: "port",
  [UnitType.SAMLauncher]: "saml",
  [UnitType.Warship]: "wshp",
} as const satisfies Record<OtherUnitType, OtherUnit>;

// Attacks
export const ATTACK_INDEX_SENT = 0; // Outgoing attack troops
export const ATTACK_INDEX_RECV = 1; // Incmoing attack troops
export const ATTACK_INDEX_CANCEL = 2; // Cancelled attack troops

// Boats
export const BOAT_INDEX_SENT = 0; // Boats launched
export const BOAT_INDEX_ARRIVE = 1; // Boats arrived
export const BOAT_INDEX_CAPTURE = 2; // Boats captured
export const BOAT_INDEX_DESTROY = 3; // Boats destroyed

// Bombs
export const BOMB_INDEX_LAUNCH = 0; // Bombs launched
export const BOMB_INDEX_LAND = 1; // Bombs landed
export const BOMB_INDEX_INTERCEPT = 2; // Bombs intercepted

// Gold
export const GOLD_INDEX_WORK = 0; // Gold earned by workers
export const GOLD_INDEX_WAR = 1; // Gold earned by conquering players
export const GOLD_INDEX_TRADE = 2; // Gold earned by trade ships
export const GOLD_INDEX_STEAL = 3; // Gold earned by capturing trade ships

// Other Units
export const OTHER_INDEX_BUILT = 0; // Structures and warships built
export const OTHER_INDEX_DESTROY = 1; // Structures and warships destroyed
export const OTHER_INDEX_CAPTURE = 2; // Structures captured
export const OTHER_INDEX_LOST = 3; // Structures/warships destroyed/captured by others
export const OTHER_INDEX_UPGRADE = 4; // Structures upgraded

const BigIntStringSchema = z.preprocess((val) => {
  if (typeof val === "string" && /^\d+$/.test(val)) return BigInt(val);
  if (typeof val === "bigint") return val;
  return val;
}, z.bigint());

const AtLeastOneNumberSchema = BigIntStringSchema.array().min(1);
export type AtLeastOneNumber = z.infer<typeof AtLeastOneNumberSchema>;

export const PlayerStatsSchema = z
  .object({
    attacks: AtLeastOneNumberSchema.optional(),
    betrayals: BigIntStringSchema.optional(),
    boats: z.partialRecord(BoatUnitSchema, AtLeastOneNumberSchema).optional(),
    bombs: z.partialRecord(BombUnitSchema, AtLeastOneNumberSchema).optional(),
    gold: AtLeastOneNumberSchema.optional(),
    units: z.partialRecord(OtherUnitSchema, AtLeastOneNumberSchema).optional(),
  })
  .optional();
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;
