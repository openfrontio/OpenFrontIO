import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeClient as harnessClient,
  makeGame as harnessGame,
  makeMockWs,
  MockWs,
} from "../util/GameServerHarness";
import { clientFrame } from "../util/Wire";

function makeClient(clientID: string, persistentID: string, role?: string) {
  const ws = makeMockWs();
  const client = harnessClient({
    clientID,
    persistentID,
    role: role ?? null,
    username: "TestUser",
    ws,
  });
  return { client, ws };
}

describe("GameServer - kick_player authorization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  function makeGame(creatorPersistentID?: string) {
    return harnessGame({ creatorPersistentID });
  }

  async function sendKickMessage(ws: MockWs, target: string) {
    await ws.trigger(
      "message",
      clientFrame({
        type: "intent",
        intent: { type: "kick_player", targetClientID: target },
      }),
    );
  }

  it("lobby creator can kick another player with lobby_creator reason", async () => {
    const game = makeGame("creator-pid");
    const kickSpy = vi.spyOn(game, "kickClient");

    const { client: creator, ws: creatorWs } = makeClient(
      "creator1",
      "creator-pid",
    );
    const { client: target } = makeClient("target01", "target-pid");

    game.joinClient(creator);
    game.joinClient(target);

    await sendKickMessage(creatorWs, "target01");

    expect(kickSpy).toHaveBeenCalledOnce();
    expect(kickSpy).toHaveBeenCalledWith(
      "target01",
      "kick_reason.lobby_creator",
    );
  });

  it("admin-flared player can kick another player with admin reason", async () => {
    const game = makeGame();
    const kickSpy = vi.spyOn(game, "kickClient");

    const { client: admin, ws: adminWs } = makeClient(
      "admin001",
      "admin-pid",
      "admin",
    );
    const { client: target } = makeClient("target01", "target-pid");

    game.joinClient(admin);
    game.joinClient(target);

    await sendKickMessage(adminWs, "target01");

    expect(kickSpy).toHaveBeenCalledOnce();
    expect(kickSpy).toHaveBeenCalledWith("target01", "kick_reason.admin");
  });

  it("non-creator non-admin cannot kick", async () => {
    const game = makeGame("creator-pid");
    const kickSpy = vi.spyOn(game, "kickClient");

    const { client: creator } = makeClient("creator1", "creator-pid");
    const { client: rando, ws: randoWs } = makeClient("rando001", "rando-pid");
    const { client: target } = makeClient("target01", "target-pid");

    game.joinClient(creator);
    game.joinClient(rando);
    game.joinClient(target);

    await sendKickMessage(randoWs, "target01");

    expect(kickSpy).not.toHaveBeenCalled();
  });

  it("cannot kick yourself even as lobby creator", async () => {
    const game = makeGame("creator-pid");
    const kickSpy = vi.spyOn(game, "kickClient");

    const { client: creator, ws: creatorWs } = makeClient(
      "creator1",
      "creator-pid",
    );
    game.joinClient(creator);

    await sendKickMessage(creatorWs, "creator1");

    expect(kickSpy).not.toHaveBeenCalled();
  });
});
