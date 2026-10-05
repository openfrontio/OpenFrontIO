import {
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";

describe("UnitImpl", () => {
  let game: Game;
  let owner: Player;

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [new PlayerInfo("owner", PlayerType.Human, null, "owner")],
    );
    owner = game.player("owner");
    game.displayMessage = vi.fn();
  });

  test.each([
    [UnitType.TransportShip, "unit_type.boat"],
    [UnitType.Warship, "unit_type.warship"],
  ])("sends the translation key when a %s is destroyed", (type, unit) => {
    const ship = owner.buildUnit(type, game.ref(8, 10), {});

    ship.delete();

    expect(game.displayMessage).toHaveBeenCalledWith(
      "events_display.unit_destroyed",
      MessageType.UNIT_DESTROYED,
      owner.id(),
      undefined,
      { unit },
      ship.id(),
    );
  });
});
