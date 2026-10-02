import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { DeleteRailroadIntentSchema } from "@openfront/engine-api/Schemas";
import { DeleteRailroadExecution } from "@openfront/engine/execution/DeleteRailroadExecution";
import { DeleteUnitExecution } from "@openfront/engine/execution/DeleteUnitExecution";
import { FactoryExecution } from "@openfront/engine/execution/FactoryExecution";
import { TrainExecution } from "@openfront/engine/execution/TrainExecution";
import { describe, expect, it, vi } from "vitest";
import { playerInfo, setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

async function fixture() {
  const game = await setup("plains", {
    infiniteGold: true,
    instantBuild: true,
    infiniteTroops: true,
  });
  const info = playerInfo("RailOwner", PlayerType.Human),
    other = playerInfo("Other", PlayerType.Human);
  game.addPlayer(info);
  game.addPlayer(other);
  const player = game.player(info.id),
    enemy = game.player(other.id);
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 100; x++) player.conquer(game.ref(x, y));
  const a = player.buildUnit(UnitType.Factory, game.ref(20, 20), {}),
    b = player.buildUnit(UnitType.City, game.ref(50, 20), {}),
    c = player.buildUnit(UnitType.City, game.ref(80, 20), {});
  game.addExecution(new FactoryExecution(a));
  executeTicks(game, 6);
  const network = game.railNetwork(),
    sa = network.stationManager().findStation(a)!,
    sb = network.stationManager().findStation(b)!,
    sc = network.stationManager().findStation(c)!;
  const rail = sa.getRailroadTo(sb)!;
  expect(rail).not.toBeNull();
  expect(sb.getRailroadTo(sc)).not.toBeNull();
  const tile = rail.tiles[Math.floor(rail.tiles.length / 2)];
  return { game, player, enemy, a, b, c, sa, sb, sc, rail, tile, network };
}

describe("instant railway deletion", () => {
  it("removes only the chosen building-to-building connection without demolition delay or cooldown", async () => {
    const f = await fixture();
    const { game, player, rail, tile, network, sa, sb, sc, a, b, c } = f;
    player.recordDeleteUnit();
    expect(player.canDeleteUnit()).toBe(false);
    const record = vi.spyOn(player, "recordDeleteUnit");
    const action = new DeleteRailroadExecution(player, rail.id, tile);
    action.init(game);
    expect(action.isActive()).toBe(false);
    expect(sa.getRailroadTo(sb)).toBeNull();
    expect(sb.getRailroadTo(sc)).not.toBeNull();
    expect(a.isActive() && b.isActive() && c.isActive()).toBe(true);
    expect(a.isMarkedForDeletion()).toBe(false);
    expect(record).not.toHaveBeenCalled();
    expect(player.canDeleteUnit()).toBe(false);
    expect(network.deletableRailroads(player, tile)).toEqual([]);
    expect(network.findStationsPath(sa, sc)).toEqual([]);
    expect(network.findStationsPath(sb, sc).length).toBe(2);
    expect(network.removeRailroad(player, rail.id, tile)).toBe(false);
    executeTicks(game, 25);
    expect(sa.getRailroadTo(sb)).toBeNull();
  });
  it("requires both endpoint buildings to remain owned when the action executes", async () => {
    for (const endpoint of ["a", "b"] as const) {
      const f = await fixture();
      expect(f.network.deletableRailroads(f.player, f.tile)).toHaveLength(1);
      f.enemy.captureUnit(f[endpoint]);
      new DeleteRailroadExecution(f.player, f.rail.id, f.tile).init(f.game);
      expect(f.sa.getRailroadTo(f.sb)).toBe(f.rail);
      expect(f.network.deletableRailroads(f.player, f.tile)).toEqual([]);
      expect(f.network.removeRailroad(f.enemy, f.rail.id, f.tile)).toBe(false);
    }
  });
  it("uses endpoint ownership even when the middle tile belongs to another player", async () => {
    const f = await fixture();
    f.enemy.conquer(f.tile);
    expect(f.network.deletableRailroads(f.player, f.tile)).toHaveLength(1);
    expect(f.network.removeRailroad(f.player, f.rail.id, f.tile)).toBe(true);
    expect(f.sa.getRailroadTo(f.sb)).toBeNull();
  });
  it("stops a train on a deleted stretch", async () => {
    const { game, player, network, sa, sc, rail, tile } = await fixture();
    const train = new TrainExecution(network, player, sa, sc, 1);
    train.init(game, game.ticks());
    expect(train.isActive()).toBe(true);
    expect(player.units(UnitType.Train).length).toBeGreaterThan(0);
    new DeleteRailroadExecution(player, rail.id, tile).init(game);
    train.tick(game.ticks() + 1);
    expect(train.isActive()).toBe(false);
    expect(player.units(UnitType.Train).length).toBe(0);
  });
  it("rejects enemy actors, distant clicks, missing IDs, invalid tiles and spawn-phase actions", async () => {
    const { game, player, enemy, network, rail, tile, sa, sb } =
      await fixture();
    expect(network.removeRailroad(enemy, rail.id, tile)).toBe(false);
    expect(network.removeRailroad(player, rail.id, game.ref(0, 99))).toBe(
      false,
    );
    expect(network.removeRailroad(player, 999999, tile)).toBe(false);
    expect(network.removeRailroad(player, rail.id, 999999999)).toBe(false);
    const original = game.inSpawnPhase;
    game.inSpawnPhase = () => true;
    expect(network.removeRailroad(player, rail.id, tile)).toBe(false);
    game.inSpawnPhase = original;
    expect(sa.getRailroadTo(sb)).toBe(rail);
  });
  it("keeps normal building deletion delayed and validates railway intent IDs", async () => {
    const { game, player, a } = await fixture();
    game.config().deleteUnitCooldown = () => 0;
    const action = new DeleteUnitExecution(player, a.id());
    action.init(game, game.ticks());
    expect(a.isMarkedForDeletion()).toBe(true);
    expect(a.isActive()).toBe(true);
    expect(
      DeleteRailroadIntentSchema.safeParse({
        type: "delete_railroad",
        railroadId: -1,
        tile: 0,
      }).success,
    ).toBe(false);
  });
});
