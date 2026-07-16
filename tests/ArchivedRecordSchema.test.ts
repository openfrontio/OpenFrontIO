import {
  AnalyticsRecordSchema,
  ArchivedAnalyticsRecordSchema,
} from "../src/core/Schemas";

// A record as an old build would have written it: no `nations` in the config,
// no `clanTag` on players, a username that fails today's tighter regex, and a
// scalar `conquests` stat (it became an array later). The `version` literal
// never changed across those schema changes, so only the lenient archived
// schema can read it back.
function oldRecord() {
  return {
    version: "v0.0.2",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    subdomain: "eu1",
    domain: "openfront.io",
    info: {
      gameID: "abCD1234",
      lobbyCreatedAt: 1700000000000,
      start: 1700000001000,
      end: 1700000002000,
      duration: 1000,
      num_turns: 100,
      lobbyFillTime: 5000,
      winner: ["player", "abCD1234"],
      config: {
        // no `nations` — predates configurable nation count
        gameMap: "Africa",
        difficulty: "Medium",
        donateGold: true,
        donateTroops: true,
        gameType: "Public",
        gameMode: "Free For All",
        gameMapSize: "Normal",
        bots: 400,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        randomSpawn: false,
      },
      players: [
        {
          clientID: "abCD1234",
          username: "[BR] køva!", // fails today's UsernameSchema regex
          // no `clanTag` — predates clan tags
          persistentID: null,
          stats: {
            conquests: "3", // scalar, pre-array
            attacks: ["100"],
          },
        },
      ],
    },
  };
}

describe("ArchivedAnalyticsRecordSchema", () => {
  test("strict schema rejects old record (why the archived one exists)", () => {
    expect(AnalyticsRecordSchema.safeParse(oldRecord()).success).toBe(false);
  });

  test("parses old record", () => {
    const result = ArchivedAnalyticsRecordSchema.safeParse(oldRecord());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const player = result.data.info.players[0];
    expect(player.username).toBe("[BR] køva!");
    expect(player.clanTag).toBeNull();
    expect(player.stats?.conquests).toEqual([3n]);
    expect(result.data.info.config.nations).toBe("default");
  });

  test("parses current-format record unchanged", () => {
    const base = oldRecord();
    const record = {
      ...base,
      info: {
        ...base.info,
        config: { ...base.info.config, nations: "disabled" },
        players: [
          {
            ...base.info.players[0],
            username: "NormalName",
            clanTag: "ABC",
            stats: { conquests: ["1", "2", "0"] },
          },
        ],
      },
    };

    const result = ArchivedAnalyticsRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.info.config.nations).toBe("disabled");
    expect(result.data.info.players[0].clanTag).toBe("ABC");
    expect(result.data.info.players[0].stats?.conquests).toEqual([1n, 2n, 0n]);
  });
});
