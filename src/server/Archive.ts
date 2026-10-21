import { GameID, ID } from "@openfront/engine-api/Schemas";
import { replacer } from "@openfront/shared/SharedUtil";
import {
  GameRecord,
  GameRecordSchema,
  PartialGameRecord,
} from "@openfront/shared/WireSchemas";
import z from "zod";
import { registeredSite } from "./ClusterCheckin";
import { logger } from "./Logger";
import { ServerEnv } from "./ServerEnv";

const log = logger.child({ component: "Archive" });

// Waits before each retry of a failed archive POST. Without a retry, a 5xx or
// network blip during an API incident loses the game's stats for every player.
// The API's duplicate check isn't atomic, so a retry that overlaps a still-
// running attempt can apply the game's win/loss deltas twice: the first delay
// is kept well above ingest time to make that unlikely.
export const ARCHIVE_RETRY_DELAYS_MS = [10_000, 30_000, 60_000];

// Per attempt, so an API that accepts the connection and then hangs doesn't
// hold a retry for undici's 300 s default.
export const ARCHIVE_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Up to 25% jitter, so servers that failed together don't retry together.
const withJitter = (ms: number) => ms + Math.floor(Math.random() * ms * 0.25);

export async function archive(gameRecord: GameRecord) {
  let gameID: GameID | undefined;
  let request: RequestInit;
  let url: string;
  // The caller doesn't await archive(), so nothing here may throw.
  try {
    gameID = gameRecord.info.gameID;
    const parsed = GameRecordSchema.safeParse(gameRecord);
    if (!parsed.success) {
      log.error(`invalid game record: ${z.prettifyError(parsed.error)}`, {
        gameID,
      });
      return;
    }
    url = `${ServerEnv.jwtIssuer()}/game/${gameID}`;
    request = {
      method: "POST",
      body: JSON.stringify(gameRecord, replacer),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    };
  } catch (error) {
    log.error(`error archiving game record: ${error}`, { gameID });
    return;
  }
  const attempts = ARCHIVE_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; ; attempt++) {
    let failure: string;
    let retryable: boolean;
    try {
      const response = await fetch(url, {
        ...request,
        signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
      });
      if (response.ok) return;
      failure = `${response.status} ${response.statusText}`;
      // The API answers 409 for a game it already holds: after a failed
      // attempt, that one most likely saved and only its response was lost.
      if (response.status === 409 && attempt > 1) {
        log.warn(
          `archive attempt ${attempt} got ${failure}, treating as already archived`,
          { gameID },
        );
        return;
      }
      // Other 4xx are schema or validation rejections: retrying won't help.
      retryable = response.status >= 500 || response.status === 429;
    } catch (error) {
      failure = `${error}`;
      retryable = true;
    }
    if (!retryable || attempt >= attempts) {
      log.error(
        `error archiving game record after ${attempt} attempt(s): ${failure}`,
        { gameID },
      );
      return;
    }
    log.warn(`archive attempt ${attempt} failed, retrying: ${failure}`, {
      gameID,
    });
    await sleep(withJitter(ARCHIVE_RETRY_DELAYS_MS[attempt - 1]));
  }
}

export async function readGameRecord(
  gameId: GameID,
): Promise<GameRecord | null> {
  try {
    if (!ID.safeParse(gameId).success) {
      log.error(`invalid game ID: ${gameId}`);
      return null;
    }
    const url = `${ServerEnv.jwtIssuer()}/game/${gameId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ServerEnv.apiKey(),
      },
    });
    const record = await response.json();
    if (!response.ok) {
      log.error(`error reading game record: ${response.statusText}`, {
        gameID: gameId,
      });
      return null;
    }
    return GameRecordSchema.parse(record);
  } catch (error) {
    log.error(`error reading game record: ${error}`, {
      gameID: gameId,
    });
    return null;
  }
}

export function finalizeGameRecord(
  clientRecord: PartialGameRecord,
): GameRecord {
  return {
    ...clientRecord,
    gitCommit: ServerEnv.gitCommit(),
    subdomain: ServerEnv.subdomain(),
    domain: ServerEnv.domain(),
    site: registeredSite(),
  };
}
