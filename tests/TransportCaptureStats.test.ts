import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import {
  BOAT_INDEX_CAPTURE,
  BOAT_INDEX_DESTROY,
  BOAT_INDEX_LOST,
} from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

let game: Game;
let captor: Player;
let victim: Player;

const captorInfo = new PlayerInfo(
  "captor",
  PlayerType.Human,
  "captor",
  "captor",
);
const victimInfo = new PlayerInfo(
  "victim",
  PlayerType.Human,
  "victim",
  "victim",
);

function transBoats(player: Player): readonly bigint[] | undefined {
  return game.stats().getPlayerStats(player)?.boats?.trans;
}

describe("TransportCaptureStats", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteTroops: true }, [
      captorInfo,
      victimInfo,
    ]);
    captor = game.player("captor");
    victim = game.player("victim");
    captor.conquer(game.ref(50, 50));
    victim.conquer(game.ref(50, 51));
  });

  test("credits the captor when a transport ship changes hands", () => {
    const transport = victim.buildUnit(
      UnitType.TransportShip,
      game.ref(60, 60),
      { troops: 100 },
    );

    captor.captureUnit(transport);

    expect(transBoats(captor)?.[BOAT_INDEX_CAPTURE]).toBe(1n);
    expect(transport.owner()).toBe(captor);
    // Only a disconnected teammate's fleet gets here, so it is a transfer
    // inside a team: not a destruction, and not a loss either.
    expect(transBoats(victim)?.[BOAT_INDEX_DESTROY] ?? 0n).toBe(0n);
    expect(transBoats(victim)?.[BOAT_INDEX_LOST] ?? 0n).toBe(0n);
  });

  test("does not count a captured trade ship as a transport", () => {
    // TradeShipExecution records the capture on delivery, so routing trade
    // ships through the same path would double-count piracy.
    const destinationPort = captor.buildUnit(
      UnitType.Port,
      game.ref(50, 50),
      {},
    );
    const tradeShip = victim.buildUnit(UnitType.TradeShip, game.ref(60, 60), {
      targetUnit: destinationPort,
    });

    captor.captureUnit(tradeShip);

    expect(transBoats(captor)?.[BOAT_INDEX_CAPTURE] ?? 0n).toBe(0n);
  });
});
