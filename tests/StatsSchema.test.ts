import { PlayerStatsLeafSchema } from "../src/core/ApiSchemas";
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
