import { RedshiftData } from "@aws-sdk/client-redshift-data";
import { S3 } from "@aws-sdk/client-s3";
import { GameID, GameRecord } from "../core/Schemas";

// Initialize AWS clients
const s3 = new S3();
const bucket = "openfront-games";
const redshiftData = new RedshiftData({ region: "eu-west-1" });

// Redshift Serverless configuration
const REDSHIFT_WORKGROUP = "game-analytics";
const REDSHIFT_DATABASE = "game_archive";

export async function archive(gameRecord: GameRecord) {
  try {
    // Archive to Redshift Serverless
    await archiveToRedshift(gameRecord);

    // Archive to S3 if there are turns
    if (gameRecord.turns.length > 0) {
      console.log(
        `${gameRecord.id}: game has more than zero turns, attempting to write to S3`,
      );
      await archiveToS3(gameRecord);
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

async function archiveToRedshift(gameRecord: GameRecord) {
  const row = {
    id: gameRecord.id,
    start: new Date(gameRecord.startTimestampMS),
    end: new Date(gameRecord.endTimestampMS),
    duration_seconds: gameRecord.durationSeconds,
    number_turns: gameRecord.num_turns,
    game_mode: gameRecord.gameConfig.gameType,
    winner: gameRecord.winner,
    difficulty: gameRecord.gameConfig.difficulty,
    map: gameRecord.gameConfig.gameMap,
    players: JSON.stringify(
      gameRecord.players.map((p) => ({
        username: p.username,
        ip: p.ip,
        persistentID: p.persistentID,
        clientID: p.clientID,
      })),
    ),
  };

  // Convert the row to SQL parameters for insertion
  const params = {
    Sql: `
      INSERT INTO game_results (
        id, start, end, duration_seconds, number_turns, game_mode, 
        winner, difficulty, map, players
      ) VALUES (
        '${row.id}', 
        '${row.start.toISOString()}', 
        '${row.end.toISOString()}', 
        ${row.duration_seconds}, 
        ${row.number_turns}, 
        '${row.game_mode}', 
        '${row.winner}', 
        '${row.difficulty}', 
        '${row.map}', 
        JSON_PARSE('${row.players}')
      )
    `,
    WorkgroupName: REDSHIFT_WORKGROUP,
    Database: REDSHIFT_DATABASE,
  };

  await redshiftData.executeStatement(params);
  console.log(`${gameRecord.id}: wrote game metadata to Redshift`);
}

async function archiveToS3(gameRecord: GameRecord) {
  // Create a deep copy to avoid modifying the original
  const recordCopy = JSON.parse(JSON.stringify(gameRecord));

  // Players may see this so make sure to clear PII
  recordCopy.players.forEach((p) => {
    p.ip = "REDACTED";
    p.persistentID = "REDACTED";
  });

  try {
    await s3.putObject({
      Bucket: bucket,
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
      Bucket: bucket,
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
      Bucket: bucket,
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
