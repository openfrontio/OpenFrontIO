import { Game } from "../src/core/game/Game";
import { createGameRecord } from "../src/core/Util";
import { MemoryArchive } from "../src/server/MemoryArchive";

import { last24HoursStats } from "../src/server/GameplayStats";

import { setup } from "./util/Setup";

const archive = new MemoryArchive();

let game: Game;

describe("GameplayStats", () => {
  beforeEach(async () => {
    game = await setup("ocean_and_land", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });
  });

  it("can access game record", async () => {
    let i = 0;
    while (i < 5) {
      game.executeNextTick();
      i++;
    }

    const gameRecord = createGameRecord(
      "game",
      null,
      null,
      [],
      Date.now(),
      Date.now(),
      "",
      "player",
      null,
    );

    archive.archive(gameRecord);
    const gameRecordFromArchive = await archive.readGameRecord(gameRecord.id);
    expect(gameRecordFromArchive).not.toBeNull();
    expect(gameRecordFromArchive?.id).toEqual(gameRecord.id);

    const records = await last24HoursStats(archive);
    expect(records.length).toEqual(1);

    // old game record
    const oldGameRecord = createGameRecord(
      "game2",
      null,
      null,
      [],
      Date.now() - 1000 * 60 * 60 * 25,
      Date.now() - 1000 * 60 * 60 * 24,
      "",
      "player",
      null,
    );
    archive.archive(oldGameRecord);
    const oldGameRecordFromArchive = await archive.readGameRecord(
      oldGameRecord.id,
    );
    expect(oldGameRecordFromArchive).not.toBeNull();

    const oldRecords = await last24HoursStats(archive);
    expect(oldRecords.length).toEqual(1);
    expect(oldRecords[0].id).toEqual(gameRecord.id); // "old" game record should not be included
  });
});
