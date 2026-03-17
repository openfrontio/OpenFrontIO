import { Attack, Player, TerraNullius } from "./Game";
import { GameImpl } from "./GameImpl";
import { TileRef } from "./GameMap";
import { PlayerImpl } from "./PlayerImpl";

export class AttackImpl implements Attack {
  private _isActive = true;
  private _borderSize = 0;
  public _retreating = false;
  public _retreated = false;

  constructor(
    private _id: string,
    private _target: Player | TerraNullius,
    private _attacker: Player,
    private _troops: number,
    private _sourceTile: TileRef | null,
    private _border: Set<number>,
    private _mg: GameImpl,
  ) {}

  sourceTile(): TileRef | null {
    return this._sourceTile;
  }

  target(): Player | TerraNullius {
    return this._target;
  }
  attacker(): Player {
    return this._attacker;
  }
  troops(): number {
    return this._troops;
  }
  setTroops(troops: number) {
    this._troops = Math.max(0, troops);
  }

  isActive() {
    return this._isActive;
  }

  id() {
    return this._id;
  }

  delete() {
    if (this._target.isPlayer()) {
      (this._target as PlayerImpl)._incomingAttacks = (
        this._target as PlayerImpl
      )._incomingAttacks.filter((a) => a !== this);
    }

    (this._attacker as PlayerImpl)._outgoingAttacks = (
      this._attacker as PlayerImpl
    )._outgoingAttacks.filter((a) => a !== this);

    this._isActive = false;
  }

  orderRetreat() {
    this._retreating = true;
  }

  executeRetreat() {
    this._retreated = true;
  }

  retreating(): boolean {
    return this._retreating;
  }

  retreated(): boolean {
    return this._retreated;
  }

  borderSize(): number {
    return this._borderSize;
  }

  clearBorder(): void {
    this._borderSize = 0;
    this._border.clear();
  }

  addBorderTile(tile: TileRef): void {
    if (!this._border.has(tile)) {
      this._borderSize += 1;
      this._border.add(tile);
    }
  }

  removeBorderTile(tile: TileRef): void {
    if (this._border.has(tile)) {
      this._borderSize -= 1;
      this._border.delete(tile);
    }
  }

  frontLinePositions(): TileRef[] {
    if (this._borderSize === 0) {
      const tile = this.sourceTile();
      return tile !== null ? [tile] : [];
    }

    // Segments smaller than this are suppressed; the largest is always kept.
    const MIN_FRONT_LINE_LENGTH = 30;
    const map = this._mg.map();
    const visited = new Set<TileRef>();
    const clusters: { representative: TileRef; size: number }[] = [];

    for (const startTile of this._border) {
      if (visited.has(startTile)) continue;

      const queue: TileRef[] = [startTile];
      visited.add(startTile);
      let qi = 0;
      let sumX = 0;
      let sumY = 0;
      let count = 0;

      while (qi < queue.length) {
        const tile = queue[qi++];
        const tx = map.x(tile);
        const ty = map.y(tile);
        sumX += tx;
        sumY += ty;
        count++;

        // 8-directional BFS so diagonal border tiles merge into one cluster
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            if (!map.isValidCoord(tx + dx, ty + dy)) continue;
            const neighbor = map.ref(tx + dx, ty + dy);
            if (this._border.has(neighbor) && !visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
      }

      // Pick the border tile nearest to the cluster centroid as representative
      const cx = sumX / count;
      const cy = sumY / count;
      let best = queue[0];
      let bestDist = Infinity;
      for (const tile of queue) {
        const dx = map.x(tile) - cx;
        const dy = map.y(tile) - cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = tile;
        }
      }
      clusters.push({ representative: best, size: count });
    }

    // Sort largest first so index 0 is always the main front line
    clusters.sort((a, b) => b.size - a.size);

    // Keep only clusters above the minimum size; always keep at least the largest
    const significant = clusters.filter((c) => c.size >= MIN_FRONT_LINE_LENGTH);
    const kept = significant.length > 0 ? significant : [clusters[0]];
    return kept.map((c) => c.representative);
  }
}
