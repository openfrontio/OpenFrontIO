import { GameStartInfoSchema } from "@openfront/engine-api/Schemas";
import {
  createPartialGameRecord,
  replacer,
} from "@openfront/shared/SharedUtil";
import {
  ArchivedAnalyticsRecordSchema,
  GameEndInfoSchema,
  GameRecordSchema,
  PartialGameRecordSchema,
  PlayerRecord,
} from "@openfront/shared/WireSchemas";
import { describe, expect, it } from "vitest";
import { testGameConfig } from "./util/Wire";

// info.statsAgreed tells the API whether the record's winner and per-player
// stats were checked, by two or more IPs voting alike or by a server replay
// (GameServer.settleWinner; covered in WinnerReplaySettle.test.ts). Records
// only travel as JSON over HTTP, so the round trip that matters is the
// archive's: JSON.stringify with the bigint replacer, then a schema parse.
describe("GameEndInfo.statsAgreed", () => {
  const players: PlayerRecord[] = [
    {
      clientID: "abCD1234",
      username: "player",
      clanTag: null,
      persistentID: null,
      stats: { finalTiles: 100n },
    },
  ];

  const record = (statsAgreed?: boolean) =>
    createPartialGameRecord(
      "gAme1234",
      testGameConfig(),
      players,
      [],
      1_700_000_000_000,
      1_700_000_060_000,
      ["player", "abCD1234"],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      statsAgreed,
    );

  // What the archive sends and the API serves back.
  const roundTrip = (statsAgreed?: boolean) =>
    GameRecordSchema.parse(
      JSON.parse(
        JSON.stringify({ ...record(statsAgreed), gitCommit: "DEV" }, replacer),
      ),
    );

  it.each([true, false])("survives the archive round trip as %s", (value) => {
    expect(PartialGameRecordSchema.parse(record(value)).info.statsAgreed).toBe(
      value,
    );
    expect(roundTrip(value).info.statsAgreed).toBe(value);
  });

  it("is absent when not given, as on singleplayer records", () => {
    const info = roundTrip().info;
    expect("statsAgreed" in info).toBe(false);
    expect(info.statsAgreed).toBeUndefined();
    // The rest of the record is unaffected.
    expect(info.players[0].stats?.finalTiles).toBe(100n);
  });

  it("is read back by the lenient archived-record schema", () => {
    const json = JSON.parse(
      JSON.stringify({ ...record(true), gitCommit: "DEV" }, replacer),
    );
    expect(ArchivedAnalyticsRecordSchema.parse(json).info.statsAgreed).toBe(
      true,
    );
  });

  it("rejects anything but a boolean", () => {
    const json = JSON.parse(
      JSON.stringify({ ...record(true), gitCommit: "DEV" }, replacer),
    );
    json.info.statsAgreed = "true";
    expect(GameRecordSchema.safeParse(json).success).toBe(false);
  });

  it("is on the end info and not on the wire start info", () => {
    expect("statsAgreed" in GameEndInfoSchema.shape).toBe(true);
    expect("statsAgreed" in GameStartInfoSchema.shape).toBe(false);
  });
});
