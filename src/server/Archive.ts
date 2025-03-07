import { GameRecord, GameID } from "../core/Schemas";
import { S3 } from "@aws-sdk/client-s3";
import { RedshiftData } from "@aws-sdk/client-redshift-data";
import {
  GameEnv,
  getServerConfigFromServer,
} from "../core/configuration/Config";

const config = getServerConfigFromServer();

const s3 = new S3({ region: "eu-west-1" });

const gameBucket = "openfront-games";
const analyticsBucket = "openfront-analytics";

export async function archive(gameRecord: GameRecord) {
  try {
    // Archive to Redshift Serverless
    await archiveAnalyticsToS3(gameRecord);

    // Archive to S3 if there are turns
    if (gameRecord.turns.length > 0) {
      console.log(
        `${gameRecord.id}: game has more than zero turns, attempting to write to full game to S3`,
      );
      await archiveFullGameToS3(gameRecord);
    }
  } catch (error) {
    console.error(`${gameRecord.id}: Final archive error: ${error}`, {
      message: error?.message || error,
      stack: error?.stack,
      name: error?.name,
      ...(error && typeof error === "object" ? error : {}),
    });
  }
}

async function archiveAnalyticsToS3(gameRecord: GameRecord) {
  // Create analytics data object (similar to what was going to Redshift)
  const analyticsData = {
    id: gameRecord.id,
    env: config.env(),
    start_time: new Date(gameRecord.startTimestampMS).toISOString(),
    end_time: new Date(gameRecord.endTimestampMS).toISOString(),
    duration_seconds: gameRecord.durationSeconds,
    number_turns: gameRecord.num_turns,
    game_mode: gameRecord.gameConfig.gameType,
    winner: gameRecord.winner,
    difficulty: gameRecord.gameConfig.difficulty,
    mapType: gameRecord.gameConfig.gameMap,
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

    await s3.putObject({
      Bucket: analyticsBucket,
      Key: analyticsKey,
      Body: JSON.stringify(analyticsData),
      ContentType: "application/json",
    });

    console.log(`${gameRecord.id}: successfully wrote game analytics to S3`);
  } catch (error) {
    console.error(
      `${gameRecord.id}: Error writing game analytics to S3: ${error}`,
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

async function archiveFullGameToS3(gameRecord: GameRecord) {
  // Create a deep copy to avoid modifying the original
  const recordCopy = JSON.parse(JSON.stringify(gameRecord));

  // Players may see this so make sure to clear PII
  recordCopy.players.forEach((p) => {
    p.ip = "REDACTED";
    p.persistentID = "REDACTED";
  });

  try {
    await s3.putObject({
      Bucket: gameBucket,
      Key: recordCopy.id,
      Body: JSON.stringify(recordCopy),
      ContentType: "application/json",
    });
  } catch (error) {
    console.log(`error saving game ${gameRecord.id}`);
    throw error;
  }

  console.log(`${gameRecord.id}: game record successfully written to S3`);
}

export async function readGameRecord(gameId: GameID): Promise<GameRecord> {
  try {
    // Check if file exists and download in one operation
    const response = await s3.getObject({
      Bucket: gameBucket,
      Key: gameId,
    });

    // Parse the response body
    const bodyContents = await response.Body.transformToString();
    const gameRecord = JSON.parse(bodyContents);

    return gameRecord as GameRecord;
  } catch (error) {
    console.error(`${gameId}: Error reading game record from S3: ${error}`, {
      message: error?.message || error,
      stack: error?.stack,
      name: error?.name,
      ...(error && typeof error === "object" ? error : {}),
    });
    throw error;
  }
}

export async function gameRecordExists(gameId: GameID): Promise<boolean> {
  try {
    await s3.headObject({
      Bucket: gameBucket,
      Key: gameId,
    });
    return true;
  } catch (error) {
    if (error.name === "NotFound") {
      return false;
    }
    console.error(`${gameId}: Error checking archive existence: ${error}`, {
      message: error?.message || error,
      stack: error?.stack,
      name: error?.name,
      ...(error && typeof error === "object" ? error : {}),
    });
    return false;
  }
}
