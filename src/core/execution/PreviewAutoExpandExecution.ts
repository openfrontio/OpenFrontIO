import { Execution, Game, Player, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";

// The previewing player is given (and kept topped up to) a huge army, matching
// the "100 million troops poured into the wilderness" framing of the feature.
const PREVIEW_TROOPS = 100_000_000;

// How many rings of wilderness to swallow per tick. Higher = faster spread.
const RINGS_PER_TICK = 10;

/**
 * Drives the singleplayer skin-preview sandbox: every tick it tops the human
 * player up to {@link PREVIEW_TROOPS} and floods their territory outward by one
 * ring, conquering every unclaimed land tile bordering them.
 *
 * The normal attack mechanic throttles expansion into terra nullius to a slow
 * crawl no matter how many troops are involved, which is the opposite of what a
 * "watch your skin spread across the map" preview wants. Since this only ever
 * runs in a throwaway singleplayer sandbox (no opponents, never saved), we
 * expand by conquering directly — a smooth radial flood-fill that visibly
 * covers the continent with the previewed cosmetic.
 *
 * Runs until the user clicks "Finish preview"; it naturally goes quiet once
 * there's no unclaimed land left to take.
 */
export class PreviewAutoExpandExecution implements Execution {
  private active = true;
  private mg: Game;
  private player: Player | null = null;

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (this.player === null) {
      this.player =
        this.mg.players().find((p) => p.type() === PlayerType.Human) ?? null;
      if (this.player === null) return;
    }
    const player = this.player;
    if (!player.isAlive()) return;

    // Keep the army huge so the HUD (if shown) reflects the giant force.
    player.setTroops(PREVIEW_TROOPS);

    // Flood outward by several rings per tick: each pass conquers every
    // unclaimed land tile touching the player's current border.
    for (let ring = 0; ring < RINGS_PER_TICK; ring++) {
      const frontier = new Set<TileRef>();
      for (const border of player.borderTiles()) {
        this.mg.forEachNeighbor(border, (n) => {
          if (this.mg.isLand(n) && !this.mg.hasOwner(n)) {
            frontier.add(n);
          }
        });
      }
      if (frontier.size === 0) break; // fully expanded — nothing left to take
      for (const tile of frontier) {
        player.conquer(tile);
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
