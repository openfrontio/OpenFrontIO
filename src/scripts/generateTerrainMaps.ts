import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { generateMap } from "./TerrainMapGenerator.js";

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
  "Pangaea",
  "Iceland",
  "TwoSeas",
  "Japan",
  "KnownWorld",
];

const removeSmall = true;

async function processSingleMap(mapName: string) {
  console.log(`[${mapName}] Starting processing...`);
  const startTime = performance.now();

  try {
    const mapPath = path.resolve(
      process.cwd(),
      "resources",
      "maps",
      `${mapName}.png`,
    );
    const outputPath = path.join(
      process.cwd(),
      "resources",
      "maps",
      `${mapName}.bin`,
    );
    const miniOutputPath = path.join(
      process.cwd(),
      "resources",
      "maps",
      `${mapName}Mini.bin`,
    );
    const thumbOutputPath = path.join(
      process.cwd(),
      "resources",
      "maps",
      `${mapName}Thumb.webp`,
    );

    console.log(`[${mapName}] Reading input PNG: ${mapPath}`);
    const imageBuffer = await fs.readFile(mapPath);

    console.log(`[${mapName}] Calling generateMap...`);
    const generationStartTime = performance.now();
    const {
      map: mainMap,
      miniMap,
      thumb,
    } = await generateMap(imageBuffer, removeSmall, mapName);
    const generationEndTime = performance.now();
    console.log(
      `[${mapName}] generateMap completed in ${(generationEndTime - generationStartTime).toFixed(2)} ms`,
    );

    console.log(`[${mapName}] Writing output files...`);
    const writeStartTime = performance.now();

    const sharpThumbPromise = sharp(thumb.data, {
      raw: {
        width: thumb.width,
        height: thumb.height,
        channels: 4,
      },
    })
      .webp({ quality: 45 })
      .toFile(thumbOutputPath);

    const writeMainMapPromise = fs.writeFile(outputPath, mainMap);
    const writeMiniMapPromise = fs.writeFile(miniOutputPath, miniMap);

    await Promise.all([
      writeMainMapPromise,
      writeMiniMapPromise,
      sharpThumbPromise,
    ]);

    const writeEndTime = performance.now();
    const totalTime = performance.now() - startTime;
    console.log(
      `[${mapName}] Output files written in ${(writeEndTime - writeStartTime).toFixed(2)} ms`,
    );
    console.log(
      `[${mapName}] Finished processing in ${totalTime.toFixed(2)} ms`,
    );
  } catch (error) {
    console.error(`[${mapName}] Error processing map:`, error);
    throw error;
  }
}

async function main() {
  console.log(`Starting terrain map generation for ${maps.length} maps...`);
  const overallStartTime = performance.now();

  try {
    for (const mapName of maps) {
      await processSingleMap(mapName);
    }

    const overallEndTime = performance.now();
    console.log(
      `\nAll terrain maps generated successfully in ${(overallEndTime - overallStartTime).toFixed(2)} ms`,
    );
  } catch (error) {
    console.error("\nError during terrain map generation process:", error);
    process.exit(1);
  }
}

main();
