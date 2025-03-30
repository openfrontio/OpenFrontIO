import { GameRecord, GameID, GameRecordSchema } from "../core/Schemas";
import { S3 } from "@aws-sdk/client-s3";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { logger } from "./Logger";

const config = getServerConfigFromServer();

const log = logger.child({ component: "Archive" });

// R2 client configuration
const r2 = new S3({
  region: "auto", // R2 ignores region, but it's required by the SDK
  endpoint: config.r2Endpoint(), // You'll need to add this to your config
  credentials: {
    accessKeyId: config.r2AccessKey(), // You'll need to add these
    secretAccessKey: config.r2SecretKey(), // credential methods to your config
  },
});

const bucket = config.r2Bucket();
const gameFolder = "games";
const analyticsFolder = "analytics";

export async function archive(gameRecord: GameRecord) {
  try {
    gameRecord.gitCommit = config.gitCommit();
    // Archive to R2
    await archiveAnalyticsToR2(gameRecord);

    // Archive full game if there are turns
    if (gameRecord.turns.length > 0) {
      log.info(
        `${gameRecord.id}: game has more than zero turns, attempting to write to full game to R2`,
      );
      await archiveFullGameToR2(gameRecord);
    }
  } catch (error) {
    log.error(`${gameRecord.id}: Final archive error: ${error}`, {
      message: error?.message || error,
      stack: error?.stack,
      name: error?.name,
      ...(error && typeof error === "object" ? error : {}),
    });
  }
}

async function archiveAnalyticsToR2(gameRecord: GameRecord) {
  // Create analytics data object
  const analyticsData = {
    id: gameRecord.id,
    env: config.env(),
    start_time: new Date(gameRecord.startTimestampMS).toISOString(),
    end_time: new Date(gameRecord.endTimestampMS).toISOString(),
    duration_seconds: gameRecord.durationSeconds,
    number_turns: gameRecord.num_turns,
    game_mode: gameRecord.gameStartInfo.config.gameType,
    winner: gameRecord.winner,
    difficulty: gameRecord.gameStartInfo.config.difficulty,
    mapType: gameRecord.gameStartInfo.config.gameMap,
    players: gameRecord.players.map((p) => ({
      username: p.username,
      ip: p.ip,
      persistentID: p.persistentID,
      clientID: p.clientID,
    })),
  };

  try {
    // Store analytics data using just the game ID as the key
    const analyticsKey = `${gameRecord.id}.json`;

    await r2.putObject({
      Bucket: bucket,
      Key: `${analyticsFolder}/${analyticsKey}`,
      Body: JSON.stringify(analyticsData),
      ContentType: "application/json",
    });

    log.info(`${gameRecord.id}: successfully wrote game analytics to R2`);
  } catch (error) {
    log.error(
      `${gameRecord.id}: Error writing game analytics to R2: ${error}`,
      {
        message: error?.message || error,
        stack: error?.stack,
        name: error?.name,
        ...(error && typeof error === "object" ? error : {}),
      },
    );
    throw error;
  }
}

async function archiveFullGameToR2(gameRecord: GameRecord) {
  // Create a deep copy to avoid modifying the original
  const recordCopy = JSON.parse(JSON.stringify(gameRecord));

  // Players may see this so make sure to clear PII
  recordCopy.players.forEach((p) => {
    p.ip = "REDACTED";
    p.persistentID = "REDACTED";
  });

  try {
    await r2.putObject({
      Bucket: bucket,
      Key: `${gameFolder}/${recordCopy.id}`,
      Body: JSON.stringify(recordCopy),
      ContentType: "application/json",
    });
  } catch (error) {
    log.error(`error saving game ${gameRecord.id}`);
    throw error;
  }

  log.info(`${gameRecord.id}: game record successfully written to R2`);
}

export async function readGameRecord(
  gameId: GameID,
): Promise<GameRecord | null> {
  try {
    // Check if file exists and download in one operation
    const response = await r2.getObject({
      Bucket: bucket,
      Key: `${gameFolder}/${gameId}`, // Fixed - needed to include gameFolder
    });
    // Parse the response body
    const bodyContents = await response.Body.transformToString();
    return JSON.parse(bodyContents) as GameRecord;
  } catch (error) {
    // Log the error for monitoring purposes
    log.error(`${gameId}: Error reading game record from R2: ${error}`, {
      message: error?.message || error,
      stack: error?.stack,
      name: error?.name,
      ...(error && typeof error === "object" ? error : {}),
    });

    // Return null instead of throwing the error
    return null;
  }
}

export async function gameRecordExists(gameId: GameID): Promise<boolean> {
  try {
    await r2.headObject({
      Bucket: bucket,
      Key: `${gameFolder}/${gameId}`, // Fixed - needed to include gameFolder
    });
    return true;
  } catch (error) {
    if (error.name === "NotFound") {
      return false;
    }
    log.error(`${gameId}: Error checking archive existence: ${error}`, {
      message: error?.message || error,
      stack: error?.stack,
      name: error?.name,
      ...(error && typeof error === "object" ? error : {}),
    });
    return false;
  }
}
