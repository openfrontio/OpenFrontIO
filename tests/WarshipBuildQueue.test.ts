import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { PortExecution } from "../src/core/execution/PortExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;
let game: Game;
let player: Player;
let buildTicks: number;

function buildPort(tile: TileRef): Unit {
  const port = player.buildUnit(UnitType.Port, tile, {});
  game.addExecution(new PortExecution(port));
  return port;
}

function orderWarship(target: TileRef): void {
  game.addExecution(
    new ConstructionExecution(player, UnitType.Warship, target),
  );
}

// An execution is init'd at the end of the tick it was added and first ticks
// on the next one, so an order lands in the port queue two ticks later.
const ORDER_TICKS = 2;

describe("Warship build queue", () => {
  beforeEach(async () => {
    game = await setup("half_land_half_ocean", { instantBuild: false }, [
      new PlayerInfo("boat dude", PlayerType.Human, null, "player_1_id"),
    ]);
    player = game.player("player_1_id");
    player.conquer(game.ref(coastX, 10));
    player.addGold(100_000_000n);
    buildTicks = game.config().unitInfo(UnitType.Warship).constructionDuration!;
    expect(buildTicks).toBeGreaterThan(0);
    executeTicks(game, 1);
  });

  test("warship is charged on order and spawns after the build time", () => {
    const port = buildPort(game.ref(coastX, 10));
    const goldBefore = player.gold();
    const cost = game.config().unitInfo(UnitType.Warship).cost(game, player);

    orderWarship(game.ref(coastX + 3, 10));
    executeTicks(game, ORDER_TICKS);

    expect(player.gold()).toBe(goldBefore - cost);
    expect(port.warshipQueue().length).toBe(1);
    expect(player.units(UnitType.Warship)).toHaveLength(0);

    executeTicks(game, buildTicks - 1);
    expect(player.units(UnitType.Warship)).toHaveLength(0);

    executeTicks(game, 1);
    const ships = player.units(UnitType.Warship);
    expect(ships).toHaveLength(1);
    expect(ships[0].warshipState().patrolTile).toBe(game.ref(coastX + 3, 10));
    expect(port.warshipQueue().length).toBe(0);
    // No second charge when the queued ship spawns.
    expect(player.gold()).toBe(goldBefore - cost);
  });

  test("a port builds queued warships one at a time", () => {
    const port = buildPort(game.ref(coastX, 10));
    orderWarship(game.ref(coastX + 3, 10));
    orderWarship(game.ref(coastX + 3, 11));
    executeTicks(game, ORDER_TICKS);
    expect(port.warshipQueue().length).toBe(2);

    executeTicks(game, buildTicks);
    expect(player.units(UnitType.Warship)).toHaveLength(1);
    expect(port.warshipQueue().length).toBe(1);

    executeTicks(game, buildTicks);
    expect(player.units(UnitType.Warship)).toHaveLength(2);
    expect(port.warshipQueue().length).toBe(0);
  });

  test("queued warships raise the price of the next one", () => {
    buildPort(game.ref(coastX, 10));
    const first = game.config().unitInfo(UnitType.Warship).cost(game, player);
    orderWarship(game.ref(coastX + 3, 10));
    executeTicks(game, ORDER_TICKS);
    const second = game.config().unitInfo(UnitType.Warship).cost(game, player);
    expect(second).toBeGreaterThan(first);
  });

  test("a farther idle port is chosen over a nearer backed-up port", () => {
    const near = buildPort(game.ref(coastX, 2));
    const far = buildPort(game.ref(coastX, 14));
    const target = game.ref(coastX + 2, 3);

    expect(player.canBuild(UnitType.Warship, target)).toBe(near.tile());

    // One ship occupies the near port for a full build; the far port's extra
    // travel (~12 tiles) is shorter than that wait, so it wins the next order.
    orderWarship(target);
    executeTicks(game, ORDER_TICKS);
    expect(near.warshipQueue().length).toBe(1);
    expect(player.canBuild(UnitType.Warship, target)).toBe(far.tile());

    orderWarship(target);
    executeTicks(game, ORDER_TICKS);
    expect(near.warshipQueue().length).toBe(1);
    expect(far.warshipQueue().length).toBe(1);

    // Once the near port is nearly done, it is the better choice again.
    executeTicks(game, buildTicks - 5);
    expect(near.warshipQueue().length).toBe(1);
    expect(player.canBuild(UnitType.Warship, target)).toBe(near.tile());
  });

  test("losing the port loses the queued warships without refund", () => {
    const port = buildPort(game.ref(coastX, 10));
    orderWarship(game.ref(coastX + 3, 10));
    executeTicks(game, ORDER_TICKS);
    const goldAfterOrder = player.gold();

    port.delete();
    executeTicks(game, buildTicks + 1);

    expect(player.units(UnitType.Warship)).toHaveLength(0);
    expect(player.gold()).toBe(goldAfterOrder);
  });
});
