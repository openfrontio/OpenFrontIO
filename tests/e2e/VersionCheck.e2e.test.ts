import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

// End-to-end test of the deploy version gate: spawns the real server
// (master + 1 worker) as a child process and exercises the actual
// WebSocket join handler and lobby feed.
//
// Opt-in (npm run test:e2e) because it binds the real dev ports 3000/3001
// and would collide with a running `npm run dev`.

const SERVER_COMMIT = "a".repeat(40);
const WRONG_COMMIT = "b".repeat(40);
const WORKER_HTTP = "http://127.0.0.1:3001";
const WORKER_WS = "ws://127.0.0.1:3001";

interface JoinResult {
  messages: any[];
  closeCode: number | undefined;
}

describe.skipIf(process.env.E2E !== "1")("deploy version gate (e2e)", () => {
  let server: ChildProcess;
  let gameID: string;
  const serverLogs: string[] = [];

  // Doubles as the readiness probe: retried until the worker accepts it.
  async function createGame(): Promise<string> {
    const deadline = Date.now() + 45_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${WORKER_HTTP}/w0/api/create_game`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${randomUUID()}`,
          },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const info = (await res.json()) as { gameID: string };
          return info.gameID;
        }
        lastError = new Error(`create_game returned ${res.status}`);
      } catch (e) {
        lastError = e;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `server not ready: ${lastError}\n--- server logs ---\n${serverLogs.join("")}`,
    );
  }

  beforeAll(async () => {
    const root = path.resolve(__dirname, "..", "..");
    server = spawn(
      path.join(root, "node_modules", ".bin", "tsx"),
      ["src/server/Server.ts"],
      {
        cwd: root,
        detached: true,
        env: {
          ...process.env,
          GAME_ENV: "dev",
          NUM_WORKERS: "1",
          GIT_COMMIT: SERVER_COMMIT,
          DOMAIN: "localhost",
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          API_KEY: "WARNING_DEV_API_KEY_DO_NOT_USE_IN_PRODUCTION",
          ADMIN_BOT_API_KEY:
            "WARNING_DEV_ADMIN_BOT_KEY_DO_NOT_USE_IN_PRODUCTION",
        },
      },
    );
    server.stdout?.on("data", (d) => serverLogs.push(String(d)));
    server.stderr?.on("data", (d) => serverLogs.push(String(d)));
    gameID = await createGame();
  }, 60_000);

  afterAll(() => {
    if (server?.pid !== undefined) {
      // detached spawn = own process group; negative pid kills the master
      // and the cluster workers it forked.
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill("SIGKILL");
      }
    }
  });

  // Opens a game socket, sends a join, and collects messages until the
  // server closes the socket or admits us (lobby_info).
  function join(gitCommit: string | undefined): Promise<JoinResult> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WORKER_WS);
      const messages: any[] = [];
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(
          new Error(`no join verdict in 15s: ${JSON.stringify(messages)}`),
        );
      }, 15_000);
      const finish = (closeCode?: number) => {
        clearTimeout(timeout);
        resolve({ messages, closeCode });
      };
      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "join",
            gameID,
            token: randomUUID(), // dev servers accept a bare persistent ID
            username: "TestPlayer",
            clanTag: null,
            turnstileToken: null,
            ...(gitCommit === undefined ? {} : { gitCommit }),
          }),
        );
      });
      ws.on("message", (data) => {
        try {
          messages.push(JSON.parse(String(data)));
        } catch {
          return;
        }
        if (messages[messages.length - 1].type === "lobby_info") {
          ws.close();
          finish(undefined);
        }
      });
      ws.on("close", (code) => finish(code));
      ws.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  }

  it("rejects a join whose gitCommit differs from the server's", async () => {
    const result = await join(WRONG_COMMIT);
    expect(result.messages).toContainEqual({
      type: "error",
      error: "version_mismatch",
    });
    expect(result.closeCode).toBe(1002);
  }, 30_000);

  it("rejects a join with no gitCommit (pre-feature client)", async () => {
    const result = await join(undefined);
    expect(result.messages).toContainEqual({
      type: "error",
      error: "version_mismatch",
    });
    expect(result.closeCode).toBe(1002);
  }, 30_000);

  it("admits a join with the matching gitCommit", async () => {
    const result = await join(SERVER_COMMIT);
    expect(result.messages.some((m) => m.type === "lobby_info")).toBe(true);
    expect(result.messages.every((m) => m.type !== "error")).toBe(true);
  }, 30_000);

  it("advertises the server commit on the lobby feed", async () => {
    // The feed is primed by the master's public-lobby schedule (every ~5s in
    // dev), so the first full snapshot can take a few seconds to arrive.
    const full = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(`${WORKER_WS}/lobbies`);
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error("no full lobby message in 30s"));
      }, 30_000);
      ws.on("message", (data) => {
        const msg = JSON.parse(String(data));
        if (msg.type === "full") {
          clearTimeout(timeout);
          ws.close();
          resolve(msg);
        }
      });
      ws.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
    expect(full.gitCommit).toBe(SERVER_COMMIT);
  }, 45_000);
});
