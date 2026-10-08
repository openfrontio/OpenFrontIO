import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { stripWorkerPrefix } from "../../src/server/WorkerPathPrefix";

// Each worker is addressed as /wN/... through nginx, but registers its routes
// unprefixed. This middleware is what reconciles the two, and it is also the
// gate that rejects a request routed to the wrong worker.
describe("stripWorkerPrefix", () => {
  let server: http.Server;
  let base: string;
  let seenUrl: string | null;

  beforeEach(async () => {
    seenUrl = null;
    const app = express();
    app.use(stripWorkerPrefix(0));
    app.get("/api/game/:id/exists", (req, res) => {
      seenUrl = req.url;
      res.json({ exists: true });
    });
    app.get("/", (req, res) => {
      seenUrl = req.url;
      res.json({ root: true });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  test("routes this worker's own prefix to the unprefixed route", async () => {
    const res = await fetch(`${base}/w0/api/game/abcdefgh/exists`);
    expect(res.status).toBe(200);
    expect(seenUrl).toBe("/api/game/abcdefgh/exists");
  });

  test("leaves an unprefixed request untouched", async () => {
    const res = await fetch(`${base}/api/game/abcdefgh/exists`);
    expect(res.status).toBe(200);
    expect(seenUrl).toBe("/api/game/abcdefgh/exists");
  });

  test("maps a bare worker prefix to the root", async () => {
    const res = await fetch(`${base}/w0`);
    expect(res.status).toBe(200);
    expect(seenUrl).toBe("/");
  });

  test("refuses a request routed to a different worker", async () => {
    const res = await fetch(`${base}/w7/api/game/abcdefgh/exists`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "Worker mismatch" });
    expect(seenUrl).toBeNull();
  });
});
