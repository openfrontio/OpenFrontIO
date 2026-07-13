// Fake matchmaking server implementing the API worker's documented protocol
// (see the matchmaking integration handoff): WS /matchmaking/join, the
// {type:"join", jwt} message, {type:"match-assignment", gameId}, and the
// close-code contract (1008 invalid session, 1000 replaced by newer
// connection). A control API lets tests trigger each server-side behavior.

import http from "node:http";
import { WebSocketServer } from "ws";

export async function startFakeMatchmakingServer() {
  const state = {
    joins: [], // every {type:"join"} ever received: { jwt, at }
    sockets: new Map(), // jwt -> ws holding the queue slot
    rejectNextJoin: false,
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (obj) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(obj));
      };
      switch (new URL(req.url, "http://localhost").pathname) {
        case "/control/state":
          return send({
            joins: state.joins,
            queued: [...state.sockets.keys()],
          });
        case "/control/reject-next": // next join gets 1008 Invalid session
          state.rejectNextJoin = true;
          return send({ ok: true });
        case "/control/kill": // abrupt drop (deploy/restart) -> client sees 1006
          for (const ws of state.sockets.values()) ws.terminate();
          state.sockets.clear();
          return send({ ok: true });
        case "/control/replace": // queue slot taken by a newer connection
          for (const ws of state.sockets.values()) {
            ws.close(1000, "Replaced by newer connection");
          }
          state.sockets.clear();
          return send({ ok: true });
        case "/control/assign": {
          const { gameId } = JSON.parse(body || "{}");
          for (const ws of state.sockets.values()) {
            ws.send(JSON.stringify({ type: "match-assignment", gameId }));
          }
          return send({ ok: true });
        }
        default:
          res.statusCode = 404;
          return res.end();
      }
    });
  });

  const wss = new WebSocketServer({
    server,
    // Real worker rejects a missing instance_id with HTTP 400 pre-upgrade.
    verifyClient: ({ req }) =>
      new URL(req.url, "http://localhost").searchParams.has("instance_id"),
  });

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== "join") return;
      state.joins.push({ jwt: msg.jwt, at: Date.now() });
      if (state.rejectNextJoin) {
        state.rejectNextJoin = false;
        ws.close(1008, "Invalid session");
        return;
      }
      const prev = state.sockets.get(msg.jwt);
      if (prev && prev !== ws) {
        prev.close(1000, "Replaced by newer connection");
      }
      state.sockets.set(msg.jwt, ws);
    });
    ws.on("close", () => {
      for (const [jwt, s] of state.sockets) {
        if (s === ws) state.sockets.delete(jwt);
      }
    });
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    port,
    wsUrl: `ws://127.0.0.1:${port}`,
    controlUrl: `http://127.0.0.1:${port}/control`,
    close: () => new Promise((r) => server.close(r)),
  };
}
