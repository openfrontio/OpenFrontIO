import { describe, expect, it } from "vitest";
import { latestGameClanTag } from "../../src/client/ProfileClanTag";

// Sample data: a member of AUS, LUX and NU. Games are newest first, as
// GET /public/player/:publicId/games returns them.
const clans = [{ tag: "AUS" }, { tag: "LUX" }, { tag: "NU" }];
const games = (...tags: (string | null)[]) =>
  tags.map((clanTag) => ({ clanTag }));

describe("latestGameClanTag", () => {
  it("takes the tag of the most recent game", () => {
    expect(latestGameClanTag(games("LUX", "AUS", "NU"), clans)).toBe("LUX");
  });

  it("skips games played without a tag", () => {
    expect(latestGameClanTag(games(null, "", "  ", "NU", "AUS"), clans)).toBe(
      "NU",
    );
  });

  it("skips a tag of a clan the player has left", () => {
    expect(latestGameClanTag(games("OLD", null, "AUS"), clans)).toBe("AUS");
  });

  it("shows no tag when no game qualifies", () => {
    expect(latestGameClanTag(games(null, "OLD", null), clans)).toBeNull();
    expect(latestGameClanTag([], clans)).toBeNull();
    expect(latestGameClanTag(games("LUX"), [])).toBeNull();
  });

  it("answers in the clan's own case", () => {
    expect(latestGameClanTag(games("lux"), clans)).toBe("LUX");
    expect(latestGameClanTag(games("LUX"), [{ tag: "Lux" }])).toBe("Lux");
  });
});
