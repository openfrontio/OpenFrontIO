import { GameID, GameRecord } from "../core/Schemas";

export class DiskArchive {
  async archive(gameRecord: GameRecord) {}

  async readGameRecord(gameId: GameID): Promise<GameRecord | null> {
    return null;
  }

  async gameRecordExists(gameId: GameID): Promise<boolean> {
    return false;
  }
}
