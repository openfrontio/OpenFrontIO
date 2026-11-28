import {
  MessageType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

describe("TransportShipExecution", () => {
  test("incoming naval invasion warning uses a translation key", async () => {
    const game = await setup("ocean_and_land", { infiniteGold: true }, [
      new PlayerInfo("attacker", PlayerType.Nation, null, "attacker_id"),
      new PlayerInfo("target", PlayerType.Nation, null, "target_id"),
    ]);
    const attacker = game.player("attacker_id");
    const target = game.player("target_id");
    let targetTile: number | undefined;

    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      if (game.x(tile) <= 7) {
        attacker.conquer(tile);
      } else if (game.x(tile) >= 14) {
        target.conquer(tile);
        targetTile ??= tile;
      }
    });
    attacker.setTroops(100_000);

    expect(targetTile).toBeDefined();
    const displayIncomingSpy = vi.spyOn(game, "displayIncomingUnit");
    game.addExecution(
      new TransportShipExecution(attacker, targetTile!, 10_000),
    );
    executeTicks(game, 2);

    expect(displayIncomingSpy).toHaveBeenCalledWith(
      expect.any(Number),
      "events_display.naval_invasion_inbound",
      MessageType.NAVAL_INVASION_INBOUND,
      target.id(),
    );
    expect(attacker.units(UnitType.TransportShip)).toHaveLength(1);
  });

  test("floors boat troops and rejects empty or sub-unit launches", async () => {
    const game = await setup("ocean_and_land", { infiniteGold: true }, [
      new PlayerInfo("attacker", PlayerType.Human, null, "attacker_id"),
      new PlayerInfo("target", PlayerType.Human, null, "target_id"),
    ]);
    const a = game.player("attacker_id");
    const b = game.player("target_id");
    let dst = 0;
    game.map().forEachTile((t) => {
      if (!game.map().isLand(t)) return;
      if (game.x(t) <= 7) a.conquer(t);
      else if (game.x(t) >= 14) {
        b.conquer(t);
        dst ||= t;
      }
    });
    a.setTroops(100);
    game.addExecution(new TransportShipExecution(a, dst, 0.9));
    executeTicks(game, 1);
    expect(a.units(UnitType.TransportShip)).toHaveLength(0);
    game.addExecution(new TransportShipExecution(a, dst, 10.9));
    executeTicks(game, 1);
    const [boat] = a.units(UnitType.TransportShip);
    expect(boat.troops()).toBe(10);
  });
});
