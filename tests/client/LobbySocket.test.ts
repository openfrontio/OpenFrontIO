import { PublicLobbySocket } from "../../src/client/LobbySocket";

class MockWebSocket extends EventTarget {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.OPEN;

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }

  send(_data: unknown) {}
}

describe("PublicLobbySocket", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    MockWebSocket.instances = [];
    // @ts-expect-error assign test mock
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("delivers lobby updates from websocket messages", () => {
    const updates: unknown[][] = [];
    const socket = new PublicLobbySocket((lobbies) => updates.push(lobbies));

    socket.start();
    const ws = MockWebSocket.instances.at(-1);
    expect(ws?.url).toContain("/lobbies");

    ws?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "lobbies_update",
          data: {
            lobbies: [
              {
                gameID: "g1",
                numClients: 1,
                gameConfig: {
                  maxPlayers: 2,
                  gameMode: 0,
                  gameMap: "Earth",
                },
              },
            ],
          },
        }),
      }),
    );

    expect(updates).toHaveLength(1);
    expect((updates[0][0] as { gameID: string }).gameID).toBe("g1");

    socket.stop();
  });

  it("falls back to HTTP polling after max websocket attempts", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lobbies: [] }),
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const socket = new PublicLobbySocket(() => {}, {
      maxWsAttempts: 1,
      reconnectDelay: 0,
      pollIntervalMs: 50,
    });

    socket.start();
    const ws = MockWebSocket.instances.at(-1);
    ws?.dispatchEvent(new CloseEvent("close"));

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    socket.stop();
  });
});
