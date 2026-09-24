/** Messages between the viewer and the processing worker. */

import type { GameRecord } from "../../core/Schemas";
import type { ReplayAppend, ReplayBase } from "./codec/ReplayTypes";

export interface ProcessorRequest {
  record: GameRecord;
  cdnBase: string;
}

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
  | { type: "error"; message: string; desync: boolean };
