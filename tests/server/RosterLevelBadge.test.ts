import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { UserMeResponseSchema } from "@openfront/shared/ApiSchemas";
import {
  LevelBadge,
  packLevelBadge,
  unpackLevelBadge,
} from "@openfront/shared/LevelBadgeWire";
import { GameInfo, ServerMessage } from "@openfront/shared/WireSchemas";
import {
  decodeServerMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  levelBadgeForPlayer,
  levelBadgeFromProgress,
} from "../../src/server/LevelBadge";
import { makeClient, makeGame } from "../util/GameServerHarness";

// The game server stamps each signed-in player's level onto the lobby roster
// from its own /users/@me lookup (Worker.ts join -> levelBadgeFromProgress ->
// Client.levelBadge -> NameVisibility.lobbyClients). Display-only.

const progress = {
  prestige: 2,
  level: 37,
  xpInLevel: 120,
  xpForNext: 900,
  lifetimeXp: 123456,
  legend: false,
  canPrestige: false,
};

function userMe(player: Record<string, unknown> = {}) {
  return UserMeResponseSchema.parse({
    user: { email: "player@example.com" },
    player: {
      publicId: "abc",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      ...player,
    },
  });
}

describe("levelBadgeFromProgress: stamping from /users/@me", () => {
  it("stamps level, prestige and legend from the response's progress", () => {
    expect(
      levelBadgeFromProgress(userMe({ progress }).player.progress),
    ).toEqual({ level: 37, prestige: 2, legend: false });
    expect(
      levelBadgeFromProgress(
        userMe({
          progress: { ...progress, level: 100, prestige: 10, legend: true },
        }).player.progress,
      ),
    ).toEqual({ level: 100, prestige: 10, legend: true });
  });

  it("stamps nothing when the response has no progress (progression off)", () => {
    expect(levelBadgeFromProgress(userMe().player.progress)).toBeUndefined();
  });

  it("stamps nothing for a malformed progress object", () => {
    // UserMeResponseSchema reads it as absent rather than failing the join.
    const me = userMe({ progress: { level: "ten" } });
    expect(levelBadgeFromProgress(me.player.progress)).toBeUndefined();
  });

  it("stamps nothing for values the wire cannot carry", () => {
    // The roster packs a badge into one integer (level 1..100, prestige
    // 0..10); anything outside that is dropped rather than sent wrong.
    for (const bad of [
      { level: 0 },
      { level: -1 },
      { level: 12.5 },
      { level: Number.NaN },
      { prestige: -1 },
      { prestige: 1.5 },
      { level: Number.MAX_SAFE_INTEGER + 2 },
      { level: 101 },
      { level: 128 },
      { prestige: 11 },
      { prestige: 16 },
    ]) {
      expect(levelBadgeFromProgress({ ...progress, ...bad })).toBeUndefined();
    }
  });

  it("stamps the edge values", () => {
    for (const edge of [
      { level: 1, prestige: 0, legend: false },
      { level: 100, prestige: 10, legend: true },
    ]) {
      expect(levelBadgeFromProgress({ ...progress, ...edge })).toEqual(edge);
    }
  });

  it("stamps nothing for a guest (no lookup at all)", () => {
    expect(levelBadgeFromProgress(undefined)).toBeUndefined();
  });
});

describe("levelBadgeForPlayer: hide my level", () => {
  it("parses /users/@me with and without levelHidden", () => {
    expect(userMe({ progress }).player.levelHidden).toBeUndefined();
    expect(userMe({ progress, levelHidden: true }).player.levelHidden).toBe(
      true,
    );
    expect(userMe({ progress, levelHidden: false }).player.levelHidden).toBe(
      false,
    );
  });

  it("reads a malformed levelHidden as hidden instead of failing the parse", () => {
    for (const bad of [null, "yes", "true", 1, 0, {}]) {
      const me = userMe({ progress, levelHidden: bad });
      expect(me.player.levelHidden).toBe(true);
      expect(me.player.progress).toBeDefined();
      // Fails closed: no badge for a setting that can't be read.
      expect(levelBadgeForPlayer(me.player)).toBeUndefined();
    }
  });

  it("stamps nothing when the player hides their level", () => {
    const me = userMe({ progress, levelHidden: true });
    expect(levelBadgeForPlayer(me.player)).toBeUndefined();
  });

  it("stamps the badge when the level is shown", () => {
    const me = userMe({ progress, levelHidden: false });
    expect(levelBadgeForPlayer(me.player)).toEqual({
      level: 37,
      prestige: 2,
      legend: false,
    });
  });

  it("stamps the badge when an older API omits the setting", () => {
    expect(levelBadgeForPlayer(userMe({ progress }).player)).toEqual({
      level: 37,
      prestige: 2,
      legend: false,
    });
  });

  it("still stamps nothing without progress, hidden or not", () => {
    expect(levelBadgeForPlayer(userMe().player)).toBeUndefined();
    expect(
      levelBadgeForPlayer(userMe({ levelHidden: false }).player),
    ).toBeUndefined();
  });

  it("a hidden player's entry carries no badge on the wire, for anyone", () => {
    const game = makeGame({ config: { gameType: GameType.Private } });
    game.joinClient(
      makeClient({
        clientID: "hide0001",
        username: "Hider",
        publicId: "hide-pub",
        levelBadge: levelBadgeForPlayer(
          userMe({ progress, levelHidden: true }).player,
        ),
      }),
    );
    game.joinClient(
      makeClient({ clientID: "peer0001", username: "Peer", publicId: "p-pub" }),
    );
    for (const viewer of ["hide0001", "peer0001"]) {
      const msg: ServerMessage = {
        type: "lobby_info",
        lobby: game.gameInfo(viewer),
        myClientID: viewer,
      };
      const back = decodeServerMessage(
        encodeServerMessage(msg, undefined),
        undefined,
      );
      if (back.type !== "lobby_info") throw new Error("wrong type");
      expect(byId(back.lobby, "hide0001")).not.toHaveProperty("levelBadge");
    }
  });
});

const VET: LevelBadge = { level: 100, prestige: 10, legend: true };
const MID: LevelBadge = { level: 37, prestige: 2, legend: false };
const byId = (info: GameInfo, id: string) =>
  info.clients!.find((c) => c.clientID === id)!;
// The entry's badge, unpacked from its wire form.
const badgeOf = (info: GameInfo, id: string) =>
  unpackLevelBadge(byId(info, id).levelBadge);

describe("lobby roster carries the server-stamped badge", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function lobby(
    config: Partial<GameConfig> = {},
    matchmakingTeams?: string[][],
  ) {
    const game = makeGame({
      config: { gameType: GameType.Private, ...config },
      matchmakingTeams,
    });
    game.joinClient(
      makeClient({
        clientID: "vet00001",
        username: "Veteran",
        publicId: "vet-pub",
        levelBadge: VET,
      }),
    );
    game.joinClient(
      makeClient({
        clientID: "mid00001",
        username: "Middling",
        publicId: "mid-pub",
        levelBadge: MID,
      }),
    );
    game.joinClient(
      makeClient({
        clientID: "guest001",
        username: "Guest",
        publicId: "g-pub",
      }),
    );
    return game;
  }

  it("names on: every signed-in player's badge, none for the guest", () => {
    const info = lobby().gameInfo("guest001");
    // On the roster as the packed integer, decoding to the stamped badge.
    expect(byId(info, "vet00001").levelBadge).toBe(packLevelBadge(VET));
    expect(badgeOf(info, "vet00001")).toEqual(VET);
    expect(badgeOf(info, "mid00001")).toEqual(MID);
    expect(byId(info, "guest001").levelBadge).toBeUndefined();
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
    expect(badgeOf(back.lobby, "vet00001")).toEqual(VET);
    expect(byId(back.lobby, "guest001").levelBadge).toBeUndefined();
  });

  it("anonymizeNames: anonymized entries carry no badge", () => {
    const info = lobby({ anonymizeNames: true }).gameInfo("guest001");
    for (const id of ["vet00001", "mid00001"]) {
      const entry = byId(info, id);
      expect(["Veteran", "Middling"]).not.toContain(entry.username);
      expect(entry.levelBadge).toBeUndefined();
      expect(entry).not.toHaveProperty("levelBadge");
    }
  });

  it("anonymizeNames: a player still sees their own badge", () => {
    const info = lobby({ anonymizeNames: true }).gameInfo("vet00001");
    expect(badgeOf(info, "vet00001")).toEqual(VET);
    expect(byId(info, "mid00001").levelBadge).toBeUndefined();
  });

  it("anonymizeNames: a viewer granted real names sees the badges too", () => {
    const info = lobby({
      anonymizeNames: true,
      nameReveals: ["guest001"],
    }).gameInfo("guest001");
    expect(badgeOf(info, "vet00001")).toEqual(VET);
    expect(badgeOf(info, "mid00001")).toEqual(MID);
  });

  it("anonymizeNames: a pinned teammate's badge shows with their real name", () => {
    const info = lobby({ anonymizeNames: true }, [
      ["vet-pub", "mid-pub"],
      ["g-pub"],
    ]).gameInfo("mid00001");
    expect(byId(info, "vet00001").username).toBe("Veteran");
    expect(badgeOf(info, "vet00001")).toEqual(VET);
  });

  it("anonymizeNames: the public HTTP view (no viewer) shows no badges", () => {
    const info = lobby({ anonymizeNames: true }).gameInfo();
    for (const c of info.clients!) expect(c.levelBadge).toBeUndefined();
  });
});

describe("Client packs its badge once, at construction", () => {
  it("holds the wire form beside the readable one", () => {
    const c = makeClient({ clientID: "vet00001", levelBadge: VET });
    expect(c.levelBadge).toEqual(VET);
    expect(c.wireLevelBadge).toBe(packLevelBadge(VET));
  });

  it("has no wire badge for a guest or a badge it cannot pack", () => {
    expect(makeClient({ clientID: "guest001" }).wireLevelBadge).toBeUndefined();
    const odd = makeClient({
      clientID: "odd00001",
      levelBadge: { level: 101, prestige: 0, legend: false },
    });
    expect(odd.wireLevelBadge).toBeUndefined();
  });
});
