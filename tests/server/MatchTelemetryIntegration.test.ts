import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import { ADMIN_BOT_CLIENT_ID } from "../../src/core/Schemas";
import { createGameWireContext } from "../../src/core/ZbinWire";
import { GameManager } from "../../src/server/GameManager";
import { GameServer } from "../../src/server/GameServer";
import type {
  MatchTelemetryCounters,
  MatchTelemetryEmitter,
  MatchTelemetryEvent,
} from "../../src/server/telemetry/MatchTelemetry";
import {
  makeClient as harnessClient,
  makeMockWs,
  mockLogger,
  MockWs,
  startGame,
} from "../util/GameServerHarness";
import { clientFrame, testGameConfig } from "../util/Wire";

class RecordingEmitter implements MatchTelemetryEmitter {
  events: MatchTelemetryEvent[] = [];

  emit(event: MatchTelemetryEvent) {
    this.events.push(event);
    return "enqueued" as const;
  }

  counters(): MatchTelemetryCounters {
    throw new Error("not used by integration tests");
  }

  stop() {}
}

const TURN_MS = 100;
const ADMIN_BOT = {
  clientID: ADMIN_BOT_CLIENT_ID,
  isLobbyCreator: false,
  isAdmin: true,
  isAdminBot: true,
};

// Every intent committed into a turn so far, as the client on `ws` saw it.
function committedIntents(ws: MockWs) {
  const ctx = createGameWireContext([{ clientID: "clientAB" }]);
  return ws.sent(ctx).flatMap((m) => (m.type === "turn" ? m.turn.intents : []));
}

function makeClient() {
  const ws = makeMockWs();
  const client = harnessClient({
    clientID: "clientAB",
    persistentID: "persistentABC",
    username: "TestUser",
    publicId: "publicABC",
    ws,
  });
  return { client, ws };
}

describe("GameServer match telemetry", () => {
  let telemetry: RecordingEmitter;
  let log: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    telemetry = new RecordingEmitter();
    log = mockLogger();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeGame() {
    return new GameServer(
      {
        id: "matchABC",
        log,
        createdAt: Date.now(),
        gameConfig: {
          donateGold: false,
          donateTroops: false,
          gameMap: GameMapType.World,
          gameType: GameType.Private,
          gameMapSize: GameMapSize.Normal,
          difficulty: Difficulty.Easy,
          nations: "default",
          infiniteGold: false,
          infiniteTroops: false,
          instantBuild: false,
          randomSpawn: false,
          gameMode: GameMode.FFA,
          bots: 0,
          disabledUnits: [],
        },
      },
      {
        telemetry,
        telemetryBuildHash: "0123456789012345678901234567890123456789",
        archive: vi.fn(async () => {}),
      },
    );
  }

  it("emits opened, joined, started, and finished events with raw identity", async () => {
    const game = makeGame();
    const { client } = makeClient();
    expect(game.joinClient(client)).toBe("joined");
    game.start();
    await game.end();
    expect(telemetry.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "match_opened",
        "player_joined",
        "match_started",
        "match_finished",
      ]),
    );
    const joined = telemetry.events.find(
      (event) => event.type === "player_joined",
    );
    expect(joined?.payload.identity).toEqual({
      clientId: "clientAB",
      publicId: "publicABC",
    });
    // persistentID must never reach telemetry identity.
    expect(joined?.payload.identity).not.toHaveProperty("persistentId");
  });

  it("emits an accepted valid intent before it appears in the committed turn", async () => {
    const game = makeGame();
    const { client, ws } = makeClient();
    game.joinClient(client);
    startGame(game);
    await ws.trigger(
      "message",
      clientFrame({ type: "intent", intent: { type: "spawn", tile: 1 } }),
    );
    const observed = telemetry.events.find(
      (event) => event.type === "intent_observed",
    );
    expect(observed).toMatchObject({
      serverTick: 0,
      payload: {
        outcome: "accepted",
        intentType: "spawn",
        identity: { clientId: "clientAB", publicId: "publicABC" },
        intent: { type: "spawn", tile: 1, clientID: "clientAB" },
      },
    });
    vi.advanceTimersByTime(TURN_MS);
    expect(committedIntents(ws)).toContainEqual({
      type: "spawn",
      tile: 1,
      clientID: "clientAB",
    });
  });

  it("tags an intent accepted while paused so telemetry can distinguish it", async () => {
    const game = makeGame();
    const { client, ws } = makeClient();
    game.joinClient(client);
    startGame(game);
    game.handleIntent({ type: "toggle_pause", paused: true }, ADMIN_BOT);
    await ws.trigger(
      "message",
      clientFrame({ type: "intent", intent: { type: "spawn", tile: 1 } }),
    );
    expect(
      telemetry.events.find((event) => event.type === "intent_observed"),
    ).toMatchObject({
      payload: {
        outcome: "accepted",
        reasonCode: "paused",
        intentType: "spawn",
      },
    });
    // Paused intents are accepted at ingress but never queued into a turn:
    // the turns committed once play resumes do not carry it.
    game.handleIntent({ type: "toggle_pause", paused: false }, ADMIN_BOT);
    vi.advanceTimersByTime(TURN_MS);
    expect(committedIntents(ws).map((i) => i.type)).not.toContain("spawn");
  });

  it("preserves an existing authorization rejection and reason", async () => {
    const game = makeGame();
    const { client, ws } = makeClient();
    game.joinClient(client);
    startGame(game);
    await ws.trigger(
      "message",
      clientFrame({
        type: "intent",
        intent: { type: "kick_player", targetClientID: "targetAB" },
      }),
    );
    expect(
      telemetry.events.find((event) => event.type === "intent_observed"),
    ).toMatchObject({
      payload: {
        outcome: "rejected",
        reasonCode: "403",
        reasonDetail: "only the lobby creator or an admin can kick players",
      },
    });
    vi.advanceTimersByTime(TURN_MS);
    expect(committedIntents(ws).map((i) => i.type)).not.toContain(
      "kick_player",
    );
  });

  it("captures the raw intent from a schema-invalid intent message", async () => {
    // The frame decodes structurally (the target is a plain string on the
    // wire) but fails zod validation — the signature of a buggy or cheating
    // client, which is exactly what this telemetry exists to observe. The
    // rejected intent is attributed with its raw payload before the kick.
    const game = makeGame();
    const { client, ws } = makeClient();
    game.joinClient(client);
    telemetry.events.length = 0;
    await ws.trigger(
      "message",
      clientFrame({
        type: "intent",
        intent: { type: "targetPlayer", target: "not a client id" },
      }),
    );
    const observed = telemetry.events.find(
      (event) => event.type === "intent_observed",
    );
    expect(observed).toMatchObject({
      payload: {
        outcome: "rejected",
        reasonCode: "kick_reason.invalid_message",
        intentType: "targetPlayer",
        intent: { type: "targetPlayer", target: "not a client id" },
      },
    });
    expect(ws.close).toHaveBeenCalled();
  });

  it("emits nothing for a structurally corrupt frame", async () => {
    // Garbage bytes decode to no readable type, so there is no intent to
    // attribute — the client is just kicked.
    const game = makeGame();
    const { client, ws } = makeClient();
    game.joinClient(client);
    telemetry.events.length = 0;
    await ws.trigger("message", Buffer.from([0xff, 0xff, 0xff, 0xff]));
    expect(
      telemetry.events.filter((event) => event.type === "intent_observed"),
    ).toHaveLength(0);
    expect(ws.close).toHaveBeenCalled();
  });

  it("does not capture a schema-invalid non-intent message", async () => {
    const game = makeGame();
    const { client, ws } = makeClient();
    game.joinClient(client);
    telemetry.events.length = 0;
    await ws.trigger(
      "message",
      clientFrame({
        type: "rejoin",
        gameID: "not a game id",
        lastTurn: 0,
        token: "secret",
      }),
    );
    expect(
      telemetry.events.filter((event) => event.type === "intent_observed"),
    ).toHaveLength(0);
  });

  it("emits a turn marker after all intent decisions for that tick", async () => {
    const game = makeGame();
    const { client, ws } = makeClient();
    game.joinClient(client);
    startGame(game);
    await ws.trigger(
      "message",
      clientFrame({ type: "intent", intent: { type: "spawn", tile: 1 } }),
    );
    vi.advanceTimersByTime(TURN_MS);
    const intentIndex = telemetry.events.findIndex(
      (event) => event.type === "intent_observed",
    );
    const markerIndex = telemetry.events.findIndex(
      (event) => event.type === "turn_committed",
    );
    expect(markerIndex).toBeGreaterThan(intentIndex);
    expect(telemetry.events[markerIndex]).toMatchObject({
      serverTick: 1,
      payload: {
        turnNumber: 0,
        replayIntentCount: 2,
        observed: 1,
        enqueued: 1,
        dropped: 0,
      },
    });
  });

  it("GameManager forwards the worker emitter and build hash to each game", () => {
    const manager = new GameManager(log, telemetry, "build-hash");
    const game = manager.createGame(
      "managerMatch",
      testGameConfig({ gameType: GameType.Private }),
    );
    expect(game).not.toBeNull();
    expect(
      telemetry.events.find((event) => event.type === "match_opened"),
    ).toMatchObject({
      matchId: "managerMatch",
      payload: { buildHash: "build-hash" },
    });
  });
});
