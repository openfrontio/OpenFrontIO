import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { generateMap as generateTerrainMapData } from "./TerrainMapGenerator.js";

function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function toLowerCaseName(str: string): string {
  return str.toLowerCase();
}

async function insertIntoFile(
  filePath: string,
  insertionPointMarker: string | RegExp,
  newContent: string,
  position: "before" | "after" = "before",
  ensureNewLine: boolean = true,
  ensureIndentation: boolean = true,
  markerIsBlock: boolean = false,
) {
  try {
    console.log(`  Updating ${path.basename(filePath)}...`);
    const absolutePath = path.resolve(process.cwd(), filePath);
    let fileContent = await fs.readFile(absolutePath, "utf-8");

    let insertionIndex = -1;
    let baseIndentation = "";
    let originalMatchLength = 0;

    if (typeof insertionPointMarker === "string") {
      insertionIndex = fileContent.indexOf(insertionPointMarker);
      if (insertionIndex !== -1 && position === "after") {
        insertionIndex += insertionPointMarker.length;
        const nextLineStartIndex =
          fileContent.indexOf("\n", insertionIndex) + 1;
        if (nextLineStartIndex > 0) {
          const nextLineEndIndex = fileContent.indexOf(
            "\n",
            nextLineStartIndex,
          );
          const nextLine = fileContent.substring(
            nextLineStartIndex,
            nextLineEndIndex > -1 ? nextLineEndIndex : fileContent.length,
          );
          const indentationMatch = nextLine.match(/^(\s*)/);
          if (indentationMatch) {
            baseIndentation = indentationMatch[1];
          }
          insertionIndex = nextLineStartIndex;
        } else {
          if (!fileContent.endsWith("\n")) {
            fileContent += "\n";
            insertionIndex++;
          }
          const lineStartIndex =
            fileContent.lastIndexOf("\n", insertionIndex - 2) + 1;
          const line = fileContent.substring(
            lineStartIndex,
            insertionIndex - 1,
          );
          const indentationMatch = line.match(/^(\s*)/);
          if (indentationMatch) {
            baseIndentation = indentationMatch[1];
          }
        }
      } else if (insertionIndex !== -1 && position === "before") {
        const lineStartIndex =
          fileContent.lastIndexOf("\n", insertionIndex - 1) + 1;
        const lineEndIndex = fileContent.indexOf("\n", insertionIndex);
        const line = fileContent.substring(
          lineStartIndex,
          lineEndIndex > -1 ? lineEndIndex : fileContent.length,
        );
        const indentationMatch = line.match(/^(\s*)/);
        if (indentationMatch) {
          baseIndentation = indentationMatch[1];
        }
        insertionIndex = lineStartIndex;
      }
    } else {
      const match = fileContent.match(insertionPointMarker);
      if (match && match.index !== undefined) {
        insertionIndex = match.index;
        originalMatchLength = match[0].length;

        if (markerIsBlock && position === "before") {
          const closingBraceIndexInMatch = match[0].lastIndexOf("}");
          if (closingBraceIndexInMatch !== -1) {
            const absoluteClosingBraceIndex =
              match.index + closingBraceIndexInMatch;
            insertionIndex =
              fileContent.lastIndexOf("\n", absoluteClosingBraceIndex - 1) + 1;
            const prevLineEndIndex = insertionIndex - 1;
            const prevLineStartIndex =
              fileContent.lastIndexOf("\n", prevLineEndIndex - 1) + 1;
            if (
              prevLineStartIndex >= 0 &&
              prevLineStartIndex < prevLineEndIndex
            ) {
              const prevLine = fileContent.substring(
                prevLineStartIndex,
                prevLineEndIndex,
              );
              const indentationMatch = prevLine.match(/^(\s*)/);
              if (indentationMatch && indentationMatch[1] != null) {
                baseIndentation = indentationMatch[1];
              } else {
                const lineEnd = fileContent.indexOf("\n", insertionIndex);
                const line = fileContent.substring(
                  insertionIndex,
                  lineEnd > -1 ? lineEnd : fileContent.length,
                );
                const fallbackIndentationMatch = line.match(/^(\s*)/);
                if (fallbackIndentationMatch) {
                  baseIndentation = fallbackIndentationMatch[1];
                }
              }
            } else {
              const lineEnd = fileContent.indexOf("\n", insertionIndex);
              const line = fileContent.substring(
                insertionIndex,
                lineEnd > -1 ? lineEnd : fileContent.length,
              );
              const fallbackIndentationMatch = line.match(/^(\s*)/);
              if (fallbackIndentationMatch) {
                baseIndentation = fallbackIndentationMatch[1];
              }
            }
          } else {
            console.warn(
              `    Closing brace '}' not found within the matched block for marker '${insertionPointMarker.toString()}' in ${filePath}. Falling back.`,
            );
            insertionIndex = fileContent.lastIndexOf("\n", match.index - 1) + 1;
            const lineEnd = fileContent.indexOf("\n", insertionIndex);
            const line = fileContent.substring(
              insertionIndex,
              lineEnd > -1 ? lineEnd : fileContent.length,
            );
            const indentationMatch = line.match(/^(\s*)/);
            if (indentationMatch) {
              baseIndentation = indentationMatch[1];
            }
          }
        } else if (position === "after") {
          insertionIndex += originalMatchLength;
          const nextLineStartIndex =
            fileContent.indexOf("\n", insertionIndex) + 1;
          if (nextLineStartIndex > 0) {
            const nextLineEndIndex = fileContent.indexOf(
              "\n",
              nextLineStartIndex,
            );
            const nextLine = fileContent.substring(
              nextLineStartIndex,
              nextLineEndIndex > -1 ? nextLineEndIndex : fileContent.length,
            );
            const indentationMatch = nextLine.match(/^(\s*)/);
            if (indentationMatch) {
              baseIndentation = indentationMatch[1];
            }
            insertionIndex = nextLineStartIndex;
          } else {
            if (!fileContent.endsWith("\n")) {
              fileContent += "\n";
              insertionIndex++;
            }
            const lineStartIndex =
              fileContent.lastIndexOf("\n", match.index) + 1;
            const line = fileContent.substring(
              lineStartIndex,
              match.index + originalMatchLength,
            );
            const indentationMatch = line.match(/^(\s*)/);
            if (indentationMatch) {
              baseIndentation = indentationMatch[1];
            }
            insertionIndex = fileContent.length;
          }
        } else {
          const lineStartIndex =
            fileContent.lastIndexOf("\n", match.index - 1) + 1;
          insertionIndex = lineStartIndex;
          const lineEnd = fileContent.indexOf("\n", lineStartIndex);
          const line = fileContent.substring(
            lineStartIndex,
            lineEnd > -1 ? lineEnd : fileContent.length,
          );
          const indentationMatch = line.match(/^(\s*)/);
          if (indentationMatch) {
            baseIndentation = indentationMatch[1];
          }
        }
      }
    }

    if (insertionIndex === -1) {
      console.warn(
        `    Marker '${insertionPointMarker.toString()}' not found in ${filePath}. Skipping insertion.`,
      );
      return false;
    }

    insertionIndex = Math.max(0, insertionIndex);

    let contentToInsert = newContent;
    if (ensureIndentation && baseIndentation) {
      contentToInsert = newContent
        .split("\n")
        .map((line) => (line.trim() ? baseIndentation + line : line))
        .join("\n");
    }
    if (
      ensureNewLine &&
      contentToInsert.trim().length > 0 &&
      !contentToInsert.endsWith("\n")
    ) {
      contentToInsert += "\n";
    }

    const checkContent = contentToInsert;
    if (fileContent.includes(checkContent)) {
      console.log(
        `    Content already exists in ${filePath}. Skipping insertion.`,
      );
      return true;
    }

    fileContent =
      fileContent.slice(0, insertionIndex) +
      contentToInsert +
      fileContent.slice(insertionIndex);

    await fs.writeFile(absolutePath, fileContent, "utf-8");
    console.log(`    ${path.basename(filePath)} updated successfully.`);
    return true;
  } catch (error) {
    console.error(`    Error updating ${filePath}:`, error);
    return false;
  }
}

async function generateMapFiles(mapName: string, removeSmall = true) {
  console.log(`[${mapName}] Starting full map generation...`);
  const startTime = performance.now();
  const mapNamePascal = toPascalCase(mapName);
  const mapNameCamel = toCamelCase(mapName);
  const mapNameLower = toLowerCaseName(mapNamePascal);

  const resourcesPath = path.resolve(process.cwd(), "resources", "maps");
  const mapPngPath = path.resolve(resourcesPath, `${mapNamePascal}.png`);
  const mapBinPath = path.resolve(resourcesPath, `${mapNamePascal}.bin`);
  const mapMiniBinPath = path.resolve(
    resourcesPath,
    `${mapNamePascal}Mini.bin`,
  );
  const mapThumbPath = path.resolve(
    resourcesPath,
    `${mapNamePascal}Thumb.webp`,
  );
  const mapJsonPath = path.resolve(resourcesPath, `${mapNamePascal}.json`);

  try {
    console.log(`[${mapName}] Checking for input PNG: ${mapPngPath}`);
    try {
      await fs.access(mapPngPath);
    } catch {
      console.error(
        `[${mapName}] ERROR: Input PNG file not found at ${mapPngPath}`,
      );
      console.error(
        `Please ensure '${mapNamePascal}.png' exists in the 'resources/maps' directory.`,
      );
      throw new Error("Input PNG missing");
    }
    const imageBuffer = await fs.readFile(mapPngPath);
    console.log(`[${mapName}] Input PNG found.`);

    console.log(`[${mapName}] Generating terrain data...`);
    const terrainGenStartTime = performance.now();
    const {
      map: mainMap,
      miniMap,
      thumb,
    } = await generateTerrainMapData(imageBuffer, removeSmall, mapNamePascal);
    const terrainGenEndTime = performance.now();
    console.log(
      `[${mapName}] Terrain data generated in ${(terrainGenEndTime - terrainGenStartTime).toFixed(2)} ms`,
    );

    console.log(`[${mapName}] Writing terrain output files...`);
    const writeStartTime = performance.now();
    const sharpThumbPromise = sharp(thumb.data, {
      raw: { width: thumb.width, height: thumb.height, channels: 4 },
    })
      .webp({ quality: 45 })
      .toFile(mapThumbPath);
    const writeMainMapPromise = fs.writeFile(mapBinPath, mainMap);
    const writeMiniMapPromise = fs.writeFile(mapMiniBinPath, miniMap);
    await Promise.all([
      writeMainMapPromise,
      writeMiniMapPromise,
      sharpThumbPromise,
    ]);
    const writeEndTime = performance.now();
    console.log(
      `[${mapName}] Terrain output files written in ${(writeEndTime - writeStartTime).toFixed(2)} ms`,
    );

    console.log(`[${mapName}] Generating nation data...`);
    const nationGenStartTime = performance.now();
    try {
      console.warn(
        `[${mapName}] Placeholder: Nation data generation skipped. Implement and call your nation generator.`,
      );
      const nationGenEndTime = performance.now();
      console.log(
        `[${mapName}] Nation data generated (placeholder) in ${(nationGenEndTime - nationGenStartTime).toFixed(2)} ms`,
      );
    } catch (nationError) {
      console.error(
        `[${mapName}] Error during nation data generation:`,
        nationError,
      );
    }

    console.log(`[${mapName}] Updating project files...`);
    const updateStartTime = performance.now();
    let allUpdatesSuccessful = true;

    const displayName = mapNamePascal.replace(/([A-Z])/g, " $1").trim();
    const jsonMapKey = mapNameCamel;

    const enJsonPath = "resources/lang/en.json";
    try {
      const enJsonContent = JSON.parse(
        await fs.readFile(path.resolve(process.cwd(), enJsonPath), "utf-8"),
      );

      if (!enJsonContent.map || typeof enJsonContent.map !== "object") {
        console.warn(
          `    Warning: "map" object not found or not an object in ${enJsonPath}. Creating it.`,
        );
        enJsonContent.map = {};
      }

      if (!(jsonMapKey in enJsonContent.map)) {
        console.log(`  Updating ${path.basename(enJsonPath)}...`);
        enJsonContent.map[jsonMapKey] = displayName;

        await fs.writeFile(
          path.resolve(process.cwd(), enJsonPath),
          JSON.stringify(enJsonContent, null, 2) + "\n",
          "utf-8",
        );
        console.log(`    ${path.basename(enJsonPath)} updated successfully.`);
      } else {
        console.log(
          `    Key 'map.${jsonMapKey}' already exists in ${path.basename(enJsonPath)}. Skipping.`,
        );
      }
    } catch (e) {
      console.error(`    Error updating ${enJsonPath}:`, e);
      allUpdatesSuccessful = false;
    }

    const mapsComponentPath = "src/client/components/Maps.ts";
    const mapDescMarker =
      /export const MapDescription: Record<keyof typeof GameMapType, string> = \{((?:.|\n)*?)\n\};/m;
    const mapDescEntry = `${mapNamePascal}: "${displayName}",`;
    allUpdatesSuccessful &&= await insertIntoFile(
      mapsComponentPath,
      mapDescMarker,
      mapDescEntry,
      "before",
      true,
      true,
      true,
    );

    const mapsUtilPath = "src/client/utilities/Maps.ts";
    const mapUtilImportMarker =
      /import .*Thumb\.webp";\s*\n\s*import { GameMapType }/m;
    const mapUtilImport = `import ${mapNameLower} from "../../../resources/maps/${mapNamePascal}Thumb.webp";`;
    allUpdatesSuccessful &&= await insertIntoFile(
      mapsUtilPath,
      mapUtilImportMarker,
      mapUtilImport,
      "before",
      true,
      false,
      false,
    );

    const mapUtilCaseMarker = /^\s+default:\s*return "";/m;
    const mapUtilCase = `    case GameMapType.${mapNamePascal}:\n      return ${mapNameLower};\n`;
    allUpdatesSuccessful &&= await insertIntoFile(
      mapsUtilPath,
      mapUtilCaseMarker,
      mapUtilCase,
      "before",
      false,
      false,
      false,
    );

    const gameTsPath = "src/core/game/Game.ts";
    const gameEnumMarker = /enum GameMapType \{((?:.|\n)*?)\n\}/m;
    const gameEnumEntry = `${mapNamePascal} = "${displayName}",`;
    allUpdatesSuccessful &&= await insertIntoFile(
      gameTsPath,
      gameEnumMarker,
      gameEnumEntry,
      "before",
      true,
      true,
      true,
    );

    const loaderPath = "src/core/game/TerrainMapFileLoader.ts";
    const loaderMarker =
      /const MAP_FILE_NAMES: Record<GameMapType, string> = \{((?:.|\n)*?)\n\};/m;
    const loaderEntry = `[GameMapType.${mapNamePascal}]: "${mapNamePascal}",`;
    allUpdatesSuccessful &&= await insertIntoFile(
      loaderPath,
      loaderMarker,
      loaderEntry,
      "before",
      true,
      true,
      true,
    );

    const updateEndTime = performance.now();
    if (allUpdatesSuccessful) {
      console.log(
        `[${mapName}] Project files updated successfully in ${(updateEndTime - updateStartTime).toFixed(2)} ms`,
      );
    } else {
      console.error(
        `[${mapName}] Errors occurred while updating project files. Please review the logs above.`,
      );
    }

    const totalTime = performance.now() - startTime;
    console.log(
      `\n[${mapName}] Finished full map generation and project update in ${totalTime.toFixed(2)} ms.`,
    );
    if (!allUpdatesSuccessful) {
      console.warn(
        "\nOne or more project file updates failed. Please check the files manually.",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[${mapName}] CRITICAL ERROR during processing:`, error);
    process.exit(1);
  }
}

async function main() {
  const mapNameArg = process.argv[2];

  if (!mapNameArg) {
    console.error("Usage: npm run build-fullmap <MapName>");
    console.error("Example: npm run build-fullmap KnownWorld");
    console.error(
      "\n<MapName> should be the base name of your map file (e.g., 'KnownWorld' for 'KnownWorld.png').",
    );
    console.error("Ensure the corresponding PNG exists in 'resources/maps/'.");
    process.exit(1);
  }

  if (!/^[A-Za-z0-9]+$/.test(mapNameArg)) {
    console.error(
      "Error: Map name should only contain letters and numbers (e.g., 'MyNewMap', 'EuropeV2').",
    );
    process.exit(1);
  }

  const mapName = toPascalCase(mapNameArg);

  await generateMapFiles(mapName);
}

main();
