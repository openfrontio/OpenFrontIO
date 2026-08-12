// Helpers for e2e tests that boot the real game server (master + cluster
// workers) as a child process and drive it over HTTP + WebSocket.
//
// The server runtime is selectable via E2E_RUNTIME=node|bun (default node),
// so the same suite verifies both the tsx/Node deployment and the Bun one.

import { ChildProcess, spawn } from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import WebSocket from "ws";
import type { ServerMessage } from "../../src/core/Schemas";

export const MASTER_PORT = 3000;
export const NUM_WORKERS = 2;
export const RUNTIME = process.env.E2E_RUNTIME === "bun" ? "bun" : "node";

const repoRoot = path.resolve(__dirname, "../..");

export const workerPort = (i: number) => 3001 + i;

const serverEnv = {
  ...process.env,
  GAME_ENV: "dev",
  NUM_WORKERS: String(NUM_WORKERS),
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  API_KEY: "WARNING_DEV_API_KEY_DO_NOT_USE_IN_PRODUCTION",
  ADMIN_BOT_API_KEY: "WARNING_DEV_ADMIN_BOT_KEY_DO_NOT_USE_IN_PRODUCTION",
  DOMAIN: "localhost",
  GIT_COMMIT: "DEV",
};

function serverCommand(): [string, string[]] {
  if (RUNTIME === "bun") {
    return ["bun", ["src/server/Server.ts"]];
  }
  return ["npx", ["tsx", "src/server/Server.ts"]];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await sleep(200);
  }
}

async function portServesHttp(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1000),
    });
    return true;
  } catch {
    return false;
  }
}

export class TestServer {
  proc: ChildProcess | null = null;
  logs: string[] = [];

  async start(): Promise<void> {
    // Fail fast if a stray server is already bound to our ports — under
    // Bun's cluster (SO_REUSEPORT) a stray would silently absorb traffic.
    for (let p = MASTER_PORT; p <= workerPort(NUM_WORKERS - 1); p++) {
      if (await portServesHttp(p)) {
        throw new Error(`port ${p} already serving HTTP; kill strays first`);
      }
    }
    const [cmd, args] = serverCommand();
    this.proc = spawn(cmd, args, {
      cwd: repoRoot,
      env: serverEnv,
      detached: true, // own process group so stop() can kill the whole tree
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.proc.stdout!.on("data", (d) => this.logs.push(String(d)));
    this.proc.stderr!.on("data", (d) => this.logs.push(String(d)));

    await waitFor(
      async () => {
        try {
          const res = await fetch(
            `http://127.0.0.1:${MASTER_PORT}/api/health`,
            { signal: AbortSignal.timeout(1000) },
          );
          return res.ok;
        } catch {
          return false;
        }
      },
      60_000,
      "server health",
    );
  }

  // PIDs (from the server's own logs) of the cluster worker processes.
  workerPids(): number[] {
    const pids: number[] = [];
    for (const line of this.logs) {
      for (const m of line.matchAll(/Started worker \d+ \(PID: (\d+)\)/g)) {
        pids.push(Number(m[1]));
      }
    }
    return pids;
  }

  masterPid(): number | null {
    for (const line of this.logs) {
      const m = line.match(/Primary (\d+) is running/);
      if (m) return Number(m[1]);
    }
    return null;
  }

  async stop(): Promise<void> {
    if (this.proc?.pid) {
      try {
        process.kill(-this.proc.pid, "SIGTERM");
      } catch {
        // already dead
      }
    }
    // Wait until every port is released so the next suite can bind.
    await waitFor(
      async () => {
        for (let p = MASTER_PORT; p <= workerPort(NUM_WORKERS - 1); p++) {
          if (await portServesHttp(p)) return false;
        }
        return true;
      },
      15_000,
      "server ports released",
    ).catch(() => {
      // Last resort: SIGKILL the group.
      if (this.proc?.pid) {
        try {
          process.kill(-this.proc.pid, "SIGKILL");
        } catch {
          // group already gone
        }
      }
    });
    this.proc = null;
  }
}

export async function createGame(
  creatorToken: string,
  config: object = {},
  onWorker = 0,
): Promise<{ gameID: string; workerIndex: number; port: number }> {
  const res = await fetch(
    `http://127.0.0.1:${workerPort(onWorker)}/api/create_game`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creatorToken}`,
      },
      body: JSON.stringify(config),
    },
  );
  if (!res.ok) {
    throw new Error(`create_game failed: ${res.status} ${await res.text()}`);
  }
  const info = await res.json();
  return {
    gameID: info.gameID,
    workerIndex: info.workerIndex,
    port: workerPort(info.workerIndex),
  };
}

export async function gameInfo(port: number, gameID: string): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${port}/api/game/${gameID}`);
  if (!res.ok) return null;
  return res.json();
}

// A WebSocket game client that records every server message and exposes
// promise-based waits, so tests read as: join → waitFor("start") → assert.
export class TestClient {
  token: string;
  ws: WebSocket | null = null;
  messages: ServerMessage[] = [];
  clientID: string | null = null;
  closeCode: number | null = null;
  closeReason = "";

  constructor(
    public port: number,
    public gameID: string,
    public username: string,
    token?: string,
  ) {
    this.token = token ?? randomUUID();
  }

  async join(): Promise<void> {
    await this.connect();
    this.send({
      type: "join",
      token: this.token,
      gameID: this.gameID,
      username: this.username,
      clanTag: null,
      turnstileToken: null,
    });
    // The server-assigned clientID arrives in lobby_info (pre-start joins)
    // or in the start message (late joins into a running game).
    const msg = await this.waitForMessage(
      (m) => m.type === "lobby_info" || m.type === "start",
      10_000,
    );
    this.clientID = (msg as any).myClientID;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}/`);
      this.ws = ws;
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
      ws.on("message", (data) => {
        try {
          this.messages.push(JSON.parse(data.toString()));
        } catch {
          // not JSON; ignore
        }
      });
      ws.on("close", (code, reason) => {
        this.closeCode = code;
        this.closeReason = reason.toString();
      });
    });
  }

  send(obj: unknown): void {
    this.ws!.send(JSON.stringify(obj));
  }

  sendIntent(intent: object): void {
    this.send({ type: "intent", intent });
  }

  async waitForMessage(
    pred: (m: ServerMessage) => boolean,
    timeoutMs = 10_000,
  ): Promise<ServerMessage> {
    let found: ServerMessage | undefined;
    await waitFor(
      () => {
        found = this.messages.find(pred);
        return found !== undefined;
      },
      timeoutMs,
      `message matching predicate (got ${this.messages.length} messages)`,
    );
    return found!;
  }

  turns(): any[] {
    return this.messages.filter((m) => m.type === "turn");
  }

  close(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000);
    }
  }
}
