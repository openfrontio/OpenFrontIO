import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";
import { generateMap } from "./TerrainMapGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticDir = path.resolve(__dirname, "../../");

const configPath = path.join(staticDir, "resources", "maps.config.json");
const maps: string[] = JSON.parse(await fs.readFile(configPath, "utf-8"));

const removeSmall = true;

async function loadTerrainMaps() {
  await Promise.all(
    maps.map(async (map) => {
      const mapPath = path.resolve(
        staticDir,
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
        staticDir,
        "resources",
        "maps",
        map + ".bin",
      );
      const miniOutputPath = path.join(
        staticDir,
        "resources",
        "maps",
        map + "Mini.bin",
      );
      const thumbOutputPath = path.join(
        staticDir,
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
  }
}

main();
