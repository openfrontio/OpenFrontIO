import { UserMeResponseSchema } from "@openfront/shared/ApiSchemas";
import {
  CosmeticPackItemSchema,
  CosmeticsSchema,
  ownsPlayerCard,
} from "@openfront/shared/CosmeticSchemas";
import {
  PlayerCard,
  PlayerCardRefsSchema,
  PlayerCardSchema,
  TrackerStatSchema,
} from "@openfront/shared/PlayerCardSchemas";
import { WirePlayer, WirePlayerSchema } from "@openfront/shared/WireSchemas";
import { zb } from "@openfront/zbin";
import { describe, expect, it } from "vitest";

const CARD: PlayerCard = {
  background: "bg_pacific",
  title: "warmonger",
  taunt: "salute",
  trackers: [
    { stat: "wins", value: 1204 },
    { stat: "nukes_launched", value: 38912 },
    { stat: "best_elo", value: 1840 },
  ],
  publicId: "pub123",
};

const minimalCatalogue = { patterns: {}, flags: {} };

const base = { product: null, rarity: "epic" };

describe("PlayerCard wire schema", () => {
  it("WirePlayer with card round-trips through zbin", () => {
    const Wire = zb.object(WirePlayerSchema.shape);
    const player: WirePlayer = {
      clientID: "aB3dEf7h",
      username: "Volt",
      clanTag: "UN",
      card: CARD,
    };
    const decoded = Wire.parseBytes(Wire.serialize(player));
    expect(decoded.card).toEqual(CARD);
  });

  it("WirePlayer without a card decodes with no card", () => {
    const Wire = zb.object(WirePlayerSchema.shape);
    const player: WirePlayer = {
      clientID: "aB3dEf7h",
      username: "Volt",
      clanTag: null,
    };
    expect(Wire.parseBytes(Wire.serialize(player)).card).toBeUndefined();
  });

  it("card with 4 trackers fails", () => {
    const result = PlayerCardSchema.safeParse({
      ...CARD,
      trackers: [...CARD.trackers, { stat: "conquests", value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("tracker stats are the launch set", () => {
    expect(TrackerStatSchema.options).toEqual([
      "wins",
      "games_played",
      "nukes_launched",
      "conquests",
      "best_elo",
      "ffa_peak_rating",
    ]);
  });

  it("refs (the @me card) carry no publicId", () => {
    const parsed = PlayerCardRefsSchema.parse(CARD);
    expect("publicId" in parsed).toBe(false);
  });
});

describe("card cosmetics in the catalogue", () => {
  it("parses all five card keys", () => {
    const parsed = CosmeticsSchema.parse({
      ...minimalCatalogue,
      playerCards: {
        standard: {
          ...base,
          name: "standard",
          description: "The player card",
          priceHard: 500,
          priceSoft: 50000,
        },
      },
      cardTrackers: {
        nukes_launched: {
          ...base,
          name: "nukes_launched",
          stat: "nukes_launched",
        },
      },
      cardBackgrounds: {
        bg_pacific: {
          ...base,
          name: "bg_pacific",
          url: "/cosmetics/bg_pacific.webp",
          unlockSource: {
            kind: "seasonFree",
            label: "Season 1 · free tier 20",
          },
        },
      },
      cardTitles: {
        warmonger: { ...base, name: "warmonger", text: "Warmonger" },
      },
      taunts: {
        salute: {
          ...base,
          name: "salute",
          tauntKind: "icon",
          preset: "salute",
        },
      },
    });
    expect(parsed.playerCards?.standard.priceSoft).toBe(50000);
    expect(parsed.cardTrackers?.nukes_launched.stat).toBe("nukes_launched");
    expect(parsed.cardBackgrounds?.bg_pacific.unlockSource?.kind).toBe(
      "seasonFree",
    );
    expect(parsed.cardTitles?.warmonger.text).toBe("Warmonger");
    expect(parsed.taunts?.salute.tauntKind).toBe("icon");
  });

  it("one bad cardBackground entry drops alone", () => {
    const parsed = CosmeticsSchema.parse({
      ...minimalCatalogue,
      cardBackgrounds: {
        bg_pacific: { ...base, name: "bg_pacific", url: "/a.webp" },
        bg_bad: { ...base, name: "bg_bad" },
      },
    });
    expect(Object.keys(parsed.cardBackgrounds ?? {})).toEqual(["bg_pacific"]);
  });

  it("older catalogue without card keys parses", () => {
    const parsed = CosmeticsSchema.parse(minimalCatalogue);
    expect(parsed.cardBackgrounds).toBeUndefined();
  });

  it("oneofone rarity parses", () => {
    const parsed = CosmeticsSchema.parse({
      ...minimalCatalogue,
      cardTitles: {
        bespoke: {
          product: null,
          rarity: "oneofone",
          name: "bespoke",
          text: "X",
        },
      },
    });
    expect(parsed.cardTitles?.bespoke.rarity).toBe("oneofone");
  });

  it("packs can hold card items", () => {
    for (const type of [
      "playerCard",
      "cardTracker",
      "cardBackground",
      "cardTitle",
      "taunt",
    ]) {
      expect(
        CosmeticPackItemSchema.safeParse({ type, name: "standard" }).success,
      ).toBe(true);
    }
  });

  it("ownsPlayerCard reads the card flare only", () => {
    expect(ownsPlayerCard(["playerCard:standard"])).toBe(true);
    expect(ownsPlayerCard(["cardBackground:bg_pacific"])).toBe(false);
    expect(ownsPlayerCard([])).toBe(false);
  });
});

describe("@me card fields", () => {
  const userMe = (player: Record<string, unknown>) => ({
    user: {},
    player: {
      publicId: "p1",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      ...player,
    },
  });

  it("parses card and tauntsMuted", () => {
    const parsed = UserMeResponseSchema.parse(
      userMe({
        card: { title: "warmonger", trackers: [{ stat: "wins", value: 3 }] },
        tauntsMuted: true,
      }),
    );
    expect(parsed.player.card?.title).toBe("warmonger");
    expect(parsed.player.tauntsMuted).toBe(true);
  });

  // Fail closed: a malformed mute flag reads as muted, never as unmuted.
  it("a malformed tauntsMuted reads as muted", () => {
    const parsed = UserMeResponseSchema.parse(userMe({ tauntsMuted: "no" }));
    expect(parsed.player.tauntsMuted).toBe(true);
  });

  // The exact shape infra's GET /users/@me sends (lib/card/PlayerCardLoadout
  // cardForMe): empty slots are null, not absent.
  it("parses the API's card with null slots", () => {
    const parsed = UserMeResponseSchema.parse(
      userMe({
        card: {
          background: "bg_pacific",
          title: null,
          taunt: null,
          trackers: [{ stat: "wins", value: 312 }],
        },
      }),
    );
    expect(parsed.player.card).toEqual({
      background: "bg_pacific",
      trackers: [{ stat: "wins", value: 312 }],
    });
  });

  it("an owner's empty loadout parses", () => {
    const parsed = UserMeResponseSchema.parse(
      userMe({
        card: { background: null, title: null, taunt: null, trackers: [] },
      }),
    );
    expect(parsed.player.card).toEqual({ trackers: [] });
  });

  it("a tracker stat this client doesn't know is dropped alone", () => {
    const parsed = UserMeResponseSchema.parse(
      userMe({
        card: {
          background: null,
          title: "warmonger",
          taunt: null,
          trackers: [
            { stat: "future_stat", value: 9 },
            { stat: "wins", value: 3 },
          ],
        },
      }),
    );
    expect(parsed.player.card).toEqual({
      title: "warmonger",
      trackers: [{ stat: "wins", value: 3 }],
    });
  });

  it("no card (null) stays null", () => {
    const parsed = UserMeResponseSchema.parse(userMe({ card: null }));
    expect(parsed.player.card).toBeNull();
  });

  it("a malformed card reads as absent, not a failed parse", () => {
    const parsed = UserMeResponseSchema.parse(
      userMe({ card: { trackers: "nope" } }),
    );
    expect(parsed.player.card).toBeUndefined();
  });
});
