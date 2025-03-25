import { encodePNGToStream } from "pureimage";
import { generateMap } from "./TerrainMapGenerator.js";
import path from "path";
import fs from "fs/promises";
import { WriteStream, createWriteStream } from "fs";

const maps = [
  "Africa",
  "Asia",
  "WorldMap",
  "BlackSea",
  "Europe",
  "Mars",
  "Mena",
  "Oceania",
  "NorthAmerica",
  "SouthAmerica",
  "Britannia",
  "GatewayToTheAtlantic",
  "Australia",
  "Iceland",
];

const removeSmall = true;

async function loadTerrainMaps() {
  await Promise.all(
    maps.map(async (map) => {
      const mapPath = path.resolve(
        process.cwd(),
        "resources",
        "maps",
        map + ".png",
      );
      const imageBuffer = await fs.readFile(mapPath);
      const {
        map: mainMap,
        miniMap,
        thumb,
      } = await generateMap(imageBuffer, removeSmall, map);

      const outputPath = path.join(
        process.cwd(),
        "resources",
        "maps",
        map + ".bin",
      );
      const miniOutputPath = path.join(
        process.cwd(),
        "resources",
        "maps",
        map + "Mini.bin",
      );
      const thumbOutputPath = path.join(
        process.cwd(),
        "resources",
        "maps",
        map + "Thumb.png",
      );
      const thumbOutStream: WriteStream = createWriteStream(
        thumbOutputPath,
        "binary",
      );

      await Promise.all([
        fs.writeFile(outputPath, mainMap),
        fs.writeFile(miniOutputPath, miniMap),
        encodePNGToStream(thumb, thumbOutStream),
      ]);
    }),
  );
}

async function main() {
  try {
    await loadTerrainMaps();
    console.log("Terrain maps generated successfully");
  } catch (error) {
    console.error("Error generating terrain maps:", error);
    process.exit(1);
  }
}

main();
