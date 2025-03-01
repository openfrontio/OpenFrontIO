import { BigQuery } from "@google-cloud/bigquery";
import { Storage } from "@google-cloud/storage";
import { GameID, GameRecord, GameRecordSchema } from "../core/Schemas";

const storage = new Storage();
const bucket = storage.bucket("openfront-games");
const bigquery = new BigQuery();

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000; // Start with 1 second delay

export async function archive(gameRecord: GameRecord) {
  try {
    // First archive to BigQuery with retries
    await withRetry(
      () => archiveToBigQuery(gameRecord),
      "BigQuery archive",
      gameRecord.id,
    );

    // Then archive to GCS with retries if there are turns
    if (gameRecord.turns.length > 0) {
      console.log(
        `${gameRecord.id}: game has more than zero turns, attempting to write to GCS`,
      );
      await withRetry(
        () => archiveToGCS(gameRecord),
        "GCS archive",
        gameRecord.id,
      );
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

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  gameId: string,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt < MAX_RETRIES) {
        const backoffDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.random() * 1000;
        const totalDelay = backoffDelay + jitter;

        console.log(
          `${gameId}: ${operationName} attempt ${attempt + 1} failed with ${error}. Retrying in ${Math.round(totalDelay)}ms...`,
        );
        await delay(totalDelay);
      }
    }
  }

  console.error(
    `${gameId}: All ${MAX_RETRIES + 1} ${operationName} attempts failed. Last error:`,
    lastError,
  );
  throw lastError;
}

async function archiveToBigQuery(gameRecord: GameRecord) {
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
    players: gameRecord.players.map((p) => ({
      username: p.username,
      ip: anonymizeIP(p.ip),
      persistentID: p.persistentID,
      clientID: p.clientID,
    })),
  };

  const [apiResponse] = await bigquery
    .dataset("game_archive")
    .table("game_results")
    .insert([row]);

  console.log(`${gameRecord.id}: wrote game metadata to BigQuery`);
  return apiResponse;
}

async function archiveToGCS(gameRecord: GameRecord) {
  // Create a deep copy to avoid modifying the original
  const recordCopy = JSON.parse(JSON.stringify(gameRecord));

  // Players may see this so make sure to clear PII
  recordCopy.players.forEach((p) => {
    p.ip = "REDACTED";
    p.persistentID = "REDACTED";
  });

  const file = bucket.file(recordCopy.id);
  await file.save(JSON.stringify(GameRecordSchema.parse(recordCopy)), {
    contentType: "application/json",
  });

  console.log(`${gameRecord.id}: game record successfully written to GCS`);
}

export async function readGameRecord(gameId: GameID): Promise<GameRecord> {
  try {
    const file = bucket.file(gameId);

    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`Game record ${gameId} not found in GCS`);
    }

    // Download and parse file content
    const [content] = await file.download();
    const gameRecord = JSON.parse(content.toString());

    // Validate the parsed content against the schema
    const validatedRecord = GameRecordSchema.parse(gameRecord);

    console.log(`${gameId}: Successfully read game record from GCS`);
    return validatedRecord;
  } catch (error) {
    console.error(`${gameId}: Error reading game record from GCS: ${error}`, {
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
    const file = bucket.file(gameId);
    const [exists] = await file.exists();
    return exists;
  } catch (error) {
    console.error(`${gameId}: Error checking archive existence: ${error}`, {
      message: error?.message || error,
      stack: error?.stack,
      name: error?.name,
      ...(error && typeof error === "object" ? error : {}),
    });
    return false;
  }
}

function anonymizeIPv4(ipv4: string): string | null {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;

  if (!ipv4Regex.test(ipv4)) {
    return null;
  }

  const octets = ipv4.split(".");

  if (
    !octets.every((octet) => {
      const num = parseInt(octet);
      return num >= 0 && num <= 255;
    })
  ) {
    return null;
  }

  octets[3] = "xxx";

  return octets.join(".");
}

function anonymizeIPv6(ipv6: string): string | null {
  const ipv6Regex = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;

  const normalizedIPv6 = ipv6
    .toUpperCase()
    .replace(/([^:]):([^:])/g, "$1:0$2")
    .replace(/::/, ":0000:");

  if (!ipv6Regex.test(normalizedIPv6)) {
    return null;
  }

  const segments = normalizedIPv6.split(":");

  if (
    !segments.every((segment) => {
      const hex = parseInt(segment, 16);
      return hex >= 0 && hex <= 65535;
    })
  ) {
    return null;
  }

  for (let i = 4; i < 8; i++) {
    segments[i] = "xxxx";
  }

  return segments.join(":");
}

function anonymizeIP(ip: string): string | null {
  const ipv4Result = anonymizeIPv4(ip);
  if (ipv4Result) {
    return ipv4Result;
  }

  const ipv6 = anonymizeIPv6(ip);
  return ipv6;
}
