import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicGames } from "../src/core/Schemas";

// OPE-255. The component stops its public-lobby socket when a game starts
// (Main.ts calls gameModeSelector.stop()), and `start()` lived ONLY in
// connectedCallback(). Nothing reconnects an element that is never
// disconnected, so an exit that does not reload the page left the lobby
// browser frozen: a stale list that never updates again.
//
// jsdom has no WebSocket worth talking to and this test is about the
// lifecycle, not the wire, so the socket is a spy -- following the same
// pattern as GameModeSelectorGatingWiring.test.ts.
const { socketCalls } = vi.hoisted(() => ({
  socketCalls: { started: 0, stopped: 0 },
}));

vi.mock("../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    constructor(_onUpdate: (g: PublicGames) => void) {}
    start(): void {
      socketCalls.started++;
    }
    stop(): void {
      socketCalls.stopped++;
    }
  },
}));

import { GameModeSelector } from "../src/client/GameModeSelector";

describe("GameModeSelector lobby-socket lifecycle", () => {
  beforeEach(() => {
    socketCalls.started = 0;
    socketCalls.stopped = 0;
  });

  it("exposes a start() that is the inverse of stop()", () => {
    const selector = new GameModeSelector();

    selector.stop();
    expect(socketCalls.stopped).toBe(1);

    selector.start();
    expect(socketCalls.started).toBe(1);
  });

  // The actual regression: a stopped socket must be able to come back without
  // the element being torn down and recreated, because in this flow it never
  // is -- <game-mode-selector> stays connected the whole time.
  it("reconnects after a stop without any disconnect/reconnect of the element", () => {
    const selector = new GameModeSelector();

    selector.stop();
    selector.start();
    selector.stop();
    selector.start();

    expect(socketCalls.stopped).toBe(2);
    expect(socketCalls.started).toBe(2);
  });
});
