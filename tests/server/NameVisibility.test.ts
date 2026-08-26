import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMode } from "../../src/core/game/Game";
import { GameStartInfo } from "../../src/core/Schemas";
import { Client } from "../../src/server/Client";
import {
  friendsLookup,
  NameVisibility,
  NameVisibilityView,
} from "../../src/server/NameVisibility";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

// The per-viewer identity rules on their own, over a fixed roster. The lobby
// projection (lobbyClients) and the anonymizeNames matrix are exercised
// through GameServer.gameInfo in AnonymizeNames*.test.ts; this file covers
// what only the module boundary exposes cleanly: the start-message reveal
// rules with explicit real/wire inputs, and the friends lookup — plus one
// end-to-end check that the start message GameServer actually sends goes
// through those rules.

type Config = ReturnType<NameVisibilityView["config"]>;

function visibility(
  clients: Client[],
  config: Partial<Config> = {},
  teams: string[][] = [],
): NameVisibility {
  return new NameVisibility({
    gameID: "g1000000",
    config: () => ({
      gameMode: GameMode.FFA,
      anonymizeNames: false,
      ...config,
    }),
    clients: () => new Map(clients.map((c) => [c.clientID, c])),
    teamIndex: (c) => {
      const i = teams.findIndex(
        (t) => c.publicId !== undefined && t.includes(c.publicId),
      );
      return i === -1 ? undefined : i;
    },
  });
}

const player = (info: GameStartInfo, id: string) =>
  info.players.find((p) => p.clientID === id)!;

describe("startInfoFor: admin clan-tag reveal in FFA", () => {
  // Admins see real clan tags in FFA so they can spot teaming live. The reveal
  // is gated on FFA — that mode never runs assignTeams, so clanTag never feeds
  // the simulation. A Team game with tags disabled DOES assign teams by
  // clanTag, so a per-viewer reveal there would desync; those cases must stay
  // stripped.
  const roster = () => [
    makeClient({
      clientID: "creator",
      username: "CreatorReal",
      clanTag: "HOST",
    }),
    makeClient({ clientID: "alice", username: "AliceReal", clanTag: "AAA" }),
    makeClient({ clientID: "charlie", username: "CharlieReal", clanTag: null }),
  ];
  const players = [
    { clientID: "creator", username: "CreatorReal", clanTag: "HOST" },
    { clientID: "alice", username: "AliceReal", clanTag: "AAA" },
    { clientID: "charlie", username: "CharlieReal", clanTag: null },
  ];
  // What start() leaves behind: the real start info keeps clan tags; the wire
  // copy clients receive has them stripped (disableClanTags).
  const real = {
    gameID: "g1000000",
    lobbyCreatedAt: 0,
    config: {},
    players,
  } as unknown as GameStartInfo;
  const wire = {
    ...real,
    players: players.map((p) => ({ ...p, clanTag: null })),
  } as unknown as GameStartInfo;
  const setup = (gameMode: GameMode, anonymizeNames = false) =>
    visibility(roster(), { gameMode, disableClanTags: true, anonymizeNames });

  it("FFA + admin: sees real clan tags", () => {
    const info = setup(GameMode.FFA).startInfoFor("admin", true, real, wire);
    expect(player(info, "creator").clanTag).toBe("HOST");
    expect(player(info, "alice").clanTag).toBe("AAA");
    expect(player(info, "charlie").clanTag).toBeNull(); // never had one
  });

  it("FFA + non-admin: clan tags stay stripped", () => {
    const info = setup(GameMode.FFA).startInfoFor("alice", false, real, wire);
    expect(player(info, "creator").clanTag).toBeNull();
    expect(player(info, "alice").clanTag).toBeNull();
  });

  it("Team + tags disabled + admin: NOT revealed (desync guard)", () => {
    // Team mode assigns teams by clanTag, so revealing it to only the admin
    // would diverge that client's team assignment — must stay stripped.
    const info = setup(GameMode.Team).startInfoFor("admin", true, real, wire);
    expect(player(info, "creator").clanTag).toBeNull();
    expect(player(info, "alice").clanTag).toBeNull();
  });

  it("never mutates the real start info (the archived record stays real)", () => {
    setup(GameMode.FFA).startInfoFor("admin", true, real, wire);
    expect(real.players[0].clanTag).toBe("HOST");
    // The shared wire copy stays stripped for non-admins.
    expect(wire.players[0].clanTag).toBeNull();
  });

  it("anonymized FFA + admin: reveals clan tags but still anonymizes others", () => {
    const info = setup(GameMode.FFA, true).startInfoFor(
      "admin",
      true,
      real,
      wire,
    );
    // Real tags are revealed...
    expect(player(info, "alice").clanTag).toBe("AAA");
    // ...but other players' usernames are still anonymized.
    expect(player(info, "alice").username).not.toBe("AliceReal");
  });
});

describe("anonName", () => {
  const roster = () => [
    makeClient({ clientID: "alice", publicId: "alice-pub" }),
    makeClient({ clientID: "bob", publicId: "bob-pub" }),
    makeClient({ clientID: "carol", publicId: "carol-pub" }),
  ];

  it("is stable per (viewer, target) and never collides within one view", () => {
    const names = visibility(roster(), { anonymizeNames: true });
    const seen = ["alice", "bob", "carol"].map((id) => names.anonName("x", id));
    expect(new Set(seen).size).toBe(3);
    expect(
      ["alice", "bob", "carol"].map((id) => names.anonName("x", id)),
    ).toEqual(seen);
  });

  it("differs between viewers, but not between pinned teammates", () => {
    const teams = [["alice-pub", "bob-pub"], ["carol-pub"]];
    const names = visibility(roster(), { anonymizeNames: true }, teams);
    // alice and bob share a rotation, so they can call the same target.
    expect(names.anonName("alice", "carol")).toBe(
      names.anonName("bob", "carol"),
    );
    // Someone outside the team keeps their own.
    expect(names.anonName("carol", "alice")).not.toBe(
      names.anonName("alice", "alice"),
    );
  });
});

describe("friendsLookup", () => {
  it("maps publicId friends to the clientIDs present, dropping the rest", () => {
    const alice = makeClient({
      clientID: "alice",
      publicId: "alice-pub",
      friends: ["bob-pub", "nobody-pub"],
    });
    const bob = makeClient({ clientID: "bob", publicId: "bob-pub" });
    expect(friendsLookup([alice, bob])(alice)).toEqual(["bob"]);
    expect(friendsLookup([alice, bob])(bob)).toBeUndefined();
  });

  it("never resolves a spectator, who is not in the simulation", () => {
    const alice = makeClient({
      clientID: "alice",
      publicId: "alice-pub",
      friends: ["cast-pub"],
    });
    const cast = makeClient({
      clientID: "cast",
      publicId: "cast-pub",
      spectator: true,
    });
    expect(friendsLookup([alice, cast])(alice)).toBeUndefined();
  });
});

describe("admin clan-tag reveal through the start message GameServer sends", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const HOST = cid("host");
  const ADMIN = cid("admin");
  const OTHER = cid("other");

  function startedGame(gameMode: GameMode) {
    const game = makeGame({
      config: { gameMode, disableClanTags: true, playerTeams: 2 },
    });
    const host = makeClient({
      clientID: HOST,
      username: "HostName",
      clanTag: "HST",
    });
    const admin = makeClient({
      clientID: ADMIN,
      username: "AdminName",
      clanTag: "ADM",
      role: "admin",
    });
    const other = makeClient({
      clientID: OTHER,
      username: "OtherName",
      clanTag: "OTH",
    });
    for (const c of [host, admin, other]) game.joinClient(c);
    startGame(game);
    // The clan tags in the start frame this client received, by player.
    const clanTagsSeenBy = (c: Client) => {
      const start = mockWsOf(c)
        .sent()
        .find((m) => m.type === "start");
      if (start?.type !== "start") throw new Error("no start frame");
      return Object.fromEntries(
        start.gameStartInfo.players.map((p) => [p.clientID, p.clanTag]),
      );
    };
    return { clanTagsSeenBy, admin, other };
  }

  it("FFA: the admin's frame carries real tags, everyone else's are stripped", () => {
    const { clanTagsSeenBy, admin, other } = startedGame(GameMode.FFA);
    expect(clanTagsSeenBy(admin)).toEqual({
      [HOST]: "HST",
      [ADMIN]: "ADM",
      [OTHER]: "OTH",
    });
    expect(clanTagsSeenBy(other)).toEqual({
      [HOST]: null,
      [ADMIN]: null,
      [OTHER]: null,
    });
  });

  it("Team mode: stripped for the admin too, since the tags feed team assignment", () => {
    const { clanTagsSeenBy, admin } = startedGame(GameMode.Team);
    expect(clanTagsSeenBy(admin)).toEqual({
      [HOST]: null,
      [ADMIN]: null,
      [OTHER]: null,
    });
  });
});
