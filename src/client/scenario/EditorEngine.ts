/**
 * What the editor engine starts on (docs/ScenarioEditor.md, "Editor
 * runtime"): a blank all-water map of the document's size with the document
 * replayed into it, or a stock map's files for a new scenario started from
 * that map.
 */

import { authoredTerrain } from "@openfront/engine-api/EditorCommands";
import {
  CustomGameMap,
  Difficulty,
  GameMapSize,
  GameMode,
  GameType,
} from "@openfront/engine-api/game/GameTypes";
import type {
  MapFiles,
  MapManifest,
} from "@openfront/engine-api/game/MapFiles";
import type { GameStartInfo } from "@openfront/engine-api/Schemas";
import {
  isScenarioSize,
  newScenarioDocument,
  type ScenarioDocument,
} from "./ScenarioDocument";
import { replayDocument, type SendCommand } from "./ScenarioReplay";

// The ocean bit of a terrain byte. A blank map is all ocean, as the
// generator makes one.
const OCEAN = 0x20;

/**
 * The game the editor engine runs: a Custom map at normal size, with no
 * players, nations or bots. The engine never ticks, so the rest is moot.
 */
export function editorStartInfo(): GameStartInfo {
  return {
    gameID: "SCENARIO",
    lobbyCreatedAt: 0,
    config: {
      gameMap: CustomGameMap,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Singleplayer,
      difficulty: Difficulty.Medium,
      nations: "disabled",
      bots: 0,
      donateGold: false,
      donateTroops: false,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    },
    players: [],
  };
}

/** A Custom map's manifest: no nations, the sizes of the three maps. */
function scenarioManifest(width: number, height: number): MapManifest {
  const meta = (w: number, h: number) => ({
    width: w,
    height: h,
    num_land_tiles: 0,
  });
  return {
    id: "Scenario",
    name: "Scenario",
    translation_key: "map.scenario",
    categories: ["fictional"],
    nations: [],
    map: meta(width, height),
    map4x: meta(width / 2, height / 2),
    map16x: meta(width / 4, height / 4),
  };
}

/** A blank all-water map, the one every document is replayed onto. */
export function blankMapFiles(width: number, height: number): MapFiles {
  const blank = (w: number, h: number) => new Uint8Array(w * h).fill(OCEAN);
  return {
    map: CustomGameMap,
    mapSize: GameMapSize.Normal,
    manifest: scenarioManifest(width, height),
    mapBin: blank(width, height),
    map4xBin: blank(width / 2, height / 2),
  };
}

/**
 * A new scenario on a stock map's normal-size files: a document holding the
 * map's authored terrain, and the files as a Custom map's, which the engine
 * starts on in place of a blank map. The map's nations are not taken.
 */
export function stockMapStart(
  name: string,
  files: MapFiles,
): { doc: ScenarioDocument; files: MapFiles } {
  const { width, height } = files.manifest.map;
  if (!isScenarioSize(width, height)) {
    throw new Error(`a ${width}x${height} map can't be a scenario`);
  }
  const doc = newScenarioDocument(name, width, height);
  files.mapBin!.forEach((b, tile) => {
    doc.terrain[tile] = authoredTerrain(b);
  });
  const manifest = scenarioManifest(width, height);
  manifest.map.num_land_tiles = files.manifest.map.num_land_tiles;
  manifest.map4x.num_land_tiles = files.manifest.map4x.num_land_tiles;
  return {
    doc,
    files: {
      map: CustomGameMap,
      mapSize: GameMapSize.Normal,
      manifest,
      mapBin: files.mapBin,
      map4xBin: files.map4xBin,
    },
  };
}

/**
 * Builds the editor engine for a document: `start` starts an engine on the
 * map files and returns how to send it commands. On a stock map's files
 * (from stockMapStart) the terrain is already there, so only the rest of
 * the document is replayed.
 */
export async function startEditorEngine(
  doc: ScenarioDocument,
  start: (files: MapFiles) => Promise<SendCommand>,
  stockFiles?: MapFiles,
): Promise<SendCommand> {
  const send = await start(stockFiles ?? blankMapFiles(doc.width, doc.height));
  replayDocument(doc, send, { terrain: stockFiles === undefined });
  return send;
}
