import { GameMode, GameType } from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { Cosmetics } from "@openfront/shared/CosmeticSchemas";
import { PlayerCard } from "@openfront/shared/PlayerCardSchemas";
import {
  GameInfo,
  ServerMessage,
  WireGameStartInfo,
} from "@openfront/shared/WireSchemas";
import {
  decodeServerMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import { describe, expect, it } from "vitest";
import { NameVisibility } from "../../src/server/NameVisibility";
import {
  FailOpenPrivilegeChecker,
  PrivilegeCheckerImpl,
} from "../../src/server/Privilege";
import { makeClient, makeGame } from "../util/GameServerHarness";

const item = { product: null, rarity: "epic" };
const cosmetics = {
  patterns: {},
  flags: {},
  playerCards: { standard: { ...item, name: "standard" } },
  cardTrackers: {
    wins: { ...item, name: "wins", stat: "wins" },
    best_elo: { ...item, name: "best_elo", stat: "best_elo" },
  },
  cardBackgrounds: {
    bg_pacific: { ...item, name: "bg_pacific", url: "/bg.webp" },
  },
  cardTitles: { warmonger: { ...item, name: "warmonger", text: "Warmonger" } },
  taunts: {
    salute: { ...item, name: "salute", tauntKind: "icon", preset: "salute" },
  },
} as unknown as Cosmetics;

const checker = new PrivilegeCheckerImpl(cosmetics, () => new Uint8Array());

const refs = {
  background: "bg_pacific",
  title: "warmonger",
  taunt: "salute",
  trackers: [
    { stat: "wins" as const, value: 1204 },
    { stat: "best_elo" as const, value: 1840 },
  ],
};

const ALL = [
  "playerCard:standard",
  "cardBackground:bg_pacific",
  "cardTitle:warmonger",
  "taunt:salute",
  "cardTracker:wins",
  "cardTracker:best_elo",
];

describe("resolveCard", () => {
  it("keeps a fully owned loadout and adds the publicId", () => {
    expect(checker.resolveCard(ALL, refs, "pub1")).toEqual({
      ...refs,
      publicId: "pub1",
    });
  });

  it("no card flare gives undefined even with a loadout", () => {
    const flares = ALL.filter((f) => !f.startsWith("playerCard:"));
    expect(checker.resolveCard(flares, refs, "pub1")).toBeUndefined();
  });

  it("drops an unowned tracker, keeps owned ones", () => {
    const flares = ALL.filter((f) => f !== "cardTracker:wins");
    expect(checker.resolveCard(flares, refs, "pub1")?.trackers).toEqual([
      { stat: "best_elo", value: 1840 },
    ]);
  });

  it("keeps owned background, drops unowned title", () => {
    const flares = ALL.filter((f) => f !== "cardTitle:warmonger");
    const card = checker.resolveCard(flares, refs, "pub1");
    expect(card?.background).toBe("bg_pacific");
    expect(card?.title).toBeUndefined();
  });

  it("unknown background name is dropped", () => {
    const card = checker.resolveCard(
      [...ALL, "cardBackground:bg_gone"],
      { ...refs, background: "bg_gone" },
      "pub1",
    );
    expect(card).toBeDefined();
    expect(card?.background).toBeUndefined();
  });

  it("no refs gives the empty card for an owner", () => {
    expect(checker.resolveCard(["playerCard:standard"], null, "pub1")).toEqual({
      trackers: [],
      publicId: "pub1",
    });
  });

  it("no refs and no card gives undefined", () => {
    expect(checker.resolveCard([], undefined, undefined)).toBeUndefined();
  });

  it("drops an owned tracker that is no longer in the catalogue", () => {
    const noTrackers = new PrivilegeCheckerImpl(
      { ...cosmetics, cardTrackers: {} } as unknown as Cosmetics,
      () => new Uint8Array(),
    );
    expect(noTrackers.resolveCard(ALL, refs, "pub1")?.trackers).toEqual([]);
    const winsGone = new PrivilegeCheckerImpl(
      {
        ...cosmetics,
        cardTrackers: { best_elo: cosmetics.cardTrackers!.best_elo },
      } as unknown as Cosmetics,
      () => new Uint8Array(),
    );
    expect(winsGone.resolveCard(ALL, refs, "pub1")?.trackers).toEqual([
      { stat: "best_elo", value: 1840 },
    ]);
  });

  it("drops a tracker whose catalogue entry isn't named by its stat", () => {
    const renamed = new PrivilegeCheckerImpl(
      {
        ...cosmetics,
        cardTrackers: {
          wins: { ...item, name: "wins", stat: "best_elo" },
          best_elo: cosmetics.cardTrackers!.best_elo,
        },
      } as unknown as Cosmetics,
      () => new Uint8Array(),
    );
    expect(renamed.resolveCard(ALL, refs, "pub1")?.trackers).toEqual([
      { stat: "best_elo", value: 1840 },
    ]);
  });

  it("fail-open checker still requires the card flare", () => {
    const open = new FailOpenPrivilegeChecker();
    expect(open.resolveCard([], refs, "pub1")).toBeUndefined();
    expect(open.resolveCard(["playerCard:standard"], refs, "pub1")).toEqual({
      trackers: [],
      publicId: "pub1",
    });
  });
});

describe("startInfoFor: the card follows name visibility", () => {
  const card: PlayerCard = { trackers: [], title: "warmonger", publicId: "p" };
  const clients = [
    makeClient({ clientID: "alice", publicId: "alice-pub" }),
    makeClient({ clientID: "bob", publicId: "bob-pub" }),
  ];
  const info = {
    gameID: "g1000000",
    lobbyCreatedAt: 0,
    config: {},
    players: [
      { clientID: "alice", username: "Alice", clanTag: null, card },
      { clientID: "bob", username: "Bob", clanTag: null, card },
    ],
  } as unknown as WireGameStartInfo;
  const names = (anonymizeNames: boolean, nameReveals?: string[]) =>
    new NameVisibility({
      gameID: "g1000000",
      config: () => ({ gameMode: GameMode.FFA, anonymizeNames, nameReveals }),
      clients: () => new Map(clients.map((c) => [c.clientID, c])),
      teamIndex: () => undefined,
    });
  const cardOf = (s: WireGameStartInfo, id: string) =>
    s.players.find((p) => p.clientID === id)!.card;

  it("anonymised viewer gets no card", () => {
    const view = names(true).startInfoFor("alice", false, info, info);
    expect(cardOf(view, "bob")).toBeUndefined();
    expect(cardOf(view, "alice")).toEqual(card);
  });

  it("names on: every card is sent", () => {
    const view = names(false).startInfoFor("alice", false, info, info);
    expect(cardOf(view, "bob")).toEqual(card);
  });

  it("nameReveals viewer keeps card", () => {
    const view = names(true, ["alice"]).startInfoFor(
      "alice",
      false,
      info,
      info,
    );
    expect(cardOf(view, "bob")).toEqual(card);
  });
});

// The lobby roster carries the equipped card background's cosmetic name
// (ClientInfo.cardBackground), read from the card resolved at join — the same
// /users/@me lookup as levelBadge (Worker.ts -> resolveCard -> Client.card ->
// NameVisibility.lobbyClients). Never from the join message.
describe("lobby roster: the card background", () => {
  const byId = (info: GameInfo, id: string) =>
    info.clients!.find((c) => c.clientID === id)!;

  function lobby(config: Partial<GameConfig> = {}, impl = checker) {
    const game = makeGame({
      config: { gameType: GameType.Private, ...config },
    });
    const join = (id: string, flares: string[], r = refs) =>
      game.joinClient(
        makeClient({
          clientID: id,
          username: `N_${id}`,
          publicId: `${id}-pub`,
          card: impl.resolveCard(flares, r, `${id}-pub`),
        }),
      );
    join("owner001", ALL);
    // Owns the background but not the card.
    join(
      "nocard01",
      ALL.filter((f) => !f.startsWith("playerCard:")),
    );
    // Owns the card but not the background.
    join(
      "nobg0001",
      ALL.filter((f) => f !== "cardBackground:bg_pacific"),
    );
    // Owns the card, nothing equipped.
    join("bare0001", ["playerCard:standard"], {
      ...refs,
      background: undefined,
    } as never);
    // A guest: no /users/@me lookup, so no card.
    game.joinClient(
      makeClient({ clientID: "guest001", username: "Guest", publicId: "g" }),
    );
    return game;
  }

  it("stamps only a card owner who owns the background", () => {
    const info = lobby().gameInfo("guest001");
    expect(byId(info, "owner001").cardBackground).toBe("bg_pacific");
    for (const id of ["nocard01", "nobg0001", "bare0001", "guest001"]) {
      expect(byId(info, id).cardBackground).toBeUndefined();
    }
  });

  it("catalogue unavailable at join (fail-open checker): no background", () => {
    const info = lobby({}, new FailOpenPrivilegeChecker() as never).gameInfo(
      "guest001",
    );
    expect(byId(info, "owner001").cardBackground).toBeUndefined();
  });

  it("never comes from the join message's cosmetics", () => {
    const game = makeGame({ config: { gameType: GameType.Private } });
    game.joinClient(
      makeClient({
        clientID: "liar0001",
        username: "Liar",
        publicId: "liar-pub",
        cosmetics: { cardBackground: "bg_pacific" } as never,
      }),
    );
    const info = game.gameInfo("liar0001");
    expect(byId(info, "liar0001").cardBackground).toBeUndefined();
  });

  it("anonymised entries never carry it; the player still sees their own", () => {
    const game = lobby({ anonymizeNames: true });
    const forGuest = game.gameInfo("guest001");
    expect(byId(forGuest, "owner001").username).not.toBe("N_owner001");
    expect(byId(forGuest, "owner001").cardBackground).toBeUndefined();
    const forOwner = game.gameInfo("owner001");
    expect(byId(forOwner, "owner001").cardBackground).toBe("bg_pacific");
    // The public HTTP view (no viewer) anonymises everyone.
    for (const c of game.gameInfo().clients!) {
      expect(c.cardBackground).toBeUndefined();
    }
  });

  it("a viewer granted real names sees it", () => {
    const info = lobby({
      anonymizeNames: true,
      nameReveals: ["guest001"],
    }).gameInfo("guest001");
    expect(byId(info, "owner001").cardBackground).toBe("bg_pacific");
  });

  it("survives the lobby_info encoding end to end", () => {
    const game = lobby();
    const msg: ServerMessage = {
      type: "lobby_info",
      lobby: game.gameInfo("guest001"),
      myClientID: "guest001",
    };
    const back = decodeServerMessage(
      encodeServerMessage(msg, undefined),
      undefined,
    );
    if (back.type !== "lobby_info") throw new Error("wrong type");
    expect(byId(back.lobby, "owner001").cardBackground).toBe("bg_pacific");
    expect(byId(back.lobby, "nobg0001")).not.toHaveProperty("cardBackground");
  });
});
