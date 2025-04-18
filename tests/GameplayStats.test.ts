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

    await last24HoursStats(archive);
  });
});
