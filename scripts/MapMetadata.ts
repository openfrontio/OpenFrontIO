import fs from "node:fs/promises";

import { GameMapType } from "../src/core/game/Game";
import { MapManifest } from "../src/core/game/TerrainMapLoader";

const isLand = (b: number) => Boolean(b & (1 << 7));

async function FixAllMapTileCt() {
  for (const mapTypeKey of Object.keys(GameMapType)) {
    const fileName = mapTypeKey.toLowerCase();
    const mapType = GameMapType[mapTypeKey as keyof typeof GameMapType];

    const manifest = JSON.parse(
      await fs.readFile(`./resources/maps/${fileName}/manifest.json`, "utf-8"),
    ) as MapManifest;
    const { map, mini_map } = manifest;

    const bin = await fs.readFile(`./resources/maps/${fileName}/map.bin`);
    const miniBin = await fs.readFile(
      `./resources/maps/${fileName}/mini_map.bin`,
    );

    let numLand = 0;
    let numLandMini = 0;

    for (let i = 0; i < map.width * map.height; i++)
      if (isLand(bin[i])) numLand++;
    for (let i = 0; i < mini_map.width * mini_map.height; i++)
      if (isLand(miniBin[i])) numLandMini++;

    if (map.num_land_tiles !== numLand)
      console.log(
        `Map "${mapType}" has incorrect count. Current: ${map.num_land_tiles}, Correct: ${numLand}`,
      );
    if (mini_map.num_land_tiles !== numLandMini)
      console.log(
        `Map "${mapType}" (mini) has incorrect count. Current: ${mini_map.num_land_tiles}, Correct: ${numLandMini}`,
      );

    const shouldCorrect =
      map.num_land_tiles !== numLand || mini_map.num_land_tiles !== numLandMini;
    if (!shouldCorrect) continue;

    await fs.writeFile(
      `./resources/maps/${fileName}/manifest.json`,
      JSON.stringify(
        {
          ...manifest,
          map: {
            ...manifest.map,
            num_land_tiles: numLand,
          },
          mini_map: {
            ...manifest.mini_map,
            num_land_tiles: numLandMini,
          },
        },
        undefined,
        2,
      ),
    );
  }
}

FixAllMapTileCt().then(() => {
  console.log("Success");
  process.exit(0);
});
