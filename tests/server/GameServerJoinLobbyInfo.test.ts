import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
  mockWsOf,
} from "../util/GameServerHarness";

// The join modal shows a spinner until the first lobby_info lands. It used to
// come from the 1s broadcast tick, so joining an occupied lobby waited up to a
// second for nothing. A seated client now gets its lobby_info at once.
describe("GameServer lobby_info on admission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const lobbyInfoFor = (client: ReturnType<typeof makeClient>) =>
    mockWsOf(client)
      .sent()
      .filter((m: any) => m.type === "lobby_info");

  it("sends lobby_info to the first joiner without waiting for the tick", () => {
    const game = makeGame();
    const first = makeClient({ clientID: cid("first") });
    expect(game.joinClient(first)).toBe("joined");

    const infos = lobbyInfoFor(first);
    expect(infos).toHaveLength(1);
    expect(infos[0].myClientID).toBe(cid("first"));
  });

  it("sends lobby_info to a joiner into an occupied lobby immediately", () => {
    const game = makeGame();
    const first = makeClient({ clientID: cid("first") });
    game.joinClient(first);
    // The broadcast interval is now running; a later joiner must not have to
    // wait for its next tick.
    const second = makeClient({ clientID: cid("second") });
    expect(game.joinClient(second)).toBe("joined");

    const infos = lobbyInfoFor(second);
    expect(infos).toHaveLength(1);
    expect(infos[0].myClientID).toBe(cid("second"));
    expect(infos[0].lobby.clients?.map((c: any) => c.clientID)).toEqual([
      cid("first"),
      cid("second"),
    ]);
  });

  it("keeps the periodic broadcast for everyone already seated", () => {
    const game = makeGame();
    const first = makeClient({ clientID: cid("first") });
    game.joinClient(first);
    const second = makeClient({ clientID: cid("second") });
    game.joinClient(second);

    vi.advanceTimersByTime(1000);
    // first: its own admission + one tick; second: admission + the same tick.
    expect(lobbyInfoFor(first)).toHaveLength(2);
    expect(lobbyInfoFor(second)).toHaveLength(2);
  });

  it("sends lobby_info to a reconnecting client immediately", () => {
    const game = makeGame();
    const client = makeClient({
      clientID: cid("c"),
      persistentID: "pid-reconnect",
    });
    game.joinClient(client);

    const ws = makeMockWs();
    expect(game.rejoinClient(ws as any, "pid-reconnect")).toBe(true);
    const infos = ws.sent().filter((m: any) => m.type === "lobby_info");
    expect(infos).toHaveLength(1);
    expect(infos[0].myClientID).toBe(cid("c"));
  });
});
