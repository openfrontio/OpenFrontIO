import { vi } from "vitest";
import { DoomsdayClockExecution } from "../src/core/execution/DoomsdayClockExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import {
  doomsdayClockDrain,
  doomsdayClockRequiredTiles,
  doomsdayClockRotQuota,
  doomsdayClockTroopFloor,
  doomsdayClockWaveState,
  ROT_NOISE_SCALE,
  rotFrontNoise,
  rotSpeckleNoise,
} from "../src/core/game/DoomsdayClock";
import {
  Game,
  GameMode,
  Player,
  PlayerType,
  Team,
  UnitType,
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
// The exec reads the real "veryfast" waves. WAVE_TICK sits in the 25% hold
// window (elapsed 856-864), so the bar is a stable 25% of the map (land 1000 ->
// bar 250) while the drain/flag logic is exercised. b(100) stays below it and
// a(400) above, so the flag/drain assertions (which depend on the drain config,
// not the exact bar) are unchanged.
// ---------------------------------------------------------------------------

const WAVE_TICK = 8600; // elapsed 860s -> veryfast 25% hold (bar 250 @ land 1000)

type SDConfig = ReturnType<ReturnType<Game["config"]>["doomsdayClockConfig"]>;

function sdConfig(over: Partial<SDConfig> = {}): SDConfig {
  return {
    enabled: true,
    speed: "veryfast", // waves rise to 30% by 15:00
    warnSeconds: 1,
    drainStartPercent: 10,
    drainMaxPercent: 80,
    drainRampSeconds: 3,
    drainFloorPercent: 5, // drain settles at 5% of max (matches production default)
    floorStartPercent: 5, // == drainFloorPercent -> flat floor, no comeback window
    floorDecaySeconds: 0,
    rotDeathSeconds: 0, // rot off unless a test asks for it (prod default)
    rotGrainSeconds: 20,
    rotSpecklePercent: 15,
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
    public tileCount: number,
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
    return this.tileCount;
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
    this.rottedAtTick = -1;
  }
  // Stamped by rot so the client can paint the red "Decaying" skull.
  rottedAtTick = -1;
  markRotted(): void {
    this.rottedAtTick = this.game.now;
  }
  // The exec only ever asks for warships (the navy drain).
  units(..._types: unknown[]): FakeWarship[] {
    return this.warships;
  }

  // --- Territory, for the rot tests -----------------------------------------
  // The number-only tests above just set tileCount; giveTiles() additionally
  // hands over real tile refs so rot has something to pick from.
  id = 0;
  private tileSet = new Set<TileRef>();
  private borderSet = new Set<TileRef>();
  relinquished: TileRef[] = [];

  giveTiles(interior: TileRef[], border: TileRef[] = []): void {
    this.tileSet = new Set([...interior, ...border]);
    this.borderSet = new Set(border);
    this.tileCount = this.tileSet.size;
  }
  smallID(): number {
    return this.id;
  }
  tiles(): {
    has: (t: TileRef) => boolean;
    forEach: (fn: (t: TileRef) => void) => void;
  } {
    return {
      has: (t) => this.tileSet.has(t),
      forEach: (fn) => this.tileSet.forEach(fn),
    };
  }
  borderTiles(): { has: (t: TileRef) => boolean } {
    return { has: (t) => this.borderSet.has(t) };
  }
  relinquish(tile: TileRef): void {
    // GameImpl.relinquish throws on an unowned tile, so mirror that: it turns a
    // double-relinquish (e.g. the same tile landing in two reservoirs) into a
    // failure here rather than a silent no-op.
    if (!this.tileSet.delete(tile)) {
      throw new Error(`relinquish of an unowned tile: ${tile}`);
    }
    this.borderSet.delete(tile);
    this.relinquished.push(tile);
    this.tileCount = this.tileSet.size;
    if (this.tileCount === 0) this.alive = false; // PlayerImpl: isAlive() = tiles > 0
  }
}

class FakeGame {
  now = 0;
  gameMode: GameMode = GameMode.FFA;
  winnerPlayer: FakePlayer | null = null;
  constructor(
    public land: number,
    public sd: SDConfig,
    public ps: FakePlayer[],
  ) {}
  getWinner(): FakePlayer | null {
    return this.winnerPlayer;
  }
  winner(): FakePlayer | null {
    return this.winnerPlayer;
  }
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
  // Rot spreads to cardinal neighbours and reads a per-tile noise field, so the
  // fake lays its tiles out on a GRID x GRID board: ref = y * GRID + x.
  x(t: TileRef): number {
    return t % GRID;
  }
  y(t: TileRef): number {
    return Math.floor(t / GRID);
  }
  neighbors(t: TileRef): TileRef[] {
    const x = t % GRID;
    const out: TileRef[] = [];
    if (x > 0) out.push((t - 1) as TileRef);
    if (x < GRID - 1) out.push((t + 1) as TileRef);
    if (t - GRID >= 0) out.push((t - GRID) as TileRef);
    if (t + GRID < GRID * GRID) out.push((t + GRID) as TileRef);
    return out;
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
  // land 1000, veryfast 25% wave -> bar = 250 at WAVE_TICK.
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

    b.tileCount = 400; // recovered above the bar
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

  it("halts execution and clears doomsday clock flags once a game winner is set", () => {
    const { game, a, b } = twoPlayerGame(150, 100);
    const exec = makeExec(game);
    runAt(exec, game, WAVE_TICK);
    expect(b.inDoomsdayClock()).toBe(true);

    game.winnerPlayer = a;
    runAt(exec, game, WAVE_TICK + 10);
    expect(a.inDoomsdayClock()).toBe(false);
    expect(b.inDoomsdayClock()).toBe(false);
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
    // WAVE_TICK sits in the veryfast 25% hold @ land 1000 -> every side's bar
    // is 250, team or solo.
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
    // Bar 250. Red 250+250=500 above (and the leader); Blue 50+50=100 below
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
    // Bar 250. Red 400+40=440 above -> safe, so the 40-tile member is NOT
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
    // Bar 250 for every side. Red (2 members, 300 combined) is safe — the old
    // headcount-scaled rule would have demanded 250x2=500 and skulled them.
    // Green (3 members, 240 combined) is below the SOLO bar -> skulled: being
    // three players earns no leniency either.
    const { game, players } = teamGame([
      { team: "Blue", tiles: [700] }, // leader
      { team: "Red", tiles: [150, 150] }, // 300 >= 250 -> safe
      { team: "Green", tiles: [100, 80, 60] }, // 240 < 250 -> skulled
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
    // Bar 250. Red holds 300+5: safe before AND after losing the 5-tile member
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
    // normal: grace 600s, then a 168s ramp 0->2%, then a 54s hold, ...
    expect(doomsdayClockRequiredTiles("normal", land, 300)).toBe(0); // in the grace
    expect(doomsdayClockRequiredTiles("normal", land, 600)).toBe(0); // grace ends
    expect(doomsdayClockRequiredTiles("normal", land, 684)).toBe(100); // halfway up -> 1%
    expect(doomsdayClockRequiredTiles("normal", land, 768)).toBe(200); // ramp done -> 2%
    expect(doomsdayClockRequiredTiles("normal", land, 800)).toBe(200); // pause holds 2%
    expect(doomsdayClockRequiredTiles("normal", land, 822)).toBe(200); // next ramp starts at 2%
    expect(doomsdayClockRequiredTiles("normal", land, 9999)).toBe(3500); // final 35%
  });

  it("tops out at 35% exactly on each preset's cap", () => {
    // Seven waves (2/4/7/11/17/25/35%); the last lands ON the cap so it has the
    // endgame to act. 35% -- not the old 55% -- because no runner-up in 85
    // tournament games ever held more than 21.6%, so a higher ceiling only ever
    // climbed past the leader's own share.
    expect(doomsdayClockRequiredTiles("normal", land, 1878)).toBe(2500); // 25% wave
    expect(doomsdayClockRequiredTiles("normal", land, 2100)).toBe(3500); // 35% @ 35:00
    expect(doomsdayClockRequiredTiles("fast", land, 1500)).toBe(3500); // 35% @ 25:00
    expect(doomsdayClockRequiredTiles("veryfast", land, 900)).toBe(3500); // 35% @ 15:00
    expect(doomsdayClockRequiredTiles("slow", land, 2700)).toBe(3500); // 35% @ 45:00
    // And never beyond it, however long the game runs.
    expect(doomsdayClockRequiredTiles("fast", land, 5000)).toBe(3500);
  });

  it("steps gently and never jumps more than 10 points at once", () => {
    // The field is bottom-heavy (half of end-survivors hold under 0.4% of the
    // map), so a big step sweeps the whole cluster into the debuff at once --
    // which is how games ended up with 8 of 10 survivors crippled together.
    const levels = [200, 400, 700, 1100, 1700, 2500, 3500];
    let prev = 0;
    for (const l of levels) {
      expect(l - prev).toBeLessThanOrEqual(1000); // <= 10 percentage points
      prev = l;
    }
    // Dense at the bottom: the first four steps are all <= 4 points.
    expect(levels[3] - levels[2]).toBeLessThanOrEqual(400);
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
    const s = doomsdayClockWaveState("normal", 684); // mid the first ramp (0->2%)
    expect(s.currentPercent).toBe(1);
    expect(s.targetPercent).toBe(2);
    expect(s.growing).toBe(true);
    expect(s.secondsToNextGrowth).toBe(0);
    expect(s.secondsToTarget).toBe(84); // 168s ramp, 84s elapsed into it
    expect(s.done).toBe(false);
  });

  it("counts down to the next ramp during a pause", () => {
    const s = doomsdayClockWaveState("normal", 800); // in the first pause (768-822)
    expect(s.growing).toBe(false);
    expect(s.currentPercent).toBe(2); // held at the level just reached
    expect(s.targetPercent).toBe(4); // next ramp climbs to 4%
    expect(s.secondsToNextGrowth).toBe(22); // next ramp starts at 822
    expect(s.secondsToTarget).toBe(0); // not rising, so no rise countdown
  });

  it("counts down through the grace", () => {
    const s = doomsdayClockWaveState("normal", 200);
    expect(s.currentPercent).toBe(0);
    expect(s.targetPercent).toBe(2);
    expect(s.secondsToNextGrowth).toBe(400); // first ramp at 600
  });

  it("flags the 10s window (5s each side) around a ramp starting", () => {
    // veryfast first ramp starts at 600s.
    expect(doomsdayClockWaveState("veryfast", 596).waveFlash).toBe(true); // 4s before
    expect(doomsdayClockWaveState("veryfast", 604).waveFlash).toBe(true); // 4s after
    expect(doomsdayClockWaveState("veryfast", 620).waveFlash).toBe(false); // mid-ramp
  });

  it("marks done after the last ramp", () => {
    const s = doomsdayClockWaveState("veryfast", 1100); // past the final ramp (@900) = 35%
    expect(s.done).toBe(true);
    expect(s.currentPercent).toBe(35);
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
    // This test is about the DRAIN floor, so pin rot off and the floor flat. Left
    // to the defaults it would break the day rot ships switched on -- the sliver
    // would rot away before there was anything to measure.
    const dcfg = game.config();
    vi.spyOn(dcfg, "doomsdayClockConfig").mockReturnValue({
      ...dcfg.doomsdayClockConfig(),
      floorStartPercent: 5,
      floorDecaySeconds: 0,
      rotDeathSeconds: 0,
    });
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

// ---------------------------------------------------------------------------
// The DECAYING troop floor. Pure integer math, so assert exact numbers: the
// floor starts at floorStartPercent of max and decays linearly to
// drainFloorPercent over floorDecaySeconds, then holds. Defaults must be inert.
// ---------------------------------------------------------------------------

describe("doomsdayClockTroopFloor", () => {
  const decaying = {
    drainFloorPercent: 5,
    floorStartPercent: 40,
    floorDecaySeconds: 100,
  };

  it("starts at floorStartPercent and lands exactly on drainFloorPercent", () => {
    expect(doomsdayClockTroopFloor(1000, 0, decaying)).toBe(400); // 40%
    expect(doomsdayClockTroopFloor(1000, 100, decaying)).toBe(50); // 5%
  });

  it("decays linearly in between", () => {
    // 50s in: 40 - floor(35 * 50/100) = 40 - 17 = 23% of 1000.
    expect(doomsdayClockTroopFloor(1000, 50, decaying)).toBe(230);
    // 20s in: 40 - floor(35 * 20/100) = 40 - 7 = 33%.
    expect(doomsdayClockTroopFloor(1000, 20, decaying)).toBe(330);
  });

  it("holds at the settled floor forever after the window", () => {
    expect(doomsdayClockTroopFloor(1000, 101, decaying)).toBe(50);
    expect(doomsdayClockTroopFloor(1000, 100_000, decaying)).toBe(50);
  });

  it("never rises: the comeback window only ever closes", () => {
    let prev = Infinity;
    for (let t = 0; t <= 120; t++) {
      const floor = doomsdayClockTroopFloor(1000, t, decaying);
      expect(floor).toBeLessThanOrEqual(prev);
      expect(Number.isInteger(floor)).toBe(true); // integer-only: lockstep-safe
      prev = floor;
    }
  });

  it("clamps a negative elapsed to the start of the window", () => {
    expect(doomsdayClockTroopFloor(1000, -5, decaying)).toBe(400);
  });

  it("is flat when the window is zero, or the start equals the settled floor", () => {
    // Either degenerate case gives a plain Math.floor(max * floor% / 100).
    const noWindow = { ...decaying, floorDecaySeconds: 0 };
    const noSpan = {
      ...decaying,
      floorStartPercent: 5,
      floorDecaySeconds: 100,
    };
    for (const t of [0, 1, 50, 100, 999]) {
      expect(doomsdayClockTroopFloor(1000, t, noWindow)).toBe(50);
      expect(doomsdayClockTroopFloor(1000, t, noSpan)).toBe(50);
    }
  });

  it("floors the percentage against max, not the other way round", () => {
    // 5% of 999 = 49.95 -> 49. Truncation, never a rounded-up floor.
    expect(doomsdayClockTroopFloor(999, 100, decaying)).toBe(49);
  });
});

// ---------------------------------------------------------------------------
// TERRITORY ROT. A doomed side whose army has bottomed out starts losing LAND,
// which is what actually ends a stalemate — the drain alone stops at the floor.
//
// Rot SPREADS: a few seeds deep inside the territory, then outward through their
// neighbours, so the fakes lay tiles out on a real GRID x GRID board (ref =
// y * GRID + x) and FakeGame.neighbors walks it. Note the fake's relinquish(tile)
// takes no conqueror, exactly like GameImpl's: rot cannot credit a kill or
// transfer gold even by accident.
// ---------------------------------------------------------------------------

const GRID = 32;

/** A solid w x h block of tiles at (x0, y0), split into interior and border. */
function gridBlock(x0: number, y0: number, w: number, h: number) {
  const interior: TileRef[] = [];
  const border: TileRef[] = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const tile = (y * GRID + x) as TileRef;
      const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      (edge ? border : interior).push(tile);
    }
  }
  return { interior, border, all: [...interior, ...border] };
}

describe("DoomsdayClockExecution (territory rot)", () => {
  const BLOCK = gridBlock(4, 4, 10, 10); // 100 tiles: 64 interior, 36 border
  const DEADLINE = 60; // seconds from skull to gone, for these fixtures

  // A leader safely above the bar plus a doomed side already sitting at its troop
  // floor (maxTroops 100 -> 5% floor = 5, and we start it at 0), so the very first
  // post-warn tick both drains (a no-op) and rots.
  function rotGame(
    over: Partial<SDConfig> = {},
    doomedId = 7,
    world = { land: 1000, leaderTiles: 400 },
  ) {
    const game = new FakeGame(
      world.land,
      sdConfig({ rotDeathSeconds: DEADLINE, rotGrainSeconds: 20, ...over }),
      [],
    );
    const leader = new FakePlayer(game, world.leaderTiles, 1000);
    const doomed = new FakePlayer(game, 0, 100);
    doomed.troopCount = 0; // bottomed out
    doomed.id = doomedId;
    doomed.giveTiles(BLOCK.interior, BLOCK.border); // 100 tiles, below the 250 bar
    game.ps = [leader, doomed];
    return { game, leader, doomed, exec: makeExec(game) };
  }

  /** Run the warn tick plus `seconds` rotting seconds. */
  function rotFor(
    g: ReturnType<typeof rotGame>,
    seconds: number,
    from = WAVE_TICK,
  ): void {
    for (let s = 0; s <= seconds; s++) runAt(g.exec, g.game, from + s * 10);
  }

  it("does nothing when rotDeathSeconds is 0", () => {
    const g = rotGame({ rotDeathSeconds: 0 });
    rotFor(g, 200);
    expect(g.doomed.relinquished).toHaveLength(0);
    expect(g.doomed.numTilesOwned()).toBe(100);
    expect(g.doomed.isAlive()).toBe(true); // the drain alone can never finish it
  });

  it("holds off during the warn window", () => {
    const g = rotGame();
    runAt(g.exec, g.game, WAVE_TICK); // flagged, 0s under -> still warning
    expect(g.doomed.relinquished).toHaveLength(0);
  });

  it("spares a side that still has an army above the floor", () => {
    const g = rotGame();
    g.doomed.troopCount = 100; // full stack: draining, but not bottomed out
    rotFor(g, 1); // the fixture drain is steep; one second still leaves an army
    expect(g.doomed.troops()).toBeLessThan(100); // the drain is biting...
    expect(g.doomed.troops()).toBeGreaterThan(5); // ...but it is above the floor
    expect(g.doomed.relinquished).toHaveLength(0); // ...so the land is safe
  });

  it("waits for the comeback window to close before rotting", () => {
    const g = rotGame({ floorStartPercent: 40, floorDecaySeconds: 30 });
    rotFor(g, 30); // window runs from the END of the warn (warnSeconds is 1 here)
    expect(g.doomed.relinquished).toHaveLength(0);

    runAt(g.exec, g.game, WAVE_TICK + 31 * 10);
    expect(g.doomed.relinquished.length).toBeGreaterThan(0);
  });

  // --- the deadline, which is the whole point -------------------------------

  it("kills the side COMPLETELY and on time, whatever its size", () => {
    // The quota is ceil(tilesLeft / secondsLeft), so size changes the rate, never
    // the finish time. This is what stops big players outliving the round.
    for (const w of [4, 8, 10]) {
      const g = rotGame();
      const block = gridBlock(2, 2, w, 3);
      g.doomed.giveTiles(block.interior, block.border);
      const held = g.doomed.numTilesOwned();
      rotFor(g, DEADLINE);
      expect(g.doomed.numTilesOwned()).toBe(0);
      expect(g.doomed.isAlive()).toBe(false); // PlayerImpl: isAlive() = tiles > 0
      // The fake throws on a double relinquish, so this also proves each tile went
      // exactly once -- none double-counted against the quota.
      expect(g.doomed.relinquished).toHaveLength(held);
      expect(new Set(g.doomed.relinquished).size).toBe(held);
    }
  });

  it("finishes on time even when rot starts late in the budget", () => {
    // A long warn + comeback window eats most of the deadline. The quota inflates
    // to compensate: a slow start means a faster finish, never a missed deadline.
    const g = rotGame({ warnSeconds: 20, floorDecaySeconds: 25 });
    rotFor(g, DEADLINE);
    expect(g.doomed.numTilesOwned()).toBe(0);
    expect(g.doomed.isAlive()).toBe(false);
  });

  it("does not dump the whole territory in one second", () => {
    // The deadline must not read as a mass deletion: with room to work, no single
    // second may take more than a modest slice.
    const g = rotGame();
    let last = 0;
    const perSecond: number[] = [];
    for (let s = 0; s <= DEADLINE; s++) {
      runAt(g.exec, g.game, WAVE_TICK + s * 10);
      perSecond.push(g.doomed.relinquished.length - last);
      last = g.doomed.relinquished.length;
    }
    expect(Math.max(...perSecond)).toBeLessThan(20); // of 100 tiles
  });

  // --- how it looks ---------------------------------------------------------

  it("opens MANY holes in the grainy phase, scattered across the territory", () => {
    // Graininess is a share of the TERRITORY, so it only means anything at scale:
    // 15% of 900 tiles over 20s is ~7 new specks every second.
    // A 10x larger world so a 900-tile territory is still below the bar (25% of
    // 10000 = 2500) and its holder is not the leader.
    const g = rotGame({ rotGrainSeconds: 20, rotSpecklePercent: 15 }, 7, {
      land: 10000,
      leaderTiles: 5000,
    });
    const big = gridBlock(1, 1, 30, 30); // 900 tiles
    g.doomed.giveTiles(big.interior, big.border);
    rotFor(g, 5);

    const rotted = g.doomed.relinquished;
    expect(rotted.length).toBeGreaterThan(25); // dozens of holes, not one or two

    // Scattered, not clustered: they span most of the block in both axes.
    const xs = rotted.map((t) => t % GRID);
    const ys = rotted.map((t) => Math.floor(t / GRID));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(15);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(15);

    // And it is still only a nibble of the whole — grainy, not gone.
    expect(g.doomed.numTilesOwned()).toBeGreaterThan(800);
  });

  it("starts INSIDE the territory, not on the frontier", () => {
    const g = rotGame();
    rotFor(g, 1);
    expect(g.doomed.relinquished.length).toBeGreaterThan(0);
    // The SEED is what sets the tone: it must open inside the territory. Tiles
    // taken after it come from spreading, which can legitimately reach the edge.
    expect(BLOCK.interior).toContain(g.doomed.relinquished[0]);
  });

  it("SPREADS from the holes as well as speckling new ones", () => {
    // Past the grainy phase the whole quota grows existing holes, so every tile
    // taken then must touch something already rotted.
    const g = rotGame({ rotGrainSeconds: 3 });
    rotFor(g, 3); // grainy phase over
    const afterGrain = g.doomed.relinquished.length;
    const seen = new Set(g.doomed.relinquished);
    rotFor(g, 8, WAVE_TICK + 4 * 10);

    const grown = g.doomed.relinquished.slice(afterGrain);
    expect(grown.length).toBeGreaterThan(0);
    for (const tile of grown) {
      const touching = g.game
        .neighbors(tile)
        .some((n) => seen.has(n as TileRef));
      expect(touching).toBe(true);
      seen.add(tile);
    }
  });

  it("stamps every rotting second, which is what drives the red skull", () => {
    // PlayerImpl.isDecaying() is a short window after this stamp, so a gap here
    // would make the on-map cue strobe.
    const g = rotGame();
    expect(g.doomed.rottedAtTick).toBe(-1); // nothing yet
    rotFor(g, 1);
    expect(g.doomed.rottedAtTick).toBe(WAVE_TICK + 10); // first rotting second
    rotFor(g, 3, WAVE_TICK + 20);
    expect(g.doomed.rottedAtTick).toBe(WAVE_TICK + 50); // re-stamped, not stale
  });

  it("kills islands too, by speckling when a blob is walled in", () => {
    const g = rotGame();
    const far = gridBlock(20, 20, 4, 4);
    g.doomed.giveTiles(
      [...BLOCK.interior, ...far.interior],
      [...BLOCK.border, ...far.border],
    );
    rotFor(g, DEADLINE);
    expect(g.doomed.numTilesOwned()).toBe(0);
    expect(g.doomed.relinquished).toHaveLength(116);
  });

  // --- recovery and determinism --------------------------------------------

  it("stops the moment the side climbs back above the bar", () => {
    const g = rotGame();
    rotFor(g, 2);
    const taken = g.doomed.relinquished.length;
    expect(taken).toBeGreaterThan(0);

    g.doomed.tileCount = 400; // recovered
    runAt(g.exec, g.game, WAVE_TICK + 30);
    expect(g.doomed.inDoomsdayClock()).toBe(false);
    expect(g.doomed.relinquished).toHaveLength(taken); // no further rot
  });

  it("gives a recovered side its full deadline again, from scratch", () => {
    // Surviving a scare must reset the clock: the doom mark is cleared, so the
    // next spell starts a fresh budget rather than resuming a nearly-expired one.
    const g = rotGame();
    rotFor(g, 5);
    const held = g.doomed.numTilesOwned();
    g.doomed.tileCount = 400; // recovered
    runAt(g.exec, g.game, WAVE_TICK + 60);
    g.doomed.tileCount = held; // doomed again
    runAt(g.exec, g.game, WAVE_TICK + 70); // re-flagged: back inside the warn
    expect(g.doomed.numTilesOwned()).toBe(held); // nothing taken yet
    runAt(g.exec, g.game, WAVE_TICK + 80); // first second of the new spell
    // A fresh budget, so the first bite is small, not a catch-up wipe.
    expect(g.doomed.numTilesOwned()).toBeGreaterThan(held - 10);
    expect(g.doomed.numTilesOwned()).toBeLessThan(held);
  });

  it("picks the same tiles from the same seed — the lockstep sim requires it", () => {
    const a = rotGame();
    const b = rotGame();
    for (let s = 0; s <= 8; s++) {
      runAt(a.exec, a.game, WAVE_TICK + s * 10);
      runAt(b.exec, b.game, WAVE_TICK + s * 10);
    }
    expect(a.doomed.relinquished.length).toBeGreaterThan(5);
    expect(a.doomed.relinquished).toEqual(b.doomed.relinquished);
  });

  it("seeds per player, so two doomed sides don't rot in lockstep", () => {
    const a = rotGame({}, 1);
    const b = rotGame({}, 2);
    for (const g of [a, b]) rotFor(g, 4);
    expect(a.doomed.relinquished).not.toEqual(b.doomed.relinquished);
  });

  it("never rots the leader, whatever its territory looks like", () => {
    const g = rotGame();
    g.leader.giveTiles(BLOCK.interior, BLOCK.border); // real tiles for the leader too
    g.leader.tileCount = 400; // still the biggest side
    g.leader.troopCount = 0; // and bottomed out, which must not matter
    rotFor(g, DEADLINE);
    expect(g.leader.relinquished).toHaveLength(0);
    expect(g.leader.isAlive()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Territory rot against the REAL simulation. The fakes above pin the selection
// rules; this pins the thing that actually matters — that relinquishing tiles
// out of a live player kills them, hands the land to nobody, and credits no one
// with the kill.
// ---------------------------------------------------------------------------

describe("DoomsdayClockExecution (territory rot, real simulation)", () => {
  it("rots a doomed player off the map, leaving the land unowned", async () => {
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
    giveLandTiles(game, big, 4000); // safely above the bar: the leader, exempt
    giveLandTiles(game, small, 60); // caught once the bar rises
    game.addExecution(new PlayerExecution(big));
    game.addExecution(new PlayerExecution(small)); // real income every tick
    game.addExecution(new DoomsdayClockExecution());

    // Rot is internal tuning, not wire-configurable, so switch it on directly.
    const cfg = game.config();
    vi.spyOn(cfg, "doomsdayClockConfig").mockReturnValue({
      ...cfg.doomsdayClockConfig(),
      rotDeathSeconds: 200, // the target: gone within ~3.5 minutes of the skull
    });

    const held = [...small.tiles()];
    expect(held).toHaveLength(60);
    // Cities on rotted ground must not be left standing. Rot does not delete them
    // itself -- PlayerExecution already removes structures on unowned land.
    for (const t of [held[0], held[20], held[40]]) {
      small.buildUnit(UnitType.City, t, {});
    }
    expect(small.units(UnitType.City)).toHaveLength(3);
    const bigTilesBefore = big.numTilesOwned();

    // Past the 600s grace, into the waves, and on until the sliver is gone.
    let sawDecaying = false;
    let lostCityWhileAlive = false;
    for (let i = 0; i < 20_000 && small.isAlive(); i++) {
      game.executeNextTick();
      if (small.isDecaying()) sawDecaying = true;
      if (small.units(UnitType.City).length < 3) lostCityWhileAlive = true;
    }

    expect(small.isAlive()).toBe(false);
    expect(small.numTilesOwned()).toBe(0);
    // The client paints the red "Decaying" skull off this flag, so it has to have
    // been true while the rotting was happening — and false once there is nothing
    // left to rot.
    expect(sawDecaying).toBe(true);
    expect(small.isDecaying()).toBe(false);
    // Gone with their ground, not merely swept up by death cleanup.
    expect(lostCityWhileAlive).toBe(true);
    expect(small.units(UnitType.City)).toHaveLength(0);
    // The land fell off the map — it was not conquered, so nobody owns it and the
    // leader gained nothing (relinquish takes no conqueror: no kill, no gold).
    for (const tile of held) expect(game.owner(tile).isPlayer()).toBe(false);
    expect(big.numTilesOwned()).toBe(bigTilesBefore);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The shipped timeline. These are the numbers the feature was tuned to and
// verified against in-game, so they are pinned: changing them should be a
// deliberate edit here, not a side effect of touching the drain or the floor.
// ---------------------------------------------------------------------------

describe("doomsday clock: the shipped timeline", () => {
  it("blinks for 30s, rots at 120s, and is gone at 150s", async () => {
    const game = await setup(
      "plains",
      {
        instantBuild: true,
        doomsdayClock: { enabled: true, speed: "veryfast" },
      },
      [playerInfo("a", PlayerType.Human)],
    );
    const cfg = game.config().doomsdayClockConfig();

    // Skull blinks until the warn ends, then holds steady (PlayerStatus.ts keys
    // the blink off exactly this).
    expect(cfg.warnSeconds).toBe(30);

    // Rot is gated on the floor's decay window closing, so the red "Decaying"
    // phase begins warnSeconds + floorDecaySeconds after the skull appears.
    expect(cfg.warnSeconds + cfg.floorDecaySeconds).toBe(120);

    // ...and by then the floor has reached its 5% low, not a moment before.
    expect(doomsdayClockTroopFloor(1000, cfg.floorDecaySeconds, cfg)).toBe(
      Math.floor((1000 * cfg.drainFloorPercent) / 100),
    );
    expect(
      doomsdayClockTroopFloor(1000, cfg.floorDecaySeconds - 1, cfg),
    ).toBeGreaterThan(Math.floor((1000 * cfg.drainFloorPercent) / 100));

    // Everything is gone at the deadline, leaving 30s of visible rotting.
    expect(cfg.rotDeathSeconds).toBe(150);
    const rotWindow =
      cfg.rotDeathSeconds - (cfg.warnSeconds + cfg.floorDecaySeconds);
    expect(rotWindow).toBe(30);
    // The grainy opening has to fit inside that window with room to spread after,
    // so it stays a minority of it rather than merely shorter than it.
    expect(cfg.rotGrainSeconds).toBeLessThan(rotWindow / 2);
  });
});

// ---------------------------------------------------------------------------
// The two rot noise fields. They look interchangeable and are not: each one is
// wrong for the other's job, in a way that only shows up on screen. Both
// properties below were broken during development, so they are pinned here.
// ---------------------------------------------------------------------------

describe("rot noise fields", () => {
  const GRID = 60;
  const lowest = (fn: (x: number, y: number) => number) => {
    const p: [number, number][] = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (fn(x, y) < ROT_NOISE_SCALE / 10) p.push([x, y]);
      }
    }
    return p;
  };
  /** Share of picks that touch another pick — clumping, which reads as static. */
  const touching = (p: [number, number][]) => {
    const set = new Set(p.map(([x, y]) => `${x},${y}`));
    const near = p.filter(([x, y]) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => set.has(`${x + dx},${y + dy}`)),
    );
    return near.length / p.length;
  };

  it("speckle noise scatters evenly — it must NOT be a plain hash", () => {
    const even = lowest((x, y) => rotSpeckleNoise(x, y, 7));
    const hashed = lowest((x, y) => rotFrontNoise(y * GRID + x, 7));
    expect(even.length).toBeGreaterThan(200); // a real sample, not a few points
    // The lattice leaves picks non-adjacent; a hash clumps a third of them.
    expect(touching(even)).toBeLessThan(0.05);
    expect(touching(hashed)).toBeGreaterThan(0.2);
  });

  it("front noise is isotropic — it must NOT be the lattice", () => {
    // The lattice's low values form a CRYSTAL: every pick's nearest neighbour sits
    // at one of a handful of fixed offsets. That is what makes it space things
    // evenly, and also what makes it useless for growth -- a front that always eats
    // its lowest-valued tile marches along those offsets and grows a straight
    // filament (measured 80x20) instead of a shape. The hash has no such axes.
    const nnOffsets = (p: [number, number][]) => {
      const seen = new Set<string>();
      for (const [x, y] of p) {
        let best = Infinity;
        let off = "";
        for (const [a, b] of p) {
          if (a === x && b === y) continue;
          const d = (a - x) ** 2 + (b - y) ** 2;
          if (d < best) {
            best = d;
            off = `${a - x},${b - y}`;
          }
        }
        seen.add(off);
      }
      return seen.size;
    };
    const lattice = nnOffsets(lowest((x, y) => rotSpeckleNoise(x, y, 7)));
    const hash = nnOffsets(lowest((x, y) => rotFrontNoise(y * GRID + x, 7)));
    expect(lattice).toBeLessThan(12); // crystalline: a few fixed axes
    expect(hash).toBeGreaterThan(25); // isotropic: no preferred direction
  });

  it("both are deterministic and in range, and vary per salt", () => {
    for (let i = 0; i < 50; i++) {
      const a = rotSpeckleNoise(i, i * 3, 1);
      const b = rotFrontNoise(i, 1);
      expect(a).toBe(rotSpeckleNoise(i, i * 3, 1));
      expect(b).toBe(rotFrontNoise(i, 1));
      for (const v of [a, b]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(ROT_NOISE_SCALE);
      }
    }
    // Two doomed sides must not rot in the same pattern.
    const p1 = lowest((x, y) => rotSpeckleNoise(x, y, 1));
    const p2 = lowest((x, y) => rotSpeckleNoise(x, y, 2));
    expect(p1).not.toEqual(p2);
  });
});

// ---------------------------------------------------------------------------
// The rot quota is shared between the sim and the HUD readout, so the number a
// player sees is the number being applied to them. Pinned here because a drift
// between the two would be invisible until someone counted tiles on screen.
// ---------------------------------------------------------------------------

describe("doomsdayClockRotQuota", () => {
  const cfg = { rotDeathSeconds: 150 };

  it("is off when there is nothing to rot, or rot is disabled", () => {
    expect(doomsdayClockRotQuota(0, 130, cfg)).toBe(0);
    expect(doomsdayClockRotQuota(100, 130, { rotDeathSeconds: 0 })).toBe(0);
  });

  it("spreads the territory evenly over the time left, rounding up", () => {
    // 30s of rot window left at the moment rot starts (150 - 120).
    expect(doomsdayClockRotQuota(300, 120, cfg)).toBe(10);
    expect(doomsdayClockRotQuota(301, 120, cfg)).toBe(11); // never rounds down
  });

  it("climbs as the deadline nears, so a stalled rot still finishes on time", () => {
    const early = doomsdayClockRotQuota(300, 120, cfg);
    const late = doomsdayClockRotQuota(300, 145, cfg);
    expect(late).toBeGreaterThan(early);
    // At and past the deadline the whole remainder goes in one second.
    expect(doomsdayClockRotQuota(300, 150, cfg)).toBe(300);
    expect(doomsdayClockRotQuota(300, 999, cfg)).toBe(300);
  });

  it("actually clears the territory by the deadline", () => {
    let tiles = 1000;
    for (let s = 120; s < cfg.rotDeathSeconds && tiles > 0; s++) {
      tiles -= doomsdayClockRotQuota(tiles, s, cfg);
    }
    expect(tiles).toBeLessThanOrEqual(0);
  });
});
