import { GameMode } from "@openfront/engine-api/game/GameTypes";
import { ServerStartGameMessage } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { partyLookup } from "../../src/server/PartyLookup";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

const PARTY_A = "AbCdEfGhJk";
const PARTY_B = "ZyXwVuTsRq";

describe("partyLookup", () => {
  test("numbers parties in join order and skips lone members", () => {
    const clients = [
      makeClient({ clientID: cid("c1") }),
      makeClient({ clientID: cid("c2") }),
      makeClient({ clientID: cid("c3") }),
      makeClient({ clientID: cid("c4") }),
      makeClient({ clientID: cid("c5") }),
      makeClient({ clientID: cid("c6") }),
    ];
    clients[0].partyID = PARTY_B;
    clients[1].partyID = PARTY_A;
    clients[2].partyID = PARTY_B;
    clients[3].partyID = PARTY_A;
    // Alone in this game: no number.
    clients[4].partyID = "LoneParty1";
    const partyFor = partyLookup(clients);
    expect(clients.map(partyFor)).toEqual([1, 2, 1, 2, undefined, undefined]);
  });

  test("ignores spectators", () => {
    const a = makeClient({ clientID: cid("c1") });
    const b = makeClient({ clientID: cid("c2") });
    a.partyID = PARTY_A;
    b.partyID = PARTY_A;
    b.spectator = true;
    const partyFor = partyLookup([a, b]);
    expect(partyFor(a)).toBeUndefined();
    expect(partyFor(b)).toBeUndefined();
  });
});

describe("GameServer - party message", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test("party members get the same party number in the start info, never the id", async () => {
    const game = makeGame({
      config: { gameMode: GameMode.Team, playerTeams: 2, nations: "disabled" },
    });
    const clients = [
      makeClient({ clientID: cid("c1"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c2") }),
      makeClient({ clientID: cid("c3"), clanTag: "CLAN" }),
      makeClient({ clientID: cid("c4") }),
    ];
    for (const c of clients) game.joinClient(c);
    await mockWsOf(clients[0]).emit({ type: "party", partyID: PARTY_A });
    await mockWsOf(clients[1]).emit({ type: "party", partyID: PARTY_A });

    startGame(game);

    const start = mockWsOf(clients[0])
      .sent()
      .find((m): m is ServerStartGameMessage => m.type === "start");
    expect(start).toBeDefined();
    const players = start!.gameStartInfo.players;
    const byID = new Map(players.map((p) => [p.clientID, p]));
    expect(byID.get(clients[0].clientID)?.party).toBe(1);
    expect(byID.get(clients[1].clientID)?.party).toBe(1);
    expect(byID.get(clients[2].clientID)?.party).toBeUndefined();
    expect(JSON.stringify(start)).not.toContain(PARTY_A);
  });

  test("a party message after the start is ignored", async () => {
    const game = makeGame({
      config: { gameMode: GameMode.Team, playerTeams: 2, nations: "disabled" },
    });
    const a = makeClient({ clientID: cid("c1") });
    const b = makeClient({ clientID: cid("c2") });
    game.joinClient(a);
    game.joinClient(b);
    startGame(game);
    await mockWsOf(a).emit({ type: "party", partyID: PARTY_B });
    expect(a.partyID).toBeUndefined();
  });
});
