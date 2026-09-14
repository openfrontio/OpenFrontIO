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

// OPE-314. `provider` distinguishes a paid subscription from a GRANT, which
// the panel must not offer a cancel for. `null` (granted) and `undefined` (a
// server that predates the field, which is every staging deploy until the next
// one) mean different things and the schema must not flatten one into the
// other.
describe("UserMeResponseSchema subscription.provider", () => {
  const parseSub = (subscription: Record<string, unknown>) =>
    UserMeResponseSchema.parse({
      user: {},
      player: { ...samplePlayer(), subscription },
    }).player.subscription;

  const paid = {
    tier: "plutonium",
    status: "active",
    currentPeriodEnd: "2026-10-01T00:00:00Z",
    cancelAtPeriodEnd: false,
  };

  it("keeps null and an absent field apart", () => {
    // Granted: the server said, explicitly, that nobody is billing this.
    expect(parseSub({ ...paid, provider: null })?.provider).toBeNull();
    // Absent: an older server that never sends the field. NOT null — the
    // client must be able to tell "granted" from "we don't know".
    expect(parseSub(paid)?.provider).toBeUndefined();
  });

  it("carries the paid rails through", () => {
    expect(parseSub({ ...paid, provider: "stripe" })?.provider).toBe("stripe");
    expect(parseSub({ ...paid, provider: "steam" })?.provider).toBe("steam");
  });

  // Loose z.string(), not an enum: a parse failure fails the whole /users/@me
  // response, so a rail added server-side must not blank the account view of
  // every client that shipped before it. An unknown value is not null, so it
  // lands on the paid behaviour.
  it("tolerates a rail it has never heard of rather than failing the response", () => {
    const parsed = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...samplePlayer(),
        subscription: { ...paid, provider: "xbox" },
      },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.player.subscription?.provider).toBe(
      "xbox",
    );
  });
});
