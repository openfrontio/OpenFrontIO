Use this folder as a safe copy of the world map when you want to add oil terrain.

How to mark oil:
- Open [image.png](/home/luke/CLASS/EECS/481/final/map-generator/assets/maps/worldoil/image.png) in an image editor that preserves exact RGBA values.
- Paint traversible oil tiles with exact `RGB(24, 24, 24)` and full opacity.
- Do not use transparency for oil. Transparent pixels are treated as water.
- Leave all non-oil land and water colors unchanged unless you intentionally want to reshape terrain.

What the game does with that color:
- `RGB(24, 24, 24)` is packed as a dedicated oil terrain value.
- Oil is land, so it remains traversible.
- Oil renders as a dark terrain in the terrain view.
- Oil currently behaves like plains for land movement and attack balance.

How to generate outputs after painting:
- Run `cd map-generator && go run .`
- The generated files will be written under `resources/maps/worldoil/`

Suggested workflow:
- Paint small clusters instead of giant solid regions so oil reads like deposits.
- Keep oil away from coastlines unless you specifically want offshore-looking traversible deposits.
- Start by testing a few isolated patches, generate the map, and inspect the terrain view in-game.
