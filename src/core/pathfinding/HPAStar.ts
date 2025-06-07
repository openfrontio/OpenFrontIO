import { PriorityQueue } from "@datastructures-js/priority-queue";
import { GameMap, TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "./AStar";

/**
 * A standalone, simple A* implementation for finding paths within a constrained local area (a single cluster)
 * @param gameMap The game map
 * @param start The starting tile
 * @param goal The destination tile
 * @param isAccessible A function to check if a tile is traversable and within the allowed search area
 * @returns An array of TileRefs representing the path or null if no path is found
 */
function localAStar(
  gameMap: GameMap,
  start: TileRef,
  goal: TileRef,
  isAccessible: (tile: TileRef) => boolean,
): TileRef[] | null {
  const openSet = new PriorityQueue<{ tile: TileRef; fScore: number }>(
    (a, b) => a.fScore - b.fScore,
  );
  const cameFrom = new Map<TileRef, TileRef>();
  const gScore = new Map<TileRef, number>();

  gScore.set(start, 0);
  openSet.enqueue({
    tile: start,
    fScore: gameMap.manhattanDist(start, goal),
  });

  while (!openSet.isEmpty()) {
    const current = openSet.dequeue().tile;

    if (current === goal) {
      const path: TileRef[] = [];
      let temp: TileRef | undefined = current;
      while (temp !== undefined) {
        path.unshift(temp);
        temp = cameFrom.get(temp);
      }
      return path;
    }

    for (const neighbor of gameMap.neighbors(current)) {
      if (!isAccessible(neighbor)) {
        continue;
      }

      const tentativeGScore = gScore.get(current)! + gameMap.cost(neighbor);
      if (tentativeGScore < (gScore.get(neighbor) ?? Infinity)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeGScore);
        const fScore = tentativeGScore + gameMap.manhattanDist(neighbor, goal);
        openSet.enqueue({ tile: neighbor, fScore });
      }
    }
  }

  return null;
}

interface Cluster {
  id: number;
  x: number;
  y: number;
  tiles: Set<TileRef>;
  entrances: Entrance[];
}

interface Entrance {
  id: string;
  cluster1: number;
  cluster2: number;
  tiles: Set<TileRef>;
  center: TileRef;
}

type AbstractGraph = Map<
  TileRef,
  Map<TileRef, { cost: number; path: TileRef[] }>
>;

/**
 * Manages the HPA* precomputation an stores the resulting abstract graph and cluster data
 * This class performs the heavy lifting and should be instantiated ONCE during a loading phase
 */
export class HPADataManager {
  public clusters: Cluster[][] = [];
  public tileToCluster = new Map<TileRef, Cluster>();
  public abstractGraph: AbstractGraph = new Map();
  private clusterSize: number;
  private gameMap: GameMap;

  constructor(gameMap: GameMap, clusterSize: number) {
    console.time("HPA Pre-computation");
    this.gameMap = gameMap;
    this.clusterSize = clusterSize;

    this._buildClusters();
    this._buildEntrances();
    this._buildAbstractGraph();
    console.timeEnd("HPA Pre-computation");
  }

  private _buildClusters() {
    const mapWidth = this.gameMap.width();
    const mapHeight = this.gameMap.height();
    const numClustersX = Math.ceil(mapWidth / this.clusterSize);
    const numClustersY = Math.ceil(mapHeight / this.clusterSize);
    let clusterIdCounter = 0;

    for (let cy = 0; cy < numClustersY; cy++) {
      this.clusters[cy] = [];
      for (let cx = 0; cx < numClustersX; cx++) {
        const cluster: Cluster = {
          id: clusterIdCounter++,
          x: cx,
          y: cy,
          tiles: new Set(),
          entrances: [],
        };
        const startX = cx * this.clusterSize;
        const startY = cy * this.clusterSize;
        const endX = Math.min(startX + this.clusterSize, mapWidth);
        const endY = Math.min(startY + this.clusterSize, mapHeight);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const tile = this.gameMap.ref(x, y);
            cluster.tiles.add(tile);
            this.tileToCluster.set(tile, cluster);
          }
        }
        this.clusters[cy][cx] = cluster;
      }
    }
  }

  private _buildEntrances() {
    const isTraversable = (tile: TileRef) => this.gameMap.isWater(tile);

    for (let cy = 0; cy < this.clusters.length; cy++) {
      for (let cx = 0; cx < this.clusters[cy].length; cx++) {
        const c1 = this.clusters[cy][cx];

        if (cx + 1 < this.clusters[cy].length) {
          const c2 = this.clusters[cy][cx + 1];
          const borderX = (cx + 1) * this.clusterSize;
          if (borderX < this.gameMap.width()) {
            this._findEntrancesOnBorder(c1, c2, borderX, "vertical", isTraversable);
          }
        }

        if (cy + 1 < this.clusters.length) {
          const c2 = this.clusters[cy + 1][cx];
          const borderY = (cy + 1) * this.clusterSize;
          if (borderY < this.gameMap.height()) {
            this._findEntrancesOnBorder(c1, c2, borderY, "horizontal", isTraversable);
          }
        }
      }
    }
  }

    private _findEntrancesOnBorder(c1: Cluster, c2: Cluster, coord: number, orientation: 'vertical' | 'horizontal', isTraversable: (tile: TileRef) => boolean) {
        const lineStart = orientation === 'vertical' ? c1.y * this.clusterSize : c1.x * this.clusterSize;
        const lineEnd = orientation === 'vertical' ? Math.min((c1.y + 1) * this.clusterSize, this.gameMap.height()) : Math.min((c1.x + 1) * this.clusterSize, this.gameMap.width());

        let currentEntranceTiles: TileRef[] = [];

        for (let i = lineStart; i < lineEnd; i++) {
            const t1 = orientation === 'vertical' ? this.gameMap.ref(coord - 1, i) : this.gameMap.ref(i, coord - 1);
            const t2 = orientation === 'vertical' ? this.gameMap.ref(coord, i) : this.gameMap.ref(i, coord);
            
            if (this.gameMap.isValidCoord(this.gameMap.x(t1), this.gameMap.y(t1)) && this.gameMap.isValidCoord(this.gameMap.x(t2), this.gameMap.y(t2)) && isTraversable(t1) && isTraversable(t2)) {
                currentEntranceTiles.push(t1, t2);
            } else {
                if (currentEntranceTiles.length > 0) {
                    this._createEntrance(c1, c2, currentEntranceTiles);
                    currentEntranceTiles = [];
                }
            }
        }
        if (currentEntranceTiles.length > 0) {
            this._createEntrance(c1, c2, currentEntranceTiles);
        }
    }

  private _createEntrance(c1: Cluster, c2: Cluster, tiles: TileRef[]) {
    const entrance: Entrance = {
      id: `${c1.id}_${c2.id}_${c1.entrances.length}`,
      cluster1: c1.id,
      cluster2: c2.id,
      tiles: new Set(tiles),
      center: tiles[Math.floor(tiles.length / 2)],
    };
    c1.entrances.push(entrance);
    c2.entrances.push(entrance);
  }

  private _buildAbstractGraph() {
    const isTraversable = (tile: TileRef) => this.gameMap.isWater(tile);
    for (const row of this.clusters) {
      for (const cluster of row) {
        if (!cluster) continue;
        const entranceCenters = cluster.entrances.map((e) => e.center);
        for (let i = 0; i < entranceCenters.length; i++) {
          for (let j = i; j < entranceCenters.length; j++) {
            const startNode = entranceCenters[i];
            const endNode = entranceCenters[j];

            if (startNode === endNode) {
              this._addAbstractEdge(startNode, endNode, 0, [startNode]);
              continue;
            }

            const isAccessibleInCluster = (tile: TileRef) => isTraversable(tile) && this.tileToCluster.get(tile)?.id === cluster.id;
            const path = localAStar(this.gameMap, startNode, endNode, isAccessibleInCluster);

            if (path) {
              const cost = path.reduce((acc, t) => acc + this.gameMap.cost(t), 0) - this.gameMap.cost(path[0]);
              this._addAbstractEdge(startNode, endNode, cost, path);
              this._addAbstractEdge(endNode, startNode, cost, [...path].reverse());
            }
          }
        }
      }
    }
  }

  private _addAbstractEdge(from: TileRef, to: TileRef, cost: number, path: TileRef[]) {
    if (!this.abstractGraph.has(from)) {
      this.abstractGraph.set(from, new Map());
    }
    this.abstractGraph.get(from)!.set(to, { cost, path });
  }
}

/**
 * Implements the AStar interface for a hierarchical search.
 * It uses pre-calculated data from HPADataManager to find paths quickly.
 */
export class HPASearch implements AStar {
  private hpaData: HPADataManager;
  private gameMap: GameMap;
  private src: TileRef;
  private dst: TileRef;
  private path: TileRef[] | null = null;
  private result: PathFindResultType = PathFindResultType.Pending;

  constructor(hpaData: HPADataManager, gameMap: GameMap, src: TileRef, dst: TileRef) {
    this.hpaData = hpaData;
    this.gameMap = gameMap;
    this.src = src;
    this.dst = dst;
  }

  compute(): PathFindResultType {
    if (this.result !== PathFindResultType.Pending) return this.result;

    const srcCluster = this.hpaData.tileToCluster.get(this.src);
    const dstCluster = this.hpaData.tileToCluster.get(this.dst);

    if (!srcCluster || !dstCluster) {
      return (this.result = PathFindResultType.PathNotFound);
    }

    if (srcCluster.id === dstCluster.id) {
      const isAccessible = (t: TileRef) => this.hpaData.tileToCluster.get(t)?.id === srcCluster.id && this.gameMap.isWater(t);
      this.path = localAStar(this.gameMap, this.src, this.dst, isAccessible);
    } else {
      this.path = this._hpaSearch(srcCluster, dstCluster);
    }

    return (this.result = this.path ? PathFindResultType.Completed : PathFindResultType.PathNotFound);
  }

  private _hpaSearch(srcCluster: Cluster, dstCluster: Cluster): TileRef[] | null {
    const openSet = new PriorityQueue<{ node: TileRef; fScore: number }>((a, b) => a.fScore - b.fScore);
    const cameFrom = new Map<TileRef, { from: TileRef; path: TileRef[] }>();
    const gScore = new Map<TileRef, number>();

    const findPathsToEntrances = (start: TileRef, cluster: Cluster): Map<TileRef, { cost: number, path: TileRef[] }> => {
      const paths = new Map();
      const isAccessible = (t: TileRef) => this.hpaData.tileToCluster.get(t)?.id === cluster.id && this.gameMap.isWater(t);
      for (const entrance of cluster.entrances) {
        const path = localAStar(this.gameMap, start, entrance.center, isAccessible);
        if (path) {
          const cost = path.reduce((acc, t) => acc + this.gameMap.cost(t), 0) - this.gameMap.cost(path[0]);
          paths.set(entrance.center, { cost, path });
        }
      }
      return paths;
    };

    const srcToEntrances = findPathsToEntrances(this.src, srcCluster);
    const dstFromEntrances = findPathsToEntrances(this.dst, dstCluster);

    gScore.set(this.src, 0);
    openSet.enqueue({ node: this.src, fScore: this.gameMap.manhattanDist(this.src, this.dst) });

    while (!openSet.isEmpty()) {
      const { node: current } = openSet.dequeue();

      if (current === this.dst) {
        let totalPath: TileRef[] = [];
        let currNode: TileRef | undefined = this.dst;
        while(currNode && currNode !== this.src) {
            const edge = cameFrom.get(currNode)!;
            totalPath = [...edge.path.slice(0, -1), ...totalPath];
            currNode = edge.from;
        }
        totalPath.unshift(this.src);
        return totalPath;
      }

      const neighbors = new Map<TileRef, { cost: number; path: TileRef[] }>();
      if (current === this.src) {
        srcToEntrances.forEach((data, entrance) => neighbors.set(entrance, data));
      } else {
        if (this.hpaData.abstractGraph.has(current)) {
          this.hpaData.abstractGraph.get(current)!.forEach((data, neighbor) => neighbors.set(neighbor, data));
        }
        if (dstFromEntrances.has(current)) {
            const edge = dstFromEntrances.get(current)!;
            neighbors.set(this.dst, {cost: edge.cost, path: [...edge.path].reverse()});
        }
      }

      for (const [neighbor, edge] of neighbors.entries()) {
        const tentativeGScore = (gScore.get(current) ?? Infinity) + edge.cost;
        if (tentativeGScore < (gScore.get(neighbor) ?? Infinity)) {
          cameFrom.set(neighbor, { from: current, path: edge.path });
          gScore.set(neighbor, tentativeGScore);
          openSet.enqueue({
            node: neighbor,
            fScore: tentativeGScore + this.gameMap.manhattanDist(neighbor, this.dst),
          });
        }
      }
    }
    return null;
  }

  reconstructPath(): TileRef[] {
    return this.path ?? [];
  }
}
