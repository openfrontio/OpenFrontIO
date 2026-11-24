/**
 * Exports a scenario as a bundle (docs/ScenarioEditor.md, "Finalising for
 * export"). The editing engine writes its terrain out as map files; a
 * second engine on those files replays the rest of the document, is
 * finalised and snapshotted, and is discarded. The editing engine and the
 * document are left as they were, so editing carries on.
 */

import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import type { MapFiles } from "@openfront/engine-api/game/MapFiles";
import type { GameStartInfo } from "@openfront/engine-api/Schemas";
import { thumbnailPixels as mapThumbnailPixels } from "@openfront/engine-lib/mapgen/Thumbnail";
import { WorkerClient } from "../WorkerClient";
import { editorStartInfo } from "./EditorEngine";
import {
  encodeScenarioBundle,
  type ScenarioBundleHeader,
} from "./ScenarioBundle";
import type { ScenarioDocument } from "./ScenarioDocument";
import { replayDocument } from "./ScenarioReplay";

/** The engine export finalises: a worker in the page, a GameRunner in tests. */
export interface ExportEngine {
  command(command: EditorCommand): Promise<unknown>;
  snapshot(gitCommit: string): Promise<Uint8Array>;
  close(): void;
}

/**
 * The gzipped bundle of the document as it is now. `editing` sends a
 * command to the editing engine and resolves with what it returned.
 * `gitCommit` is this build's. Edits made while it runs go only into the
 * live document and engine.
 */
export async function exportScenario(
  doc: ScenarioDocument,
  editing: (command: EditorCommand) => Promise<MapFiles | undefined>,
  {
    scenario,
    gitCommit,
    startEngine = startWorkerEngine,
    renderThumbnail = renderScenarioThumbnail,
  }: {
    scenario: ScenarioBundleHeader["scenario"];
    gitCommit: string;
    startEngine?: (
      start: GameStartInfo,
      files: MapFiles,
    ) => Promise<ExportEngine>;
    renderThumbnail?: (files: MapFiles) => Promise<Uint8Array>;
  },
): Promise<Uint8Array> {
  // In one step, so the copy holds exactly the edits the files do.
  const copy = structuredClone(doc);
  const files = await editing({ type: "export_terrain" });
  if (files === undefined) throw new Error("export_terrain wrote no files");

  const engine = await startEngine(exportStartInfo(copy), copyFiles(files));
  let snapshot: Uint8Array;
  try {
    const applied: Promise<unknown>[] = [];
    replayDocument(copy, (c) => applied.push(engine.command(c)), {
      terrain: false,
    });
    applied.push(engine.command({ type: "finalize" }));
    await Promise.all(applied);
    snapshot = await engine.snapshot(gitCommit);
  } finally {
    engine.close();
  }

  return encodeScenarioBundle({
    header: {
      scenario,
      engineCommit: gitCommit,
      nations: copy.nations.map(({ id, name, flag, playable }) => ({
        id,
        name,
        flag,
        playable,
      })),
    },
    files,
    snapshot,
    thumbnail: await renderThumbnail(files),
  });
}

/** The editor's game with the document's settings, which the snapshot keeps. */
export function exportStartInfo(doc: ScenarioDocument): GameStartInfo {
  const start = editorStartInfo();
  return { ...start, config: { ...start.config, ...doc.config } };
}

async function startWorkerEngine(
  start: GameStartInfo,
  files: MapFiles,
): Promise<ExportEngine> {
  const worker = new WorkerClient(start, undefined, undefined, files);
  await worker.initialize();
  return {
    command: (command) => worker.editorCommand(command),
    snapshot: (gitCommit) => worker.snapshot(gitCommit),
    close: () => worker.cleanup(),
  };
}

/** A copy for an engine to take over, as a worker's init transfers them. */
function copyFiles(files: MapFiles): MapFiles {
  return {
    ...files,
    mapBin: files.mapBin?.slice(),
    map4xBin: files.map4xBin?.slice(),
    map16xBin: files.map16xBin?.slice(),
  };
}

/**
 * The thumbnail's RGBA pixels, as the map generator draws a stock map's
 * (mapgen/Thumbnail): half the 4x map's size, one pixel per other tile,
 * water and impassable transparent.
 */
export function thumbnailPixels(files: MapFiles): ImageData["data"] {
  const { width, height } = files.manifest.map4x;
  const { rgba } = mapThumbnailPixels(files.map4xBin!, width, height);
  return new Uint8ClampedArray(rgba.buffer);
}

/** The thumbnail as webp, at the generator's quality. */
export async function renderScenarioThumbnail(
  files: MapFiles,
): Promise<Uint8Array> {
  const pixels = thumbnailPixels(files);
  const w = Math.max(1, Math.floor(files.manifest.map4x.width / 2));
  const canvas = new OffscreenCanvas(w, pixels.length / 4 / w);
  canvas
    .getContext("2d")!
    .putImageData(new ImageData(pixels, w, canvas.height), 0, 0);
  const blob = await canvas.convertToBlob({
    type: "image/webp",
    quality: 0.45,
  });
  // A browser that can't encode webp (Safari) gives a PNG instead.
  if (blob.type !== "image/webp") {
    throw new Error("this browser can't encode a webp thumbnail");
  }
  return new Uint8Array(await blob.arrayBuffer());
}
