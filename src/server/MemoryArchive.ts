import { GameID, GameRecord, GameRecordMetadata } from "../core/Schemas";
import { Archive } from "./Archive";

export class MemoryArchive extends Archive {
  private indices: Map<GameID, GameRecordMetadata> = new Map();
  private map: Map<GameID, GameRecord> = new Map();

  // warning: this is not a persistent archive
  async archiveRecord(gameRecord: GameRecord) {
    this.map.set(gameRecord.id, gameRecord);
  }

  async readGameRecord(gameId: GameID): Promise<GameRecord | null> {
    const record = this.map.get(gameId);
    if (record) {
      return record;
    } else {
      return null;
    }
  }

  async gameRecordExists(gameId: GameID): Promise<boolean> {
    return this.map.has(gameId);
  }

  async indexRecord(gameRecord: GameRecord) {
    const metadata: GameRecordMetadata = {
      id: gameRecord.id,
      startTimestampMS: gameRecord.startTimestampMS,
      endTimestampMS: gameRecord.endTimestampMS,
      version: gameRecord.version,
      gitCommit: gameRecord.gitCommit,
    };

    this.indices.set(gameRecord.id, metadata);
  }

  async findRecords(
    fn: (metadata: GameRecordMetadata) => boolean,
  ): Promise<GameRecord[]> {
    const records: GameRecord[] = [];
    for (const [gameId, metadata] of this.indices.entries()) {
      if (fn(metadata)) {
        const record = await this.readGameRecord(gameId);
        if (record) {
          records.push(record);
        }
      }
    }
    return records;
  }
}
