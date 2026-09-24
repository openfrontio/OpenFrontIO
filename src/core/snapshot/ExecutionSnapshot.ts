import { z } from "zod";
import type { Execution } from "../game/Game";
import type { ExecRecord, SnapshotReader } from "./SnapshotContext";
import { Migration, snapshotType, SnapshotType } from "./SnapshotType";

/** An execution that can rebuild its state onto a prototype-only shell. */
export interface RestorableExecution<S> extends Execution {
  /**
   * Called on an object made with Object.create(prototype): no constructor
   * or field initializer has run. Must assign every field, and must only
   * assign — referenced objects may still be empty shells at this point.
   */
  restoreSnapshot(state: S, r: SnapshotReader): void;
}

export interface ExecutionSnapshotType<S> extends SnapshotType<S> {
  // A thunk, so the class can be defined after its snapshot type and import
  // cycles between execution modules cannot observe it undefined.
  readonly cls: () => { prototype: RestorableExecution<S> };
  write(data: S): ExecRecord;
}

export function execSnapshotType<T extends z.ZodType>(def: {
  /** Stable type tag stored in snapshots; never reuse or rename one. */
  name: string;
  version: number;
  schema: T;
  migrations?: Record<number, Migration>;
  cls: () => { prototype: RestorableExecution<z.output<T>> };
}): ExecutionSnapshotType<z.output<T>> {
  const base = snapshotType(def);
  return {
    ...base,
    cls: def.cls,
    write(data) {
      return { t: def.name, v: def.version, d: data };
    },
  };
}
