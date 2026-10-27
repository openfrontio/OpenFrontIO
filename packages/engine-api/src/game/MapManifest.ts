import tribeNameThemes from "resources/tribeNameThemes.json";
import { z } from "zod";
import { mapCategoryOrder, type SpecialModifierKey } from "./Maps.gen";

// Both schemas are strict: an unknown key is an error, so a misspelt field
// fails CI instead of silently falling back to its default.

const specialModifierKeys = [
  "isRandomSpawn",
  "isCompact",
  "isCrowded",
  "isHardNations",
  "startingGold1M",
  "startingGold5M",
  "startingGold25M",
  "goldMultiplier",
  "isAlliancesDisabled",
  "isNukesDisabled",
  "isSAMsDisabled",
  "isPeaceTime",
  "isWaterNukes",
  "isDoomsdayClock",
] as const;

// Fails to compile when this list and the generated SpecialModifierKey
// union (map-generator/codegen.go) stop matching in either direction.
type ListedModifierKey = (typeof specialModifierKeys)[number];
const modifierKeysMatchCodegen: [
  Exclude<SpecialModifierKey, ListedModifierKey>,
  Exclude<ListedModifierKey, SpecialModifierKey>,
] extends [never, never]
  ? true
  : false = true;
void modifierKeysMatchCodegen;

const modifierKeyPattern = specialModifierKeys.join("|");

// The API (openfrontio/infra `GameMapTypeSchema`, and the `maps.name`
// varchar(29) column) rejects a game record whose map name breaks these.
const API_MAP_NAME = /^[a-zA-Z0-9\s().-]+$/;
const API_MAP_NAME_MAX_LENGTH = 29;

const Coordinates = z
  .tuple([z.int().nonnegative(), z.int().nonnegative()])
  .describe("[x, y] tile position. Origin is top-left; y extends down.");

export const NationSchema = z.strictObject({
  name: z.string().min(1),
  coordinates: Coordinates.optional().describe(
    "Spawn position. Omit for a random spawn.",
  ),
  flag: z
    .string()
    .optional()
    .describe(
      "Flag file name in resources/flags/ without the .svg suffix. Empty means no flag.",
    ),
});

export const MapLayerSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/)
    .refine((id) => id !== "image", {
      message: '"image" is reserved for the terrain source',
    })
    .describe("Layer id. Also the PNG file name without the extension."),
  placement: z
    .enum(["land", "water"])
    .describe("Whether the layer covers land or water tiles."),
  nukeable: z
    .boolean()
    .optional()
    .describe("Permanently destroyed inside nuke impact radii."),
  alpha: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Initial opacity for the player's layer-alpha slider."),
});

export const SpawnAreaSchema = z.strictObject({
  x: z.int().nonnegative(),
  y: z.int().nonnegative(),
  width: z.int().positive(),
  height: z.int().positive(),
});

export const CustomTribeSchema = z.union([
  z.string().min(1),
  z.strictObject({
    name: z.string().min(1),
    coordinates: Coordinates.optional(),
  }),
]);

const MapMetadataSchema = z.strictObject({
  width: z.int().positive(),
  height: z.int().positive(),
  num_land_tiles: z.int().nonnegative(),
});

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

const mapInfoShape = {
  id: z
    .string()
    .regex(/^[A-Z][A-Za-z0-9]*$/)
    .describe("UpperCamelCase folder name; the GameMapType enum key."),
  name: z
    .string()
    .min(1)
    .max(API_MAP_NAME_MAX_LENGTH)
    .regex(API_MAP_NAME)
    .describe(
      "Canonical wire-format name. Never change it once the map ships.",
    ),
  translation_key: z.string().regex(/^map\.[a-z0-9]+$/),
  display_name: z
    .string()
    .min(1)
    .optional()
    .describe("English display name when it differs from name."),
  categories: z
    .array(z.enum(mapCategoryOrder))
    .min(1)
    .refine(unique, { message: "categories must not repeat" }),
  featured_rank: z
    .int()
    .positive()
    .optional()
    .describe("Position in the featured grid, 1 first."),
  special_team_count: z
    .int()
    .min(2)
    .optional()
    .describe("Preferred team count in team and special games."),
  disabled_modifiers: z.array(z.enum(specialModifierKeys)).optional(),
  forced_modifiers: z
    .array(
      z
        .string()
        .regex(new RegExp(`^(${modifierKeyPattern})(:(100|[1-9][0-9]?))?$`))
        .describe('A modifier key, or "key:percentage" for a roll chance.'),
    )
    .optional(),
  themes: z
    .array(z.enum(Object.keys(tribeNameThemes)))
    .optional()
    .describe("Tribe name themes from resources/tribeNameThemes.json."),
  custom_tribes: z.array(CustomTribeSchema).optional(),
  nations: z.array(NationSchema),
  additionalNations: z
    .array(NationSchema)
    .optional()
    .describe(
      "Fallback nations used when a game asks for more than nations lists.",
    ),
  teamGameSpawnAreas: z
    .record(z.string().regex(/^[0-9]+$/), z.array(SpawnAreaSchema).min(1))
    .optional()
    .describe("Spawn rectangles per team count."),
  layers: z
    .array(MapLayerSchema)
    .refine((layers) => unique(layers.map((l) => l.id)), {
      message: "layer ids must be unique",
    })
    .optional(),
};

const featuredRankRule = [
  (info: { featured_rank?: number; categories: string[] }) =>
    info.featured_rank === undefined || info.categories.includes("featured"),
  { message: 'featured_rank needs "featured" in categories' },
] as const;

/** The authored map-generator/assets/maps/<map>/info.json. */
export const MapInfoSchema = z
  .strictObject({
    $schema: z.string().optional(),
    ...mapInfoShape,
  })
  .refine(...featuredRankRule);

/**
 * resources/maps/<map>/manifest.json: info.json without $schema, plus the
 * dimensions the generator measured. The engine gets it in MapFiles.
 */
export const MapManifestSchema = z
  .strictObject({
    ...mapInfoShape,
    map: MapMetadataSchema,
    map4x: MapMetadataSchema,
    map16x: MapMetadataSchema,
  })
  .refine(...featuredRankRule)
  .superRefine((manifest, ctx) => {
    const { width, height } = manifest.map;
    const inBounds = ([x, y]: readonly [number, number]) =>
      x < width && y < height;
    const groups = {
      nations: manifest.nations,
      additionalNations: manifest.additionalNations ?? [],
      custom_tribes: (manifest.custom_tribes ?? []).filter(
        (t) => typeof t !== "string",
      ),
    };
    for (const [group, entries] of Object.entries(groups)) {
      entries.forEach((entry, i) => {
        if (entry.coordinates !== undefined && !inBounds(entry.coordinates)) {
          ctx.addIssue({
            code: "custom",
            path: [group, i, "coordinates"],
            message: `outside the ${width}x${height} map`,
          });
        }
      });
    }
    for (const [teams, areas] of Object.entries(
      manifest.teamGameSpawnAreas ?? {},
    )) {
      areas.forEach((a, i) => {
        if (a.x + a.width > width || a.y + a.height > height) {
          ctx.addIssue({
            code: "custom",
            path: ["teamGameSpawnAreas", teams, i],
            message: `outside the ${width}x${height} map`,
          });
        }
      });
    }
  });

export type MapManifest = z.infer<typeof MapManifestSchema>;
export type MapMetadata = z.infer<typeof MapMetadataSchema>;
export type Nation = z.infer<typeof NationSchema>;
export type AdditionalNation = Nation;
export type MapLayer = z.infer<typeof MapLayerSchema>;
export type LayerPlacement = MapLayer["placement"];
