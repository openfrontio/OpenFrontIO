/**
 * A stand-in for the game API, for trying the replay viewer locally.
 *
 *   npx tsx scripts/replay/stub-game-api.mts <dir> [port] [host]
 *
 * Serves `<dir>/<gameID>.json` at `GET /game/<gameID>`, the endpoint the
 * viewer fetches a record from (ReplayRecord.ts). On 8787 it stands in for
 * the dev client's API (ApiBase.ts); the client's other API calls then 404,
 * which is harmless. Records come from record-demo.mts, or from a game
 * saved from the live API in a browser.
 */

import fs from "fs";
import http from "http";
import path from "path";

const dir: string = process.argv[2] ?? "records";
const port = Number(process.argv[3] ?? 8787);
const host = process.argv[4] ?? "127.0.0.1";
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

http
  .createServer((req, res) => {
    // The dev client fetches records from another origin (localhost:9000).
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:9000");
    // The client-side replay's fetch (JoinLobbyModal) sends Content-Type,
    // so the browser asks first. Without this answer it blocks the fetch.
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
      res.writeHead(204).end();
      return;
    }
    const match = /^\/game\/([A-Za-z0-9_-]+)$/.exec(req.url ?? "");
    if (match === null) {
      res.writeHead(404).end('{"error":"not found"}');
      return;
    }
    const file = path.join(dir, `${match[1]}.json`);
    if (!fs.existsSync(file)) {
      console.log(`404 ${req.url}`);
      res.writeHead(404).end('{"error":"no such game"}');
      return;
    }
    console.log(`200 ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(fs.readFileSync(file));
  })
  .listen(port, host, () =>
    console.log(`stub game API on http://${host}:${port} serving ${dir}`),
  );
