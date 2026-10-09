import { describe, expect, it } from "vitest";
import { GameManager } from "../../src/server/GameManager";
import { zeroCounters } from "../../src/server/telemetry/MatchTelemetry";
import {
  cid,
  makeClient,
  mockLogger,
  mockWsOf,
} from "../util/GameServerHarness";

const telemetry = {
  emit: () => "enqueued" as const,
  counters: zeroCounters,
  stop: () => {},
};

describe("GameManager.activeClientsByPlatform", () => {
  it("counts connected clients per platform across games, zeros included", () => {
    const manager = new GameManager(mockLogger(), telemetry);
    const a = manager.createGame(cid("a"), undefined)!;
    const b = manager.createGame(cid("b"), undefined)!;
    a.joinClient(makeClient({ platform: "steam" }));
    a.joinClient(makeClient({ platform: "web" }));
    b.joinClient(makeClient({ platform: "steam" }));
    b.joinClient(makeClient());
    const gone = makeClient({ platform: "crazygames" });
    b.joinClient(gone);
    mockWsOf(gone).trigger("close");

    expect(Object.fromEntries(manager.activeClientsByPlatform())).toEqual({
      web: 1,
      steam: 2,
      crazygames: 0,
      unknown: 1,
    });
    expect(manager.activeClients()).toBe(4);
  });
});
