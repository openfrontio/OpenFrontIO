import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DESKTOP_APP_ORIGIN,
  applyGameApiCorsHeaders,
  gameApiCors,
} from "../../src/server/GameApiCors";
import { stripWorkerPrefix } from "../../src/server/WorkerPathPrefix";

// The game server's /api routes are same-origin for the web client, but the
// desktop app loads its renderer from app://openfront and so reaches them
// cross-origin. A POST carrying Authorization + Content-Type is not a simple
// request, so the browser preflights it: without these headers the desktop
// cannot create a lobby, join by id, or poll for a game at all.
function collect() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers.set(name, value);
    },
  };
}

describe("applyGameApiCorsHeaders", () => {
  test("allows the desktop app origin", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders(DESKTOP_APP_ORIGIN, setHeader);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("app://openfront");
  });

  test("advertises the methods and headers the game API actually uses", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders(DESKTOP_APP_ORIGIN, setHeader);
    // GET (game/:id, exists), POST (create_game, listing), OPTIONS (preflight).
    const methods = headers.get("Access-Control-Allow-Methods") ?? "";
    expect(methods).toContain("GET");
    expect(methods).toContain("POST");
    expect(methods).toContain("OPTIONS");
    // Authorization carries the play token; Content-Type is what makes the
    // POSTs non-simple in the first place.
    const allowed = (
      headers.get("Access-Control-Allow-Headers") ?? ""
    ).toLowerCase();
    expect(allowed).toContain("authorization");
    expect(allowed).toContain("content-type");
  });

  test("never allows credentials", () => {
    // The play token travels in the Authorization header, not a cookie.
    // Allowing credentials here would expose session cookies to any origin we
    // ever add to the allowlist, for no benefit.
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders(DESKTOP_APP_ORIGIN, setHeader);
    expect(headers.has("Access-Control-Allow-Credentials")).toBe(false);
  });

  test("varies on Origin even when the origin is rejected", () => {
    // Otherwise a cache could hand an allowed origin's response, headers and
    // all, to a request from a different origin.
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders("https://evil.example", setHeader);
    expect(headers.get("Vary")).toBe("Origin");
  });

  test("does not allow an unknown origin", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders("https://evil.example", setHeader);
    expect(headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  test("does not allow a lookalike of the desktop origin", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders("app://openfront.evil.example", setHeader);
    expect(headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  test("sets nothing for a request with no Origin (the web client)", () => {
    const { headers, setHeader } = collect();
    applyGameApiCorsHeaders(undefined, setHeader);
    expect(headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});

describe("gameApiCors middleware, mounted on a real Express app", () => {
  // Driven over real HTTP rather than fake req/res: the things worth checking
  // here — that Express actually emits the headers, that a preflight really is
  // terminated before the route runs, that an error response still carries the
  // grant — are properties of Express's own request handling, and a hand-rolled
  // response double would only prove the double behaves as written.
  let server: http.Server;
  let base: string;
  let routeHits: string[];

  beforeEach(async () => {
    routeHits = [];
    const app = express();
    // Mirrors Worker.ts: CORS ahead of the prefix check, matching both shapes.
    app.use(["/api", /^\/w\d+\/api/], gameApiCors);
    app.use(stripWorkerPrefix(0));
    app.post("/api/create_game", (_req, res) => {
      routeHits.push("create_game");
      res.json({ gameID: "g1" });
    });
    app.get("/api/game/:id/exists", (_req, res) => {
      routeHits.push("exists");
      res.json({ exists: true });
    });
    app.post("/api/boom", (_req, res) => {
      routeHits.push("boom");
      res.status(400).json({ error: "bad" });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  test("answers a preflight without running the route", async () => {
    const res = await fetch(`${base}/api/create_game`, {
      method: "OPTIONS",
      headers: {
        Origin: DESKTOP_APP_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "app://openfront",
    );
    expect(
      res.headers.get("access-control-allow-headers")?.toLowerCase(),
    ).toContain("authorization");
    expect(routeHits).toEqual([]);
  });

  test("grants a real request from the desktop app", async () => {
    const res = await fetch(`${base}/api/create_game`, {
      method: "POST",
      headers: { Origin: DESKTOP_APP_ORIGIN },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "app://openfront",
    );
    expect(routeHits).toEqual(["create_game"]);
  });

  test("grants a request addressed to this worker's prefix", async () => {
    // The shape the client actually sends: ClientEnv.workerPath() puts the
    // worker in the path, and nginx routes on it.
    const res = await fetch(`${base}/w0/api/game/abcdefgh/exists`, {
      headers: { Origin: DESKTOP_APP_ORIGIN },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "app://openfront",
    );
    expect(routeHits).toEqual(["exists"]);
  });

  test("grants a worker-mismatch 404 so the client can read it", async () => {
    // A client that computes the wrong worker for a game id (e.g. its injected
    // numWorkers disagrees with the server's) gets this 404. Without the grant
    // the desktop sees an opaque CORS failure instead, which hides the actual
    // fault — the same reasoning that puts CORS ahead of the rate limiter.
    const res = await fetch(`${base}/w7/api/game/abcdefgh/exists`, {
      headers: { Origin: DESKTOP_APP_ORIGIN },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "app://openfront",
    );
    expect(routeHits).toEqual([]);
  });

  test("an error response still carries the grant", async () => {
    // Otherwise the desktop client sees an opaque CORS failure and can never
    // report the real status. This is why the middleware is mounted ahead of
    // the rate limiter in Worker.ts.
    const res = await fetch(`${base}/api/boom`, {
      method: "POST",
      headers: { Origin: DESKTOP_APP_ORIGIN },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "app://openfront",
    );
  });

  test("runs the route for an unknown origin but grants it nothing", async () => {
    // Rejecting server-side would break non-browser callers (the admin bot,
    // curl) that send no Origin or another one. We withhold permission and let
    // the browser enforce it.
    const res = await fetch(`${base}/api/create_game`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toContain("Origin");
    expect(routeHits).toEqual(["create_game"]);
  });

  test("serves a request with no Origin at all, ungranted", async () => {
    const res = await fetch(`${base}/api/create_game`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(routeHits).toEqual(["create_game"]);
  });
});
