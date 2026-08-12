// End-to-end test of the game server over real HTTP + WebSocket: boots the
// actual master + cluster workers (Node via tsx, or Bun with
// E2E_RUNTIME=bun) and drives the full lobby -> start -> turn-relay ->
// rejoin -> kick flow that production clients exercise.

import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createGame,
  gameInfo,
  RUNTIME,
  sleep,
  TestClient,
  TestServer,
  waitFor,
} from "./util";

describe(`game server e2e (runtime: ${RUNTIME})`, () => {
  const server = new TestServer();
  const creatorToken = randomUUID();
  let game: { gameID: string; workerIndex: number; port: number };
  let creator: TestClient;
  let playerB: TestClient;
  let playerC: TestClient;

  beforeAll(async () => {
    await server.start();
    game = await createGame(creatorToken);
    creator = new TestClient(game.port, game.gameID, "creator", creatorToken);
    playerB = new TestClient(game.port, game.gameID, "playerB");
    playerC = new TestClient(game.port, game.gameID, "playerC");
  });

  afterAll(async () => {
    for (const c of [creator, playerB, playerC]) c?.close();
    await server.stop();
  });

  test("health endpoint reports ok once workers are ready", async () => {
    const res = await fetch("http://127.0.0.1:3000/api/health");
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("create_game requires an auth token", async () => {
    const res = await fetch(`http://127.0.0.1:${game.port}/api/create_game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("created game is queryable on its worker", async () => {
    const info = await gameInfo(game.port, game.gameID);
    expect(info).not.toBeNull();
    expect(info.gameID).toBe(game.gameID);
    expect(info.gameConfig.gameType).toBe("Private");
  });

  test("clients join over WebSocket and get server-assigned clientIDs", async () => {
    await creator.join();
    await playerB.join();
    await playerC.join();
    expect(creator.clientID).toBeTruthy();
    expect(playerB.clientID).toBeTruthy();
    expect(playerC.clientID).toBeTruthy();
    // All three ids are distinct.
    expect(
      new Set([creator.clientID, playerB.clientID, playerC.clientID]).size,
    ).toBe(3);

    // Lobby info converges to 3 clients for everyone.
    await waitFor(
      async () => {
        const info = await gameInfo(game.port, game.gameID);
        return info?.clients?.length === 3;
      },
      10_000,
      "lobby to report 3 clients",
    );
  });

  test("lobby identifies the creator", async () => {
    const info = await gameInfo(game.port, game.gameID);
    expect(info.lobbyCreatorClientID).toBe(creator.clientID);
  });

  test("non-creator cannot start the game", async () => {
    playerB.sendIntent({ type: "toggle_game_start_timer" });
    await sleep(1500);
    const info = await gameInfo(game.port, game.gameID);
    expect(info.startsAt ?? undefined).toBeUndefined();
  });

  test("creator starts the game; every client receives prestart and start", async () => {
    creator.sendIntent({ type: "toggle_game_start_timer" });
    for (const c of [creator, playerB, playerC]) {
      await c.waitForMessage((m) => m.type === "prestart", 15_000);
      const start = (await c.waitForMessage(
        (m) => m.type === "start",
        15_000,
      )) as any;
      expect(start.gameStartInfo.gameID).toBe(game.gameID);
      expect(start.gameStartInfo.players).toHaveLength(3);
      expect(start.myClientID).toBe(c.clientID);
      const usernames = start.gameStartInfo.players.map((p: any) => p.username);
      expect(usernames).toEqual(
        expect.arrayContaining(["creator", "playerB", "playerC"]),
      );
    }
  });

  test("server broadcasts turns at the 100ms tick", async () => {
    const before = creator.turns().length;
    await sleep(1200);
    const after = creator.turns().length;
    const gained = after - before;
    // ~12 expected; allow generous slack for CI jitter.
    expect(gained).toBeGreaterThanOrEqual(8);
    expect(gained).toBeLessThanOrEqual(16);
    // Turn numbers are consecutive.
    const numbers = creator.turns().map((t) => t.turn.turnNumber);
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBe(numbers[i - 1] + 1);
    }
  });

  test("an intent is relayed to every client, stamped with the sender's clientID", async () => {
    const marker = 987654321; // distinctive troops value to find the intent
    playerB.sendIntent({ type: "attack", targetID: null, troops: marker });
    for (const c of [creator, playerB, playerC]) {
      const turnMsg = (await c.waitForMessage(
        (m) =>
          m.type === "turn" &&
          (m as any).turn.intents.some((i: any) => i.troops === marker),
        5_000,
      )) as any;
      const intent = turnMsg.turn.intents.find((i: any) => i.troops === marker);
      // The clientID comes from the authenticated connection, not the payload.
      expect(intent.clientID).toBe(playerB.clientID);
    }
  });

  test("a client that vanishes can rejoin and receives the missed turns", async () => {
    // Hard-drop C's socket (no close frame ≈ network loss).
    playerC.ws!.terminate();
    await sleep(600);
    const lastTurn =
      playerC.turns().length === 0
        ? 0
        : playerC.turns()[playerC.turns().length - 1].turn.turnNumber + 1;

    const rejoined = new TestClient(
      game.port,
      game.gameID,
      "playerC",
      playerC.token,
    );
    await rejoined.connect();
    rejoined.send({
      type: "rejoin",
      gameID: game.gameID,
      lastTurn,
      token: playerC.token,
    });
    const start = (await rejoined.waitForMessage(
      (m) => m.type === "start",
      10_000,
    )) as any;
    // The catch-up slice starts exactly where the client left off.
    expect(start.gameStartInfo.gameID).toBe(game.gameID);
    if (start.turns.length > 0) {
      expect(start.turns[0].turnNumber).toBe(lastTurn);
    }
    // Same identity as before the drop.
    expect(start.myClientID).toBe(playerC.clientID);
    playerC = rejoined;
    playerC.clientID = start.myClientID;
  });

  test("a client sending garbage is kicked with a reason", async () => {
    const victim = new TestClient(game.port, game.gameID, "victim");
    await victim.join();
    victim.ws!.send("this is not json");
    await victim.waitForMessage(
      (m) => m.type === "error" && (m as any).error.includes("invalid_message"),
      5_000,
    );
    await waitFor(
      () => victim.closeCode !== null,
      5_000,
      "victim socket to close",
    );
    expect(victim.closeCode).toBe(1000);

    // Kicked identity cannot rejoin.
    const comeback = new TestClient(
      game.port,
      game.gameID,
      "victim",
      victim.token,
    );
    await comeback.connect();
    comeback.send({
      type: "join",
      token: comeback.token,
      gameID: game.gameID,
      username: "victim",
      clanTag: null,
      turnstileToken: null,
    });
    await waitFor(
      () => comeback.closeCode !== null,
      5_000,
      "kicked rejoin to be rejected",
    );
    expect(comeback.closeCode).toBe(1002);
  });

  test("games on the wrong worker are rejected", async () => {
    // Join a game that lives on worker A via worker B's port: the message
    // is dropped (no lobby_info ever arrives).
    const wrongPort = game.port === 3001 ? 3002 : 3001;
    const lost = new TestClient(wrongPort, game.gameID, "lostsoul");
    await lost.connect();
    lost.send({
      type: "join",
      token: lost.token,
      gameID: game.gameID,
      username: "lostsoul",
      clanTag: null,
      turnstileToken: null,
    });
    await sleep(1500);
    expect(lost.messages.find((m) => m.type === "lobby_info")).toBeUndefined();
    lost.close();
  });
});
