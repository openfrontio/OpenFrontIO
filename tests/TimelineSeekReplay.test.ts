import { describe, expect, it } from "vitest";
import type { Config } from "../src/core/configuration/Config";
import { GameMapImpl } from "../src/core/game/GameMap";
import {
  GameUpdateType,
  type GameUpdateViewData,
} from "../src/core/game/GameUpdates";
import { GameView } from "../src/core/game/GameView";
import type { TerrainMapData } from "../src/core/game/TerrainMapLoader";
import type { WorkerClient } from "../src/core/worker/WorkerClient";

function createEmptyGameUpdates() {
  const updates: any = {};
  for (const v of Object.values(GameUpdateType)) {
    if (typeof v === "number") {
      updates[v] = [];
    }
  }
  return updates;
}

function createView(w: number, h: number): GameView {
  const terrain = new Uint8Array(w * h).fill(1 << 7);
  const gameMap = new GameMapImpl(w, h, terrain, w * h);
  const mapData: TerrainMapData = {
    nations: [],
    gameMap,
    miniGameMap: gameMap,
  };

  return new GameView(
    {} as unknown as WorkerClient,
    {} as unknown as Config,
    mapData,
    "client1" as any,
    "me",
    "game1" as any,
    [],
  );
}

function packTileUpdate(tile: number, state16: number): bigint {
  return (BigInt(tile) << 16n) | BigInt(state16 & 0xffff);
}

describe("Timeline-style seek via checkpoints + tick replay", () => {
  it("reconstructs map state for arbitrary ticks", () => {
    const w = 5;
    const h = 4;
    const totalTicks = 30;
    const checkpointEvery = 5;

    const baseline = createView(w, h);
    const byTickState = new Map<number, Uint16Array>();
    const checkpoints: {
      tick: number;
      checkpoint: ReturnType<GameView["exportCheckpoint"]>;
    }[] = [{ tick: 0, checkpoint: baseline.exportCheckpoint() }];
    const tickRecords: {
      tick: number;
      packedTileUpdatesBuffer: ArrayBuffer;
      updates: any;
    }[] = [];

    for (let tick = 1; tick <= totalTicks; tick++) {
      const tile1 = tick % (w * h);
      const tile2 = (tick * 7) % (w * h);

      const owner1 = (tick % 15) + 1;
      const owner2 = ((tick + 3) % 15) + 1;
      const fallout2 = tick % 2 === 0;

      const state1 = owner1;
      const state2 = owner2 | (fallout2 ? 1 << 13 : 0);

      const packedTileUpdates = new BigUint64Array([
        packTileUpdate(tile1, state1),
        packTileUpdate(tile2, state2),
      ]);

      const updates = createEmptyGameUpdates();
      const gu: GameUpdateViewData = {
        tick,
        packedTileUpdates,
        updates,
        playerNameViewData: {},
      };

      baseline.update(gu);
      byTickState.set(tick, baseline.exportCheckpoint().mapState);

      tickRecords.push({
        tick,
        packedTileUpdatesBuffer: packedTileUpdates.buffer.slice(0),
        updates,
      });

      if (tick % checkpointEvery === 0) {
        checkpoints.push({ tick, checkpoint: baseline.exportCheckpoint() });
      }
    }

    const nearestCheckpoint = (targetTick: number) => {
      let best = checkpoints[0]?.checkpoint ?? baseline.exportCheckpoint();
      for (const cp of checkpoints) {
        if (cp.tick <= targetTick && cp.tick >= best.tick) {
          best = cp.checkpoint;
        }
      }
      return best;
    };

    const targets = [1, 2, 7, 13, 19, 24, 30];
    for (const target of targets) {
      const view = createView(w, h);
      const cp = nearestCheckpoint(target);
      view.importCheckpoint(cp);

      for (const rec of tickRecords) {
        if (rec.tick <= cp.tick) continue;
        if (rec.tick > target) break;
        view.update({
          tick: rec.tick,
          packedTileUpdates: new BigUint64Array(rec.packedTileUpdatesBuffer),
          updates: rec.updates,
          playerNameViewData: {},
        });
      }

      const expected = byTickState.get(target);
      expect(expected).toBeDefined();
      expect(Array.from(view.exportCheckpoint().mapState)).toEqual(
        Array.from(expected!),
      );
    }
  });
});
