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

/**
 * A warship of the nation at a water tile, as if built in play, which
 * patrols around that tile once the game starts.
 */
export const PlaceWarshipCommandSchema = z.object({
  type: z.literal("place_warship"),
  tile: Tile,
  nation: ID,
});

export const RemoveWarshipCommandSchema = z.object({
  type: z.literal("remove_warship"),
  tile: Tile,
});

/**
 * Makes two nations allies from the start, as an accepted request would at
 * tick 0: the alliance runs for the config's alliance duration and can be
 * renewed or broken like any other. The first nation is the requestor.
 */
export const AddAllianceCommandSchema = z.object({
  type: z.literal("add_alliance"),
  nations: z.tuple([ID, ID]),
});

/** Takes back an alliance `add_alliance` made, as if it had never been. */
export const RemoveAllianceCommandSchema = z.object({
  type: z.literal("remove_alliance"),
  nations: z.tuple([ID, ID]),
});

// What the author decides for a tile: 0 for water, 0x80 | elevation (0-30)
// for land, 0x9f for impassable. These are the bits of the terrain byte the
// map generator takes from the image; the engine derives the rest.
const AuthoredTerrain = z
  .int()
  .min(0)
  .max(0x9f)
  .refine((v) => v === 0 || v >= 0x80, "not an authored terrain byte");

/**
 * The authored bits of a full terrain byte (one from a map file or the
 * engine's map): 0 for water, else the land bit and the elevation, which is
 * 31 for impassable. Drops the shoreline and ocean bits and water depth.
 */
export function authoredTerrain(b: number): number {
  return (b & 0x80) === 0 ? 0 : b & 0x9f;
}

// The most tiles one set_terrain takes. The repair keeps sets of the edited
// tiles and their neighbours, which must stay under the 2^24 entries a JS
// Set holds. A larger edit (a heightmap import) is sent as several.
export const MAX_TERRAIN_BATCH = 1 << 20;

/**
 * Writes the authored terrain of the tiles (`terrain[i]` for `tiles[i]`) and
 * repairs the shoreline, water depth and minimap around them. A tile that
 * changes between water, land and impassable loses its owner and its units
 * first. The ocean bit waits for `end_terrain_edit`, the water graph for
 * the rebuild before test play.
 */
export const SetTerrainCommandSchema = z.object({
  type: z.literal("set_terrain"),
  tiles: z.array(Tile).max(MAX_TERRAIN_BATCH),
  terrain: z.array(AuthoredTerrain).max(MAX_TERRAIN_BATCH),
});

/**
 * Ends a run of `set_terrain` commands (a stroke): redoes the ocean bit
 * and the water depth of bodies with no coast over the whole map.
 */
export const EndTerrainEditCommandSchema = z.object({
  type: z.literal("end_terrain_edit"),
});

/**
 * Runs the full terrain pass and writes the terrain out as map files, which
 * the result carries (docs/ScenarioEditor.md, "Finalising for export"). It
 * changes nothing else, so editing can carry on.
 */
export const ExportTerrainCommandSchema = z.object({
  type: z.literal("export_terrain"),
});

/**
 * Makes the game ready to play: AI for every nation, executions for the
 * structures, warships and the running game, spawn phase over. Sent to a
 * second engine started on the exported map files, which is then
 * snapshotted and discarded; it can't be undone.
 */
export const FinalizeCommandSchema = z.object({
  type: z.literal("finalize"),
});

export const EditorCommandSchema = z.discriminatedUnion("type", [
  AddNationCommandSchema,
  RemoveNationCommandSchema,
  SetNationCommandSchema,
  SetOwnerCommandSchema,
  PlaceStructureCommandSchema,
  RemoveStructureCommandSchema,
  PlaceWarshipCommandSchema,
  RemoveWarshipCommandSchema,
  AddAllianceCommandSchema,
  RemoveAllianceCommandSchema,
  SetTerrainCommandSchema,
  EndTerrainEditCommandSchema,
  ExportTerrainCommandSchema,
  FinalizeCommandSchema,
]);
export type EditorCommand = z.infer<typeof EditorCommandSchema>;
