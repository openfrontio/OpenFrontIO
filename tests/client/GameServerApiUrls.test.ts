import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  getPlayToken: vi.fn(async () => "play-token"),
  getAuthHeader: vi.fn(async () => "Bearer test"),
  isSessionActive: vi.fn(() => false),
}));

import {
  createNextLobby,
  fetchLobbyListed,
  setLobbyListed,
} from "../../src/client/Api";
import { ClientEnv } from "../../src/client/ClientEnv";

// The game server's HTTP API must be addressed the same way its WebSockets
// are: against the configured server host. These fetches used to be relative,
// so they resolved against the document origin — which is correct only when
// the page happens to be served by the game server itself. It is not on the
// desktop build (app://openfront, where every /api route 404s against the
// local file handler) nor on any deployment that serves the client from a
// different host than the game server.
function setConfig(serverHost?: string) {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.io",
    instanceId: "test",
    gitCommit: "test",
    ...(serverHost === undefined ? {} : { serverHost }),
  };
  ClientEnv.reset();
}

let fetchMock: ReturnType<typeof vi.fn>;

function lastCall(): any[] {
  const calls = fetchMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
}

function lastUrl(): string {
  return String(lastCall()[0]);
}

beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ listed: true, exists: true, gameID: "g1" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
  vi.clearAllMocks();
});

describe("game-server API URLs with an explicit serverHost", () => {
  beforeEach(() => setConfig("main.openfront.dev"));

  it("fetchLobbyListed targets the configured game server", async () => {
    await fetchLobbyListed("game-1");
    expect(lastUrl()).toBe(
      `https://main.openfront.dev/${ClientEnv.workerPath("game-1")}/api/game/game-1`,
    );
  });

  it("setLobbyListed targets the configured game server", async () => {
    await setLobbyListed("game-1", true);
    expect(lastUrl()).toBe(
      `https://main.openfront.dev/${ClientEnv.workerPath("game-1")}/api/game/game-1/listing`,
    );
  });

  it("createNextLobby targets the worker that owns the finished game", async () => {
    await createNextLobby("game-1");
    expect(lastUrl()).toBe(
      `https://main.openfront.dev/${ClientEnv.workerPath("game-1")}/api/create_game?previous=game-1`,
    );
  });
});

describe("game-server API URLs on the web build (no serverHost)", () => {
  beforeEach(() => setConfig(undefined));

  // jsdom serves the tests from http://localhost:3000 by default; the point is
  // that the request still lands on the document's own origin, exactly as the
  // previous relative URLs did.
  it("fetchLobbyListed stays same-origin", async () => {
    await fetchLobbyListed("game-1");
    expect(new URL(lastUrl()).origin).toBe(window.location.origin);
    expect(new URL(lastUrl()).pathname).toBe(
      `/${ClientEnv.workerPath("game-1")}/api/game/game-1`,
    );
  });

  it("setLobbyListed stays same-origin", async () => {
    await setLobbyListed("game-1", true);
    expect(new URL(lastUrl()).origin).toBe(window.location.origin);
    expect(new URL(lastUrl()).pathname).toBe(
      `/${ClientEnv.workerPath("game-1")}/api/game/game-1/listing`,
    );
  });

  it("createNextLobby stays same-origin", async () => {
    await createNextLobby("game-1");
    expect(new URL(lastUrl()).origin).toBe(window.location.origin);
    expect(new URL(lastUrl()).pathname).toBe(
      `/${ClientEnv.workerPath("game-1")}/api/create_game`,
    );
  });
});
