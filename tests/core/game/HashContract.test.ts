import { describe, expect, it } from "vitest";
import {
  GameUpdates,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { ClientHashSchema, TurnSchema } from "../../../src/core/Schemas";
import { hashAdd32, hashMul32, simpleHash } from "../../../src/core/Util";
import { setup } from "../../util/Setup";

describe("gameplay hash contract", () => {
  it("wraps hash arithmetic as signed 32-bit integers", () => {
    expect(hashAdd32(0x7fffffff, 1)).toBe(-0x80000000);
    expect(hashMul32(0x7fffffff, 2)).toBe(-2);
  });

  it("emits deterministic signed 32-bit hashes that match gameplay schemas", async () => {
    const game = await setup("ocean_and_land");
    const aliceInfo = new PlayerInfo(
      "Alice",
      PlayerType.Human,
      null,
      "ALIC0001",
    );
    const bobInfo = new PlayerInfo("Bob", PlayerType.Human, null, "BOB00002");

    const alice = game.addPlayer(aliceInfo);
    const bob = game.addPlayer(bobInfo);
    const aliceTroops = 2_000_000_000;
    const bobTroops = 1_900_000_000;

    alice.setTroops(aliceTroops);
    bob.setTroops(bobTroops);

    const oldUnboundedHash =
      1 +
      simpleHash(alice.id()) * aliceTroops +
      simpleHash(bob.id()) * bobTroops;
    expect(oldUnboundedHash).toBeGreaterThan(Number.MAX_SAFE_INTEGER);

    const expectedHash = hashAdd32(
      hashAdd32(1, hashMul32(simpleHash(alice.id()), aliceTroops)),
      hashMul32(simpleHash(bob.id()), bobTroops),
    );

    const hashUpdates = updatesOfType<{ tick: number; hash: number }>(
      game.executeNextTick(),
      GameUpdateType.Hash,
    );
    const [hashUpdate] = hashUpdates;

    expect(hashUpdate).toBeDefined();
    if (!hashUpdate) {
      throw new Error("Expected a hash update on tick 0");
    }
    expect(hashUpdate.hash).toBe(expectedHash);
    expect(Number.isInteger(hashUpdate.hash)).toBe(true);
    expect(hashUpdate.hash).toBeGreaterThanOrEqual(-0x80000000);
    expect(hashUpdate.hash).toBeLessThanOrEqual(0x7fffffff);
    expect(
      ClientHashSchema.parse({
        type: "hash",
        turnNumber: hashUpdate.tick,
        hash: hashUpdate.hash,
      }).hash,
    ).toBe(expectedHash);
    expect(
      TurnSchema.parse({
        turnNumber: hashUpdate.tick,
        intents: [],
        hash: hashUpdate.hash,
      }).hash,
    ).toBe(expectedHash);
  });
});

function updatesOfType<T>(updates: GameUpdates, type: GameUpdateType): T[] {
  return (updates[type] as T[]) ?? [];
}
