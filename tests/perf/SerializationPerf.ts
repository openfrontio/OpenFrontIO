import Benchmark from "benchmark";
import { PlayerID } from "../../src/core/game/Game";
import { GameUpdate, GameUpdateType } from "../../src/core/game/GameUpdates";

// Create a large batch of updates to simulate a busy tick
const updates: GameUpdate[] = [];

// 1. Tile Updates (Bulk)
for (let i = 0; i < 1000; i++) {
  // Simulate TileUpdateWrapper structure if it exists, or just raw tile updates if they are handled differently.
  // Looking at GameUpdates.ts, TileUpdateWrapper isn't fully defined in the snippet I saw,
  // but let's assume standard object structure for benchmark.
  // Actually, let's use valid update types we saw.

  // TargetPlayerUpdate
  updates.push({
    type: GameUpdateType.TargetPlayer,
    id: i,
    target: "p2" as PlayerID,
  });
}

// 2. Unit Updates
for (let i = 0; i < 500; i++) {
  // Mock UnitUpdate
  updates.push({
    type: GameUpdateType.Unit,
    id: i,
    tile: i,
    player: "p1" as PlayerID,
    // Add other typical fields if needed, or keep minimal for serialization test
  } as any);
}

const largePayload = {
  tick: 100,
  updates: updates,
};

const results: string[] = [];

new Benchmark.Suite()
  .add("JSON.stringify (1500 updates)", () => {
    JSON.stringify(largePayload);
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== Serialization Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
