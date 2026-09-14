import {
  PlayerStatsLeafSchema,
  PlayerStatsTreeSchema,
} from "../src/core/ApiSchemas";
import { PlayerStatsSchema } from "../src/core/StatsSchemas";

function testPlayerSchema(
  json: string,
  expectSuccess = true,
  expectThrow = false,
): void {
  const parse = () => {
    const raw = JSON.parse(json);
    const result = PlayerStatsSchema.safeParse(raw);
    return result.success;
  };

  if (expectSuccess) {
    // Expect success
    expect(parse()).toBeTruthy();
  } else if (!expectThrow) {
    // Expect failure
    expect(parse()).toBeFalsy();
  } else {
    // Expect throw
    expect(parse).toThrow();
  }
}

describe("StatsSchema", () => {
  test("Parse empty", () => {
    testPlayerSchema("{}");
  });

  test("Parse partial", () => {
    testPlayerSchema('{"units":{"port":["0","0","0","1"]}}');
  });

  test("Parse invalid", () => {
    testPlayerSchema("[]", false);
    testPlayerSchema("null", false);
    testPlayerSchema('"null"', false);
    testPlayerSchema('"undefined"', false);
  });

  test("Parse failure", () => {
    testPlayerSchema("", false, true);
    testPlayerSchema("undefined", false, true);
    testPlayerSchema("{", false, true);
    testPlayerSchema("{}}", false, true);
  });

  test("null array elements coerce to 0n (LEFT JOIN rows with no stats)", () => {
    // Postgres SUM() over all-NULL rows returns NULL. These should parse as 0n.
    testPlayerSchema(
      '{"attacks":[null,null,null],"betrayals":null,"gold":[null,null,null,null,null,null]}',
    );
  });
});

describe("PlayerStatsLeafSchema", () => {
  test("parses optional legacy recent game IDs and outcomes", () => {
    const result = PlayerStatsLeafSchema.parse({
      wins: "1",
      losses: "1",
      total: "2",
      stats: {},
      recentGames: [
        { gameId: "102", won: true },
        { gameId: "101", won: false },
      ],
    });

    expect(result.recentGames).toEqual([
      { gameId: 102n, won: true },
      { gameId: 101n, won: false },
    ]);
  });

  test("null stat values coerce to 0n", () => {
    const result = PlayerStatsLeafSchema.safeParse({
      wins: "0",
      losses: "1",
      total: "1",
      stats: { attacks: [null, null, null], betrayals: null },
    });
    expect(result.success).toBe(true);
  });

  test("missing required field (wins) still fails — undefined is not coerced", () => {
    const result = PlayerStatsLeafSchema.safeParse({
      losses: "1",
      total: "1",
      stats: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("PlayerStatsTreeSchema", () => {
  test("parses recent aggregates for every selectable filter level", () => {
    const result = PlayerStatsTreeSchema.parse({
      recent: {
        all: { games: 100, wins: 64 },
        Public: {
          all: { games: 100, wins: 65 },
          Medium: { games: 100, wins: 65 },
          "Free For All": {
            all: { games: 100, wins: 66 },
            Medium: { games: 100, wins: 66 },
          },
        },
        Ranked: {
          all: { games: 100, wins: 67 },
          "1v1": { games: 100, wins: 68 },
        },
      },
    });

    expect(result.recent?.all).toEqual({ games: 100, wins: 64 });
    expect(result.recent?.Public?.Medium).toEqual({
      games: 100,
      wins: 65,
    });
    expect(result.recent?.Public?.["Free For All"]?.all).toEqual({
      games: 100,
      wins: 66,
    });
    expect(result.recent?.Ranked?.["1v1"]).toEqual({
      games: 100,
      wins: 68,
    });
  });

  test("rejects a recent aggregate above the 100-game window", () => {
    expect(() =>
      PlayerStatsTreeSchema.parse({
        recent: { all: { games: 101, wins: 64 } },
      }),
    ).toThrow();
  });

  test("rejects a recent node missing its all aggregate", () => {
    expect(() =>
      PlayerStatsTreeSchema.parse({
        recent: { all: { games: 100, wins: 64 }, Public: { Medium: {} } },
      }),
    ).toThrow();
  });

  test("accepts Humans Vs Nations as a separate profile stats mode", () => {
    const result = PlayerStatsTreeSchema.parse({
      Public: {
        "Humans Vs Nations": {
          Hard: {
            wins: "1",
            losses: "2",
            total: "3",
            stats: {},
          },
        },
      },
    });

    expect(result.Public?.["Humans Vs Nations"]?.Hard?.total).toBe(3n);
  });
});
