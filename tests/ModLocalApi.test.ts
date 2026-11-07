import type http from "node:http";
import type { AddressInfo } from "node:net";
// @ts-expect-error plain .mjs script with no type declarations
import { start } from "../scripts/mod/local-api.mjs";

// The local stand-in for OpenFront's closed-source API (scripts/mod/local-api.mjs).
describe("local API stand-in", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = await start(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });

  test("serves a valid, empty cosmetics list", async () => {
    const res = await fetch(`${base}/cosmetics.json?rail=web`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ patterns: {}, flags: {} });
  });

  test("serves the bundled empty streams feed", async () => {
    const res = await fetch(`${base}/streams.json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ featured: [], live: [] });
  });

  test("everyone is a guest: account endpoints answer 401", async () => {
    for (const p of ["/auth/refresh", "/users/@me", "/join_verify"]) {
      expect((await fetch(`${base}${p}`)).status, p).toBe(401);
    }
  });

  test("matchmaking polls succeed with no assignment", async () => {
    const res = await fetch(`${base}/matchmaking/checkin`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  test("has no server list, and unknown paths are 404", async () => {
    expect((await fetch(`${base}/cluster.json`)).status).toBe(404);
    expect((await fetch(`${base}/anything-else`)).status).toBe(404);
  });

  test("answers CORS preflight for the page's origin, with credentials", async () => {
    const res = await fetch(`${base}/auth/refresh`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:9000",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:9000",
    );
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
