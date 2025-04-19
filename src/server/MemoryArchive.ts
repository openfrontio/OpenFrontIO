import { GameID, GameRecord, GameRecordMetadata } from "../core/Schemas";
import { Archive } from "./Archive";

export class MemoryArchive extends Archive {
  private indices: Map<GameID, GameRecordMetadata> = new Map();
  private map: Map<GameID, GameRecord> = new Map();

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

  async indexRecord(gameRecord: GameRecord) {}
}
