import {
  ClaimAllRewardsResponseSchema,
  ClaimRewardResponseSchema,
  FriendEntrySchema,
  GetMyTribeNamesResponseSchema,
  GoogleUser,
  GoogleUserSchema,
  isTemporaryUsername,
  isVerifiedUsername,
  PlayerGameModeFilterSchema,
  PlayerGameResultSchema,
  PlayerGameTypeFilterSchema,
  PlayerLeaderboardEntrySchema,
  PlayerProfileSchema,
  PostTribeBoostResponseSchema,
  PublicPlayerGameSchema,
  PublicPlayerGamesResponseSchema,
  PutUsernameResponseSchema,
  RankedLeaderboardEntrySchema,
  RewardSchema,
  TribeLeaderboardResponseSchema,
  TribeNameSchema,
  TribeStatsResponseSchema,
  UserMeResponseSchema,
} from "../src/core/ApiSchemas";

describe("UserMeResponseSchema ban", () => {
  const ban = UserMeResponseSchema.shape.ban;

  it("accepts an active temporary ban", () => {
    const r = ban.safeParse({
      category: "cheating",
      reason: "aimbot in ranked",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a permanent ban (null reason and expiry)", () => {
    const r = ban.safeParse({
      category: "other",
      reason: null,
      expiresAt: null,
    });
    expect(r.success).toBe(true);
  });

  it("treats null and a missing field as 'no ban'", () => {
    expect(ban.safeParse(null).success).toBe(true);
    expect(ban.safeParse(undefined).success).toBe(true);
  });

  it("rejects a ban with no category", () => {
    expect(ban.safeParse({ reason: null, expiresAt: null }).success).toBe(
      false,
    );
  });
});

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

describe("PlayerProfileSchema clans", () => {
  const base = {
    createdAt: "2024-01-15T12:00:00.000Z",
    stats: {},
  };
  const clan = {
    tag: "ALP",
    name: "Alpha Clan",
    role: "leader",
    joinedAt: "2024-02-01T12:00:00.000Z",
    memberCount: 12,
  };

  it("accepts a profile carrying clan memberships", () => {
    const result = PlayerProfileSchema.safeParse({
      ...base,
      clans: [clan, { ...clan, tag: "ZET", role: "member", memberCount: 1 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans).toHaveLength(2);
      expect(result.data.clans?.[0].role).toBe("leader");
      expect(result.data.clans?.[1].memberCount).toBe(1);
    }
  });

  it("accepts a profile without clans (older API)", () => {
    const result = PlayerProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans).toBeUndefined();
    }
  });

  it("accepts an empty clan list", () => {
    const result = PlayerProfileSchema.safeParse({ ...base, clans: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans).toEqual([]);
    }
  });

  it.each(["owner", "admin", "Leader", ""])(
    "rejects the unknown role %j",
    (role) => {
      expect(
        PlayerProfileSchema.safeParse({ ...base, clans: [{ ...clan, role }] })
          .success,
      ).toBe(false);
    },
  );

  it.each([0, -1, 1.5, "12", null])(
    "rejects the invalid memberCount %j",
    (memberCount) => {
      expect(
        PlayerProfileSchema.safeParse({
          ...base,
          clans: [{ ...clan, memberCount }],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects a clan tag outside the clan-tag charset/length", () => {
    // ClanTagSchema: 2-5 uppercase alphanumerics.
    for (const tag of ["a", "toolongtag", "a b", ""]) {
      expect(
        PlayerProfileSchema.safeParse({ ...base, clans: [{ ...clan, tag }] })
          .success,
      ).toBe(false);
    }
  });

  it("rejects a non-ISO joinedAt", () => {
    expect(
      PlayerProfileSchema.safeParse({
        ...base,
        clans: [{ ...clan, joinedAt: "last tuesday" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a clan entry missing required fields", () => {
    expect(
      PlayerProfileSchema.safeParse({ ...base, clans: [{ tag: "ALP" }] })
        .success,
    ).toBe(false);
  });

  it("keeps clan balances as strings rather than coercing to numbers", () => {
    const result = PlayerProfileSchema.safeParse({
      ...base,
      clans: [{ ...clan, softBalance: "1000", hardBalance: "0" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans?.[0].softBalance).toBe("1000");
      expect(result.data.clans?.[0].hardBalance).toBe("0");
    }
  });

  it("preserves a balance beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const huge = "9007199254740993";
    const result = PlayerProfileSchema.safeParse({
      ...base,
      clans: [{ ...clan, softBalance: huge, hardBalance: huge }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans?.[0].softBalance).toBe(huge);
    }
  });

  it("accepts a clan entry without balances (older API)", () => {
    const result = PlayerProfileSchema.safeParse({ ...base, clans: [clan] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clans?.[0].softBalance).toBeUndefined();
      expect(result.data.clans?.[0].hardBalance).toBeUndefined();
    }
  });

  it("rejects numeric balances", () => {
    expect(
      PlayerProfileSchema.safeParse({
        ...base,
        clans: [{ ...clan, softBalance: 1000 }],
      }).success,
    ).toBe(false);
  });
});

describe("UserMeResponseSchema clan balances", () => {
  const clans = UserMeResponseSchema.shape.player.shape.clans;
  const clan = {
    tag: "ALP",
    name: "Alpha Clan",
    role: "leader",
    joinedAt: "2024-02-01T12:00:00.000Z",
    memberCount: 12,
  };

  it("keeps balances as strings on the caller's own clans", () => {
    const r = clans.safeParse([
      { ...clan, softBalance: "150", hardBalance: "25" },
    ]);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data?.[0].softBalance).toBe("150");
      expect(r.data?.[0].hardBalance).toBe("25");
    }
  });

  it("accepts clans without balances (older API)", () => {
    const r = clans.safeParse([clan]);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data?.[0].softBalance).toBeUndefined();
    }
  });

  it("rejects numeric balances", () => {
    expect(clans.safeParse([{ ...clan, hardBalance: 25 }]).success).toBe(false);
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

describe("PlayerLeaderboardEntrySchema accountUsername", () => {
  it("rejects a mapped entry without accountUsername", () => {
    expect(
      PlayerLeaderboardEntrySchema.safeParse({
        rank: 1,
        playerId: "abc123",
        elo: 1500,
        games: 15,
        wins: 10,
        losses: 5,
        winRate: 2 / 3,
      }).success,
    ).toBe(false);
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
  };

  it("keeps accountUsername verbatim", () => {
    const result = RankedLeaderboardEntrySchema.safeParse({
      ...base,
      accountUsername: "bob.4821",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accountUsername).toBe("bob.4821");
    }
  });

  it("accepts the current API contract with accountUsername: null", () => {
    const result = RankedLeaderboardEntrySchema.safeParse({
      ...base,
      accountUsername: null,
    });
    expect(result.success).toBe(true);
  });

  it("drops legacy ranked identity fields", () => {
    const result = RankedLeaderboardEntrySchema.safeParse({
      ...base,
      accountUsername: "bob.4821",
      user: {
        id: "discord-id",
        avatar: null,
        username: "discord-user",
        global_name: null,
        discriminator: "0",
      },
      username: "session-name",
      clanTag: "ABC",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("user");
      expect(result.data).not.toHaveProperty("username");
      expect(result.data).not.toHaveProperty("clanTag");
    }
  });

  it("rejects an entry without accountUsername", () => {
    expect(RankedLeaderboardEntrySchema.safeParse(base).success).toBe(false);
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

describe("TribeNameSchema boost fields", () => {
  const base = {
    id: "7",
    displayName: "Iron Legion",
    status: "live",
    reviewReason: null,
  };

  it("parses a boosted name", () => {
    const result = TribeNameSchema.safeParse({
      ...base,
      activeBoosts: 2,
      boostExpiresAt: "2026-08-23T18:04:11.000Z",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.activeBoosts).toBe(2);
    expect(result.data.boostExpiresAt).toBe("2026-08-23T18:04:11.000Z");
  });

  it("parses an unboosted name (count 0, null expiry)", () => {
    const result = TribeNameSchema.safeParse({
      ...base,
      activeBoosts: 0,
      boostExpiresAt: null,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.activeBoosts).toBe(0);
    expect(result.data.boostExpiresAt).toBeNull();
  });

  it("parses a response without boost fields (older API)", () => {
    const result = TribeNameSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.activeBoosts).toBeUndefined();
    expect(result.data.boostExpiresAt).toBeUndefined();
  });

  // Regression: the list endpoint's boostExpiresAt comes from a raw SQL
  // max() that bypasses the ORM's Date mapping, so the wire carried pg text
  // ("2026-08-23 18:04:11+00"); a strict z.iso.datetime() failed the whole
  // list parse. The field is a plain string and the renderer guards it.
  it("tolerates a non-ISO boost expiry (raw pg text)", () => {
    const result = TribeNameSchema.safeParse({
      ...base,
      activeBoosts: 1,
      boostExpiresAt: "2026-08-23 18:04:11+00",
    });
    expect(result.success).toBe(true);
  });
});

describe("TribeLeaderboardResponseSchema", () => {
  const entry = {
    rank: 1,
    name: "Dragon Riders",
    gamesAppeared: 140,
    playerReach: 12400,
    ownerPublicId: "aB3xK9zQ",
    ownerUsername: "wolfpack.4821",
    activeBoosts: 0,
  };
  const base = {
    windowDays: 30,
    start: "2026-06-27",
    end: "2026-07-27",
    tribes: [entry],
  };

  it("parses a board page", () => {
    const result = TribeLeaderboardResponseSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tribes[0].playerReach).toBe(12400);
    expect(result.data.windowDays).toBe(30);
    expect(result.data.tribes[0].ownerUsername).toBe("wolfpack.4821");
  });

  // The buyer has never set an account username; the row falls back to the
  // public id (<player-name> does that, so null must survive the parse).
  it("parses an entry whose owner has no username", () => {
    const result = TribeLeaderboardResponseSchema.safeParse({
      ...base,
      tribes: [{ ...entry, ownerUsername: null }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tribes[0].ownerUsername).toBeNull();
    expect(result.data.tribes[0].ownerPublicId).toBe("aB3xK9zQ");
  });

  // A missing activeBoosts fails via coercion (undefined → NaN), so its
  // ZodError reads "received NaN" rather than "required" — still a rejection.
  it.each(["ownerPublicId", "ownerUsername", "activeBoosts"])(
    "rejects an entry missing %s",
    (field) => {
      const tribe: Record<string, unknown> = { ...entry };
      delete tribe[field];
      expect(
        TribeLeaderboardResponseSchema.safeParse({ ...base, tribes: [tribe] })
          .success,
      ).toBe(false);
    },
  );

  it("parses an entry with an active boost count", () => {
    const result = TribeLeaderboardResponseSchema.safeParse({
      ...base,
      tribes: [{ ...entry, activeBoosts: 2 }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tribes[0].activeBoosts).toBe(2);
  });

  // Same coercion tolerance as TribeNameSchema.activeBoosts: a count that
  // arrives as a stringified number must not fail the whole board parse.
  it("coerces a stringified boost count", () => {
    const result = TribeLeaderboardResponseSchema.safeParse({
      ...base,
      tribes: [{ ...entry, activeBoosts: "3" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tribes[0].activeBoosts).toBe(3);
  });

  it("parses an empty board", () => {
    expect(
      TribeLeaderboardResponseSchema.safeParse({ ...base, tribes: [] }).success,
    ).toBe(true);
  });

  // The window bounds are display-only. They are plain strings so a wobble in
  // the wire format (see boostExpiresAt) cannot fail the whole board parse the
  // way a strict z.iso.date() would; the renderer drops what it can't read.
  it("tolerates window bounds that are not YYYY-MM-DD", () => {
    const result = TribeLeaderboardResponseSchema.safeParse({
      ...base,
      start: "2026-06-27T00:00:00.000Z",
      end: "2026-07-27 18:04:11+00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a page missing the tribes array", () => {
    expect(
      TribeLeaderboardResponseSchema.safeParse({
        windowDays: base.windowDays,
        start: base.start,
        end: base.end,
      }).success,
    ).toBe(false);
  });

  it("rejects an entry with a non-numeric reach", () => {
    const result = TribeLeaderboardResponseSchema.safeParse({
      ...base,
      tribes: [{ ...entry, playerReach: "12400" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("TribeStatsResponseSchema", () => {
  const base = {
    name: "Cool Tribe",
    ownerPublicId: "aB3xK9zQ",
    ownerUsername: "Ada.4821",
    activeBoosts: 2,
    lifetime: { gamesAppeared: 107, playerReach: 10699 },
    window: {
      days: 30,
      start: "2026-07-02",
      end: "2026-08-01",
      gamesAppeared: 7,
      playerReach: 700,
    },
  };

  it("parses a full response", () => {
    const result = TribeStatsResponseSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe("Cool Tribe");
    expect(result.data.activeBoosts).toBe(2);
    expect(result.data.lifetime.playerReach).toBe(10699);
    expect(result.data.window.gamesAppeared).toBe(7);
  });

  // The buyer has never set an account username; the dialog falls back to
  // the public id (<player-name> does that, so null must survive the parse).
  it("parses a response whose owner has no username", () => {
    const result = TribeStatsResponseSchema.safeParse({
      ...base,
      ownerUsername: null,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ownerUsername).toBeNull();
  });

  // A name that exists but hasn't appeared in any games yet is a 200 with
  // zeroed figures, not a 404.
  it("parses a zeroed response for a name with no appearances", () => {
    const result = TribeStatsResponseSchema.safeParse({
      ...base,
      activeBoosts: 0,
      lifetime: { gamesAppeared: 0, playerReach: 0 },
      window: { ...base.window, gamesAppeared: 0, playerReach: 0 },
    });
    expect(result.success).toBe(true);
  });

  // Same coercion tolerance as TribeNameSchema.activeBoosts: a count that
  // arrives as a stringified number must not fail the parse.
  it("coerces a stringified boost count", () => {
    const result = TribeStatsResponseSchema.safeParse({
      ...base,
      activeBoosts: "3",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.activeBoosts).toBe(3);
  });

  // The window bounds are display-only plain strings (see the leaderboard's
  // start/end); the dialog drops the date span it can't read rather than
  // failing the whole parse.
  it("tolerates window bounds that are not YYYY-MM-DD", () => {
    const result = TribeStatsResponseSchema.safeParse({
      ...base,
      window: {
        ...base.window,
        start: "2026-07-02T00:00:00.000Z",
        end: "2026-08-01 18:04:11+00",
      },
    });
    expect(result.success).toBe(true);
  });

  it.each(["name", "ownerPublicId", "lifetime", "window"])(
    "rejects a response missing %s",
    (field) => {
      const body: Record<string, unknown> = { ...base };
      delete body[field];
      expect(TribeStatsResponseSchema.safeParse(body).success).toBe(false);
    },
  );

  it("rejects a non-numeric reach", () => {
    const result = TribeStatsResponseSchema.safeParse({
      ...base,
      lifetime: { gamesAppeared: 107, playerReach: "10699" },
    });
    expect(result.success).toBe(false);
  });
});

describe("GetMyTribeNamesResponseSchema", () => {
  it("parses the names-only response (pricing lives in cosmetics.json)", () => {
    expect(GetMyTribeNamesResponseSchema.safeParse({ names: [] }).success).toBe(
      true,
    );
  });

  it("strips a legacy priceHard instead of rejecting it", () => {
    const result = GetMyTribeNamesResponseSchema.safeParse({
      priceHard: "200",
      names: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect("priceHard" in result.data).toBe(false);
  });
});

describe("PostTribeBoostResponseSchema", () => {
  it("parses the documented 201 response", () => {
    const result = PostTribeBoostResponseSchema.safeParse({
      id: "42",
      customTribeNameId: "7",
      expiresAt: "2026-08-23T18:04:11.000Z",
      pricePaid: "100",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Bigints come as strings on the wire and must stay strings.
    expect(result.data.id).toBe("42");
    expect(result.data.pricePaid).toBe("100");
  });

  it("rejects a response without expiresAt", () => {
    expect(
      PostTribeBoostResponseSchema.safeParse({
        id: "42",
        customTribeNameId: "7",
        pricePaid: "100",
      }).success,
    ).toBe(false);
  });
});
