import { NukeExecution } from "../src/core/execution/NukeExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { BOAT_INDEX_DESTROY, BOAT_INDEX_LOST } from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";
import { constructionExecution } from "./util/utils";

let game: Game;
let owner: Player;
let enemy: Player;

const ownerInfo = new PlayerInfo("owner", PlayerType.Human, "owner", "owner");
const enemyInfo = new PlayerInfo("enemy", PlayerType.Human, "enemy", "enemy");

function boats(
  player: Player,
  type: "trade" | "trans",
): readonly bigint[] | undefined {
  return game.stats().getPlayerStats(player)?.boats?.[type];
}

describe("BoatLossStats", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      { infiniteTroops: true, infiniteGold: true, instantBuild: true },
      [ownerInfo, enemyInfo],
    );
    owner = game.player("owner");
    enemy = game.player("enemy");
    owner.conquer(game.ref(50, 50));
    enemy.conquer(game.ref(10, 10));
  });

  test("an enemy shell charges the owner a transport and credits the kill", () => {
    const transport = owner.buildUnit(
      UnitType.TransportShip,
      game.ref(60, 60),
      {
        troops: 100,
      },
    );

    transport.modifyHealth(-transport.maxHealth(), enemy);

    expect(transport.isActive()).toBe(false);
    expect(boats(owner, "trans")?.[BOAT_INDEX_LOST]).toBe(1n);
    expect(boats(enemy, "trans")?.[BOAT_INDEX_DESTROY]).toBe(1n);
    expect(boats(owner, "trans")?.[BOAT_INDEX_DESTROY] ?? 0n).toBe(0n);
  });

  test("an enemy shell charges the owner a trade ship", () => {
    const port = enemy.buildUnit(UnitType.Port, game.ref(10, 10), {});
    const tradeShip = owner.buildUnit(UnitType.TradeShip, game.ref(60, 60), {
      targetUnit: port,
    });

    tradeShip.modifyHealth(-tradeShip.maxHealth(), enemy);

    expect(boats(owner, "trade")?.[BOAT_INDEX_LOST]).toBe(1n);
    expect(boats(enemy, "trade")?.[BOAT_INDEX_DESTROY]).toBe(1n);
  });

  test("the owner's own nuke still costs them the transport, with no kill credit", () => {
    constructionExecution(game, owner, 50, 50, UnitType.MissileSilo);
    const target = game.ref(52, 52);
    const transport = owner.buildUnit(UnitType.TransportShip, target, {
      troops: 100,
    });

    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, owner, target, null),
    );
    for (let i = 0; i < 60 && transport.isActive(); i++) {
      game.executeNextTick();
    }

    expect(transport.isActive()).toBe(false);
    expect(boats(owner, "trans")?.[BOAT_INDEX_LOST]).toBe(1n);
    // Friendly fire deliberately passes no destroyer (NukeExecution), so
    // nobody scores the kill -- but the boat is still gone.
    expect(boats(owner, "trans")?.[BOAT_INDEX_DESTROY] ?? 0n).toBe(0n);
  });

  test("being eliminated charges the owner every boat still afloat", () => {
    const port = enemy.buildUnit(UnitType.Port, game.ref(10, 10), {});
    owner.buildUnit(UnitType.TransportShip, game.ref(60, 60), { troops: 100 });
    owner.buildUnit(UnitType.TradeShip, game.ref(61, 61), { targetUnit: port });
    owner.relinquish(game.ref(50, 50));
    expect(owner.isAlive()).toBe(false);

    game.addExecution(new PlayerExecution(owner));
    game.executeNextTick();
    game.executeNextTick();

    expect(boats(owner, "trans")?.[BOAT_INDEX_LOST]).toBe(1n);
    expect(boats(owner, "trade")?.[BOAT_INDEX_LOST]).toBe(1n);
  });

  test("a boat that is retired rather than destroyed costs nothing", () => {
    const transport = owner.buildUnit(
      UnitType.TransportShip,
      game.ref(60, 60),
      {
        troops: 100,
      },
    );

    // The arrival, retreat and voluntary-delete paths all retire a boat with
    // delete(false); only a destruction may charge the owner.
    transport.delete(false);

    expect(boats(owner, "trans")?.[BOAT_INDEX_LOST] ?? 0n).toBe(0n);
  });
});
