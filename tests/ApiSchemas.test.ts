import {
  ClaimAllRewardsResponseSchema,
  ClaimRewardResponseSchema,
  FriendEntrySchema,
  GoogleUser,
  GoogleUserSchema,
  isTemporaryUsername,
  isVerifiedUsername,
  PlayerGameModeFilterSchema,
  PlayerGameResultSchema,
  PlayerGameTypeFilterSchema,
  PlayerProfileSchema,
  PublicPlayerGameSchema,
  PublicPlayerGamesResponseSchema,
  PutUsernameResponseSchema,
  RankedLeaderboardEntrySchema,
  RewardSchema,
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

  it("accepts a pre-rendered account username", () => {
    const result = PlayerProfileSchema.safeParse({
      ...base,
      username: "bob.4821",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("bob.4821");
    }
  });

  it("accepts username: null (player never set one)", () => {
    const result = PlayerProfileSchema.safeParse({ ...base, username: null });
    expect(result.success).toBe(true);
  });

  it("accepts a profile without username (older API)", () => {
    const result = PlayerProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBeUndefined();
    }
  });
});

describe("FriendEntrySchema", () => {
  const base = {
    publicId: "abc123",
    createdAt: "2024-01-15T12:00:00.000Z",
  };

  it("accepts an entry with an account username", () => {
    const result = FriendEntrySchema.safeParse({
      ...base,
      username: "bob.4821",
    });
    expect(result.success).toBe(true);
  });

  it("accepts username: null (friend never set one)", () => {
    const result = FriendEntrySchema.safeParse({ ...base, username: null });
    expect(result.success).toBe(true);
  });

  it("accepts an entry without username (older API)", () => {
    expect(FriendEntrySchema.safeParse(base).success).toBe(true);
  });
});

describe("RankedLeaderboardEntrySchema accountUsername", () => {
  const base = {
    rank: 1,
    elo: 1500,
    peakElo: 1600,
    wins: 10,
    losses: 5,
    total: 15,
    public_id: "abc123",
    username: "xX_Sniper_Xx",
  };

  it("keeps accountUsername verbatim alongside the session username", () => {
    const result = RankedLeaderboardEntrySchema.safeParse({
      ...base,
      accountUsername: "bob.4821",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accountUsername).toBe("bob.4821");
      expect(result.data.username).toBe("xX_Sniper_Xx");
    }
  });

  it("accepts accountUsername: null (player never set one)", () => {
    const result = RankedLeaderboardEntrySchema.safeParse({
      ...base,
      accountUsername: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an entry without accountUsername (older API)", () => {
    expect(RankedLeaderboardEntrySchema.safeParse(base).success).toBe(true);
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

  it("normalizes accidental whitespace around archived map names", () => {
    const result = PublicPlayerGameSchema.safeParse({
      ...validGame,
      map: "Deglaciated Antarctica ",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map).toBe("Deglaciated Antarctica");
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
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
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

describe("UserMeResponseSchema unlimitedRanked", () => {
  const basePlayer = {
    publicId: "p1",
    adfree: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("accepts a player exempt from ranked play limits", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: { ...basePlayer, unlimitedRanked: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.unlimitedRanked).toBe(true);
    }
  });

  it("rejects a response without unlimitedRanked", () => {
    expect(
      UserMeResponseSchema.safeParse({ user: {}, player: basePlayer }).success,
    ).toBe(false);
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

describe("UserMeResponseSchema canCreatePublicLobbies", () => {
  const basePlayer = {
    publicId: "p1",
    adfree: false,
    unlimitedRanked: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("accepts a player allowed to list lobbies publicly", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: { ...basePlayer, canCreatePublicLobbies: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.canCreatePublicLobbies).toBe(true);
    }
  });

  it("rejects a response without canCreatePublicLobbies", () => {
    expect(
      UserMeResponseSchema.safeParse({ user: {}, player: basePlayer }).success,
    ).toBe(false);
  });
});

describe("UserMeResponseSchema account username", () => {
  const basePlayer = {
    publicId: "p1",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
  };

  it("accepts a lapsed claim holder (suffix showing, grace deadline set)", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        username: "Bob.4821",
        usernameBase: "Bob",
        usernameDiscriminator: "4821",
        usernameStatus: "claimed",
        usernameClaimExpiresAt: "2026-08-17T19:42:00.000Z",
        nextUsernameChangeAt: null,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.username).toBe("Bob.4821");
      expect(result.data.player.usernameStatus).toBe("claimed");
    }
  });

  it("accepts a response without any username fields (older API)", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: basePlayer,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.usernameStatus).toBeUndefined();
    }
  });

  it("accepts a player who never set a name (all null, unclaimed)", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        username: null,
        usernameBase: null,
        usernameDiscriminator: null,
        usernameStatus: "unclaimed",
        usernameClaimExpiresAt: null,
        nextUsernameChangeAt: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("keeps a leading-zero discriminator as a string", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {},
      player: {
        ...basePlayer,
        username: "Ann.0042",
        usernameBase: "Ann",
        usernameDiscriminator: "0042",
        usernameStatus: "unclaimed",
        usernameClaimExpiresAt: null,
        nextUsernameChangeAt: null,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player.usernameDiscriminator).toBe("0042");
    }
  });

  it("rejects an unknown usernameStatus", () => {
    expect(
      UserMeResponseSchema.safeParse({
        user: {},
        player: { ...basePlayer, usernameStatus: "expired" },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-ISO usernameClaimExpiresAt", () => {
    expect(
      UserMeResponseSchema.safeParse({
        user: {},
        player: {
          ...basePlayer,
          usernameStatus: "claimed",
          usernameClaimExpiresAt: "next month",
        },
      }).success,
    ).toBe(false);
  });
});

describe("PutUsernameResponseSchema", () => {
  const base = {
    username: "NewName.7302",
    base: "NewName",
    discriminator: "7302",
    usernameStatus: "unclaimed",
    nextUsernameChangeAt: "2026-08-17T19:42:00.000Z",
  };

  it("accepts a rename result", () => {
    const result = PutUsernameResponseSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("NewName.7302");
      expect(result.data.discriminator).toBe("7302");
    }
  });

  it("accepts a null cooldown", () => {
    expect(
      PutUsernameResponseSchema.safeParse({
        ...base,
        nextUsernameChangeAt: null,
      }).success,
    ).toBe(true);
  });

  it("rejects a numeric discriminator (leading zeros would be lost)", () => {
    expect(
      PutUsernameResponseSchema.safeParse({ ...base, discriminator: 7302 })
        .success,
    ).toBe(false);
  });

  it("rejects a missing base", () => {
    const rest: Record<string, unknown> = { ...base };
    delete rest.base;
    expect(PutUsernameResponseSchema.safeParse(rest).success).toBe(false);
  });
});

describe("isTemporaryUsername", () => {
  it.each(["TEMPORARY0042", "TEMPORARY9999"])("detects %s", (name) => {
    expect(isTemporaryUsername(name)).toBe(true);
  });

  it.each([
    "temporary1234",
    "TEMPORARY123",
    "TEMPORARY12345",
    "TEMPORARYabcd",
    "Bob",
  ])("rejects %s", (name) => {
    expect(isTemporaryUsername(name)).toBe(false);
  });

  it("handles null and undefined bases", () => {
    expect(isTemporaryUsername(null)).toBe(false);
    expect(isTemporaryUsername(undefined)).toBe(false);
  });
});

describe("isVerifiedUsername", () => {
  it.each(["bob", "big_boss", "a-b_c9"])(
    "treats bare (dotless) display %s as verified",
    (name) => {
      expect(isVerifiedUsername(name)).toBe(true);
    },
  );

  it.each(["bob.4821", "big_boss.0042"])(
    "treats suffixed display %s as not verified",
    (name) => {
      expect(isVerifiedUsername(name)).toBe(false);
    },
  );

  it("never verifies an unset username", () => {
    expect(isVerifiedUsername(null)).toBe(false);
    expect(isVerifiedUsername(undefined)).toBe(false);
  });

  it("never verifies a TEMPORARY#### server rename, even though it is bare", () => {
    expect(isVerifiedUsername("TEMPORARY1234")).toBe(false);
  });
});
