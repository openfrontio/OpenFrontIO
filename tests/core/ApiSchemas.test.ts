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

// trustTier is optional/nullable so an API without the field, or one whose
// trust computation failed (null), still parses; only the two tiers are valid.
describe("UserMeResponseSchema trustTier", () => {
  const parseWith = (player: Record<string, unknown>) =>
    UserMeResponseSchema.parse({ user: {}, player });

  it("accepts trusted and untrusted", () => {
    expect(
      parseWith({ ...samplePlayer(), trustTier: "trusted" }).player.trustTier,
    ).toBe("trusted");
    expect(
      parseWith({ ...samplePlayer(), trustTier: "untrusted" }).player.trustTier,
    ).toBe("untrusted");
  });

  it("accepts null and an absent field", () => {
    expect(
      parseWith({ ...samplePlayer(), trustTier: null }).player.trustTier,
    ).toBeNull();
    expect(parseWith(samplePlayer()).player.trustTier).toBeUndefined();
  });

  it("rejects an unknown tier", () => {
    expect(
      UserMeResponseSchema.safeParse({
        user: {},
        player: { ...samplePlayer(), trustTier: "admin" },
      }).success,
    ).toBe(false);
  });
});
