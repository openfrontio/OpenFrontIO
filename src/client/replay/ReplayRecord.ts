/**
 * Fetches the archived game record a replay is made from, the same way the
 * client-side replay does (JoinLobbyModal.checkArchivedGame).
 *
 * A record only replays on the build that played it, because the core is
 * only deterministic within a build. Records from other builds are watched
 * on that build's versioned shell (#4934), which has its own viewer and
 * processor, so this build never tries to simulate them.
 */

import { GameRecord, GameRecordSchema } from "../../core/Schemas";
import { getApiBase } from "../ApiBase";
import { ClientEnv } from "../ClientEnv";

export type RecordResult =
  | { kind: "record"; record: GameRecord }
  /** Played on another build (or under another record schema). */
  | { kind: "other_build" }
  | { kind: "not_found" }
  | { kind: "unreachable" };

/**
 * A record JoinLobbyModal already fetched and checked, passed to the
 * viewer so it isn't downloaded twice. Used once, then cleared.
 */
let handedOver: { gameID: string; record: GameRecord } | null = null;

export function handOverRecord(gameID: string, record: GameRecord): void {
  handedOver = { gameID, record };
}

export async function fetchReplayRecord(
  gameID: string,
  opts: {
    apiBase?: string;
    ownCommit?: string;
    fetchFn?: typeof fetch;
  } = {},
): Promise<RecordResult> {
  if (handedOver?.gameID === gameID) {
    const { record } = handedOver;
    handedOver = null;
    return { kind: "record", record };
  }
  const apiBase = opts.apiBase ?? getApiBase();
  const ownCommit = opts.ownCommit ?? ClientEnv.gitCommit();
  const fetchFn = opts.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn.call(
      globalThis,
      `${apiBase}/game/${encodeURIComponent(gameID)}`,
      { headers: { Accept: "application/json" } },
    );
  } catch {
    return { kind: "unreachable" };
  }
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return { kind: "unreachable" };
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { kind: "unreachable" };
  }
  // A record that doesn't match the schema is from another build (the
  // client-side replay treats it the same way).
  const parsed = GameRecordSchema.safeParse(raw);
  if (!parsed.success) return { kind: "other_build" };
  const record = parsed.data;
  // DEV builds replay anything, like the client-side replay.
  if (ownCommit !== "DEV" && record.gitCommit !== ownCommit) {
    return { kind: "other_build" };
  }
  return { kind: "record", record };
}
