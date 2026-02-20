import { describe, expect, it } from "vitest";
import type { Config } from "../src/core/configuration/Config";
import { UnitType } from "../src/core/game/Game";
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

function createMinimalGameView(): GameView {
  const w = 4;
  const h = 3;
  const terrain = new Uint8Array(w * h).fill(1 << 7); // land
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

describe("GameView checkpoints", () => {
  it("roundtrips a checkpoint (map, units, railroads, toDelete)", () => {
    const view1 = createMinimalGameView();

    const tileA = view1.ref(0, 0);
    const tileB = view1.ref(1, 0);
    const ownerA = 7;
    const hasFallout = true;
    const defenseBonus = true;

    const stateA = ownerA;
    const stateB =
      3 /* owner */ | (hasFallout ? 1 << 13 : 0) | (defenseBonus ? 1 << 14 : 0);

    const packedTileUpdates = new BigUint64Array([
      (BigInt(tileA) << 16n) | BigInt(stateA),
      (BigInt(tileB) << 16n) | BigInt(stateB),
    ]);

    const updates = createEmptyGameUpdates();
    updates[GameUpdateType.Unit].push({
      type: GameUpdateType.Unit,
      unitType: UnitType.City,
      troops: 10,
      id: 42,
      ownerID: 1,
      pos: tileA,
      lastPos: tileA,
      isActive: false,
      reachedTarget: false,
      retreating: false,
      targetable: false,
      markedForDeletion: false,
      missileTimerQueue: [],
      level: 1,
      hasTrainStation: false,
    });
    updates[GameUpdateType.RailroadConstructionEvent].push({
      type: GameUpdateType.RailroadConstructionEvent,
      id: 99,
      tiles: [tileA, tileB],
    });

    const gu: GameUpdateViewData = {
      tick: 1,
      packedTileUpdates,
      updates,
      playerNameViewData: {},
    };

    view1.update(gu);
    const cp1 = view1.exportCheckpoint();

    const view2 = createMinimalGameView();
    view2.importCheckpoint(cp1);
    const cp2 = view2.exportCheckpoint();

    expect(view2.ticks()).toBe(1);
    expect(view2.ownerID(tileA)).toBe(ownerA);
    expect(view2.hasFallout(tileB)).toBe(true);
    expect(((cp2.mapState[tileB] >> 14) & 1) === 1).toBe(true);

    expect(cp2.toDeleteUnitIds).toEqual(cp1.toDeleteUnitIds);
    expect(cp2.railroads).toEqual(cp1.railroads);
    expect(Array.from(cp2.mapState)).toEqual(Array.from(cp1.mapState));
    expect(cp2.numTilesWithFallout).toBe(cp1.numTilesWithFallout);

    const unit = view2.unit(42);
    expect(unit).toBeDefined();
    expect(unit?.isActive()).toBe(false);
  });
});
