import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicLobbySocket } from "../src/client/LobbySocket";
import {
  PublicGameInfo,
  PublicGames,
  PublicGameType,
} from "../src/core/Schemas";

function lobby(
  gameID: string,
  numClients: number,
  publicGameType: PublicGameType = "ffa",
): PublicGameInfo {
  return { gameID, numClients, publicGameType };
}

function fullMessage(
  serverTime: number,
  games: Partial<Record<PublicGameType, PublicGameInfo[]>>,
) {
  return JSON.stringify({
    type: "full",
    serverTime,
    games: { ffa: [], team: [], special: [], ...games },
  });
}

function countsMessage(serverTime: number, counts: Record<string, number>) {
  return JSON.stringify({ type: "counts", serverTime, counts });
}

function makeSocket() {
  const callback = vi.fn<(g: PublicGames) => void>();
  const socket = new PublicLobbySocket(callback);
  const dispatch = (data: string) => {
    (socket as any).handleMessage({ data } as MessageEvent);
  };
  return { socket, callback, dispatch };
}

describe("PublicLobbySocket.handleMessage", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("delivers a full snapshot to the callback", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(
      fullMessage(1000, {
        ffa: [lobby("g1", 3)],
        team: [lobby("g2", 5, "team")],
      }),
    );

    expect(callback).toHaveBeenCalledTimes(1);
    const arg = callback.mock.calls[0][0];
    expect(arg.serverTime).toBe(1000);
    expect(arg.games.ffa).toEqual([lobby("g1", 3)]);
    expect(arg.games.team).toEqual([lobby("g2", 5, "team")]);
  });

  it("patches numClients onto the last full snapshot when counts arrives", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 3), lobby("g2", 4)] }));
    callback.mockClear();

    dispatch(countsMessage(1500, { g1: 7, g2: 4 }));

    expect(callback).toHaveBeenCalledTimes(1);
    const arg = callback.mock.calls[0][0];
    expect(arg.serverTime).toBe(1500);
    expect(arg.games.ffa).toEqual([lobby("g1", 7), lobby("g2", 4)]);
    // Static fields (gameConfig, startsAt, publicGameType) survive the patch.
    expect(arg.games.ffa?.[0].publicGameType).toBe("ffa");
  });

  it("ignores counts arriving before any full snapshot", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(countsMessage(1000, { g1: 5 }));
    expect(callback).not.toHaveBeenCalled();
  });

  it("leaves lobbies whose gameID is absent from counts unchanged", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 3), lobby("g2", 4)] }));
    callback.mockClear();

    dispatch(countsMessage(1500, { g1: 9 }));

    const arg = callback.mock.calls[0][0];
    expect(arg.games.ffa).toEqual([lobby("g1", 9), lobby("g2", 4)]);
  });

  it("applies consecutive counts deltas on top of the merged state", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 1)] }));
    dispatch(countsMessage(1500, { g1: 2 }));
    dispatch(countsMessage(2000, { g1: 3 }));

    expect(callback).toHaveBeenCalledTimes(3);
    expect(callback.mock.calls[2][0].games.ffa).toEqual([lobby("g1", 3)]);
    expect(callback.mock.calls[2][0].serverTime).toBe(2000);
  });

  it("replaces lobby set when a fresh full snapshot arrives", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 3)] }));
    dispatch(fullMessage(2000, { ffa: [lobby("g2", 5)] }));

    const arg = callback.mock.calls[1][0];
    expect(arg.games.ffa).toEqual([lobby("g2", 5)]);
    expect(arg.serverTime).toBe(2000);
  });

  it("does not call the callback on malformed JSON", () => {
    const { callback, dispatch } = makeSocket();
    dispatch("not json");
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not call the callback on schema-invalid messages", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(JSON.stringify({ type: "bogus", serverTime: 1 }));
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not mutate the previously-delivered snapshot when applying counts", () => {
    const { callback, dispatch } = makeSocket();
    dispatch(fullMessage(1000, { ffa: [lobby("g1", 3)] }));
    const prevSnapshot = callback.mock.calls[0][0];
    const prevFfa = prevSnapshot.games.ffa;

    dispatch(countsMessage(1500, { g1: 99 }));

    expect(prevSnapshot.serverTime).toBe(1000);
    expect(prevFfa).toEqual([lobby("g1", 3)]);
  });
});
