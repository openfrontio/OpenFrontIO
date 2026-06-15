import { maxInvaderNations } from "../src/core/execution/invasion/InvasionConfig";
import { InvasionExecution } from "../src/core/execution/invasion/InvasionExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import {
  ColoredTeams,
  Game,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";

const gameID: GameID = "invasion_test_game";

describe("Invasion Mode config", () => {
  test("getters default to disabled / zero grace", async () => {
    const game = await setup("half_land_half_ocean");
    expect(game.config().invasionMode()).toBe(false);
    expect(game.config().invasionGracePeriodTicks()).toBe(0);
  });

  test("grace period converts minutes to ticks (10 ticks/sec)", async () => {
    const game = await setup("half_land_half_ocean", {
      invasionMode: true,
      invasionGracePeriod: 3,
    });
    expect(game.config().invasionMode()).toBe(true);
    expect(game.config().invasionGracePeriodTicks()).toBe(3 * 60 * 10);
  });
});

describe("Invasion Mode waves", () => {
  test("launches an invader nation by sea from a water edge", async () => {
    const game = await setup("half_land_half_ocean", {
      invasionMode: true,
      invasionGracePeriod: 0,
    });
    game.addExecution(new InvasionExecution(gameID));

    // Transports land quickly on the tiny test map, so watch every tick.
    let sawInvaderTransport = false;
    for (let i = 0; i < 250; i++) {
      game.executeNextTick();
      for (const unit of game.units(UnitType.TransportShip)) {
        if (unit.owner().team() === ColoredTeams.Invaders) {
          sawInvaderTransport = true;
        }
      }
    }

    const invaders = game
      .players()
      .filter((p) => p.team() === ColoredTeams.Invaders);

    expect(invaders.length).toBeGreaterThan(0);
    expect(sawInvaderTransport).toBe(true);

    const invader = invaders[0];
    expect(invader.type()).toBe(PlayerType.Nation);
    expect(invader.name().startsWith("Invader")).toBe(true);

    // At least one invader has made landfall and now holds territory.
    expect(invaders.some((p) => p.isAlive() && p.numTilesOwned() > 0)).toBe(
      true,
    );
  });

  test("respects the grace period before sending any waves", async () => {
    const game = await setup("half_land_half_ocean", {
      invasionMode: true,
      invasionGracePeriod: 1, // 600 ticks
    });
    game.addExecution(new InvasionExecution(gameID));

    for (let i = 0; i < 100; i++) game.executeNextTick();

    const invaders = game
      .players()
      .filter((p) => p.team() === ColoredTeams.Invaders);
    expect(invaders.length).toBe(0);
  });

  test("never exceeds the difficulty cap of concurrent invader nations", async () => {
    const difficulty = "Impossible";
    const game = await setup("ocean_and_land", {
      invasionMode: true,
      invasionGracePeriod: 0,
      difficulty: difficulty as never,
    });
    game.addExecution(new InvasionExecution(gameID));

    const cap = maxInvaderNations(difficulty as never);
    let maxConcurrent = 0;
    let sawWarship = false;
    for (let i = 0; i < 1600; i++) {
      game.executeNextTick();
      if (game.units(UnitType.Warship).length > 0) sawWarship = true;
      const live = game
        .players()
        .filter(
          (p) =>
            p.team() === ColoredTeams.Invaders &&
            (p.isAlive() || p.unitCount(UnitType.TransportShip) > 0),
        ).length;
      maxConcurrent = Math.max(maxConcurrent, live);
    }

    expect(maxConcurrent).toBeGreaterThan(0);
    expect(maxConcurrent).toBeLessThanOrEqual(cap);
    // Escorts arrive once the invasion passes minute 2.
    expect(sawWarship).toBe(true);
  });
});

describe("Invasion Mode faction", () => {
  test("invaders cannot form alliances with anyone", async () => {
    const game = await setup("half_land_half_ocean");
    const humanInfo = new PlayerInfo("human", PlayerType.Human, null, "human");
    game.addPlayer(humanInfo);
    const invaderInfo = new PlayerInfo(
      "Invader 1",
      PlayerType.Nation,
      null,
      "invader",
    );
    game.addPlayer(invaderInfo, ColoredTeams.Invaders);

    const human = game.player("human");
    const invader = game.player("invader");

    expect(invader.team()).toBe(ColoredTeams.Invaders);
    expect(human.canSendAllianceRequest(invader)).toBe(false);
    expect(invader.canSendAllianceRequest(human)).toBe(false);
  });

  // Locks the assumption InvasionExecution.launchBomb relies on: a missile silo
  // built directly via buildUnit is immediately usable, so a (normally silo-less)
  // invader can be funded and fire a scheduled strike.
  test("an invader can build a silo and launch a strike", async () => {
    const game = await setup("half_land_half_ocean");
    const invaderInfo = new PlayerInfo(
      "Invader 1",
      PlayerType.Nation,
      null,
      "invader",
    );
    game.addPlayer(invaderInfo, ColoredTeams.Invaders);
    const victimInfo = new PlayerInfo("victim", PlayerType.Human, null, "vic");
    game.addPlayer(victimInfo);
    const invader = game.player("invader");
    const victim = game.player("vic");

    const land: number[] = [];
    for (let x = 2; x < 14; x++) {
      for (let y = 2; y < 14; y++) {
        const r = game.ref(x, y);
        if (game.isLand(r)) land.push(r);
      }
    }
    invader.conquer(land[0]);
    for (let i = 1; i < 6; i++) victim.conquer(land[i]);

    // Mirror launchBomb: free instant silo, fund the warhead, fire.
    invader.buildUnit(UnitType.MissileSilo, land[0], {});
    invader.addGold(game.unitInfo(UnitType.AtomBomb).cost(game, invader));
    game.addExecution(new NukeExecution(UnitType.AtomBomb, invader, land[3]));

    const tilesBefore = victim.numTilesOwned();
    let sawAtomBomb = false;
    for (let i = 0; i < 120; i++) {
      game.executeNextTick();
      if (game.units(UnitType.AtomBomb).length > 0) sawAtomBomb = true;
    }

    expect(sawAtomBomb).toBe(true);
    expect(victim.numTilesOwned()).toBeLessThan(tilesBefore);
  });
});

describe("Invasion Mode is inert when disabled", () => {
  test("no invaders appear without the execution", async () => {
    const game: Game = await setup("half_land_half_ocean");
    for (let i = 0; i < 250; i++) game.executeNextTick();
    const invaders = game
      .players()
      .filter((p) => p.team() === ColoredTeams.Invaders);
    expect(invaders.length).toBe(0);
    expect(game.units(UnitType.TransportShip).length).toBe(0);
  });
});
