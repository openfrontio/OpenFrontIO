import { ConstructionExecution } from "../../../src/core/execution/ConstructionExecution";
import { MissileSiloExecution } from "../../../src/core/execution/MissileSiloExecution";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import {
  Game,
  MessageType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;
let otherPlayer: Player;

describe("NukeExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id"),
        new PlayerInfo("other", PlayerType.Human, "client_id2", "other_id"),
      ],
    );

    (game.config() as TestConfig).nukeMagnitudes = vi.fn(() => ({
      inner: 10,
      outer: 10,
    }));
    (game.config() as TestConfig).nukeAllianceBreakThreshold = vi.fn(() => 5);

    player = game.player("player_id");
    otherPlayer = game.player("other_id");

    player.conquer(game.ref(1, 1));
  });

  test("nuke should destroy buildings and redraw out of range buildings", async () => {
    // Build a city at (1,1)
    player.buildUnit(UnitType.City, game.ref(1, 1), {});
    // Build a missile silo in range
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 10), {});
    // Build a SAM out of range
    const sam = player.buildUnit(UnitType.SAMLauncher, game.ref(1, 11), {});
    sam.touch = vi.fn();
    // Build a Defense post out of range AND out of redraw range
    const defensePost = player.buildUnit(
      UnitType.DefensePost,
      game.ref(1, 27),
      {},
    );
    defensePost.touch = vi.fn();
    // Add a nuke execution targeting the city
    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(1, 1),
      game.ref(1, 2),
    );
    game.addExecution(nukeExec);
    // Run enough ticks for the nuke to detonate
    executeTicks(game, 10);
    // The city and silo should be destroyed
    expect(player.units(UnitType.City)).toHaveLength(0);
    expect(player.units(UnitType.MissileSilo)).toHaveLength(0);
    expect(player.units(UnitType.SAMLauncher)).toHaveLength(1);
    expect(sam.touch).toHaveBeenCalled();
    expect(defensePost.touch).not.toHaveBeenCalled();
  });

  test("nuke should only be targetable near src and dst", async () => {
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});
    const nukeExec = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(199, 199),
      game.ref(1, 1),
    );
    game.addExecution(nukeExec);
    // targetable distance is 400

    //near launch should be targetable (distance src < 400)
    executeTicks(game, 2);
    expect(nukeExec.getNuke()!.isTargetable()).toBeTruthy();

    //mid air should not be targetable (distance src > 400, distance target > 400)
    executeTicks(game, 38);
    expect(nukeExec.getNuke()!.isTargetable()).toBeFalsy();

    //near target should be targetable (distance target < 400)
    executeTicks(game, 35);
    expect(nukeExec.getNuke()!.isTargetable()).toBeTruthy();
  });

  test("nuke should break alliances on launch", async () => {
    const req = player.createAllianceRequest(otherPlayer);
    req!.accept();

    player.conquer(game.ref(1, 1));
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});

    for (let x = 90; x < 99; x++) {
      for (let y = 90; y < 99; y++) {
        otherPlayer.conquer(game.ref(x, y));
      }
    }

    // Add a nuke targeting just outside the other player's territory.
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player, game.ref(85, 85), null),
    );

    game.executeNextTick(); // init
    game.executeNextTick(); // exec

    expect(player.isTraitor()).toBe(true);
    expect(player.isAlliedWith(otherPlayer)).toBe(false);
  });

  test("AtomBomb detonation emits NUKE_DETONATED to each impacted player", () => {
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});
    // Give otherPlayer a cluster around (50,50) so the blast intersects them.
    for (let x = 48; x < 53; x++) {
      for (let y = 48; y < 53; y++) {
        otherPlayer.conquer(game.ref(x, y));
      }
    }

    const displayMessageSpy = vi.spyOn(game, "displayMessage");

    game.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        player,
        game.ref(50, 50),
        game.ref(1, 1),
      ),
    );
    executeTicks(game, 200);

    const detonatedCalls = displayMessageSpy.mock.calls.filter(
      (call) => call[1] === MessageType.NUKE_DETONATED,
    );
    expect(detonatedCalls.length).toBeGreaterThan(0);
    const otherCall = detonatedCalls.find(
      (call) => call[2] === otherPlayer.id(),
    );
    expect(otherCall).toBeDefined();
    expect(otherCall![0]).toBe("events_display.atom_bomb_detonated");
    // focusPlayerID (7th positional) is the launcher
    expect(otherCall![6]).toBe(player.id());

    displayMessageSpy.mockRestore();
  });

  test("HydrogenBomb detonation emits NUKE_DETONATED with hydrogen_bomb key", () => {
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});
    for (let x = 48; x < 53; x++) {
      for (let y = 48; y < 53; y++) {
        otherPlayer.conquer(game.ref(x, y));
      }
    }

    const displayMessageSpy = vi.spyOn(game, "displayMessage");

    game.addExecution(
      new NukeExecution(
        UnitType.HydrogenBomb,
        player,
        game.ref(50, 50),
        game.ref(1, 1),
      ),
    );
    executeTicks(game, 300);

    const detonatedCalls = displayMessageSpy.mock.calls.filter(
      (call) => call[1] === MessageType.NUKE_DETONATED,
    );
    expect(detonatedCalls.length).toBeGreaterThan(0);
    expect(detonatedCalls[0][0]).toBe("events_display.hydrogen_bomb_detonated");

    displayMessageSpy.mockRestore();
  });

  test("MIRVWarhead detonation does NOT emit NUKE_DETONATED", () => {
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});
    for (let x = 48; x < 53; x++) {
      for (let y = 48; y < 53; y++) {
        otherPlayer.conquer(game.ref(x, y));
      }
    }

    const displayMessageSpy = vi.spyOn(game, "displayMessage");

    game.addExecution(
      new NukeExecution(
        UnitType.MIRVWarhead,
        player,
        game.ref(50, 50),
        game.ref(1, 1),
      ),
    );
    executeTicks(game, 200);

    const detonatedCalls = displayMessageSpy.mock.calls.filter(
      (call) => call[1] === MessageType.NUKE_DETONATED,
    );
    expect(detonatedCalls).toHaveLength(0);

    displayMessageSpy.mockRestore();
  });

  test("nuke should break alliance when destroying ally's building even with few tiles", async () => {
    const req = player.createAllianceRequest(otherPlayer);
    req!.accept();

    expect(player.isAlliedWith(otherPlayer)).toBe(true);

    player.conquer(game.ref(1, 1));
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});

    // Give the other player just a few tiles (below the threshold of 5)
    // and build a port on one of them
    otherPlayer.conquer(game.ref(50, 50));
    otherPlayer.conquer(game.ref(51, 50));
    otherPlayer.conquer(game.ref(50, 51));
    otherPlayer.buildUnit(UnitType.Port, game.ref(50, 50), {});

    expect(otherPlayer.units(UnitType.Port)).toHaveLength(1);

    // Nuke targeting the ally's port - this should break alliance
    // even though the tile count is below threshold
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, player, game.ref(50, 50), null),
    );

    game.executeNextTick(); // init
    game.executeNextTick(); // exec

    // Alliance should be broken because we're destroying ally's building
    expect(player.isTraitor()).toBe(true);
    expect(player.isAlliedWith(otherPlayer)).toBe(false);
  });

  test("drainNukeImpacts returns all queued tiles after detonation and empty on subsequent drain", () => {
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});

    // No nukes yet — drain should be empty.
    expect(game.drainNukeImpacts()).toHaveLength(0);

    game.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        player,
        game.ref(50, 50),
        game.ref(1, 1),
      ),
    );
    executeTicks(game, 200);

    // After detonation, drainNukeImpacts should return all blast-radius tiles.
    const impacts = game.drainNukeImpacts();
    expect(impacts.length).toBeGreaterThan(0);

    // The target tile (50,50) must be among the impacted tiles.
    const targetRef = game.ref(50, 50);
    expect(impacts).toContain(targetRef);

    // With inner=outer=10 the blast is a filled circle of radius 10.
    // pi*10^2 ~= 314 tiles; require at least 200 (conservative lower bound
    // accounting for impassable terrain and map edges).
    expect(impacts.length).toBeGreaterThanOrEqual(200);

    // Every returned tile ref should be a valid number.
    for (const ref of impacts) {
      expect(typeof ref).toBe("number");
      expect(ref).toBeGreaterThanOrEqual(0);
    }

    // A second drain should be empty (queue was consumed).
    expect(game.drainNukeImpacts()).toHaveLength(0);
  });

  test("drainNukeImpacts returns queued tiles for HydrogenBomb detonation", () => {
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});

    expect(game.drainNukeImpacts()).toHaveLength(0);

    game.addExecution(
      new NukeExecution(
        UnitType.HydrogenBomb,
        player,
        game.ref(50, 50),
        game.ref(1, 1),
      ),
    );
    executeTicks(game, 300);

    const impacts = game.drainNukeImpacts();
    expect(impacts.length).toBeGreaterThan(0);

    // Target tile must be present.
    expect(impacts).toContain(game.ref(50, 50));

    // HydrogenBomb has a larger blast radius than AtomBomb.
    expect(impacts.length).toBeGreaterThanOrEqual(200);

    for (const ref of impacts) {
      expect(typeof ref).toBe("number");
      expect(ref).toBeGreaterThanOrEqual(0);
    }

    expect(game.drainNukeImpacts()).toHaveLength(0);
  });

  test("drainNukeImpacts returns queued tiles for water nukes", async () => {
    const waterGame = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true, waterNukes: true },
      [new PlayerInfo("player", PlayerType.Human, "client_id1", "player_id")],
    );
    (waterGame.config() as TestConfig).nukeMagnitudes = vi.fn(() => ({
      inner: 10,
      outer: 10,
    }));

    const waterPlayer = waterGame.player("player_id");
    waterPlayer.conquer(waterGame.ref(1, 1));
    waterPlayer.buildUnit(UnitType.MissileSilo, waterGame.ref(1, 1), {});

    expect(waterGame.drainNukeImpacts()).toHaveLength(0);

    waterGame.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        waterPlayer,
        waterGame.ref(50, 50),
        waterGame.ref(1, 1),
      ),
    );
    executeTicks(waterGame, 200);

    const impacts = waterGame.drainNukeImpacts();
    expect(impacts.length).toBeGreaterThan(0);

    // Target tile must be present.
    expect(impacts).toContain(waterGame.ref(50, 50));

    // A tile on the blast boundary (distance exactly 10 from center).
    expect(impacts).toContain(waterGame.ref(40, 50));

    // With inner=outer=10 the blast is a filled circle of radius 10.
    // pi*10^2 ~= 314 tiles; require at least 200 (conservative lower bound
    // accounting for impassable terrain and map edges).
    expect(impacts.length).toBeGreaterThanOrEqual(200);

    for (const ref of impacts) {
      expect(typeof ref).toBe("number");
      expect(ref).toBeGreaterThanOrEqual(0);
    }

    expect(waterGame.drainNukeImpacts()).toHaveLength(0);
  });

  test("stacked atom bombs launch staggered and fly on distinct tiles", () => {
    const silo = player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});
    // A silo holds `level` concurrent missiles; raise to 3 so the whole stack launches.
    silo.increaseLevel();
    silo.increaseLevel();
    // Each added level starts on reload cooldown — clear both so all tubes are ready.
    silo.reloadMissile();
    silo.reloadMissile();

    game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.AtomBomb,
        game.ref(150, 150),
        undefined,
        3,
      ),
    );

    // Construction completes and all three NukeExecutions build their nukes.
    executeTicks(game, 3);
    expect(player.units(UnitType.AtomBomb)).toHaveLength(3);

    // Each bomb waits one tick longer than the previous, so once all are
    // moving they trail each other along the same path on distinct tiles.
    executeTicks(game, 4);
    const tiles = player.units(UnitType.AtomBomb).map((n) => n.tile());
    expect(tiles).toHaveLength(3);
    expect(new Set(tiles).size).toBe(3);
  });

  test("stacked atom bombs across silos fire simultaneously, staggered within each silo", () => {
    // At default speed the parabola's early points cluster on the launch
    // tile, so a departed bomb is indistinguishable from a waiting one for
    // several ticks. A high speed makes the first move leave the silo tile.
    (game.config() as TestConfig).setDefaultNukeSpeed(20);

    // Away from the map corner — a parabola launched from the corner has a
    // degenerate first segment that stays on the launch tile.
    const siloA = player.buildUnit(UnitType.MissileSilo, game.ref(50, 50), {});
    const siloB = player.buildUnit(UnitType.MissileSilo, game.ref(50, 54), {});
    for (const silo of [siloA, siloB]) {
      silo.increaseLevel();
      silo.reloadMissile();
    }

    game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.AtomBomb,
        game.ref(150, 150),
        undefined,
        4,
      ),
    );

    // Construction completes and each silo claims two of the four nukes.
    executeTicks(game, 3);
    const atSilo = () =>
      player
        .units(UnitType.AtomBomb)
        .map((n) => n.tile())
        .filter((t) => t === siloA.tile() || t === siloB.tile());
    expect(player.units(UnitType.AtomBomb)).toHaveLength(4);
    expect(atSilo()).toEqual(
      expect.arrayContaining([siloA.tile(), siloB.tile()]),
    );
    expect(atSilo()).toHaveLength(4);

    // One tick later the lead bomb of EACH silo has departed — silos fire
    // simultaneously rather than the second silo waiting on the first.
    executeTicks(game, 1);
    const waiting = atSilo();
    expect(waiting).toHaveLength(2);
    expect(waiting).toContain(siloA.tile());
    expect(waiting).toContain(siloB.tile());

    // Next tick the followers depart too.
    executeTicks(game, 1);
    expect(atSilo()).toHaveLength(0);
  });

  test("stacked bombs beyond loaded silo tubes are dropped, not queued", () => {
    const silo = player.buildUnit(UnitType.MissileSilo, game.ref(50, 50), {});
    // Reloading is driven by the silo's execution (normally added when the
    // silo is built through ConstructionExecution).
    game.addExecution(new MissileSiloExecution(silo));

    game.addExecution(
      new ConstructionExecution(
        player,
        UnitType.AtomBomb,
        game.ref(150, 150),
        undefined,
        3,
      ),
    );

    // Track every distinct bomb ever launched (bombs disappear on detonation).
    const seen = new Set<number>();
    const collect = () => {
      for (const n of player.units(UnitType.AtomBomb)) seen.add(n.id());
    };

    // One loaded tube: exactly one bomb launches, the excess is dropped.
    executeTicks(game, 3);
    collect();
    expect(seen.size).toBe(1);

    // Even after the tube reloads, no further bombs appear.
    executeTicks(game, game.config().SiloCooldown() + 5);
    collect();
    expect(seen.size).toBe(1);
  });
});
