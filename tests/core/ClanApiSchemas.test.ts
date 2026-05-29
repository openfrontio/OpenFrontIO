import { describe, expect, it } from "vitest";
import { clanExistsApiPath } from "../../src/core/ClanApiSchemas";

describe("clanExistsApiPath", () => {
  it("uppercases and URL-encodes the tag", () => {
    expect(clanExistsApiPath("abc")).toBe("/public/clan/ABC/exists");
    expect(clanExistsApiPath("a/b")).toBe("/public/clan/A%2FB/exists");
  });
});
