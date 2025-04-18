import { GameID, GameRecord } from "../core/Schemas";

export class MemoryArchive {
  private map: Map<GameID, GameRecord> = new Map();

  async archive(gameRecord: GameRecord) {
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
}
