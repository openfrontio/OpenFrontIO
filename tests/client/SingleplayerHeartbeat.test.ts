import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import {
  SINGLEPLAYER_HEARTBEAT_INTERVAL_MS,
  startSingleplayerHeartbeat,
} from "../../src/client/SingleplayerHeartbeat";

// The heartbeat is the server's only sign a singleplayer game exists, so it
// must reach the game server (not the page host) on the worker the id hashes
// to, carry the platform, keep beating on the interval, and stop cleanly.
const SERVER_HOST = "main.openfront.dev";
const GAME_ID = "WKk9mHgY";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 8,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.io",
    instanceId: "test",
    gitCommit: "test",
    serverHost: SERVER_HOST,
  };
  ClientEnv.reset();
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
});

describe("startSingleplayerHeartbeat", () => {
  it("posts to the game's worker on the game server, with the platform", () => {
    const stop = startSingleplayerHeartbeat(GAME_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://${SERVER_HOST}/${ClientEnv.workerPath(GAME_ID)}/api/singleplayer/${GAME_ID}/heartbeat`,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ platform: "web" });
    stop();
  });

  it("beats once per interval until stopped", () => {
    const stop = startSingleplayerHeartbeat(GAME_ID);
    vi.advanceTimersByTime(SINGLEPLAYER_HEARTBEAT_INTERVAL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(SINGLEPLAYER_HEARTBEAT_INTERVAL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("skips the beat when no game server is known", () => {
    // The static apex page: no serverHost, no numWorkers, no list applied.
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      turnstileSiteKey: "x",
      jwtAudience: "openfront.io",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
    const stop = startSingleplayerHeartbeat(GAME_ID);
    expect(fetchMock).not.toHaveBeenCalled();
    stop();
  });

  it("survives a failed request", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const stop = startSingleplayerHeartbeat(GAME_ID);
    await vi.advanceTimersByTimeAsync(SINGLEPLAYER_HEARTBEAT_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });
});
