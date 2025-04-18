import { GameID, GameRecord } from "../core/Schemas";
import { GameEnv } from "../core/configuration/Config";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { MemoryArchive } from "./MemoryArchive";
import { S3Archive } from "./S3Archive";

export interface Archive {
  archive(gameRecord: GameRecord): Promise<void>;
  readGameRecord(gameId: GameID): Promise<GameRecord | null>;
  gameRecordExists(gameId: GameID): Promise<boolean>;
}

export function getArchive(): Archive {
  const config = getServerConfigFromServer();
  if (config.env() == GameEnv.Dev) {
    return new MemoryArchive();
  } else {
    return new S3Archive();
  }
}
