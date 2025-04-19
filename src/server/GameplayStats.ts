import { GameRecord, GameRecordMetadata } from "../core/Schemas";
import { Archive } from "./Archive";

export async function last24HoursStats(
  archive: Archive,
): Promise<Array<GameRecord>> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const records: Array<GameRecord> = await archive.findRecords(
    (metadata: GameRecordMetadata) => {
      return (
        metadata.startTimestampMS > twentyFourHoursAgo.getTime() &&
        metadata.startTimestampMS < now.getTime()
      );
    },
  );

  return records;
}
