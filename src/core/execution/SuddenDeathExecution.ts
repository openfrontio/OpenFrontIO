import {
  Execution,
  Game,
  GameMode,
  Player,
  PlayerType,
  Team,
} from "../game/Game";
import {
  suddenDeathDrain,
  suddenDeathSideRequiredTiles,
} from "../game/SuddenDeath";

/**
 * OFM sudden-death (anti-stall). Once armed, every alive side must hold a rising
 * share of the whole map: each player in FFA, each whole team in team modes (so
 * a team is judged on its combined territory and every member shares the fate).
 * The bar rises in discrete waves (battle-royale zone), stepping up to each
 * wave's level (chosen by the speed preset, see SuddenDeath.ts) and holding. As
 * it rises the bottom is cut, which forces consolidation and guarantees a finish.
 *
 * A side below the bar is marked (inSuddenDeath -> blinking skull on the client)
 * and, after the warn window, every member bleeds an escalating percentage of
 * their troops until the side recovers or hits zero. Climbing back above the bar
 * clears the mark and stops the drain.
 *
 * Deterministic: integer-only. The threshold is one floored integer ratio (see
 * SuddenDeath.ts) and the drain a floored percentage, no floating-point. Off
 * unless enabled in the GameConfig. Runs once per second (every 10 ticks), like
 * WinCheckExecution.
 */
export class SuddenDeathExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (ticks % 10 !== 0) return; // once per second
    if (this.mg === null) throw new Error("Not initialized");
    const mg = this.mg;
    const cfg = mg.config().suddenDeathConfig();
    if (!cfg.enabled) return;

    const elapsed = mg.elapsedGameSeconds();
    // Humans and Nations are subject to sudden death; the small map bots are not
    // (the !== Bot idiom used across the codebase).
    const contenders = mg
      .players()
      .filter((p) => p.type() !== PlayerType.Bot && p.isAlive());

    // The bar applies per side: each player in FFA, each whole team otherwise.
    const ffa = mg.config().gameConfig().gameMode === GameMode.FFA;
    const sides = this.sides(contenders, ffa);

    // A winner is already inevitable (one side left): idle. Before the first
    // wave the bar is 0, so nobody is flagged anyway.
    if (sides.length < 2) {
      for (const p of contenders) p.clearSuddenDeath();
      return;
    }

    const land = mg.numLandTiles() - mg.numTilesWithFallout();

    // The leading side (the crown holder in FFA, the top team otherwise) is
    // never doomed. Sudden death culls the challengers toward the leader, so the
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
      const required = suddenDeathSideRequiredTiles(
        cfg.speed,
        land,
        elapsed,
        members.length,
      );
      // A non-leading side below the bar skulls and drains every member; the
      // leader (and any side above the bar) clears them all.
      if (i !== leaderIdx && sideTiles[i] < required) {
        for (const m of members) {
          m.enterSuddenDeath();
          const secondsUnder = Math.floor(m.suddenDeathTicks() / 10);
          if (secondsUnder >= cfg.warnSeconds) {
            const chunk = suddenDeathDrain(
              mg.config().maxTroops(m),
              secondsUnder - cfg.warnSeconds,
              cfg,
            );
            m.removeTroops(chunk); // caps at current troops
          }
        }
      } else {
        for (const m of members) m.clearSuddenDeath();
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
