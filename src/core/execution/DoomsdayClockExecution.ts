import {
  doomsdayClockDrain,
  doomsdayClockSideRequiredTiles,
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

/**
 * Doomsday Clock (anti-stall). Once armed, every side must hold a rising
 * share of the whole map: each player in FFA, each whole team in team modes (so
 * a team is judged on its combined territory and every member shares the fate).
 * The bar rises in discrete waves (battle-royale zone), stepping up to each
 * wave's level (chosen by the speed preset, see DoomsdayClock.ts) and holding. As
 * it rises the bottom is cut, which forces consolidation and guarantees a finish.
 *
 * A side below the bar is marked (inDoomsdayClock -> blinking skull on the client)
 * and, after the warn window, every member bleeds an escalating percentage of
 * their troops until the side recovers or hits zero. Climbing back above the bar
 * clears the mark and stops the drain.
 *
 * Deterministic: integer-only. The threshold is one floored integer ratio (see
 * DoomsdayClock.ts) and the drain a floored percentage, no floating-point. Off
 * unless enabled in the GameConfig. Runs once per second (every 10 ticks), like
 * WinCheckExecution.
 */
export class DoomsdayClockExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

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

    // The leading side (the crown holder in FFA, the top team otherwise) is
    // never doomed. Doomsday Clock culls the challengers toward the leader, so the
    // leader always keeps its army: the game can never freeze with every
    // remaining side bled to zero, and the final wave squeezes out everyone but
    // the leader -> a single winner. First side with the most tiles wins ties
    // (deterministic: sides are built in a fixed order).
    const sideTiles = sides.map((members) =>
      members.reduce((sum, m) => sum + m.numTilesOwned(), 0),
    );
    let leaderIdx = 0;
    for (let i = 1; i < sideTiles.length; i++) {
      if (sideTiles[i] > sideTiles[leaderIdx]) leaderIdx = i;
    }

    for (let i = 0; i < sides.length; i++) {
      const members = sides[i];
      // Threshold scales with the side's headcount: a team of N must hold N× a
      // solo player's share (FFA sides are size 1, unscaled).
      const required = doomsdayClockSideRequiredTiles(
        cfg.speed,
        land,
        elapsed,
        members.length,
      );
      // A non-leading side below the bar skulls and drains every member; the
      // leader (and any side above the bar) clears them all.
      if (i !== leaderIdx && sideTiles[i] < required) {
        for (const m of members) {
          m.enterDoomsdayClock();
          const secondsUnder = Math.floor(m.doomsdayClockTicks() / 10);
          if (secondsUnder >= cfg.warnSeconds) {
            const secondsPastWarn = secondsUnder - cfg.warnSeconds;
            const chunk = doomsdayClockDrain(
              mg.config().maxTroops(m),
              secondsPastWarn,
              cfg,
            );
            m.removeTroops(chunk); // caps at current troops
            // The navy bleeds on the same ramp but toward warshipDrainCfg's far
            // higher ceiling (see above), so a doomed side's fleet is scuttled
            // fast at full attrition. A percentage of each warship's (veterancy-
            // adjusted) max health; passing no attacker makes each destruction
            // environmental, never a credited kill (see UnitImpl.delete). Healing
            // is suppressed for flagged owners in WarshipExecution.healWarship so
            // the decay actually lands.
            for (const ws of m.units(UnitType.Warship)) {
              ws.modifyHealth(
                -doomsdayClockDrain(
                  ws.maxHealth(),
                  secondsPastWarn,
                  warshipDrainCfg,
                  cfg.warshipDrainCurveExponent,
                ),
              );
            }
          }
        }
      } else {
        for (const m of members) m.clearDoomsdayClock();
      }
    }
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
