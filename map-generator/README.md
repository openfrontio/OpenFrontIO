# MapGenerator

This is a go-based tool to generate map files for OpenFront.

The map generator reads PNG files and converts pixels into terrain based primarily on the **Blue** channel.
Because only blue values are used, grayscale and other formats are fully supported. Many maps in `assets/maps/<mapname>` are grayscale.

Additional Guides, Tutorials, Scripts, Resources, and Third Party Unofficial Applications can be found on
the [Official Openfront Wiki](https://openfront.wiki/Map_Making)

## Installation

1. Install go <https://go.dev/doc/install>
2. Go to map-generator folder: `cd map-generator`
3. Install dependencies: `go mod download`
4. Run the generator for all maps: `go run .`

## Creating a new map

Maps are discovered automatically from the `assets/maps/` folders — `info.json` holds everything the game needs to know about a map.

1. Create a new folder in `assets/maps/<map_name>`
2. Create `assets/maps/<map_name>/image.png`
3. Create `assets/maps/<map_name>/info.json` (see below)
4. Run the generator for your map: `go run . --maps=<map_name>`

   By default, `go run .` will process all defined maps.

   Use `--maps` to process a single map:

   `go run . --maps=fourislands`

   To process a subset of maps, pass a comma-separated list:

   `go run . --maps=northamerica,world`

5. Find the output folder at `../resources/maps/<map_name>`

`go run .` formats every file it writes with Prettier as its last step (shelling out to `npx prettier --write`), so the output already matches `npm run format` — no separate formatting step needed. If `npx prettier` isn't available (e.g. `npm ci` hasn't been run), generation still succeeds but prints a warning; run `npm run format` from the root directory to format manually in that case.

`npm run gen-maps` (from the root directory) is equivalent to `go run .` for all maps.

## Output Files

- `../resources/maps/<map_name>/manifest.json` - JSON metadata containing map dimensions and land tile counts for all scales.
- `../resources/maps/<map_name>/map.bin` - Full-scale binary map data packed with terrain type and magnitude.
- `../resources/maps/<map_name>/map4x.bin` - 1/4 scale (half dimensions) binary map data used for mini-maps.
- `../resources/maps/<map_name>/map16x.bin` - 1/16 scale (quarter dimensions) binary map data used for mini-maps.
- `../resources/maps/<map_name>/thumbnail.webp` - WebP image thumbnail of the map.
- `../src/core/game/Maps.gen.ts` - Generated TypeScript (the `GameMapType` enum and the `maps` list of `MapInfo` objects) built from every map's info.json. Regenerated on every run, even with `--maps`.
- `../resources/lang/en.json` - The `map` section is rewritten with each map's display name. Regenerated on every run, even with `--maps`.

## Command Line Flags

- `--maps`: Optional comma-separated list of maps to process.
  - ex: `go run . --maps=world,eastasia,big_plains`

### Logging

- `--log-level`: Explicitly sets the log level.
  - ex: `go run . --log-level=debug`
  - values: `ALL`, `DEBUG`, `INFO` (default), `WARN`, `ERROR`.
- `--verbose` or `-v`: Adds additional logging and prefixes logs with the `[mapname]`. Alias of `--log-level=DEBUG`.
- `--debug-performance`: Adds additional logging for performance-based recommendations, sets `--log-level=DEBUG`.
- `--debug-removal`: Adds additional logging of removed island and lake position/size, sets `--log-level=DEBUG`.

The Generator outputs logs using `slog` with standard log-levels, and an additional ALL level.

The `--verbose`, `-v`, `--debug-performance`, and `--debug-removal` flags all set the log level to `DEBUG`.
`debug-performance` and `debug-removal` are opt-in on top of the debug log level, as they can produce wordy output. You must pass the specific flag to see the corresponding logs if the `log-level` is set to `DEBUG`.

Setting `--log-level=ALL` will output all possible logs, including all `DEBUG` tiers, regardless of whether the specific flags are passed.

## Create image.png

The map-generator will process your input file at `assets/maps/<map_name>/image.png` to generate the map
thumbnail and binary files. To create this `png` input file, you can crop the world map:

1. [Download world map (warning very large file)](https://drive.google.com/file/d/1W2oMPj1L5zWRyPhh8LfmnY3_kve-FBR2/view?usp=sharing)
2. Crop the file (recommend Gimp)

If you are doing work in image editing software or using automated tools, `./map_generator.go` contains documentation for:

- `Pixel` -> `Terrain Type & Magnitude` mapping in `GenerateMap`
- `Terrain Type` -> `Thumbnail Color` mapping in `getThumbnailColor`

### Impassable Terrain

Pure black pixels (`#000000` / `rgb(0, 0, 0)` with alpha ≥ 20) are encoded as **impassable terrain**. This is a solid, static void that:

- Cannot be owned, attacked, or nuked.
- Nuke trajectories cannot pass over it (just as they cannot leave the map border).
- Renders as the map background colour, making the map appear non-rectangular.

Use impassable terrain to carve out non-rectangular map shapes or to create barriers that divide regions without water.

In-Game, the color of a tile is determined dynamically based on its **Terrain Type** and **Magnitude**.

- Ocean default color definition: `../src/client/render/gl/render-settings.json` (user changeable via settings)
- Terrain color calculations: `../src/client/render/gl/utils/ColorUtils.ts#L50`

## Create info.json

The map-generator reads `assets/maps/<map_name>/info.json` to determine nation positions, starting coordinates, flags, and other map metadata.

### Example

```json
{
  "id": "MySampleMap",
  "name": "My Sample Map",
  "translation_key": "map.mysamplemap",
  "categories": ["europe", "featured"],
  "multiplayer_frequency": 4,
  "featured_rank": 5,
  "layers": [
    {
      "id": "roads",
      "placement": "land",
      "nukeable": true
    }
  ],
  "nations": [
    {
      "coordinates": [396, 364],
      "name": "United States",
      "flag": "us"
    },
    {
      "coordinates": [512, 280],
      "name": "Canada",
      "flag": "ca"
    }
  ]
}
```

### Fields

| Field                   | Required | Description                                                                                                                                                                                                                      |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | ✅       | `CamelCaseName` of the map. Must match the `assets/maps/<map_name>` folder name (case-insensitive). Becomes the `GameMapType` enum key.                                                                                          |
| `name`                  | ✅       | Canonical name — the `GameMapType` enum value. **Must never change** once the map ships (it is part of the wire format and stored in game records).                                                                              |
| `translation_key`       | ✅       | Key in `../resources/lang/en.json`. Must be `map.<foldername>`.                                                                                                                                                                  |
| `categories`            | ✅       | One or more category strings (see below). No duplicates. Must have at least one entry. Groups the map in the map picker.                                                                                                         |
| `multiplayer_frequency` |          | How often the map appears in the public multiplayer playlist. Use `0` (or omit) to exclude from rotation. Used as fallback when per-mode frequencies are not set.                                                                |
| `ffa_frequency`         |          | FFA lobby rotation weight. Overrides `multiplayer_frequency` for FFA lobbies. Use `0` to exclude from FFA. Omit to use `multiplayer_frequency`.                                                                                  |
| `team_frequency`        |          | Team lobby rotation weight. Overrides `multiplayer_frequency` for Team lobbies. Use `0` to exclude from Team. Omit to use `multiplayer_frequency`.                                                                               |
| `special_frequency`     |          | Special lobby rotation weight. Overrides `multiplayer_frequency` for Special lobbies. Use `0` to exclude from Special. Omit to use `multiplayer_frequency`.                                                                      |
| `disabled_modifiers`    |          | Array of modifier keys that should never be rolled for this map in special games (e.g. `["isRandomSpawn"]`).                                                                                                                     |
| `forced_modifiers`      |          | Array of modifiers always forced on in special games. Plain key (e.g. `"startingGold5M"`) or `"key:percentage"` (e.g. `"goldMultiplier:75"` = 75% chance). Counts toward the 3-modifier cap.                                     |
| `display_name`          |          | English display name written to `../resources/lang/en.json`. Defaults to `name`. Set only when the display name differs from the canonical name (e.g. `"MENA"`, `"Europe (Classic)"`).                                           |
| `featured_rank`         |          | Position in the featured grid (`1` = first). Requires `"featured"` in `categories`. Unranked featured maps sort after ranked ones, alphabetically.                                                                               |
| `special_team_count`    |          | Preferred team count for team/special games — see `SPECIAL_TEAM_MAPS` in `../src/server/MapPlaylist.ts`. Must be `0` or `≥ 2` (1 is not allowed).                                                                                |
| `custom_tribes`         |          | Array of tribe names or `{ "name": "...", "coordinates": [x, y] }` objects. Coordinates are optional (omit for random spawn). Tribe names must be unique and must not collide with `nations[].name`. Empty strings are rejected. |
| `themes`                |          | Array of theme strings for tribe name generation.                                                                                                                                                                                |
| `layers`                |          | Array of map layer definitions rendered between terrain and territory (see below).                                                                                                                                               |
| `nations`               |          | Array of nation objects (see below).                                                                                                                                                                                             |

### Categories

Each entry in `categories` must be one of:

`featured`, `new`, `world`, `continental`, `europe`, `asia`, `north_america`, `africa`, `south_america`, `oceania`, `antarctica`, `countries`, `cosmic`, `fictional`, `arcade`, `tournament`

Maps that straddle regions (e.g. Black Sea, Bering Strait) can list more than one. Add `featured` to show the map in the featured section of the map picker.

### Nations

Each nation object has:

| Field         | Required | Description                                                                                                                                                                                                                                       |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | ✅       | Display name of the nation.                                                                                                                                                                                                                       |
| `coordinates` |          | `[x, y]` position of the nation spawn. Origin is top-left, x extends right, y extends down. Omit for random spawn.                                                                                                                                |
| `flag`        |          | ISO 3166 country code (e.g. `"us"`, `"ca"`, `"de"`). The full list of supported codes is in `../src/client/data/countries.json`. For quick reference, see [ISO 3166 country codes](https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes). |

### Layers

Layers are PNG overlays rendered between terrain and territory, useful for decorations. Each layer is a separate PNG file in `assets/maps/<map_name>/` named `<id>.png`.

| Field       | Required | Description                                                                                                                                           |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | ✅       | Unique identifier for the layer. Also the PNG filename (without extension). Must be alphanumeric (hyphens allowed). Must not be `"image"` (reserved). |
| `placement` | ✅       | `"land"` or `"water"` — whether the layer sits on land (and impassable terrain) or water tiles.                                                       |
| `nukeable`  |          | If `true`, the layer is permanently destroyed in nuke impact radii. Defaults to `false`.                                                              |

Layer display names are stored in the `map_layers` section of `../resources/lang/en.json` (keyed by layer id). Players can disable layers in the graphics settings.

## Update CREDITS.md

Add License & Attribution information to `../CREDITS.md`. If you are unsure if
a map's license can be used, open an issue or ask in Discord before beginning work.

## Adding Flags

Flags can be added to `../resources/flags/<iso_code>.svg`

The country will need to be added to `../src/client/data/countries.json`

## To Enable In-Game

Everything is generated from the info.json files when the map-generator runs —
there are no manual steps:

- The `GameMapType` enum and the `maps` list (one `MapInfo` per map) are
  written to `../src/core/game/Maps.gen.ts`. Do not edit that file by hand.
- The `map` section of `../resources/lang/en.json` is rewritten with each
  map's `display_name` (or `name`). Translations to other languages are
  managed via Crowdin.

## Notes

- Islands smaller than 30 tiles (pixels) are automatically removed by the script.
- Bodies of water smaller than 200 tiles (pixels) are also removed.
- The map generator normalizes dimensions to multiples of 4. Any pixels beyond `Width - (Width % 4)` or `Height - (Height % 4)` are cropped.

For Performance Reasons:

- Maps should be between 2 - 3 million pixels square (area).
- Maps with over 3 million land tiles are not recommended.
- Average land tile count is around 1 - 2 million.

## 🛠️ Development Tools

- **Format map-generator code**:

  ```bash
  go fmt .
  ```

- **Output Map Generator Documentation**:

  ```bash
  go doc -cmd -u -all
  ```

  The map-generator is a cli tool, to get any visibility, we pass `-cmd`. It also
  does not expose any API, so we use `-u` and `-all` to show all documentation for
  unexposed values.

  _Known Bug_ Using `-http` does not respect the other flags and only renders the README
