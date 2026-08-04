import {
  doomsdayClockDrain,
  doomsdayClockRequiredTiles,
  doomsdayClockTroopFloor,
  ROT_NOISE_SCALE,
  rotFrontNoise,
  rotSpeckleNoise,
} from "../game/DoomsdayClock";
import {
  Execution,
  Game,
  GameMode,
  Player,
  PlayerType,
  Team,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";

/**
 * Doomsday Clock (anti-stall). Once armed, every side must hold a rising
 * share of the whole map: each player in FFA, each whole team in team modes (so
 * a team is judged on its combined territory and every member shares the fate).
 * The bar is the SAME for every side regardless of headcount — the clock shrinks
 * the number of viable SIDES, and sides are the unit of elimination/victory, so
 * a team faces exactly the bar a solo player faces. (It was previously scaled by
 * member count, which saturated at "hold the whole map" right after the grace in
 * real team lobbies and dropped whenever a teammate died — deciding games at
 * ~minute 12 on the slow preset instead of acting as a late-game backstop.)
 * The bar rises in discrete waves (battle-royale zone), stepping up to each
 * wave's level (chosen by the speed preset, see DoomsdayClock.ts) and holding. As
 * it rises the bottom is cut, which forces consolidation and guarantees a finish.
 *
 * A side below the bar is marked (inDoomsdayClock -> blinking skull) and, after
 * the warn window, bleeds troops (and warship health) down to a decaying floor.
 * Climbing back above the bar clears the mark and stops everything below.
 *
 * Once the floor bottoms out, TERRITORY ROT takes land until the side dies. The
 * drain alone never kills, so without rot a stalemate outlives the final wave
 * with every challenger crippled but unkillable. Timings in Config.ts.
 *
 * Deterministic: every value the sim stores is an integer — the threshold is one
 * floored ratio (see DoomsdayClock.ts), the drain and floor are floored
 * percentages, and quotas are exact ceilings over integers. Tile choices come from
 * integer hashes of the tile, salted per player — no PRNG state and no floats. Off
 * unless enabled in the GameConfig. Runs once per second (every 10 ticks), like
 * WinCheckExecution.
 */
/** Keeps the `n` lowest-keyed tiles seen, in one pass and in key order. */
class LowestN {
  private tiles: TileRef[] = [];
  private keys: number[] = [];
  constructor(private readonly n: number) {}
  get size(): number {
    return this.tiles.length;
  }
  offer(tile: TileRef, key: number): void {
    if (
      this.tiles.length === this.n &&
      key >= this.keys[this.tiles.length - 1]
    ) {
      return;
    }
    let i = this.keys.length;
    while (i > 0 && this.keys[i - 1] > key) i--;
    this.tiles.splice(i, 0, tile);
    this.keys.splice(i, 0, key);
    if (this.tiles.length > this.n) {
      this.tiles.pop();
      this.keys.pop();
    }
  }
  take(): TileRef[] {
    return this.tiles;
  }
}

export class DoomsdayClockExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  /** Per doomed player: when rot began, and the tiles it eats next mapped to how
   *  many of their neighbours have already rotted. Kept between ticks so rot
   *  spreads from where it started. Sim-derived, so replay-safe. */
  private rotState = new Map<
    number,
    { since: number; held: number; front: Map<TileRef, number> }
  >();

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (ticks % 10 !== 0) return; // once per second
    if (this.mg === null) throw new Error("Not initialized");
    const mg = this.mg;
    const cfg = mg.config().doomsdayClockConfig();
    if (!cfg.enabled) return;
    // Warships bleed on their OWN gentler start + higher ceiling, and (via the
    // curve exponent passed to the drain below) a STEEP convex ramp: a ship
    // caught when its side is first doomed lasts ~as long as troops, but a side
    // that has been under the clock the full ramp loses ships in ~2s.
    const warshipDrainCfg = {
      ...cfg,
      drainStartPercent: cfg.warshipDrainStartPercent,
      drainMaxPercent: cfg.warshipDrainMaxPercent,
    };

    const elapsed = mg.elapsedGameSeconds();
    // Humans and Nations are subject to it; the small map bots are not (the
    // !== Bot idiom used across the codebase). players() already returns only
    // alive players.
    const contenders = mg.players().filter((p) => p.type() !== PlayerType.Bot);

    // The bar applies per side: each player in FFA, each whole team otherwise.
    const ffa = mg.config().gameConfig().gameMode === GameMode.FFA;
    const sides = this.sides(contenders, ffa);

    // A winner is already inevitable (one side left): idle. Before the first
    // wave the bar is 0, so nobody is flagged anyway.
    if (sides.length < 2) {
      for (const p of contenders) p.clearDoomsdayClock();
      return;
    }

    const land = mg.numLandTiles() - mg.numTilesWithFallout();
    // One bar for every side this tick (solo or team — headcount never scales it).
    const required = doomsdayClockRequiredTiles(cfg.speed, land, elapsed);

    // The leading side (the crown holder in FFA, the top team otherwise) is
    // never doomed. Doomsday Clock culls the challengers toward the leader, so the
    // leader always keeps its army: the game can never freeze with every
    // remaining side crippled at the floor, and the final wave squeezes out
    // everyone but the leader -> a single winner. First side with the most tiles
    // wins ties (deterministic: sides are built in a fixed order).
    const sideTiles = sides.map((members) =>
      members.reduce((sum, m) => sum + m.numTilesOwned(), 0),
    );
    let leaderIdx = 0;
    for (let i = 1; i < sideTiles.length; i++) {
      if (sideTiles[i] > sideTiles[leaderIdx]) leaderIdx = i;
    }

    for (let i = 0; i < sides.length; i++) {
      const members = sides[i];
      // A non-leading side below the bar skulls and drains every member; the
      // leader (and any side above the bar) clears them all.
      if (i !== leaderIdx && sideTiles[i] < required) {
        for (const m of members) {
          m.enterDoomsdayClock();
          const secondsUnder = Math.floor(m.doomsdayClockTicks() / 10);
          if (secondsUnder >= cfg.warnSeconds) {
            const secondsPastWarn = secondsUnder - cfg.warnSeconds;
            // Crippled, not wiped: clamp the removal to what sits above the
            // floor. The floor itself decays, leaving one comeback window.
            const maxTroops = mg.config().maxTroops(m);
            const troopFloor = doomsdayClockTroopFloor(
              maxTroops,
              secondsPastWarn,
              cfg,
            );
            const chunk = doomsdayClockDrain(maxTroops, secondsPastWarn, cfg);
            m.removeTroops(
              Math.min(chunk, Math.max(0, m.troops() - troopFloor)),
            );
            // Paced on secondsUnder: the deadline covers the whole doomed
            // spell, warn and comeback window included.
            if (
              cfg.rotDeathSeconds > 0 &&
              secondsPastWarn >= cfg.floorDecaySeconds &&
              m.troops() <= troopFloor
            ) {
              this.rot(mg, m, secondsUnder, cfg);
            }
            // The navy bleeds on the same ramp but toward warshipDrainCfg's far
            // higher ceiling (see above), so a doomed side's fleet is battered
            // fast at full attrition, down to the SAME floor (drainFloorPercent of
            // each warship's veterancy-adjusted max health) rather than sunk. No
            // attacker is passed, so any loss is environmental, never a credited
            // kill (see UnitImpl.delete). Healing is suppressed for flagged owners
            // in WarshipExecution.healWarship so the decay actually lands.
            for (const ws of m.units(UnitType.Warship)) {
              const shipFloor = Math.floor(
                (ws.maxHealth() * cfg.drainFloorPercent) / 100,
              );
              const removable = Math.max(0, ws.health() - shipFloor);
              if (removable <= 0) continue;
              const dmg = doomsdayClockDrain(
                ws.maxHealth(),
                secondsPastWarn,
                warshipDrainCfg,
                cfg.warshipDrainCurveExponent,
              );
              ws.modifyHealth(-Math.min(dmg, removable));
            }
          }
        }
      } else {
        for (const m of members) {
          m.clearDoomsdayClock();
          this.rotState.delete(m.smallID()); // recovered: any rot starts over
        }
      }
    }
  }

  /**
   * Take territory so the player holds none by rotDeathSeconds after their skull
   * appeared. The per-second quota ceil(tilesLeft / secondsLeft) self-corrects, so
   * the deadline holds whatever the size and however late rot started.
   */
  private rot(
    mg: Game,
    player: Player,
    secondsUnder: number,
    cfg: {
      rotDeathSeconds: number;
      rotGrainSeconds: number;
      rotSpecklePercent: number;
    },
  ): void {
    const owned = player.numTilesOwned();
    if (owned <= 0) return;

    const id = player.smallID();
    const state = this.rotState.get(id) ?? {
      since: mg.ticks(),
      held: owned, // territory at the start, which sets the speckle density
      front: new Map<TileRef, number>(),
    };

    const secondsLeft = Math.max(1, cfg.rotDeathSeconds - secondsUnder);
    const evenQuota = Math.ceil(owned / secondsLeft);

    // Grainy opening, sized off the TERRITORY: a share of the quota would be one
    // or two holes a second on all but a huge empire. Runs ahead; quota absorbs it.
    const grainy = mg.ticks() - state.since < cfg.rotGrainSeconds * 10;
    const specks = grainy
      ? Math.max(
          1,
          Math.ceil(
            (state.held * cfg.rotSpecklePercent) / 100 / cfg.rotGrainSeconds,
          ),
        )
      : 0;
    let budget = Math.min(owned, Math.max(evenQuota, specks));

    const tiles = player.tiles();
    const front = new Map<TileRef, number>();
    for (const [tile, rotted] of state.front) {
      if (tiles.has(tile)) front.set(tile, rotted);
    }

    budget -= this.speckle(mg, player, Math.min(specks, budget), front);
    budget -= this.spread(mg, player, budget, front);
    // Front exhausted (no holes yet, or blobs walled in on an island).
    if (budget > 0) this.speckle(mg, player, budget, front);

    this.rotState.set(id, { since: state.since, held: state.held, front });
  }

  /** Open `count` holes, preferring the INTERIOR so decay starts inside rather
   *  than eroding the frontier. Reservoir sampling: TileSet has no indexing. */
  private speckle(
    mg: Game,
    player: Player,
    count: number,
    front: Map<TileRef, number>,
  ): number {
    if (count <= 0) return 0;
    const salt = player.smallID();
    const border = player.borderTiles();
    // Lowest noise first. The field is near-evenly spaced (see rotNoise), so holes
    // land spread out instead of clotting the way uniform random picks do.
    const interior = new LowestN(count);
    const edge = new LowestN(count);
    player.tiles().forEach((tile) => {
      const key = rotSpeckleNoise(mg.x(tile), mg.y(tile), salt);
      (border.has(tile) ? edge : interior).offer(tile, key);
    });
    const picked =
      interior.size >= count
        ? interior.take()
        : [...interior.take(), ...edge.take()];
    let opened = 0;
    for (const tile of picked) {
      if (opened === count) break;
      if (this.consume(mg, player, tile, front)) opened++;
    }
    return opened;
  }

  /**
   * Grow the holes outward by up to `count` tiles, favouring TIPS: a front tile
   * with one rotted neighbour goes before one with three. That is a cheap local
   * stand-in for the dielectric-breakdown growth exponent — growth concentrates
   * where the field is steepest — and it is the difference between dendritic
   * fingers and the compact round blobs of plain perimeter growth (Eden), which is
   * provably what uniform selection produces. Noise breaks ties so equal-rank
   * tiles do not fill in as tidy diamonds.
   */
  private spread(
    mg: Game,
    player: Player,
    count: number,
    front: Map<TileRef, number>,
  ): number {
    if (count <= 0 || front.size === 0) return 0;
    const salt = player.smallID();
    const pick = new LowestN(count);
    for (const [tile, rotted] of front) {
      const key = rotted * ROT_NOISE_SCALE + rotFrontNoise(tile, salt);
      pick.offer(tile, key);
    }
    let taken = 0;
    for (const tile of pick.take()) {
      if (taken === count) break;
      if (this.consume(mg, player, tile, front)) taken++;
    }
    return taken;
  }

  /**
   * Rot one tile: hand the land to nobody and queue its neighbours. No conqueror
   * is passed, so this is environmental — never a credited kill or captured gold.
   * Anything built on it is deleted by PlayerExecution, which already removes
   * structures standing on unowned land.
   *
   * False if the player no longer holds the tile. relinquish THROWS on unowned
   * land, and a tile can sit on the front twice (reached from two rotted
   * neighbours in one second) or be conquered away between seconds.
   */
  private consume(
    mg: Game,
    player: Player,
    tile: TileRef,
    front: Map<TileRef, number>,
  ): boolean {
    const tiles = player.tiles();
    if (!tiles.has(tile)) return false;
    player.relinquish(tile);
    // Stamp it so the client can paint the red "Decaying" skull off authoritative
    // state instead of re-deriving the (knife-edge) troops-vs-floor test.
    player.markRotted();
    front.delete(tile);
    // Tallying here keeps every front tile's rotted-neighbour count current for
    // free, which is what spread() ranks tips by.
    for (const neighbour of mg.neighbors(tile)) {
      if (tiles.has(neighbour)) {
        front.set(neighbour, (front.get(neighbour) ?? 0) + 1);
      }
    }
    return true;
  }

  /** Group contenders into sides: singletons in FFA, by team otherwise. */
  private sides(contenders: Player[], ffa: boolean): Player[][] {
    if (ffa) return contenders.map((p) => [p]);
    const byTeam = new Map<Team, Player[]>();
    for (const p of contenders) {
      const team = p.team();
      if (team === null) continue;
      const members = byTeam.get(team);
      if (members) members.push(p);
      else byTeam.set(team, [p]);
    }
    return Array.from(byTeam.values());
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
