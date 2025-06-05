import { GameMap, TileRef } from "../game/GameMap";

const CLUSTER_SIZE = 8;

export interface Gateway {
  pos: TileRef;
  clusterA: number;
  clusterB: number;
}

export interface Cluster {
  id: number;
  tiles: TileRef[];
  gateways: Gateway[];
}

export class AbstractGraph {
  public clusters: Cluster[] = [];
  public gateways: Gateway[] = [];

  constructor(private gm: GameMap) {
    this.buildClusters();
    this.buildGateways();
  }

  private buildClusters() {
    const w = this.gm.width();
    const h = this.gm.height();
    let id = 0;
    for (let cy = 0; cy < h; cy += CLUSTER_SIZE) {
      for (let cx = 0; cx < w; cx += CLUSTER_SIZE) {
        const tiles: TileRef[] = [];
        for (let y = cy; y < Math.min(cy + CLUSTER_SIZE, h); y++) {
          for (let x = cx; x < Math.min(cx + CLUSTER_SIZE, w); x++) {
            tiles.push(this.gm.ref(x, y));
          }
        }
        this.clusters.push({ id: id++, tiles, gateways: [] });
      }
    }
  }

  private buildGateways() {
    const w = this.gm.width();
    const h = this.gm.height();
    const clusterIndex = (x: number, y: number) =>
      Math.floor(y / CLUSTER_SIZE) *
        Math.ceil(w / CLUSTER_SIZE) +
      Math.floor(x / CLUSTER_SIZE);

    const maybeAddGateway = (x: number, y: number, x2: number, y2: number) => {
      const a = clusterIndex(x, y);
      const b = clusterIndex(x2, y2);
      if (a === b) return;
      const tile = this.gm.ref(x, y);
      if (this.gm.isWater(tile)) return;
      const gw: Gateway = { pos: tile, clusterA: a, clusterB: b };
      this.gateways.push(gw);
      this.clusters[a].gateways.push(gw);
      this.clusters[b].gateways.push(gw);
    };

    for (let x = CLUSTER_SIZE; x < w; x += CLUSTER_SIZE) {
      for (let y = 0; y < h; y++) {
        maybeAddGateway(x, y, x - 1, y);
      }
    }
    for (let y = CLUSTER_SIZE; y < h; y += CLUSTER_SIZE) {
      for (let x = 0; x < w; x++) {
        maybeAddGateway(x, y, x, y - 1);
      }
    }
  }
}
