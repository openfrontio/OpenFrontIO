import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Gatekeeper,
  guardGatekeeper,
  IntentObservation,
  loadGatekeeper,
  MatchGatekeeper,
  noopGatekeeper,
} from "../../src/server/Gatekeeper";
import {
  makeClient,
  makeGame,
  makeMockWs,
  mockLogger,
  startGame,
} from "../util/GameServerHarness";
import { clientFrame } from "../util/Wire";

const TURN_MS = 100;

// Records every hook call, in order.
function recordingGatekeeper() {
  const calls: { hook: string; args: unknown[] }[] = [];
  const hooks: MatchGatekeeper = {
    clientJoined: (client) =>
      calls.push({ hook: "clientJoined", args: [client.clientID] }),
    intentObserved: (o: IntentObservation) =>
      calls.push({ hook: "intentObserved", args: [o] }),
    turnCommitted: (turn, count) =>
      calls.push({ hook: "turnCommitted", args: [turn, count] }),
    matchEnded: (totalTurns) =>
      calls.push({ hook: "matchEnded", args: [totalTurns] }),
  };
  const opened: string[] = [];
  const gatekeeper: Gatekeeper = {
    matchOpened: ({ gameID }) => {
      opened.push(gameID);
      return hooks;
    },
  };
  const observed = () =>
    calls
      .filter((c) => c.hook === "intentObserved")
      .map((c) => c.args[0] as IntentObservation);
  return { gatekeeper, calls, opened, observed };
}

describe("guardGatekeeper", () => {
  it("swallows and logs a hook that throws", () => {
    const log = mockLogger();
    const throwing: Gatekeeper = {
      matchOpened: () => ({
        clientJoined: () => {
          throw new Error("boom");
        },
        intentObserved: () => {
          throw new Error("boom");
        },
        turnCommitted: () => {
          throw new Error("boom");
        },
        matchEnded: () => {
          throw new Error("boom");
        },
      }),
    };
    const hooks = guardGatekeeper(throwing, log).matchOpened({ gameID: "g" });
    expect(() => hooks.turnCommitted(0, 0)).not.toThrow();
    expect(() => hooks.matchEnded(0)).not.toThrow();
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it("falls back to no-op hooks when matchOpened throws", () => {
    const log = mockLogger();
    const hooks = guardGatekeeper(
      {
        matchOpened: () => {
          throw new Error("boom");
        },
      },
      log,
    ).matchOpened({ gameID: "g" });
    expect(() => hooks.matchEnded(0)).not.toThrow();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("passes on matchEnded only once", () => {
    const rec = recordingGatekeeper();
    const hooks = guardGatekeeper(rec.gatekeeper, mockLogger()).matchOpened({
      gameID: "g",
    });
    hooks.matchEnded(3);
    hooks.matchEnded(3);
    expect(rec.calls).toEqual([{ hook: "matchEnded", args: [3] }]);
  });
});

describe("loadGatekeeper", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "gatekeeper-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses the no-op when the module is absent", async () => {
    const log = mockLogger();
    expect(await loadGatekeeper(log, dir)).toBe(noopGatekeeper);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("loads the module's default export", async () => {
    writeFileSync(
      path.join(dir, "index.ts"),
      `export default () => ({
        matchOpened: () => ({
          clientJoined() {},
          intentObserved() {},
          turnCommitted() {},
          matchEnded() { throw new Error("from module"); },
        }),
      });`,
    );
    const log = mockLogger();
    const gatekeeper = await loadGatekeeper(log, dir);
    expect(gatekeeper).not.toBe(noopGatekeeper);
    // Guarded: the module's throw is logged, not raised.
    gatekeeper.matchOpened({ gameID: "g" }).matchEnded(0);
    expect(log.error).toHaveBeenCalledWith("gatekeeper matchEnded failed", {
      error: "Error: from module",
    });
  });

  it("uses the no-op and logs when the module fails to load", async () => {
    writeFileSync(
      path.join(dir, "index.ts"),
      `throw new Error("broken module");`,
    );
    const log = mockLogger();
    expect(await loadGatekeeper(log, dir)).toBe(noopGatekeeper);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe("GameServer gatekeeper hooks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const rec = recordingGatekeeper();
    const game = makeGame({
      id: "matchABC",
      deps: { gatekeeper: rec.gatekeeper },
    });
    const ws = makeMockWs();
    const client = makeClient({ clientID: "clientAB", ws });
    return { rec, game, client, ws };
  }

  it("reports the match, the join, intents, turns and the end", async () => {
    const { rec, game, client, ws } = setup();
    expect(rec.opened).toEqual(["matchABC"]);
    game.joinClient(client);
    startGame(game);
    await ws.trigger(
      "message",
      clientFrame({ type: "intent", intent: { type: "spawn", tile: 1 } }),
    );
    vi.advanceTimersByTime(TURN_MS);
    await game.end();

    const hooks = rec.calls.map((c) => c.hook);
    expect(hooks[0]).toBe("clientJoined");
    expect(hooks).toContain("turnCommitted");
    expect(hooks[hooks.length - 1]).toBe("matchEnded");
    expect(rec.observed()).toEqual([
      {
        client,
        intent: { type: "spawn", tile: 1, clientID: "clientAB" },
        intentType: "spawn",
        outcome: "accepted",
        turn: 0,
        reasonCode: undefined,
      },
    ]);
    const firstTurn = rec.calls.find((c) => c.hook === "turnCommitted");
    expect(firstTurn?.args[0]).toBe(0);
  });

  it("reports a rejected intent with its reason", async () => {
    const { rec, game, client, ws } = setup();
    game.joinClient(client);
    startGame(game);
    await ws.trigger(
      "message",
      clientFrame({
        type: "intent",
        intent: { type: "kick_player", targetClientID: "targetAB" },
      }),
    );
    expect(rec.observed()).toMatchObject([
      { intentType: "kick_player", outcome: "rejected", reasonCode: "403" },
    ]);
  });

  it("reports a schema-invalid intent before the kick", async () => {
    const { rec, game, client, ws } = setup();
    game.joinClient(client);
    await ws.trigger(
      "message",
      clientFrame({
        type: "intent",
        intent: { type: "targetPlayer", target: "not a client id" },
      }),
    );
    expect(rec.observed()).toMatchObject([
      {
        intentType: "targetPlayer",
        outcome: "rejected",
        reasonCode: "kick_reason.invalid_message",
      },
    ]);
  });

  it("reports the end of a match that never started", async () => {
    const { rec, game, client } = setup();
    game.joinClient(client);
    await game.end();
    expect(rec.calls.map((c) => c.hook)).toEqual([
      "clientJoined",
      "matchEnded",
    ]);
  });
});
