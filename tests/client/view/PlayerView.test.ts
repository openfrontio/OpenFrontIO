/**
 * PlayerView is a thin accessor wrapping a PlayerUpdate record plus precomputed
 * colors. Tests verify each accessor forwards the underlying data, that the
 * color variants (neutral/friendly/embargo) are precomputed at construction,
 * and that relation predicates (allied / same-team / friendly / embargo) match
 * what the FrameBuilder relies on when populating PlayerState.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { PlayerView } from "../../../src/client/view/PlayerView";
import {
  AllPlayers,
  EmojiMessage,
  PlayerType,
} from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { UserSettings } from "../../../src/core/game/UserSettings";
import {
  makeEmptyGu,
  makeGameView,
  makeNameViewData,
  makePlayerUpdate,
  makePlayerView,
} from "../../util/viewStubs";

describe("PlayerView accessors", () => {
  it("forwards data fields", () => {
    const p = makePlayerView({
      data: {
        id: "player-a",
        smallID: 7,
        clientID: "client-a",
        name: "Alice",
        displayName: "Alice",
        playerType: PlayerType.Human,
        isAlive: true,
        isDisconnected: false,
        isLobbyCreator: true,
        tilesOwned: 42,
        gold: 999n,
        troops: 250,
      },
    });

    expect(p.id()).toBe("player-a");
    expect(p.smallID()).toBe(7);
    expect(p.clientID()).toBe("client-a");
    expect(p.name()).toBe("Alice");
    expect(p.displayName()).toBe("Alice");
    expect(p.type()).toBe(PlayerType.Human);
    expect(p.isAlive()).toBe(true);
    expect(p.isDisconnected()).toBe(false);
    expect(p.isLobbyCreator()).toBe(true);
    expect(p.numTilesOwned()).toBe(42);
    expect(p.gold()).toBe(999n);
    expect(p.troops()).toBe(250);
  });

  it("isPlayer() is always true", () => {
    expect(makePlayerView().isPlayer()).toBe(true);
  });

  it("team() returns null when team is undefined on data", () => {
    expect(makePlayerView({ data: { team: undefined } }).team()).toBeNull();
  });

  it("team() forwards a set team", () => {
    expect(makePlayerView({ data: { team: "red" } }).team()).toBe("red");
  });

  it("isTraitor + getTraitorRemainingTicks forward, with min clamp at 0", () => {
    const traitor = makePlayerView({
      data: { isTraitor: true, traitorRemainingTicks: 5 },
    });
    expect(traitor.isTraitor()).toBe(true);
    expect(traitor.getTraitorRemainingTicks()).toBe(5);

    // Negative or missing → clamped to 0
    const expired = makePlayerView({
      data: { isTraitor: false, traitorRemainingTicks: -3 },
    });
    expect(expired.getTraitorRemainingTicks()).toBe(0);

    const missing = makePlayerView({ data: { isTraitor: false } });
    expect(missing.getTraitorRemainingTicks()).toBe(0);
  });

  it("nameLocation() returns nameData passed at construction", () => {
    const nameData = makeNameViewData({ x: 12, y: 34, size: 20 });
    expect(makePlayerView({ nameData }).nameLocation()).toBe(nameData);
  });

  it("outgoingEmojis / outgoingAttacks / incomingAttacks / alliances forward arrays", () => {
    const alliance = {
      id: 1,
      other: { id: "ally", smallID: 2 },
      createdAt: 0,
      expiresAt: 100,
      onlyOneAgreedToExtend: false,
    } as unknown as ReturnType<PlayerView["alliances"]>[number];
    const attack = {
      attackerID: 1,
      targetID: 0,
      troops: 50,
      id: "attack-a",
      retreating: false,
    } as unknown as ReturnType<PlayerView["outgoingAttacks"]>[number];
    const emoji = {
      message: 0,
      senderID: 1,
      recipientID: 2,
      createdAt: 0,
    } as unknown as ReturnType<PlayerView["outgoingEmojis"]>[number];

    const p = makePlayerView({
      data: {
        alliances: [alliance],
        outgoingAttacks: [attack],
        incomingAttacks: [],
        outgoingEmojis: [emoji],
      },
    });

    expect(p.alliances()).toEqual([alliance]);
    expect(p.outgoingAttacks()).toEqual([attack]);
    expect(p.incomingAttacks()).toEqual([]);
    expect(p.outgoingEmojis()).toEqual([emoji]);
  });
});

describe("PlayerView colors", () => {
  it("territoryColor() with no tile returns a Colord", () => {
    const c = makePlayerView().territoryColor();
    expect(typeof c.toHex()).toBe("string");
  });

  it("structureColors() returns precomputed light/dark", () => {
    const colors = makePlayerView().structureColors();
    expect(colors).toHaveProperty("light");
    expect(colors).toHaveProperty("dark");
  });

  it("borderColor() with no tile returns the base border color", () => {
    const p = makePlayerView();
    const noTile = p.borderColor();
    // Same value should come back for repeat calls (cached).
    expect(p.borderColor().toHex()).toBe(noTile.toHex());
  });
});

describe("PlayerView relations", () => {
  function pair(
    aSmall: number,
    bSmall: number,
    opts: {
      aAllies?: number[];
      aTeam?: string;
      bTeam?: string;
      // Embargoes are renderer-format: stringified smallIDs of the OTHER player.
      aEmbargoSmallIDs?: number[];
      bEmbargoSmallIDs?: number[];
      aOutgoingReq?: string[];
    } = {},
  ) {
    const a = makePlayerView({
      data: {
        id: "a",
        smallID: aSmall,
        allies: opts.aAllies ?? [],
        team: opts.aTeam,
        outgoingAllianceRequests: opts.aOutgoingReq ?? [],
      },
    });
    const b = makePlayerView({
      data: {
        id: "b",
        smallID: bSmall,
        team: opts.bTeam,
      },
    });
    if (opts.aEmbargoSmallIDs) a.setEmbargoSmallIDs(opts.aEmbargoSmallIDs);
    if (opts.bEmbargoSmallIDs) b.setEmbargoSmallIDs(opts.bEmbargoSmallIDs);
    return { a, b };
  }

  it("isAlliedWith() reflects ally smallIDs in data.allies", () => {
    const { a, b } = pair(1, 2, { aAllies: [2] });
    expect(a.isAlliedWith(b)).toBe(true);
    expect(b.isAlliedWith(a)).toBe(false); // b has no allies set
  });

  it("isOnSameTeam() compares data.team and treats undefined as no team", () => {
    const same = pair(1, 2, { aTeam: "red", bTeam: "red" });
    const diff = pair(1, 2, { aTeam: "red", bTeam: "blue" });
    const noTeam = pair(1, 2);
    expect(same.a.isOnSameTeam(same.b)).toBe(true);
    expect(diff.a.isOnSameTeam(diff.b)).toBe(false);
    // Two players with no team set should NOT count as same team.
    expect(noTeam.a.isOnSameTeam(noTeam.b)).toBe(false);
  });

  it("isFriendly() = allied OR same team", () => {
    const allied = pair(1, 2, { aAllies: [2] });
    expect(allied.a.isFriendly(allied.b)).toBe(true);

    const teammates = pair(1, 2, { aTeam: "red", bTeam: "red" });
    expect(teammates.a.isFriendly(teammates.b)).toBe(true);

    const strangers = pair(1, 2);
    expect(strangers.a.isFriendly(strangers.b)).toBe(false);
  });

  it("hasEmbargoAgainst / hasEmbargo are symmetric on the second", () => {
    // a embargoes b — by smallID (renderer format)
    const aEmbargoesB = pair(1, 2, { aEmbargoSmallIDs: [2] });
    // One-way directional embargo from a
    expect(aEmbargoesB.a.hasEmbargoAgainst(aEmbargoesB.b)).toBe(true);
    expect(aEmbargoesB.b.hasEmbargoAgainst(aEmbargoesB.a)).toBe(false);
    // Symmetric version is true from either side
    expect(aEmbargoesB.a.hasEmbargo(aEmbargoesB.b)).toBe(true);
    expect(aEmbargoesB.b.hasEmbargo(aEmbargoesB.a)).toBe(true);
  });

  it("isRequestingAllianceWith() reflects outgoingAllianceRequests", () => {
    const { a, b } = pair(1, 2, { aOutgoingReq: ["b"] });
    expect(a.isRequestingAllianceWith(b)).toBe(true);
    expect(b.isRequestingAllianceWith(a)).toBe(false);
  });
});

describe("PlayerView in a GameView context", () => {
  it("allies() resolves smallIDs through the game's smallID → PlayerView map", () => {
    // Build a GameView and feed it two players so allies() can resolve.
    const game = makeGameView();
    const aliceUpdate = makePlayerUpdate({
      id: "alice",
      smallID: 1,
      clientID: "c-alice",
      name: "Alice",
      allies: [2],
    });
    const bobUpdate = makePlayerUpdate({
      id: "bob",
      smallID: 2,
      clientID: "c-bob",
      name: "Bob",
    });

    // Drive a tick through the GameView so it creates the PlayerViews and
    // registers smallID lookups — that's the path FrameBuilder & PlayerView use.
    const gu = makeEmptyGu(1);
    gu.updates[GameUpdateType.Player] = [aliceUpdate, bobUpdate];
    gu.playerNameViewData = {
      alice: makeNameViewData(),
      bob: makeNameViewData(),
    };
    game.update(gu);

    const alice = game.player("alice");
    const bob = game.player("bob");
    expect(alice.allies()).toEqual([bob]);
  });

  it("isMe() is true only for the player matching myClientID", () => {
    const game = makeGameView({ myClientID: "c-me" });
    const me = makePlayerUpdate({
      id: "me",
      smallID: 1,
      clientID: "c-me",
      name: "Me",
    });
    const other = makePlayerUpdate({
      id: "other",
      smallID: 2,
      clientID: "c-other",
      name: "Other",
    });

    const gu = makeEmptyGu(1);
    gu.updates[GameUpdateType.Player] = [me, other];
    gu.playerNameViewData = {
      me: makeNameViewData(),
      other: makeNameViewData(),
    };
    game.update(gu);

    expect(game.player("me").isMe()).toBe(true);
    expect(game.player("other").isMe()).toBe(false);
  });
});

describe("PlayerView emoji display setting (#4430)", () => {
  // Emoji data lives on the shared PlayerView.state.outgoingEmojis field, read
  // both by the WebGL name-pass (floating emoji over players) and the player
  // overlay. Disabling emojis must empty it at construction and every tick.
  function resetSettings() {
    localStorage.clear();
    // UserSettings keeps a static cache shared across instances; clear it so
    // reads see the freshly-set localStorage.
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  }

  function setEmojisEnabled(enabled: boolean) {
    localStorage.setItem("settings.emojis", String(enabled));
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
  }

  const broadcastEmoji: EmojiMessage = {
    message: "👍",
    senderID: 1,
    recipientID: AllPlayers,
    createdAt: 0,
  };

  beforeEach(resetSettings);

  it("keeps outgoing emojis in view state when the setting is on (default)", () => {
    const p = makePlayerView({ data: { outgoingEmojis: [broadcastEmoji] } });
    expect(p.state.outgoingEmojis).toHaveLength(1);
    expect(p.outgoingEmojis()).toHaveLength(1);
  });

  it("strips outgoing emojis at construction when the setting is off", () => {
    setEmojisEnabled(false);
    const p = makePlayerView({ data: { outgoingEmojis: [broadcastEmoji] } });
    expect(p.state.outgoingEmojis).toEqual([]);
    expect(p.outgoingEmojis()).toEqual([]);
  });

  it("strips emojis arriving via applyUpdate when the setting is off", () => {
    setEmojisEnabled(false);
    const p = makePlayerView();
    p.applyUpdate(makePlayerUpdate({ outgoingEmojis: [broadcastEmoji] }));
    expect(p.state.outgoingEmojis).toEqual([]);
  });
});
