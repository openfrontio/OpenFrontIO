import {
  ClaimAllRewardsResponseSchema,
  ClaimRewardResponseSchema,
  GoogleUser,
  GoogleUserSchema,
  hasActiveSubscription,
  PlayerGameModeFilterSchema,
  PlayerGameResultSchema,
  PlayerGameTypeFilterSchema,
  PlayerProfileSchema,
  PublicPlayerGameSchema,
  PublicPlayerGamesResponseSchema,
  RewardSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../src/core/ApiSchemas";

describe("GoogleUserSchema", () => {
  it("accepts a valid email", () => {
    const result = GoogleUserSchema.safeParse({ email: "user@example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("rejects a missing email", () => {
    expect(GoogleUserSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a non-string email", () => {
    expect(GoogleUserSchema.safeParse({ email: 123 }).success).toBe(false);
  });

  it("infers the GoogleUser type from the schema", () => {
    // Compile-time check that GoogleUser is derived from the schema.
    const user: GoogleUser = { email: "typed@example.com" };
    expect(user.email).toBe("typed@example.com");
  });
});

describe("PlayerProfileSchema", () => {
  const base = {
    createdAt: "2024-01-15T12:00:00.000Z",
    stats: {},
  };

  it("accepts a profile without a games array (moved to its own endpoint)", () => {
    const result = PlayerProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("ignores a legacy games field rather than failing the parse", () => {
    const result = PlayerProfileSchema.safeParse({
      ...base,
      games: [{ gameId: "g1" }],
    });
    // Zod strips unknown keys by default, so an old server response that still
    // carries games[] parses cleanly without the field surfacing.
    expect(result.success).toBe(true);
    if (result.success) {
      expect("games" in result.data).toBe(false);
    }
  });

  it("rejects a non-ISO createdAt", () => {
    expect(
      PlayerProfileSchema.safeParse({ ...base, createdAt: "yesterday" })
        .success,
    ).toBe(false);
  });
});

describe("PlayerGameModeFilterSchema", () => {
  it.each(["ffa", "team", "hvn", "ranked"])("accepts %s", (value) => {
    expect(PlayerGameModeFilterSchema.safeParse(value).success).toBe(true);
  });

  it("rejects 'all' (filter omission is encoded by absence, not a value)", () => {
    expect(PlayerGameModeFilterSchema.safeParse("all").success).toBe(false);
  });
});

describe("PlayerGameTypeFilterSchema", () => {
  it.each(["public", "private", "singleplayer"])("accepts %s", (value) => {
    expect(PlayerGameTypeFilterSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an unknown type value", () => {
    expect(PlayerGameTypeFilterSchema.safeParse("ranked").success).toBe(false);
  });
});

describe("PlayerGameResultSchema", () => {
  it.each(["victory", "defeat", "incomplete"])("accepts %s", (value) => {
    expect(PlayerGameResultSchema.safeParse(value).success).toBe(true);
  });

  it("rejects an unknown result value", () => {
    expect(PlayerGameResultSchema.safeParse("win").success).toBe(false);
  });
});

describe("PublicPlayerGameSchema", () => {
  const validGame = {
    gameId: "g1",
    start: "2024-06-01T00:00:00.000Z",
    durationSeconds: 1234,
    map: "World",
    mode: "Team",
    type: "Public",
    playerTeams: "Duos",
    rankedType: "unranked",
    result: "victory" as const,
    totalPlayers: 8,
    username: "alice",
    clanTag: "ABC",
  };

  it("accepts a fully-populated game", () => {
    expect(PublicPlayerGameSchema.safeParse(validGame).success).toBe(true);
  });

  it("accepts clanTag: null (not repping a clan)", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, clanTag: null }).success,
    ).toBe(true);
  });

  it("rejects a missing username", () => {
    const withoutUsername: Record<string, unknown> = { ...validGame };
    delete withoutUsername.username;
    expect(PublicPlayerGameSchema.safeParse(withoutUsername).success).toBe(
      false,
    );
  });

  it("accepts playerTeams: null (FFA / non-team games)", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, playerTeams: null })
        .success,
    ).toBe(true);
  });

  it("accepts totalPlayers: null (historical rows)", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, totalPlayers: null })
        .success,
    ).toBe(true);
  });

  it("rejects a negative durationSeconds", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, durationSeconds: -1 })
        .success,
    ).toBe(false);
  });

  it("rejects a non-ISO start", () => {
    expect(
      PublicPlayerGameSchema.safeParse({ ...validGame, start: "June 1 2024" })
        .success,
    ).toBe(false);
  });
});

describe("PublicPlayerGamesResponseSchema", () => {
  const validGame = {
    gameId: "g1",
    start: "2024-06-01T00:00:00.000Z",
    durationSeconds: 1234,
    map: "World",
    mode: "Free For All",
    type: "Public",
    playerTeams: null,
    rankedType: "unranked",
    result: "defeat" as const,
    totalPlayers: 20,
    username: "bob",
    clanTag: null,
  };

  it("accepts a non-empty page with an opaque cursor", () => {
    const result = PublicPlayerGamesResponseSchema.safeParse({
      results: [validGame],
      nextCursor: "opaque-cursor-abc123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nextCursor).toBe("opaque-cursor-abc123");
    }
  });

  it("accepts an empty page with a null cursor", () => {
    expect(
      PublicPlayerGamesResponseSchema.safeParse({
        results: [],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });

  it("rejects when nextCursor is missing (must be string or null)", () => {
    expect(
      PublicPlayerGamesResponseSchema.safeParse({ results: [] }).success,
    ).toBe(false);
  });
});

describe("RewardSchema", () => {
  const validReward = {
    id: "42",
    currencyType: "hard",
    amount: "500",
    reason: "subscription_signup_bonus",
    note: "Subscription signup bonus (Gold)",
  };

  it("accepts a fully-populated reward", () => {
    expect(RewardSchema.safeParse(validReward).success).toBe(true);
  });

  it("keeps id and amount as strings (bigints can exceed MAX_SAFE_INTEGER)", () => {
    const result = RewardSchema.safeParse({
      ...validReward,
      amount: "9007199254740993",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("42");
      expect(result.data.amount).toBe("9007199254740993");
    }
  });

  it("accepts note: null", () => {
    expect(RewardSchema.safeParse({ ...validReward, note: null }).success).toBe(
      true,
    );
  });

  it("accepts an unknown reason (open-ended by design)", () => {
    expect(
      RewardSchema.safeParse({ ...validReward, reason: "future_source" })
        .success,
    ).toBe(true);
  });

  it("rejects an unknown currencyType", () => {
    expect(
      RewardSchema.safeParse({ ...validReward, currencyType: "gems" }).success,
    ).toBe(false);
  });
});

describe("UserMeResponseSchema rewards", () => {
  const basePlayer = {
    publicId: "p1",
    adfree: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("accepts a player with unclaimed rewards", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        rewards: [
          {
            id: "42",
            currencyType: "soft",
            amount: "150",
            reason: "subscription_daily",
            note: "Daily Gold subscription reward (5 days)",
          },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.rewards).toHaveLength(1);
    }
  });

  it("accepts a response without rewards (older API versions)", () => {
    expect(
      UserMeResponseSchema.safeParse({ user: {}, player: basePlayer }).success,
    ).toBe(true);
  });
});

describe("claim response schemas", () => {
  it("coerces claim balances from bigint strings to numbers", () => {
    const result = ClaimRewardResponseSchema.safeParse({
      id: "42",
      currencyType: "hard",
      amount: "500",
      claimedAt: "2026-07-09T18:03:11.000Z",
      currency: { soft: "1200", hard: "850" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toEqual({ soft: 1200, hard: 850 });
    }
  });

  it("accepts a claim-all with nothing pending", () => {
    const result = ClaimAllRewardsResponseSchema.safeParse({
      claimed: [],
      currency: { soft: "0", hard: "0" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.claimed).toEqual([]);
    }
  });

  it("accepts a claim-all with claimed rewards", () => {
    const result = ClaimAllRewardsResponseSchema.safeParse({
      claimed: [
        {
          id: "42",
          currencyType: "hard",
          amount: "500",
          reason: "subscription_signup_bonus",
          note: null,
          claimedAt: "2026-07-09T18:03:11.000Z",
        },
      ],
      currency: { soft: "1200", hard: "850" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.claimed).toEqual([{ id: "42" }]);
    }
  });
});

describe("hasActiveSubscription", () => {
  function userMeWith(
    subscription: UserMeResponse["player"]["subscription"],
  ): UserMeResponse {
    return {
      user: {},
      player: {
        publicId: "p1",
        adfree: false,
        achievements: { singleplayerMap: [] },
        friends: [],
        subscription,
      },
    };
  }

  it("is true for an active subscription", () => {
    expect(
      hasActiveSubscription(
        userMeWith({
          tier: "supporter",
          status: "active",
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }),
      ),
    ).toBe(true);
  });

  it("is true while trialing", () => {
    expect(
      hasActiveSubscription(
        userMeWith({
          tier: "supporter",
          status: "trialing",
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }),
      ),
    ).toBe(true);
  });

  it("is false for canceled or past_due subscriptions", () => {
    for (const status of ["canceled", "past_due", "incomplete"]) {
      expect(
        hasActiveSubscription(
          userMeWith({
            tier: "supporter",
            status,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          }),
        ),
      ).toBe(false);
    }
  });

  it("is false without a subscription", () => {
    expect(hasActiveSubscription(userMeWith(null))).toBe(false);
  });
});
