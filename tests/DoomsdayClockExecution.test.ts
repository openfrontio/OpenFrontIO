import { DoomsdayClockExecution } from "../src/core/execution/DoomsdayClockExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import {
  doomsdayClockDrain,
  doomsdayClockRequiredTiles,
  doomsdayClockWaveState,
} from "../src/core/game/DoomsdayClock";
import {
  Game,
  GameMode,
  Player,
  PlayerType,
  Team,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { playerInfo, setup } from "./util/Setup";

// ---------------------------------------------------------------------------
// Unit tests: the flag / warn / drain / grouping logic is pure arithmetic over
// a side's combined numTilesOwned() + each member's troops(). We drive it through
// tiny fakes so the numbers are exact. The wave schedule + drain are covered by
// the pure-function tests further down; the end-to-end integration against the
// real simulation is the final test.
//
// The exec reads the real "veryfast" waves. WAVE_TICK sits in the 26% hold
// window (elapsed 796-808), so the bar is a stable 26% of the map (land 1000 ->
// bar 260) while the drain/flag logic is exercised. b(100) stays below it and
// a(400) above, so the flag/drain assertions (which depend on the drain config,
// not the exact bar) are unchanged.
// ---------------------------------------------------------------------------

const WAVE_TICK = 8000; // elapsed 800s -> veryfast 26% hold (bar 260 @ land 1000)

type SDConfig = ReturnType<ReturnType<Game["config"]>["doomsdayClockConfig"]>;

function sdConfig(over: Partial<SDConfig> = {}): SDConfig {
  return {
    enabled: true,
    speed: "veryfast", // waves rise to 30% by 15:00
    warnSeconds: 1,
    drainStartPercent: 10,
    drainMaxPercent: 80,
    drainRampSeconds: 3,
    drainFloorPercent: 5, // drain stops at 5% of max (matches production default)
    warshipDrainStartPercent: 10, // fixture: same start as troops (linear curve below)
    warshipDrainMaxPercent: 100, // ships ramp to a higher ceiling than troops
    warshipDrainCurveExponent: 1, // fixture uses a linear ramp for exact numbers
    ...over,
  };
}

// A stand-in warship: tracks HP and whether a destroyer (kill credit) was ever
// passed to modifyHealth. Doomsday decay must pass none, so destruction is
// environmental and never scores a kill (see UnitImpl.delete).
class FakeWarship {
  destroyed = false;
  attackerWasPassed = false;
  constructor(
    private hp: number,
    private readonly hpMax: number,
  ) {}
  maxHealth(): number {
    return this.hpMax;
  }
  health(): number {
    return this.hp;
  }
  modifyHealth(delta: number, attacker?: unknown): void {
    if (attacker !== undefined) this.attackerWasPassed = true;
    this.hp = Math.max(0, Math.min(this.hpMax, this.hp + delta));
    if (this.hp === 0) this.destroyed = true;
  }
}

class FakePlayer {
  markedTick = -1;
  warships: FakeWarship[] = [];
  readonly troopMax: number;
  constructor(
    private game: FakeGame,
    public tiles: number,
    public troopCount: number,
    private kind: PlayerType = PlayerType.Human,
    private alive: boolean = true,
    private teamId: Team | null = null,
  ) {
    this.troopMax = troopCount; // capacity = starting troops in tests
  }
  type(): PlayerType {
    return this.kind;
  }
  maxTroops(): number {
    return this.troopMax;
  }
  isAlive(): boolean {
    return this.alive;
  }
  team(): Team | null {
    return this.teamId;
  }
  kill(): void {
    this.alive = false;
  }
  numTilesOwned(): number {
    return this.tiles;
  }
  troops(): number {
    return this.troopCount;
  }
  removeTroops(n: number): number {
    const removed = Math.min(this.troopCount, n);
    this.troopCount -= removed;
    return removed;
  }
  // Mirrors PlayerImpl: a dead player is never in doomsday clock (the mark is
  // never cleared on death, so both are gated on isAlive()).
  inDoomsdayClock(): boolean {
    return this.alive && this.markedTick >= 0;
  }
  doomsdayClockTicks(): number {
    return this.inDoomsdayClock() ? this.game.now - this.markedTick : 0;
  }
  enterDoomsdayClock(): void {
    if (this.markedTick < 0) this.markedTick = this.game.now;
  }
  clearDoomsdayClock(): void {
    this.markedTick = -1;
  }
  // The exec calls units(UnitType.Warship); we ignore the filter and hand back
  // this side's warships.
  units(..._types: unknown[]): FakeWarship[] {
    return this.warships;
  }
}

class FakeGame {
  now = 0;
  gameMode: GameMode = GameMode.FFA;
  constructor(
    public land: number,
    public sd: SDConfig,
    public ps: FakePlayer[],
  ) {}
  ticks(): number {
    return this.now;
  }
  elapsedGameSeconds(): number {
    return Math.floor(this.now / 10);
  }
  players(): FakePlayer[] {
    return this.ps.filter((p) => p.isAlive()); // match GameImpl.players(): alive only
  }
  numLandTiles(): number {
    return this.land;
  }
  numTilesWithFallout(): number {
    return 0;
  }
  config() {
    return {
      doomsdayClockConfig: () => this.sd,
      gameConfig: () => ({ gameMode: this.gameMode }),
      maxTroops: (p: FakePlayer) => p.maxTroops(),
    };
  }
}

// Advance the fake clock to a given tick (multiple of 10) and run the exec once.
function runAt(
  exec: DoomsdayClockExecution,
  game: FakeGame,
  tick: number,
): void {
  game.now = tick;
  exec.tick(tick);
}

function makeExec(game: FakeGame): DoomsdayClockExecution {
  const exec = new DoomsdayClockExecution();
  exec.init(game as unknown as Game, 0);
  return exec;
}

describe("DoomsdayClockExecution (logic)", () => {
  // land 1000, veryfast 20% wave -> bar = 200 at WAVE_TICK.
  function twoPlayerGame(
    aTiles: number,
    bTiles: number,
    over: Partial<SDConfig> = {},
  ) {
    const game = new FakeGame(1000, sdConfig(over), []);
    const a = new FakePlayer(game, aTiles, 1000);
    const b = new FakePlayer(game, bTiles, 1000);
    game.ps = [a, b];
    return { game, a, b };
  }

  it("does nothing when disabled", () => {
    const { game, b } = twoPlayerGame(400, 100, { enabled: false });
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    expect(b.inDoomsdayClock()).toBe(false);
    expect(b.troops()).toBe(1000);
  });

  it("does nothing before the first wave", () => {
    // veryfast grace runs to 180s; before it the bar is 0, nobody below it.
    const { game, b } = twoPlayerGame(400, 100);
    const exec = makeExec(game);
    runAt(exec, game, 500); // elapsed 50s < 180s (grace)
    expect(b.inDoomsdayClock()).toBe(false);
    expect(b.troops()).toBe(1000);
  });

  it("flags a player below the bar and spares one above it", () => {
    const { game, a, b } = twoPlayerGame(400, 100);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK); // bar = 200
    expect(a.inDoomsdayClock()).toBe(false);
    expect(b.inDoomsdayClock()).toBe(true);
  });

  it("warns before draining, then drains harder over time", () => {
    const { game, b } = twoPlayerGame(400, 100); // b below the 200 bar
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK); // flagged this tick, 0s under -> within the warn
    expect(b.inDoomsdayClock()).toBe(true);
    expect(b.troops()).toBe(1000); // no drain yet

    runAt(exec, game, WAVE_TICK + 10); // 1s under -> 10% of max(1000) = 100
    expect(b.troops()).toBe(900);

    runAt(exec, game, WAVE_TICK + 20); // 2s under -> 33% of max(1000) = 330 (linear)
    expect(b.troops()).toBe(570);
  });

  it("drains an unrecovered player down to the 5% floor, never zero", () => {
    // b (maxTroops 1000) is caught and never recovers. The drain cripples it to
    // drainFloorPercent of max (5% of 1000 = 50) and stops there, not at zero.
    const { game, b } = twoPlayerGame(400, 50);
    const exec = makeExec(game);
    for (let t = WAVE_TICK; t <= WAVE_TICK + 1000; t += 10)
      runAt(exec, game, t);
    expect(b.troops()).toBe(50); // 5% floor, not wiped
    expect(b.inDoomsdayClock()).toBe(true);
    // Holds at the floor on further ticks (no drift below it).
    runAt(exec, game, WAVE_TICK + 1010);
    expect(b.troops()).toBe(50);
  });

  it("clears the mark and stops draining when a player climbs back above the bar", () => {
    const { game, b } = twoPlayerGame(400, 100);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    runAt(exec, game, WAVE_TICK + 10); // drained once
    const afterDrain = b.troops();
    expect(b.inDoomsdayClock()).toBe(true);

    b.tiles = 400; // recovered above the bar
    runAt(exec, game, WAVE_TICK + 20);
    expect(b.inDoomsdayClock()).toBe(false);
    expect(b.troops()).toBe(afterDrain); // drain stopped
  });

  it("drops the mark once a flagged player dies (no stuck panel or churn)", () => {
    // Nothing clears the mark on death, so inDoomsdayClock()/doomsdayClockTicks()
    // must gate on isAlive() to avoid a permanently "Draining" panel and a
    // per-tick update delta for an eliminated player.
    const { game, b } = twoPlayerGame(400, 100);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    expect(b.inDoomsdayClock()).toBe(true);

    b.kill();
    expect(b.inDoomsdayClock()).toBe(false);
    expect(b.doomsdayClockTicks()).toBe(0);
  });

  it("never dooms the leading side, even below the bar (no all-drained stalemate)", () => {
    // Both sides below the 200 bar; the larger (a) is the crown, so it is spared
    // and keeps its army to close the game instead of everyone bleeding to zero.
    const { game, a, b } = twoPlayerGame(150, 100);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    expect(a.inDoomsdayClock()).toBe(false); // leader, spared
    expect(b.inDoomsdayClock()).toBe(true); // challenger, doomed
    runAt(exec, game, WAVE_TICK + 30);
    expect(a.troops()).toBe(1000); // never drained
    expect(b.troops()).toBeLessThan(1000); // bled
  });

  it("applies to nations like players and excludes map bots", () => {
    const game = new FakeGame(1000, sdConfig(), []);
    const leader = new FakePlayer(game, 400, 1000, PlayerType.Human);
    const human = new FakePlayer(game, 100, 1000, PlayerType.Human);
    const nation = new FakePlayer(game, 50, 1000, PlayerType.Nation);
    const bot = new FakePlayer(game, 5, 1000, PlayerType.Bot);
    game.ps = [leader, human, nation, bot];
    const exec = makeExec(game);
    // Bar 200; leader (400) is crown-exempt; human (100) and nation (50) are
    // below it; the bot is exempt by type.
    runAt(exec, game, WAVE_TICK);
    expect(human.inDoomsdayClock()).toBe(true);
    expect(nation.inDoomsdayClock()).toBe(true); // a nation is treated like a player
    expect(bot.inDoomsdayClock()).toBe(false); // map bots are never subject to it
    expect(leader.inDoomsdayClock()).toBe(false); // the crown is never doomed
    runAt(exec, game, WAVE_TICK + 10);
    expect(nation.troops()).toBeLessThan(1000); // drained like a player
    expect(bot.troops()).toBe(1000); // untouched
  });

  it("is deterministic: identical scenarios give identical drains", () => {
    const run = () => {
      const { game, b } = twoPlayerGame(400, 100);
      const exec = makeExec(game);
      for (let t = WAVE_TICK; t <= WAVE_TICK + 200; t += 10)
        runAt(exec, game, t);
      return b.troops();
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------------------
// Warship decay: a flagged (sub-threshold, non-leader) side's warships bleed HP
// on the troop start + ramp but toward a much higher ceiling, so at full
// attrition they drop to the 5% floor in ~2s (never sunk). Damage carries no
// attacker (environmental, never a credited kill); the leader's fleet is spared.
// ---------------------------------------------------------------------------

describe("DoomsdayClockExecution (warship decay)", () => {
  // b (100 tiles) is below the 200 bar at WAVE_TICK and is flagged; a (400) is
  // the leader and is spared. maxTroops == warship maxHealth == 1000, so at the
  // start of the ramp troop and warship losses are numerically identical; they
  // diverge later as warships climb to their higher ceiling.
  function warshipGame(bShips: FakeWarship[], aShips: FakeWarship[] = []) {
    const game = new FakeGame(1000, sdConfig(), []);
    const a = new FakePlayer(game, 400, 1000); // leader, above the bar
    const b = new FakePlayer(game, 100, 1000); // below the bar
    a.warships = aShips;
    b.warships = bShips;
    game.ps = [a, b];
    return { game, a, b };
  }

  it("matches the troop drain at the start of the ramp", () => {
    const ship = new FakeWarship(1000, 1000);
    const { game, b } = warshipGame([ship]);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK); // flag b (within the warn window)
    runAt(exec, game, WAVE_TICK + 10); // 1s under -> 0s past warn -> drainStart 10%
    expect(b.troops()).toBe(900); // troops: 10% of 1000
    expect(ship.health()).toBe(900); // warship: identical at the start (same 10%)
  });

  it("batters a warship down to the 5% floor at full attrition, never sunk", () => {
    // Once the side is fully ramped, a fresh full-HP warship would take its whole
    // ceiling (100% here) in one tick, but the floor (5% of maxHealth 1000 = 50)
    // clamps it: the ship drops to 50 HP and survives instead of being destroyed.
    const { game, b } = warshipGame([]);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK); // flag b (starts the side's attrition clock)
    const fresh = new FakeWarship(1000, 1000);
    b.warships = [fresh]; // appears once the side is fully ramped
    runAt(exec, game, WAVE_TICK + 70); // secondsPastWarn 6 >= ramp 3 -> max
    expect(fresh.health()).toBe(50); // 5% floor
    expect(fresh.destroyed).toBe(false); // crippled, not sunk
  });

  it("decays HP with no attacker (environmental) and stops at the floor", () => {
    const ship = new FakeWarship(1000, 1000);
    const { game } = warshipGame([ship]);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    runAt(exec, game, WAVE_TICK + 10); // 10% of 1000 = 100 dmg
    expect(ship.health()).toBe(900); // took damage
    expect(ship.attackerWasPassed).toBe(false); // environmental, no kill credit
    expect(ship.destroyed).toBe(false);
  });

  it("leaves a warship already at the floor untouched", () => {
    const ship = new FakeWarship(50, 1000); // exactly the 5% floor
    const { game } = warshipGame([ship]);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    runAt(exec, game, WAVE_TICK + 70); // full attrition
    expect(ship.health()).toBe(50); // nothing left above the floor to remove
    expect(ship.destroyed).toBe(false);
    expect(ship.attackerWasPassed).toBe(false);
  });

  it("spares the leader's warships", () => {
    const leaderShip = new FakeWarship(1000, 1000);
    const { game } = warshipGame([new FakeWarship(1000, 1000)], [leaderShip]);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    runAt(exec, game, WAVE_TICK + 30); // well past the warn window
    expect(leaderShip.health()).toBe(1000);
  });

  it("does not damage warships during the warn window", () => {
    const ship = new FakeWarship(1000, 1000);
    const { game, b } = warshipGame([ship]);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK); // flagged this tick, 0s under -> within warn
    expect(b.inDoomsdayClock()).toBe(true);
    expect(ship.health()).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Team modes: the bar applies to a whole team's combined territory — the SAME
// bar a solo side faces, regardless of headcount — and every member shares the
// fate (skull + drain together).
// ---------------------------------------------------------------------------

describe("DoomsdayClockExecution (teams)", () => {
  function teamGame(teams: { team: string; tiles: number[] }[]) {
    // WAVE_TICK sits in the veryfast 26% hold @ land 1000 -> every side's bar
    // is 260, team or solo.
    const game = new FakeGame(1000, sdConfig(), []);
    game.gameMode = GameMode.Team;
    const players: FakePlayer[] = [];
    for (const t of teams) {
      for (const tiles of t.tiles) {
        players.push(
          new FakePlayer(game, tiles, 1000, PlayerType.Human, true, t.team),
        );
      }
    }
    game.ps = players;
    return { game, players };
  }

  it("judges a team on combined territory and skulls every member when below", () => {
    // Bar 260. Red 250+250=500 above (and the leader); Blue 50+50=100 below
    // -> both Blue members skulled together.
    const { game, players } = teamGame([
      { team: "Red", tiles: [250, 250] },
      { team: "Blue", tiles: [50, 50] },
    ]);
    const [red1, red2, blue1, blue2] = players;
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    expect(red1.inDoomsdayClock()).toBe(false);
    expect(red2.inDoomsdayClock()).toBe(false);
    expect(blue1.inDoomsdayClock()).toBe(true);
    expect(blue2.inDoomsdayClock()).toBe(true);
    runAt(exec, game, WAVE_TICK + 10); // past the warn -> both Blue members drain
    expect(blue1.troops()).toBeLessThan(1000);
    expect(blue2.troops()).toBeLessThan(1000);
    expect(red1.troops()).toBe(1000); // safe team untouched
  });

  it("spares a tiny member whose team is collectively above the bar", () => {
    // Bar 260. Red 400+40=440 above -> safe, so the 40-tile member is NOT
    // skulled even though 40 is far below the bar on its own.
    const { game, players } = teamGame([
      { team: "Red", tiles: [400, 40] },
      { team: "Blue", tiles: [50, 50] },
    ]);
    const [, redTiny, blue1] = players;
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    expect(redTiny.inDoomsdayClock()).toBe(false); // team is collectively safe
    expect(blue1.inDoomsdayClock()).toBe(true);
  });

  it("does NOT scale the bar by headcount (a team faces the same bar as a solo)", () => {
    // Bar 260 for every side. Red (2 members, 300 combined) is safe — the old
    // headcount-scaled rule would have demanded 260x2=520 and skulled them.
    // Green (3 members, 240 combined) is below the SOLO bar -> skulled: being
    // three players earns no leniency either.
    const { game, players } = teamGame([
      { team: "Blue", tiles: [700] }, // leader
      { team: "Red", tiles: [150, 150] }, // 300 >= 260 -> safe
      { team: "Green", tiles: [100, 80, 60] }, // 240 < 260 -> skulled
    ]);
    const [blue1, red1, red2, green1, green2, green3] = players;
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    expect(blue1.inDoomsdayClock()).toBe(false); // leader
    expect(red1.inDoomsdayClock()).toBe(false);
    expect(red2.inDoomsdayClock()).toBe(false);
    expect(green1.inDoomsdayClock()).toBe(true);
    expect(green2.inDoomsdayClock()).toBe(true);
    expect(green3.inDoomsdayClock()).toBe(true);
  });

  it("keeps the bar unchanged when a teammate dies", () => {
    // Bar 260. Red holds 300+5: safe before AND after losing the 5-tile member
    // (still 300 >= 260). The old rule moved the bar with the alive headcount:
    // 520 while both lived (skulled), 260 after the death (saved by dying) —
    // deaths must never move the bar.
    const { game, players } = teamGame([
      { team: "Blue", tiles: [700] }, // leader
      { team: "Red", tiles: [300, 5] },
    ]);
    const [, red1, red2] = players;
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    expect(red1.inDoomsdayClock()).toBe(false); // 305 >= 260 (old rule: < 520)
    expect(red2.inDoomsdayClock()).toBe(false);
    red2.kill();
    runAt(exec, game, WAVE_TICK + 10);
    expect(red1.inDoomsdayClock()).toBe(false); // 300 >= 260, bar unmoved
  });

  it("idles when only one team remains", () => {
    const { game, players } = teamGame([{ team: "Red", tiles: [50, 50] }]);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    expect(players[0].inDoomsdayClock()).toBe(false);
    expect(players[1].inDoomsdayClock()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The shared wave schedule + drain: pure integer functions, so we assert the
// exact thresholds and wave cues the sim and the HUD both depend on.
// ---------------------------------------------------------------------------

describe("doomsdayClockRequiredTiles (ramping waves)", () => {
  const land = 10000;

  it("is 0 through the grace, ramps linearly, then holds during the pause", () => {
    // normal: grace 600s, then a 208s ramp 0->4%, then a 50s hold, ...
    expect(doomsdayClockRequiredTiles("normal", land, 300)).toBe(0); // in the grace
    expect(doomsdayClockRequiredTiles("normal", land, 600)).toBe(0); // grace ends
    expect(doomsdayClockRequiredTiles("normal", land, 704)).toBe(200); // halfway up -> 2%
    expect(doomsdayClockRequiredTiles("normal", land, 808)).toBe(400); // ramp done -> 4%
    expect(doomsdayClockRequiredTiles("normal", land, 830)).toBe(400); // pause holds 4%
    expect(doomsdayClockRequiredTiles("normal", land, 858)).toBe(400); // next ramp starts at 4%
    expect(doomsdayClockRequiredTiles("normal", land, 9999)).toBe(5500); // final 55%
  });

  it("reaches the 40% wave then the final 55% squeeze per preset", () => {
    // 40% waypoint (5th wave), then the 6th wave to 55% at the preset cap.
    expect(doomsdayClockRequiredTiles("normal", land, 1850)).toBe(4000); // 40% wave
    expect(doomsdayClockRequiredTiles("normal", land, 2110)).toBe(5500); // 55% @ 35:00
    expect(doomsdayClockRequiredTiles("fast", land, 1510)).toBe(5500); // 55% @ 25:00
    expect(doomsdayClockRequiredTiles("veryfast", land, 910)).toBe(5500); // 55% @ 15:00
    expect(doomsdayClockRequiredTiles("slow", land, 2710)).toBe(5500); // 55% @ 45:00
  });

  it("never decreases, and is zero for no land", () => {
    let prev = 0;
    for (let t = 0; t <= 2400; t += 5) {
      const r = doomsdayClockRequiredTiles("normal", land, t);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(doomsdayClockRequiredTiles("normal", 0, 1800)).toBe(0);
  });
});

describe("doomsdayClockWaveState", () => {
  it("reports the live share and target while ramping", () => {
    const s = doomsdayClockWaveState("normal", 704); // mid the first ramp (0->4%)
    expect(s.currentPercent).toBe(2);
    expect(s.targetPercent).toBe(4);
    expect(s.growing).toBe(true);
    expect(s.secondsToNextGrowth).toBe(0);
    expect(s.secondsToTarget).toBe(104); // 208s ramp, 104s elapsed into it
    expect(s.done).toBe(false);
  });

  it("counts down to the next ramp during a pause", () => {
    const s = doomsdayClockWaveState("normal", 830); // in the first pause (808-858)
    expect(s.growing).toBe(false);
    expect(s.currentPercent).toBe(4); // held at the level just reached
    expect(s.targetPercent).toBe(9); // next ramp climbs to 9%
    expect(s.secondsToNextGrowth).toBe(28); // next ramp starts at 858
    expect(s.secondsToTarget).toBe(0); // not rising, so no rise countdown
  });

  it("counts down through the grace", () => {
    const s = doomsdayClockWaveState("normal", 200);
    expect(s.currentPercent).toBe(0);
    expect(s.targetPercent).toBe(4);
    expect(s.secondsToNextGrowth).toBe(400); // first ramp at 600
  });

  it("flags the 10s window (5s each side) around a ramp starting", () => {
    // veryfast first ramp starts at 600s.
    expect(doomsdayClockWaveState("veryfast", 596).waveFlash).toBe(true); // 4s before
    expect(doomsdayClockWaveState("veryfast", 604).waveFlash).toBe(true); // 4s after
    expect(doomsdayClockWaveState("veryfast", 620).waveFlash).toBe(false); // mid-ramp
  });

  it("marks done after the last ramp", () => {
    const s = doomsdayClockWaveState("veryfast", 1100); // past the final ramp (@900) = 55%
    expect(s.done).toBe(true);
    expect(s.currentPercent).toBe(55);
    expect(s.secondsToNextGrowth).toBe(0);
  });
});

describe("doomsdayClockDrain", () => {
  const cfg = {
    drainStartPercent: 10,
    drainMaxPercent: 80,
    drainRampSeconds: 3,
  };

  it("starts gentle and grows linearly, capping at the max", () => {
    expect(doomsdayClockDrain(1000, 0, cfg)).toBe(100); // 10%
    expect(doomsdayClockDrain(1000, 1, cfg)).toBe(330); // 33%
    expect(doomsdayClockDrain(1000, 2, cfg)).toBe(560); // 56%
    expect(doomsdayClockDrain(1000, 3, cfg)).toBe(800); // capped at 80%
    expect(doomsdayClockDrain(1000, 100, cfg)).toBe(800);
    // linear: each step before the cap removes the same amount more
    const d0 = doomsdayClockDrain(1000, 0, cfg);
    const d1 = doomsdayClockDrain(1000, 1, cfg);
    const d2 = doomsdayClockDrain(1000, 2, cfg);
    expect(d1 - d0).toBe(d2 - d1);
  });

  it("removes at least one troop and never less", () => {
    expect(doomsdayClockDrain(1, 0, cfg)).toBe(1); // floor(0.1) -> min 1
  });

  it("treats time before the warn window as zero", () => {
    expect(doomsdayClockDrain(1000, -5, cfg)).toBe(100); // clamped to start %
  });

  it("shapes a convex curve (exponent > 1): gentle early, steep late, integer-only", () => {
    // Warship-style ramp: start 1%, max 50% over 90s, exponent 8. Integer-only
    // (no floats) so it's deterministic in the lockstep sim.
    const ship = {
      drainStartPercent: 1,
      drainMaxPercent: 50,
      drainRampSeconds: 90,
    };
    const at = (t: number) => doomsdayClockDrain(10000, t, ship, 8);

    expect(at(0)).toBe(100); // 1% of 10000 at the very start
    expect(at(90)).toBe(5000); // 50% once fully ramped
    expect(at(200)).toBe(5000); // holds at the max past the ramp

    // Convex: at the ramp midpoint it's still far below the linear midpoint
    // (which would be ~25%); the bulk of the attrition is back-loaded.
    expect(at(45)).toBeLessThan(at(90) / 4);

    // Monotonic non-decreasing, and every value an integer.
    let prev = -1;
    for (let t = 0; t <= 90; t++) {
      const v = at(t);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }

    // Deterministic: identical inputs give identical output.
    expect(at(37)).toBe(at(37));
  });
});

// ---------------------------------------------------------------------------
// Integration: real simulation. We give one player a slice above the bar and
// another a sliver below it, then run real ticks. The drain is isolated from
// normal troop dynamics by comparing the enabled run vs the disabled run.
// ---------------------------------------------------------------------------

function giveLandTiles(game: Game, player: Player, n: number): number {
  let count = 0;
  for (let y = 0; y < game.height() && count < n; y++) {
    for (let x = 0; x < game.width() && count < n; x++) {
      const t: TileRef = game.ref(x, y);
      if (game.isLand(t) && !game.owner(t).isPlayer()) {
        player.conquer(t);
        count++;
      }
    }
  }
  return count;
}

describe("DoomsdayClockExecution (integration)", () => {
  // Steepest preset; we run past its grace (600s) into the waves. Drain tuning
  // is internal now, so this exercises the default drain (warn 30s, 2%->5%/90s).
  const SD = {
    enabled: true,
    speed: "veryfast" as const,
  };
  const TICKS = 6500; // 650s of game time -> veryfast holding its 4% wave

  async function buildGame(enabled: boolean) {
    const game = await setup(
      "plains",
      { instantBuild: true, doomsdayClock: { ...SD, enabled } },
      [
        playerInfo("big", PlayerType.Human),
        playerInfo("small", PlayerType.Human),
      ],
    );
    const big = game.player("big");
    const small = game.player("small");
    // Size the slices to the bar at the point we stop.
    const bar = doomsdayClockRequiredTiles(
      "veryfast",
      game.numLandTiles(),
      TICKS / 10,
    );
    giveLandTiles(game, big, bar + 50); // above the bar
    giveLandTiles(game, small, 3); // a sliver, below the bar
    big.setTroops(50_000);
    small.setTroops(50_000);
    // setup() builds the game via createGame, not GameRunner, so the execution
    // GameRunner normally registers must be added here.
    game.addExecution(new DoomsdayClockExecution());
    for (let i = 0; i < TICKS; i++) game.executeNextTick();
    return { big, small };
  }

  it("skulls the player below the bar, spares the one above, and drains them", async () => {
    const on = await buildGame(true);
    const off = await buildGame(false);

    expect(on.small.inDoomsdayClock()).toBe(true);
    expect(on.big.inDoomsdayClock()).toBe(false);
    expect(off.small.inDoomsdayClock()).toBe(false);

    // The drain is the difference vs the disabled run (isolates it from the
    // normal troop dynamics both runs share).
    expect(on.small.troops()).toBeLessThan(off.small.troops());
  });
});

// ---------------------------------------------------------------------------
// Default-config floor behavior. Uses the resolved DOOMSDAY_CLOCK_DEFAULTS (no
// drain overrides) with real troop income (PlayerExecution) flowing every tick.
// The drain cripples a caught side to drainFloorPercent (5%) of its max and
// stops there: it never reaches zero, and income keeps it hovering at the floor.
// ---------------------------------------------------------------------------

describe("DoomsdayClockExecution (default drain, with income)", () => {
  it("cripples a full-troop side down to ~5% of max, never wiped", async () => {
    // Only enabled + speed set -> drain uses the defaults (warn 30s, 2%->5% /90s,
    // floor 5%). veryfast is chosen so the bar rises fast enough to catch the sliver.
    const game = await setup(
      "plains",
      {
        instantBuild: true,
        doomsdayClock: { enabled: true, speed: "veryfast" },
      },
      [
        playerInfo("big", PlayerType.Human),
        playerInfo("small", PlayerType.Human),
      ],
    );
    const big = game.player("big");
    const small = game.player("small");
    giveLandTiles(game, big, 4000); // safely above the bar
    giveLandTiles(game, small, 3); // a sliver, caught once the bar rises
    game.addExecution(new PlayerExecution(big));
    game.addExecution(new PlayerExecution(small)); // income every tick
    game.addExecution(new DoomsdayClockExecution());

    // Run until the rising bar catches the sliver, then fill it to a full stack
    // so the drain works from the worst case (a full army down to the floor).
    let caughtTick = -1;
    for (let i = 0; i < 8000; i++) {
      // grace is 600s now -> the bar only rises after ~6000 ticks
      game.executeNextTick();
      if (small.inDoomsdayClock()) {
        caughtTick = game.ticks();
        break;
      }
    }
    expect(caughtTick).toBeGreaterThan(0);
    const maxTroops = game.config().maxTroops(small);
    const floor = Math.floor((maxTroops * 5) / 100);
    small.setTroops(maxTroops);

    // Run well past the warn + ramp (30s + 90s) so the drain reaches steady state.
    for (let i = 0; i < 2500; i++) game.executeNextTick();

    expect(small.inDoomsdayClock()).toBe(true);
    expect(small.troops()).toBeGreaterThan(0); // never wiped to zero
    expect(small.troops()).toBeGreaterThanOrEqual(floor - 1); // never below the 5% floor
    // Settles at the floor (income keeps it a little above, within one drain step).
    expect(small.troops()).toBeLessThan(floor + Math.floor(maxTroops * 0.05));
  });
});
