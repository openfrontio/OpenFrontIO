import { describe, expect, it } from "vitest";
import { ClusterConfigSchema } from "../../src/core/ClusterConfig";
import { GAME_ID_REGEX } from "../../src/core/Schemas";
import { generateGameID } from "../../src/core/Util";

const entry = (host: string, color = "blue", numWorkers = 2) => ({
  host,
  color,
  numWorkers,
});

describe("ClusterConfigSchema", () => {
  it("accepts a valid multi-entry map", () => {
    const result = ClusterConfigSchema.safeParse({
      a: entry("blue.openfront.io", "blue", 16),
      b: entry("green.openfront.io", "green", 16),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty map", () => {
    expect(ClusterConfigSchema.safeParse({}).success).toBe(false);
  });

  it("rejects duplicate hosts", () => {
    const result = ClusterConfigSchema.safeParse({
      a: entry("same.io"),
      b: entry("same.io"),
    });
    expect(result.success).toBe(false);
  });

  it.each(["ab", "A", "1", ""])("rejects letter key %j", (letter) => {
    expect(
      ClusterConfigSchema.safeParse({ [letter]: entry("x.io") }).success,
    ).toBe(false);
  });

  it("rejects an unknown color", () => {
    expect(
      ClusterConfigSchema.safeParse({ a: entry("x.io", "purple") }).success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5])("rejects numWorkers %d", (n) => {
    expect(
      ClusterConfigSchema.safeParse({ a: entry("x.io", "blue", n) }).success,
    ).toBe(false);
  });
});

describe("generateGameID", () => {
  it("mints letter + 9 random chars that validate as a game id", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateGameID("a");
      expect(id).toHaveLength(10);
      expect(id[0]).toBe("a");
      expect(GAME_ID_REGEX.test(id)).toBe(true);
    }
  });
});
