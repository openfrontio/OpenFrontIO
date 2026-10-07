/** Messages between the viewer and the processing worker. */

import type { Difficulty } from "@openfront/engine-api/game/GameTypes";
import type { GameRecord, WireGameStartInfo } from "@openfront/shared/WireSchemas";
import type { ReplayAppend, ReplayBase } from "./codec/ReplayTypes";

export type ProcessorRequest =
  | {
      type?: "process";
      record: GameRecord;
      cdnBase: string;
      /** A port to the engine's worker, which the page started. */
      engine: MessagePort;
    }
  | {
      type: "extract_snapshot";
      record: GameRecord;
      targetTick: number;
      chosenPlayerID: string;
      localClientID: string;
      difficulty?: Difficulty;
      cdnBase: string;
    };

export type ProcessorResponse =
  /** Simulation progress, 0 to 100. */
  | { type: "progress"; percent: number }
  /** The header fields that don't change, before any frames. */
  | { type: "start"; base: ReplayBase }
  /** The frames (and players, events) processed since the last append. */
  | { type: "append"; append: ReplayAppend }
  /** Processing finished. The appends had all of it. */
  | { type: "done" }
  /** `desync`: the record doesn't replay on this build. */
  | { type: "error"; message: string; desync: boolean }
  | {
      type: "snapshot_extracted";
      snapshot: Uint8Array;
      gameStartInfo: WireGameStartInfo;
    };
