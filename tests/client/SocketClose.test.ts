import { afterEach, describe, expect, it, vi } from "vitest";
import { describeSocketClose } from "../../src/client/SocketClose";

const close = (code: number, reason = "") =>
  ({ code, reason, wasClean: code !== 1006 }) as CloseEvent;

describe("describeSocketClose", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("says a socket that never opened failed its handshake", () => {
    expect(
      describeSocketClose(
        "wss://blue.openfront.io/w3/lobbies",
        close(1006),
        null,
      ),
    ).toBe(
      "blue.openfront.io/w3/lobbies closed (1006, no close frame) before it opened",
    );
  });

  it("gives the server's reason and how long the socket was open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    expect(
      describeSocketClose(
        "wss://blue.openfront.io/w0",
        close(4001, "kicked"),
        7_500,
      ),
    ).toBe('blue.openfront.io/w0 closed (4001) "kicked" after 2.5s open');
  });

  it("drops the query string", () => {
    expect(
      describeSocketClose(
        "wss://api.openfront.io/matchmaking/join?instance=abc&mode=1v1",
        close(1006),
        null,
      ),
    ).not.toContain("instance");
  });

  it("notes when the browser itself is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(describeSocketClose("wss://x/w0", close(1006), null)).toContain(
      "browser offline",
    );
  });

  it("does not throw on a URL it cannot parse", () => {
    expect(() => describeSocketClose("", close(1006), null)).not.toThrow();
  });
});
