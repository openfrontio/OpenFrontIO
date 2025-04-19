import { GameID, GameRecord, GameRecordMetadata } from "../core/Schemas";

export abstract class ArchiveBase {
  abstract readGameRecord(gameId: GameID): Promise<GameRecord | null>;
  abstract gameRecordExists(gameId: GameID): Promise<boolean>;
  abstract archiveRecord(gameRecord: GameRecord): Promise<void>;
  abstract indexRecord(gameRecord: GameRecord): Promise<void>; // stores metadata for search
  abstract findRecords(
    fn: (metadata: GameRecordMetadata) => boolean,
  ): Promise<GameRecord[]>;
}

export abstract class Archive extends ArchiveBase {
  async archive(gameRecord: GameRecord) {
    await this.archiveRecord(gameRecord);
    await this.indexRecord(gameRecord);
  }
}
