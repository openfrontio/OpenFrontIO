#!/usr/bin/env node
// A tiny local stand-in for OpenFront's closed-source account/shop API, which
// the dev setup expects on http://localhost:8787. Without it every request to
// that port is refused and the browser console and server logs fill with
// ECONNREFUSED noise. With it the game starts cleanly, offline:
//
//   - no accounts: sign-in answers 401, so you play as a guest
//   - no shop: cosmetics are an empty, valid list
//   - no public matchmaking or server list (private lobbies and single player
//     do not need either)
//
// Nothing here talks to the real OpenFront servers. No dependencies.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.LOCAL_API_PORT ?? 8787);
const here = path.dirname(fileURLToPath(import.meta.url));

function loadStreamsFallback() {
  try {
    return fs.readFileSync(
      path.resolve(here, "../../resources/streams.json"),
      "utf-8",
    );
  } catch {
    return JSON.stringify({
      verifiedAt: new Date(0).toISOString(),
      featured: [],
      live: [],
    });
  }
}
const STREAMS = loadStreamsFallback();

// Exact-path answers: [status, body]
const ROUTES = {
  "GET /cosmetics.json": [200, JSON.stringify({ patterns: {}, flags: {} })],
  "GET /streams.json": [200, STREAMS],
  // "A site nobody registered": the client reads this as reachable, no list.
  "GET /cluster.json": [404, JSON.stringify({ error: "local" })],
  // Servers poll this for public-matchmaking matches: "no assignment", so the
  // poll succeeds quietly instead of logging an error every few seconds.
  "POST /matchmaking/checkin": [200, "{}"],
  "GET /reserved_clan_tags": [200, "[]"],
  "GET /map_weights": [404, JSON.stringify({ error: "local" })],
  "GET /custom_tribes": [404, JSON.stringify({ error: "local" })],
};

export function handle(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    // Reflect the caller so credentialed requests from any local port work.
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ?? "*",
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const pathname = new URL(req.url ?? "/", "http://local").pathname;
  const hit = ROUTES[`${req.method} ${pathname}`];
  let status;
  let body;
  if (hit) {
    [status, body] = hit;
  } else if (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/users/") ||
    pathname === "/join_verify"
  ) {
    // No accounts offline: everyone is a guest.
    status = 401;
    body = JSON.stringify({ error: "local mode: no accounts" });
  } else {
    status = 404;
    body = JSON.stringify({ error: "not available in local mode" });
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

export function start(port = PORT) {
  const server = http.createServer(handle);
  // The lobby coordinator and matchmaking use websockets; there is no public
  // matchmaking offline, so refuse them cleanly instead of hanging.
  server.on("upgrade", (_req, socket) => {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  start()
    .then(() =>
      console.log(`Local API stand-in listening on http://localhost:${PORT}`),
    )
    .catch((e) => {
      if (e && e.code === "EADDRINUSE") {
        console.log(
          `Port ${PORT} is already in use; assuming an API is running there.`,
        );
        return;
      }
      throw e;
    });
}
