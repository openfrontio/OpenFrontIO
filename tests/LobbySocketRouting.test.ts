import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";
import { PublicLobbySocket } from "../src/client/LobbySocket";
import { lobbyFrame } from "./util/Wire";

const { ensureServerList } = vi.hoisted(() => ({
  ensureServerList: vi.fn(async () => "api"),
}));
vi.mock("../src/client/ServerList", () => ({
  ensureServerList,
  reloadWouldRescue: vi.fn(() => false),
}));

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 1;
  binaryType = "";
  constructor(public url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.readyState = 3;
  }
  sendLobby(gameID: string) {
    const frame = lobbyFrame({
      type: "full",
      serverTime: 0,
      games: { team: [{ gameID, publicGameType: "team", numClients: 1 }] },
    });
    this.dispatchEvent(new MessageEvent("message", { data: frame.buffer }));
  }
}

describe("PublicLobbySocket joined-game routing", () => {
  let socket: PublicLobbySocket;
  const foreignGame = "b123456789";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("WebSocket", FakeWebSocket);
    FakeWebSocket.instances = [];
    ensureServerList.mockReset().mockResolvedValue("api");
    ClientEnv.reset();
    ClientEnv.applyServerList(
      {
        servers: {
          a: {
            host: "picked.example",
            numWorkers: 2,
            version: "abcdef0",
            state: "open",
          },
          b: {
            host: "owner.example",
            numWorkers: 7,
            version: "abcdef0",
            state: "open",
          },
        },
      },
      "a",
    );
    socket = new PublicLobbySocket(vi.fn());
  });

  afterEach(() => {
    socket.stop();
    ClientEnv.reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the picked-server feed when no game is specified", async () => {
    await socket.start();
    expect(FakeWebSocket.instances[0].url).toMatch(
      /^wss:\/\/picked\.example\/w[01]\/lobbies$/,
    );
  });

  it("uses the game's owning server and worker, including reconnects", async () => {
    await socket.start(foreignGame);
    const expected = `wss://owner.example/${ClientEnv.gameWorkerPath(foreignGame)}/lobbies`;
    expect(FakeWebSocket.instances[0].url).toBe(expected);
    FakeWebSocket.instances[0].dispatchEvent(new Event("close"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(FakeWebSocket.instances[1].url).toBe(expected);
  });

  it("ignores old socket messages and close events after switching feeds", async () => {
    const update = vi.fn();
    socket = new PublicLobbySocket(update);
    await socket.start();
    const old = FakeWebSocket.instances[0];
    await socket.start(foreignGame);
    expect(old.readyState).toBe(3);
    old.sendLobby("stale");
    old.dispatchEvent(new Event("close"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(update).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(2);
    const current = FakeWebSocket.instances[1];
    current.sendLobby(foreignGame);
    expect(update.mock.calls[0][0].games.team[0].gameID).toBe(foreignGame);
    socket.stop();
    current.sendLobby("after-stop");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("discards discovery from a previous start after closing and reopening", async () => {
    let finishDiscovery!: (value: string) => void;
    ensureServerList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDiscovery = resolve;
        }),
    );
    const oldStart = socket.start();
    socket.stop();
    await socket.start(foreignGame);
    finishDiscovery("api");
    await oldStart;
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("owner.example");
  });
});
