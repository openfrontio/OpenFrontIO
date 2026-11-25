/**
 * Rebuilds a scenario document in an editor engine (docs/ScenarioEditor.md,
 * "One engine, never ticking"): the one path for opening a draft, resizing,
 * test play and export.
 */

import {
  type EditorCommand,
  MAX_TERRAIN_BATCH,
} from "@openfront/engine-api/EditorCommands";
import { type ScenarioDocument, WATER } from "./ScenarioDocument";

/**
 * Sends one command to the editor engine: a worker client's message, or a
 * GameRunner's applyEditorCommand. The engine applies them in order.
 */
export type SendCommand = (command: EditorCommand) => void;

/**
 * Sends the commands that rebuild the document in a fresh editor engine
 * started on a blank all-water map of the document's size. Without
 * `terrain`, for an engine already on the document's exported map files,
 * it leaves the terrain alone.
 */
export function replayDocument(
  doc: ScenarioDocument,
  send: SendCommand,
  { terrain = true }: { terrain?: boolean } = {},
): void {
  if (terrain) {
    const tiles: number[] = [];
    doc.terrain.forEach((b, tile) => {
      if (b !== WATER) tiles.push(tile);
    });
    sendTerrain(
      tiles,
      tiles.map((t) => doc.terrain[t]),
      send,
    );
    send({ type: "end_terrain_edit" });
  }
  const owned: number[][] = doc.nations.map(() => []);
  doc.owners.forEach((owner, tile) => {
    if (owner !== 0) owned[owner - 1].push(tile);
  });
  doc.nations.forEach((n, i) => {
    send({ type: "add_nation", id: n.id, name: n.name, flag: n.flag });
    send({
      type: "set_nation",
      id: n.id,
      troops: n.troops,
      gold: n.gold,
      playable: n.playable,
    });
    if (owned[i].length > 0) {
      send({ type: "set_owner", tiles: owned[i], owner: n.id });
    }
  });
  for (const s of doc.structures) {
    send({
      type: "place_structure",
      unit: s.type,
      tile: s.tile,
      nation: s.nation,
      level: s.level,
    });
  }
  for (const w of doc.warships) {
    send({ type: "place_warship", tile: w.tile, nation: w.nation });
  }
  for (const nations of doc.alliances) {
    send({ type: "add_alliance", nations });
  }
}

/** Sends a terrain write as set_terrain commands the engine takes. */
export function sendTerrain(
  tiles: readonly number[],
  terrain: readonly number[],
  send: SendCommand,
  // Tests split at a few tiles rather than a million, to cross a batch
  // boundary in milliseconds.
  batchSize: number = MAX_TERRAIN_BATCH,
): void {
  for (let i = 0; i < tiles.length; i += batchSize) {
    send({
      type: "set_terrain",
      tiles: tiles.slice(i, i + batchSize),
      terrain: terrain.slice(i, i + batchSize),
    });
  }
}
