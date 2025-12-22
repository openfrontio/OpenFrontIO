# MapGenerator

This is a go-based tool to generate map files for OpenFront.

The map generator reads PNG files and converts pixels into terrain based primarily on the **Blue** channel.
Because only blue values are used, grayscale and other formats are fully supported. Many maps in `assets/maps/<mapname>` are grayscale.

Additional Guides, Tutorials, Scripts, Resources, and Third Party Unofficial Applications can be found on
the [Official Openfront Wiki](https://openfront.wiki/Map_Making)

## Installation

1. Install go <https://go.dev/doc/install>
2. Install dependencies: `go mod download`
3. Run the generator: `go run .`

## Creating a new map

1. Create a new folder in `assets/maps/<map_name>`
2. Create `assets/maps/<map_name>/image.png`
3. Create `assets/maps/<map_name>/info.json` with name and countries
4. Add the map name in `main.go` The `<name>` in `{Name: "<name>"},` should match the `<map-name>` folder at `assets/maps/<map_name>`
5. Run the generator: `go run .`
6. Find the output folder at `../resources/maps/<map_name>`

By default, this will process all defined maps.

Use `--maps` to process a single map:

`go run . --maps=fourislands`

To process a subset of maps, pass a comma-separated list:

`go run . --maps=northamerica,world`

## Create image.png

The map-generator will process your input file at `assets/maps/<map_name>/image.png` to generate the map
thumbnail and binary files. To create this `png` input file, you can crop the world map:

1. [Download world map (warning very large file)](https://drive.google.com/file/d/1W2oMPj1L5zWRyPhh8LfmnY3_kve-FBR2/view?usp=sharing)
2. Crop the file (recommend Gimp)

If you are doing work in image editing software or using automated tools, `./map_generator.go` contains documentation for:

- `Pixel` -> `Terrain Type & Magnitude` mapping in `GenerateMap`
- `Terrain Type` -> `Thumbnail Color` mapping in `getThumbnailColor`

In-Game, terrain is rendered using themes. The color of a tile is determined dynamically based on
its **Terrain Type** and **Magnitude**. Theme Files:

- `../src/core/configuration/PastelTheme.ts` (Light)
- `../src/core/configuration/PastelThemeDark.ts` (Dark).

## Create info.json

The map-generator will process your input file at `assets/maps/<map_name>/info.json` to determine the
position of Nations, their starting coordinates, and any flags.

Example:

```json
{
  "name": "MySampleMap",
  "nations": [
    {
      "coordinates": [396, 364],
      "name": "United States",
      "flag": "us"
    }
  ]
}
```

`coordinates` is x/y position of the nation spawn on the map. Origin is at top left, with x extending right and y extending down

`name` is a `CamelCaseName` of your map. It is used to enable the map in-game.

`flag` is the code for a country

- The full list of supported codes can be seen in `../src/client/data/countries.json` - all ISO_3166 codes are supported, with several additions.

- For quick reference, [Use country codes found here](https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes)

## Update CREDITS.md

Add License & Attribution information to `../CREDITS.md`. If you are unsure if
a map's license can be used, open an issue or ask in Discord before beginning work.

## Adding Flags

Flags can be added to `../resources/flags/<iso_code>.svg`

The country will need to be added to `../src/client/data/countries.json`

## To Enable In-Game

Using the `name` from your json:

- Add to the MapDescription `../src/client/components/Maps.ts`
- Add to the numPlayersConfig `../src/core/configuration/DefaultConfig.ts`
- Add to the mapCategories `../src/core/game/Game.ts`
- Add to the map playlist `../src/server/MapPlaylist.ts`
- Add to the `map` translation object in `../resources/lang/en.json`

## Notes

- Maps should be between 2 - 3 million pixels square (area)
- Islands smaller than 30 tiles (pixels) are automatically removed by the script.
- Bodies of water smaller than 200 tiles (pixels) are also removed.
- The map generator normalizes dimensions to multiples of 4. Any pixels beyond `Width - (Width % 4)` or `Height - (Height % 4)` are cropped.

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
