# MapGenerator

This is a tool to generate map files for OpenFront.

## Installation

1. Install go <https://go.dev/doc/install>
2. Install dependencies: `go mod download`
3. Run the generator: `go run .`

## Creating a new map

1. Create a new folder in `assets/maps/<map_name>`
2. Create image.png
3. Create info.json with name and countries
4. Add the map name in main.go
5. Run the generator: `go run .`
6. Find the output folder at `../resources/maps/<map_name>`

By default, this will process all defined maps.

Use `--maps` to process a single map:

`go run . --maps=fourislands`

To process a subset of maps, pass a comma-separated list:

`go run . --maps=northamerica,world`

## Create image.png

1. [Download world map (warning very large file)](https://drive.google.com/file/d/1W2oMPj1L5zWRyPhh8LfmnY3_kve-FBR2/view?usp=sharing)
2. Crop the file (recommend Gimp)

- We recommend roughly 2 million pixels for performance reasons
- Do not go over 4 million pixels.

## Create info.json

- Look at existing info.json for structure
- [Use country codes found here](https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes)

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

## To Enable In-Game

- Add a translation for the map name to `resources/lang/en.json`
- Add the MapDescription `src/client/components/Maps.ts`
- Add the numPlayersConfig `src/core/configuration/DefaultConfig.ts`
- Add the GameMapType `src/core/game/Game.ts`
- To add to the map playlist, modify `src/server/MapPlaylist.ts`

## Notes

- Islands smaller than 30 tiles (pixels) are automatically removed by the script.
- Bodies of water smaller than 200 tiles (pixels) are also removed.
- For details on how pixel values map to terrain types and gameplay mechanics, see [README_TERRAIN.md](README_TERRAIN.md).

## 🛠️ Development Tools

- **Format map-generator code**:

  ```bash
  go fmt .
  ```

- **Output Map Generator Documentation**:

  The map-generator is a cli tool, to get any visibility, we pass `-cmd`. It also
  does not expose any API, so we use `-u` and `-all` to show all documentation for
  unexposed values.

  _Known Bug_ Using `-http` does not respect the other flags and only renders the README

  ```bash
  go doc -cmd -u -all
  ```
