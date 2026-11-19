import { z } from "zod";
import { Structures } from "./game/GameTypes";
import { ID } from "./Schemas";

/**
 * Scenario editor commands (docs/ScenarioEditor.md, "Editor mode in the
 * worker"). They are not intents: only a worker started in editor mode takes
 * them, one per `editor_command` message, and applies each at once, without
 * a tick.
 */

const NationName = z.string().min(1).max(64);
// A flag file name in resources/flags/ without the .svg suffix; null for none.
const NationFlag = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^/\\]+$/)
  .nullable();
const Amount = z.int().nonnegative();
const Tile = z.int().nonnegative();

export const AddNationCommandSchema = z.object({
  type: z.literal("add_nation"),
  id: ID,
  name: NationName,
  flag: NationFlag,
});

export const RemoveNationCommandSchema = z.object({
  type: z.literal("remove_nation"),
  id: ID,
});

/** Changes only the fields given. */
export const SetNationCommandSchema = z.object({
  type: z.literal("set_nation"),
  id: ID,
  name: NationName.optional(),
  flag: NationFlag.optional(),
  troops: Amount.optional(),
  gold: Amount.optional(),
  /** A human may be assigned this nation when the scenario is played. */
  playable: z.boolean().optional(),
});

/** Gives the tiles to a nation, or to nobody when `owner` is null. */
export const SetOwnerCommandSchema = z.object({
  type: z.literal("set_owner"),
  tiles: z.array(Tile),
  owner: ID.nullable(),
});

export const PlaceStructureCommandSchema = z.object({
  type: z.literal("place_structure"),
  unit: z.enum(Structures.types),
  tile: Tile,
  nation: ID,
  level: z.int().min(1).max(100),
});

export const RemoveStructureCommandSchema = z.object({
  type: z.literal("remove_structure"),
  tile: Tile,
});

export const EditorCommandSchema = z.discriminatedUnion("type", [
  AddNationCommandSchema,
  RemoveNationCommandSchema,
  SetNationCommandSchema,
  SetOwnerCommandSchema,
  PlaceStructureCommandSchema,
  RemoveStructureCommandSchema,
]);
export type EditorCommand = z.infer<typeof EditorCommandSchema>;
