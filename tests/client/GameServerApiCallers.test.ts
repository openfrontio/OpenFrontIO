import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  getPlayToken: vi.fn(async () => "play-token"),
  getAuthHeader: vi.fn(async () => "Bearer test"),
  isSessionActive: vi.fn(() => false),
}));

import { createLobby } from "../../src/client/Api";
import { ClientEnv } from "../../src/client/ClientEnv";
import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";
import { MatchmakingModal } from "../../src/client/Matchmaking";

// Every remaining caller of the game server's HTTP API, driven through real
// production code. Each one used to build a relative URL, which silently
// resolved against the document origin instead of the game server.
const SERVER_HOST = "main.openfront.dev";

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
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.io",
    instanceId: "test",
    gitCommit: "test",
    serverHost: SERVER_HOST,
  };
  ClientEnv.reset();
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ exists: true, gameID: "game-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
  vi.clearAllMocks();
});

describe("createLobby", () => {
  it("creates the lobby on the configured game server", async () => {
    await createLobby();
    // No worker prefix: the edge (nginx in prod, the vite proxy in dev) picks
    // a worker, which mints a self-owned id.
    expect(lastUrl()).toBe(`https://${SERVER_HOST}/api/create_game`);
  });

  it("still sends the play token as the creator's identity", async () => {
    await createLobby();
    const init = lastCall()[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer play-token",
    );
  });
});

describe("JoinLobbyModal.checkActiveLobby", () => {
  it("probes the configured game server for the lobby", async () => {
    const modal = new JoinLobbyModal();
    await (
      modal as unknown as {
        checkActiveLobby(id: string): Promise<boolean>;
      }
    ).checkActiveLobby("game-1");
    expect(lastUrl()).toBe(
      `https://${SERVER_HOST}/${ClientEnv.workerPath("game-1")}/api/game/game-1/exists`,
    );
  });
});

describe("MatchmakingModal.checkGame", () => {
  it("polls the configured game server for the matched game", async () => {
    const modal = new MatchmakingModal();
    const internals = modal as unknown as {
      gameID: string | null;
      checkGame(): Promise<void>;
    };
    internals.gameID = "game-1";
    await internals.checkGame();
    expect(lastUrl()).toBe(
      `https://${SERVER_HOST}/${ClientEnv.workerPath("game-1")}/api/game/game-1/exists`,
    );
  });
});
