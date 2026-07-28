import { describe, expect, it } from "vitest";
import { UserMeResponseSchema } from "../../src/core/ApiSchemas";

function samplePlayer() {
  return {
    publicId: "player-1",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: {
      singleplayerMap: [],
    },
    friends: [],
    subscription: null,
  };
}

describe("UserMeResponseSchema steam identity", () => {
  it("accepts a user.steam identity", () => {
    const parsed = UserMeResponseSchema.parse({
      user: {
        steam: { steamId: "77", personaName: "P", avatarUrl: "https://a" },
      },
      player: samplePlayer(),
    });
    expect(parsed.user.steam?.steamId).toBe("77");
  });

  it("accepts a user.steam identity with null personaName/avatarUrl (GetPlayerSummaries fallback)", () => {
    const parsed = UserMeResponseSchema.parse({
      user: {
        steam: { steamId: "77", personaName: null, avatarUrl: null },
      },
      player: samplePlayer(),
    });
    expect(parsed.user.steam?.steamId).toBe("77");
    expect(parsed.user.steam?.personaName).toBeNull();
    expect(parsed.user.steam?.avatarUrl).toBeNull();
  });
});
