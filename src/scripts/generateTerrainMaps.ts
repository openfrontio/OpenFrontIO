import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { generateMap } from "./TerrainMapGenerator.js";

const maps = [
  "Africa",
  "Asia",
  "WorldMap",
  "WorldMapGiant",
  "BlackSea",
  "Europe",
  "EuropeClassic",
  "Mars",
  "Mena",
  "Oceania",
  "NorthAmerica",
  "SouthAmerica",
  "Britannia",
  "GatewayToTheAtlantic",
  "Australia",
  "Pangaea",
  "Iceland",
  "BetweenTwoSeas",
  "EastAsia",
  "KnownWorld",
  "FaroeIslands",
  "DeglaciatedAntarctica",
  "FalklandIslands",
  "Baikal",
  "Halkidiki",
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
        map + "Thumb.webp",
      );

      await Promise.all([
        fs.writeFile(outputPath, mainMap),
        fs.writeFile(miniOutputPath, miniMap),
        sharp(Buffer.from(thumb.data), {
          raw: {
            width: thumb.width,
            height: thumb.height,
            channels: 4,
          },
        })
          .webp({ quality: 45 })
          .toFile(thumbOutputPath),
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
