import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  getPlayToken: vi.fn(async () => "play-token"),
  getAuthHeader: vi.fn(async () => "Bearer test"),
  isSessionActive: vi.fn(() => false),
}));

const mocks = vi.hoisted(() => ({
  ensureServerList: vi.fn(async (): Promise<string> => "fallback"),
}));

// These callers all await the server list first; here it answers "no list,
// use the page's values" so the URLs under test come from BOOTSTRAP_CONFIG,
// and the one case that must refuse ("outdated") can be asked for directly.
vi.mock("../../src/client/ServerList", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ensureServerList: mocks.ensureServerList };
});

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
  mocks.ensureServerList.mockResolvedValue("fallback");
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

  // No server runs this build any more (the rollover moved on without this
  // tab): creating against the page's own stale host would mint a lobby on
  // a server that is going away. The lobby socket's "update available"
  // prompt is what moves the player forward.
  it("refuses to create when no server runs this build any more", async () => {
    mocks.ensureServerList.mockResolvedValue("outdated");
    await expect(createLobby()).rejects.toThrow(/no server that takes new/);
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("create_game")),
    ).toBe(false);
  });

  // This page names its own server (serverHost above), so "no-server" means
  // the list DOES carry that server, fenced: deliberately out of rotation,
  // taking nothing new. A lobby minted there would be born on a server on
  // its way out, so Create refuses here too.
  it("refuses to create on its own server once the list fences it", async () => {
    mocks.ensureServerList.mockResolvedValue("no-server");
    await expect(createLobby()).rejects.toThrow(/no server that takes new/);
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("create_game")),
    ).toBe(false);
  });

  // A stale registry (OPE-430) answers "fallback" instead: the list has no
  // entry for this page's server at all, and that host is running this
  // build — it served this page — so Create goes ahead on it.
  it("creates on the page's own server when the list has no entry for it", async () => {
    mocks.ensureServerList.mockResolvedValue("fallback");
    await createLobby();
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
