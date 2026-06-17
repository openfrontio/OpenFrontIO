import { MAX_INVADER_NATIONS } from "../src/core/execution/invasion/InvasionConfig";
import { InvasionExecution } from "../src/core/execution/invasion/InvasionExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { WinCheckExecution } from "../src/core/execution/WinCheckExecution";
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

  test("never exceeds the cap of concurrent invader nations and escorts arrive", async () => {
    const game = await setup("ocean_and_land", {
      invasionMode: true,
      invasionGracePeriod: 0,
    });
    game.addExecution(new InvasionExecution(gameID));

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
    expect(maxConcurrent).toBeLessThanOrEqual(MAX_INVADER_NATIONS);
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

  // The core of the new "missiles from the ocean" mechanic: a landless invader
  // (owns no tiles, no silo, not even "alive") can still fire a nuke straight
  // from an open-water spawn tile via NukeExecution's forced-src launch.
  test("a landless invader launches a nuke from open water", async () => {
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
    let water = -1;
    for (let x = 0; x < game.width(); x++) {
      for (let y = 0; y < game.height(); y++) {
        const r = game.ref(x, y);
        if (game.isLand(r)) land.push(r);
        else if (game.isWater(r) && water < 0) water = r;
      }
    }
    expect(water).toBeGreaterThanOrEqual(0);
    expect(land.length).toBeGreaterThan(10);
    for (let i = 0; i < 10; i++) victim.conquer(land[i]);

    // The invader holds no territory — the normal canBuild path would refuse.
    expect(invader.isAlive()).toBe(false);

    invader.addGold(game.unitInfo(UnitType.AtomBomb).cost(game, invader));
    game.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        invader,
        land[5], // target a victim tile
        water, // launch from open water
        -1,
        0,
        true,
        true, // forceSrc
      ),
    );

    const tilesBefore = victim.numTilesOwned();
    let sawAtomBomb = false;
    let bombStartedFromWater = false;
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      for (const bomb of game.units(UnitType.AtomBomb)) {
        sawAtomBomb = true;
        if (game.isWater(bomb.tile())) bombStartedFromWater = true;
      }
    }

    expect(sawAtomBomb).toBe(true);
    expect(bombStartedFromWater).toBe(true);
    expect(victim.numTilesOwned()).toBeLessThan(tilesBefore);
  });
});

describe("Invasion Mode win conditions", () => {
  test("no player can win while the invader horde remains", async () => {
    const game = await setup("half_land_half_ocean", {
      invasionMode: true,
      maxTimerValue: 1, // game-length win condition fires after 60s
    });
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

    const land: number[] = [];
    for (let x = 0; x < game.width(); x++) {
      for (let y = 0; y < game.height(); y++) {
        const r = game.ref(x, y);
        if (game.isLand(r)) land.push(r);
      }
    }
    expect(land.length).toBeGreaterThan(1);
    // Human dominates the map; a single invader tile keeps the horde "alive".
    for (let i = 1; i < land.length; i++) human.conquer(land[i]);
    invader.conquer(land[0]);

    game.addExecution(new WinCheckExecution());

    // Run well past the 60s game-length condition.
    for (let i = 0; i < 700; i++) game.executeNextTick();

    expect(human.isAlive()).toBe(true);
    expect(invader.isAlive()).toBe(true);
    // The "You Won" path never triggers: an opposing (invader) player remains.
    expect(game.getWinner()).toBeNull();
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
