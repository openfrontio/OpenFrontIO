import { describe, expect, it } from "vitest";
import {
  AnalyticsRecordSchema,
  ArchivedAnalyticsRecordSchema,
} from "../src/core/Schemas";

// Modelled on a real archived record (game 1iHmEZME, June 2026) that the
// strict write-side schema rejects: most players predate clanTag, one
// username carries the old embedded clan-tag style, and the config is from
// the disableNations era (no `nations` field, unknown keys like
// `competitiveScoring`).
const legacyRecord = {
  version: "v0.0.2",
  gitCommit: "4c560c7ba912b09edd1e28b599ec6439955ee863",
  domain: "openfront.dev",
  subdomain: "compet",
  info: {
    gameID: "1iHmEZME",
    lobbyCreatedAt: 1750000000000,
    config: {
      gameMap: "Australia",
      difficulty: "Easy",
      donateGold: true,
      donateTroops: true,
      gameType: "Private",
      gameMode: "Team",
      gameMapSize: "Normal",
      disableNations: true,
      bots: 400,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
      playerTeams: "Duos",
      competitiveScoring: true,
    },
    players: [
      {
        clientID: "N8ptb2xQ",
        username: "Wonder",
        // No clanTag — predates the field.
        cosmetics: {},
        persistentID: null,
        stats: {
          attacks: ["92819239"],
          gold: ["5000", "100"],
          conquests: ["3", "10", "1"],
        },
      },
      {
        clientID: "MpkQz3Ej",
        // Old embedded clan-tag style; fails today's UsernameSchema regex.
        username: "[UN] Jedifah",
        clanTag: "UN",
        cosmetics: {},
        persistentID: null,
        stats: { killedAt: "900", gold: ["2500"] },
      },
      {
        clientID: "wzJtSsHS",
        username: "Temujin",
        cosmetics: { flag: "Mongol Empire" },
        persistentID: null,
        stats: { conquests: ["1"] },
      },
    ],
    start: 1750000100000,
    end: 1750000938000,
    duration: 838,
    num_turns: 8380,
    winner: ["team", "Blue", "N8ptb2xQ"],
    lobbyFillTime: 60000,
  },
};

describe("archived game records", () => {
  it("strict write-side schema rejects legacy records (why the read schema exists)", () => {
    expect(AnalyticsRecordSchema.safeParse(legacyRecord).success).toBe(false);
  });

  it("parses a legacy record and preserves what the ranking display needs", () => {
    const parsed = ArchivedAnalyticsRecordSchema.parse(legacyRecord);
    expect(parsed.info.players).toHaveLength(3);
    expect(parsed.info.players[0].clanTag).toBeNull();
    expect(parsed.info.players[1].username).toBe("[UN] Jedifah");
    expect(parsed.info.players[1].clanTag).toBe("UN");
    expect(parsed.info.players[2].cosmetics?.flag).toBe("Mongol Empire");
    expect(parsed.info.winner).toEqual(["team", "Blue", "N8ptb2xQ"]);
    expect(parsed.info.duration).toBe(838);
    expect(parsed.info.config.gameMap).toBe("Australia");
    expect(parsed.info.config.gameMode).toBe("Team");
    // Stats round-trip through the BigInt string preprocessing.
    expect(parsed.info.players[0].stats?.gold?.[0]).toBe(5000n);
    expect(parsed.info.players[1].stats?.killedAt).toBe(900n);
  });

  it("drops only a corrupt stats blob, not the whole record", () => {
    const record = structuredClone(legacyRecord);
    (record.info.players[0] as { stats: unknown }).stats = {
      gold: ["not-a-number"],
    };
    const parsed = ArchivedAnalyticsRecordSchema.parse(record);
    expect(parsed.info.players[0].stats).toBeUndefined();
    expect(parsed.info.players[1].stats?.killedAt).toBe(900n);
  });

  it("tolerates missing config and winner", () => {
    const record = structuredClone(legacyRecord) as {
      info: { config?: unknown; winner?: unknown };
    };
    delete record.info.config;
    delete record.info.winner;
    const parsed = ArchivedAnalyticsRecordSchema.parse(record);
    expect(parsed.info.config).toEqual({ gameMode: "", gameMap: "" });
    expect(parsed.info.winner).toBeUndefined();
  });

  it("still fails without players — the view needs them to render anything", () => {
    const record = structuredClone(legacyRecord) as {
      info: { players?: unknown };
    };
    delete record.info.players;
    expect(ArchivedAnalyticsRecordSchema.safeParse(record).success).toBe(false);
  });
});
