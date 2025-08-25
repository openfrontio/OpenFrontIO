import { AnalyticsRecord, GameID, GameRecord, RedactedGameRecord, RedactedGameRecordSchema } from "../core/Schemas";
import { S3 } from "@aws-sdk/client-s3";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { logger } from "./Logger";
import { replacer } from "../core/Util";
import { z } from "zod";

const config = getServerConfigFromServer();

const log = logger.child({ component: "Archive" });

// R2 client configuration
const r2 = new S3({
  region: "auto", // R2 ignores region, but it's required by the SDK
  /* eslint-disable sort-keys */
  endpoint: config.r2Endpoint(),
  credentials: {
    accessKeyId: config.r2AccessKey(),
    secretAccessKey: config.r2SecretKey(),
  },
  /* eslint-disable sort-keys */
});

const bucket = config.r2Bucket();
const gameFolder = "games";
const analyticsFolder = "analytics";

export async function archive(gameRecord: GameRecord) {
  try {
    gameRecord.gitCommit = config.gitCommit();
    // Archive to R2
    await archiveAnalyticsToR2(stripTurns(gameRecord));

    // Archive full game if there are turns
    if (gameRecord.turns.length > 0) {
      log.info(
        `${gameRecord.info.gameID}: game has more than zero turns, attempting to write to full game to R2`,
      );
      await archiveFullGameToR2(stripPersistentIds(gameRecord));
    }
  } catch (error: unknown) {
    // If the error is not an instance of Error, log it as a string
    if (!(error instanceof Error)) {
      log.error(
        `${gameRecord.info.gameID}: Final archive error. Non-Error type: ${String(error)}`,
      );
      return;
    }

    const { message, stack, name } = error;
    log.error(`${gameRecord.info.gameID}: Final archive error: ${error}`, {
      message,
      stack,
      name,
      ...(error && typeof error === "object" ? error : {}),
    });
  }
}

function stripTurns(gameRecord: GameRecord): AnalyticsRecord {
  // Create analytics data object
  const { info, version, gitCommit, subdomain, domain } = gameRecord;
  const analyticsData: AnalyticsRecord = {
    info,
    version,
    gitCommit,
    subdomain,
    domain,
  };
  return analyticsData;
}

function stripPersistentIds(gameRecord: GameRecord): RedactedGameRecord {
  // Create replay object
  const {
    info: {
      gameID,
      config,
      players: privatePlayers,
      start,
      end,
      duration,
      num_turns,
      winner,
    },
    version,
    gitCommit,
    subdomain,
    domain,
    turns,
  } = gameRecord;
  const players = privatePlayers.map(
    ({ clientID, persistentID: _, username, pattern, flag }) => ({
      clientID,
      username,
      pattern,
      flag,
    }),
  );
  const replayData: RedactedGameRecord = {
    info: { gameID, config, players, start, end, duration, num_turns, winner },
    version,
    gitCommit,
    subdomain,
    domain,
    turns,
  };
  return replayData;
}

async function archiveAnalyticsToR2(gameRecord: AnalyticsRecord) {
  const { info } = gameRecord;
  try {
    // Store analytics data using just the game ID as the key
    const analyticsKey = `${info.gameID}.json`;

    await r2.putObject({
      Bucket: bucket,
      Key: `${analyticsFolder}/${analyticsKey}`,
      Body: JSON.stringify(gameRecord, replacer),
      ContentType: "application/json",
    });

    log.info(`${info.gameID}: successfully wrote game analytics to R2`);
  } catch (error: unknown) {
    // If the error is not an instance of Error, log it as a string
    if (!(error instanceof Error)) {
      log.error(
        `${gameRecord.info.gameID}: Error writing game analytics to R2. Non-Error type: ${String(error)}`,
      );
      return;
    }

    const { message, stack, name } = error;
    log.error(`${info.gameID}: Error writing game analytics to R2: ${error}`, {
      message,
      stack,
      name,
      ...(error && typeof error === "object" ? error : {}),
    });
    throw error;
  }
}

async function archiveFullGameToR2(gameRecord: RedactedGameRecord) {
  try {
    await r2.putObject({
      Bucket: bucket,
      Key: `${gameFolder}/${gameRecord.info.gameID}`,
      Body: JSON.stringify(gameRecord, replacer),
      ContentType: "application/json",
    });
  } catch (error) {
    log.error(`error saving game ${gameRecord.info.gameID}`);
    throw error;
  }

  log.info(`${gameRecord.info.gameID}: game record successfully written to R2`);
}

export async function readGameRecord(
  gameId: GameID,
): Promise<RedactedGameRecord | string> {
  try {
    // Check if file exists and download in one operation
    const response = await r2.getObject({
      Bucket: bucket,
      Key: `${gameFolder}/${gameId}`, // Fixed - needed to include gameFolder
    });
    // Parse the response body
    if (response.Body === undefined) {
      log.warn(`${gameId}: Received empty response from R2`);
      return readGameRecordFallback(gameId);
    }

    const bodyContents = await response.Body.transformToString();
    return validateRecord(JSON.parse(bodyContents), gameId);
  } catch (error: unknown) {
    // If the error is not an instance of Error, log it as a string
    if (!(error instanceof Error)) {
      log.info(
        `${gameId}: Error reading game record from R2. Non-Error type: ${String(error)}`,
      );
    } else {
      const { message, stack, name } = error;
      // Log the error for monitoring purposes
      log.info(`${gameId}: Error reading game record from R2: ${error}`, {
        message,
        stack,
        name,
        ...(error && typeof error === "object" ? error : {}),
      });
    }
    return readGameRecordFallback(gameId);
  }
}

export async function readGameRecordFallback(
  gameId: GameID,
): Promise<RedactedGameRecord | string> {
  try {
    const response = await fetch(config.replayUrl(gameId), {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return "replay.not_found";
      }

      throw new Error(
        `Http error: non-successful http status ${response.status}`,
      );
    }

    const contentType = response.headers.get("Content-Type")?.split(";")?.[0];
    if (contentType !== "application/json") {
      throw new Error(
        `Http error: unexpected content type "${response.headers.get("Content-Type")}"`,
      );
    }

    return validateRecord(await response.json(), gameId);
  } catch (error: unknown) {
    // If the error is not an instance of Error, log it as a string
    if (!(error instanceof Error)) {
      log.info(
        `${gameId}: Error reading game record from public api. Non-Error type: ${String(error)}`,
      );
    } else {
      const { message, stack, name } = error;
      log.info(
        `${gameId}: Error reading game record from public api: ${error}`,
        {
          message,
          stack,
          name,
          ...(error && typeof error === "object" ? error : {}),
        },
      );
    }
    return "replay.error";
  }
}

function validateRecord(
  json: unknown,
  gameId: GameID,
): RedactedGameRecord | string {
  const parsed = RedactedGameRecordSchema.safeParse(json);

  if (!parsed.success) {
    const error = z.prettifyError(parsed.error);
    log.error(`${gameId}: Error parsing game record: ${error}`);
    return "replay.invalid";
  }

  return parsed.data;
}

export async function gameRecordExists(gameId: GameID): Promise<boolean> {
  try {
    await r2.headObject({
      Bucket: bucket,
      Key: `${gameFolder}/${gameId}`, // Fixed - needed to include gameFolder
    });
    return true;
  } catch (error: unknown) {
    // If the error is not an instance of Error, log it as a string
    if (!(error instanceof Error)) {
      log.error(
        `${gameId}: Error checking archive existence. Non-Error type: ${String(error)}`,
      );
      return false;
    }
    const { message, stack, name } = error;
    if (name === "NotFound") {
      return false;
    }
    log.error(`${gameId}: Error checking archive existence: ${error}`, {
      message,
      stack,
      name,
      ...(error && typeof error === "object" ? error : {}),
    });
    return false;
  }
}
