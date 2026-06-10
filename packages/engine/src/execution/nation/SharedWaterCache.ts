import { Game, Player, PlayerType } from "../../game/Game";

/**
 * Cache for "which water components does each nation share with a
 * valid trade partner". Used by nation AI to decide whether to spend cycles
 * trying to place a port on a given coastline.
 *
 * Rebuilt at most once every TTL_TICKS (3s at 10 ticks/s). Port placement is
 * not time-critical - a nation noticing a newly-valid port site a few seconds
 * late is fine and lets us amortize the O(total_border_tiles) build across
 * far more callers than a per-tick cache would.
 */
const TTL_TICKS = 30;

/** Sentinel added to a player's shared-water set to signal "touches ocean". */
const OCEAN_SENTINEL = -1;

export class SharedWaterCache {
  private tick: number = -Infinity;
  private byPlayer: Map<Player, Set<number> | null> | null = null;

  constructor(private game: Game) {}

  get(player: Player): Set<number> | null {
    const tick = this.game.ticks();
    if (this.byPlayer === null || tick - this.tick >= TTL_TICKS) {
      this.byPlayer = this.build();
      this.tick = tick;
    }
    return this.byPlayer.get(player) ?? null;
  }

  private build(): Map<Player, Set<number> | null> {
    const game = this.game;

    // Pass 1: for each non-bot player, record which water bodies they touch
    // and which lakes have them as a candidate trade partner. Bots are skipped
    // entirely — nation AI is the only caller, and bots are never candidate
    // trade partners.
    const playerToWater = new Map<
      Player,
      { hasOcean: boolean; lakes: Set<number> }
    >();
    const lakePartners = new Map<number, Player[]>();

    for (const player of game.players()) {
      if (player.type() === PlayerType.Bot) continue;

      let hasOcean = false;
      const lakes = new Set<number>();
      for (const tile of player.borderTiles()) {
        if (!game.isShore(tile)) continue;
        for (const neighbor of game.neighbors(tile)) {
          if (!game.isWater(neighbor)) continue;
          if (game.isOcean(neighbor)) {
            hasOcean = true;
            continue;
          }
          const comp = game.getWaterComponent(neighbor);
          if (comp !== null) lakes.add(comp);
        }
      }
      playerToWater.set(player, { hasOcean, lakes });

      for (const c of lakes) {
        let arr = lakePartners.get(c);
        if (arr === undefined) {
          arr = [];
          lakePartners.set(c, arr);
        }
        arr.push(player);
      }
    }

    // Pass 2: ocean is treated as always shared (nation AI short-circuits on
    // ocean neighbors). Lake components are shared only if some *other* player
    // on that component can trade with P (i.e. no mutual embargo).
    const result = new Map<Player, Set<number> | null>();
    for (const [player, { hasOcean, lakes }] of playerToWater) {
      const shared = new Set<number>();

      if (hasOcean) shared.add(OCEAN_SENTINEL);

      for (const c of lakes) {
        const partners = lakePartners.get(c);
        if (partners === undefined) continue;
        for (const other of partners) {
          if (other !== player && player.canTrade(other)) {
            shared.add(c);
            break;
          }
        }
      }

      result.set(player, shared.size > 0 ? shared : null);
    }
    return result;
  }
}
