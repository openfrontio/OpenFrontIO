import { Attack, Cell, Player, TerraNullius } from "./Game";
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

  clusterPositions(): Cell[] {
    // Minimum border tiles for a cluster to get its own label.
    // Clusters smaller than this are suppressed (except we always keep the largest).
    const MIN_CLUSTER_SIZE = 30;

    if (this._borderSize === 0) {
      const avg = this.averagePosition();
      return avg ? [avg] : [];
    }

    const map = this._mg.map();
    const visited = new Set<TileRef>();
    const clusters: { centroid: Cell; size: number }[] = [];

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

      clusters.push({
        centroid: new Cell(sumX / count, sumY / count),
        size: count,
      });
    }

    // Keep only clusters above the minimum size.
    // Always keep the largest cluster so there's at least one label.
    const significant = clusters.filter((c) => c.size >= MIN_CLUSTER_SIZE);
    if (significant.length === 0) {
      const largest = clusters.reduce((a, b) => (b.size > a.size ? b : a));
      return [largest.centroid];
    }
    return significant.map((c) => c.centroid);
  }

  averagePosition(): Cell | null {
    if (this._borderSize === 0) {
      if (this.sourceTile() === null) {
        // No border tiles and no source tile—return a default position or throw an error
        return null;
      }
      // No border tiles yet—use the source tile's location
      const tile: number = this.sourceTile()!;
      return new Cell(this._mg.map().x(tile), this._mg.map().y(tile));
    }

    let averageX = 0;
    let averageY = 0;

    for (const t of this._border) {
      averageX += this._mg.map().x(t);
      averageY += this._mg.map().y(t);
    }

    averageX = averageX / this._borderSize;
    averageY = averageY / this._borderSize;

    return new Cell(averageX, averageY);
  }
}
