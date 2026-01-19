import { GameMap, TileRef } from "../../game/GameMap";
import { DebugSpan } from "../../utilities/DebugSpan";
import { PathFinder } from "../types";
import { AbstractGraphAStar } from "./AStar.AbstractGraph";
import { AStarWaterBounded } from "./AStar.WaterBounded";
import { AbstractGraph, AbstractNode } from "./AbstractGraph";
import { BFSGrid } from "./BFS.Grid";
import { LAND_MARKER } from "./ConnectedComponents";

export class AStarWaterHierarchical implements PathFinder<number> {
  private tileBFS: BFSGrid;
  private abstractAStar: AbstractGraphAStar;
  private localAStar: AStarWaterBounded;
  private localAStarMultiCluster: AStarWaterBounded;
  private localAStarShortPath: AStarWaterBounded;
  private sourceResolver: SourceResolver;

  constructor(
    private map: GameMap,
    private graph: AbstractGraph,
    private options: {
      cachePaths?: boolean;
    } = {},
  ) {
    // BFS for nearest node search
    this.tileBFS = new BFSGrid(map.width() * map.height());

    const clusterSize = graph.clusterSize;

    // AbstractGraphAStar for abstract graph routing
    this.abstractAStar = new AbstractGraphAStar(this.graph);

    // BoundedAStar for cluster-bounded local pathfinding
    const maxLocalNodes = clusterSize * clusterSize;
    this.localAStar = new AStarWaterBounded(map, maxLocalNodes);

    // BoundedAStar for multi-cluster (3x3) local pathfinding
    const multiClusterSize = clusterSize * 3;
    const maxMultiClusterNodes = multiClusterSize * multiClusterSize;
    this.localAStarMultiCluster = new AStarWaterBounded(
      map,
      maxMultiClusterNodes,
    );

    // BoundedAStar for short path multi-source (120 + 2*10 padding = 140)
    const shortPathSize = 140;
    const maxShortPathNodes = shortPathSize * shortPathSize;
    this.localAStarShortPath = new AStarWaterBounded(map, maxShortPathNodes);

    // SourceResolver for multi-source search
    this.sourceResolver = new SourceResolver(this.map, this.graph);
  }

  findPath(from: number | number[], to: number): number[] | null {
    return DebugSpan.wrap("AStar.WaterHierarchical:findPath", () => {
      DebugSpan.set("$to", () => to);
      DebugSpan.set("$from", () => from);

      if (Array.isArray(from)) {
        return this.findPathMultiSource(from as TileRef[], to as TileRef);
      }

      return this.findPathSingle(from as TileRef, to as TileRef);
    });
  }

  private findPathMultiSource(
    sources: TileRef[],
    target: TileRef,
  ): TileRef[] | null {
    // Early exit: try bounded A* for sources close to target
    const shortPath = this.tryShortPathMultiSource(sources, target);
    if (shortPath) return shortPath;

    // 1. Resolve target to abstract node
    const targetNode = this.sourceResolver.resolveTarget(target);
    if (!targetNode) return null;

    // 2. Map sources → abstract nodes (cheap O(1) cluster lookup per source)
    const nodeToSource = this.sourceResolver.resolveSourcesToNodes(sources);
    if (nodeToSource.size === 0) return null;

    // 3. Run multi-source A* on abstract graph
    const nodeIds = [...nodeToSource.keys()];
    const nodePath = this.abstractAStar.findPath(nodeIds, targetNode.id);
    if (!nodePath) return null;

    // 4. Get winning source tile (nodePath[0] is winning start node)
    const winningSource = nodeToSource.get(nodePath[0])!;

    // 5. Run full single-source from winner
    return this.findPathSingle(winningSource, target);
  }

  private tryShortPathMultiSource(
    sources: TileRef[],
    target: TileRef,
  ): TileRef[] | null {
    const SHORT_PATH_THRESHOLD = 120;
    const PADDING = 10;

    const candidates = sources.filter(
      (s) => this.map.manhattanDist(s, target) <= SHORT_PATH_THRESHOLD,
    );
    if (candidates.length === 0) return null;

    const toX = this.map.x(target);
    const toY = this.map.y(target);
    let minX = toX,
      maxX = toX,
      minY = toY,
      maxY = toY;

    for (const s of candidates) {
      const sx = this.map.x(s);
      const sy = this.map.y(s);
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }

    const bounds = {
      minX: Math.max(0, minX - PADDING),
      maxX: Math.min(this.map.width() - 1, maxX + PADDING),
      minY: Math.max(0, minY - PADDING),
      maxY: Math.min(this.map.height() - 1, maxY + PADDING),
    };

    return this.localAStarShortPath.searchBounded(candidates, target, bounds);
  }

  findPathSingle(from: TileRef, to: TileRef): TileRef[] | null {
    const dist = this.map.manhattanDist(from, to);

    // Early exit for very short distances
    if (dist <= this.graph.clusterSize) {
      DebugSpan.start("earlyExit");
      const startX = this.map.x(from);
      const startY = this.map.y(from);
      const clusterX = Math.floor(startX / this.graph.clusterSize);
      const clusterY = Math.floor(startY / this.graph.clusterSize);
      const localPath = this.findLocalPath(from, to, clusterX, clusterY, true);
      DebugSpan.end();

      if (localPath) {
        return localPath;
      }
    }

    DebugSpan.start("nodeLookup");
    const startNode = this.findNearestNode(from);
    const endNode = this.findNearestNode(to);
    DebugSpan.end();

    if (!startNode) {
      return null;
    }

    if (!endNode) {
      return null;
    }

    if (startNode.id === endNode.id) {
      DebugSpan.start("sameNodeLocalPath");
      const clusterX = Math.floor(startNode.x / this.graph.clusterSize);
      const clusterY = Math.floor(startNode.y / this.graph.clusterSize);
      const path = this.findLocalPath(from, to, clusterX, clusterY, true);
      DebugSpan.end();
      return path;
    }

    DebugSpan.start("abstractPath");
    const nodePath = this.findAbstractPath(startNode.id, endNode.id);
    DebugSpan.end();

    if (!nodePath) {
      return null;
    }

    DebugSpan.set("nodePath", () =>
      nodePath
        .map((nodeId) => {
          const node = this.graph.getNode(nodeId);
          return node ? node.tile : -1;
        })
        .filter((tile) => tile !== -1),
    );

    const initialPath: TileRef[] = [];

    DebugSpan.start("initialPath");

    // 1. Find path from start to first node
    const firstNode = this.graph.getNode(nodePath[0])!;
    const firstNodeTile = firstNode.tile;

    const startX = this.map.x(from);
    const startY = this.map.y(from);
    const startClusterX = Math.floor(startX / this.graph.clusterSize);
    const startClusterY = Math.floor(startY / this.graph.clusterSize);
    const startSegment = this.findLocalPath(
      from,
      firstNodeTile,
      startClusterX,
      startClusterY,
    );

    if (!startSegment) {
      return null;
    }

    initialPath.push(...startSegment);

    // 2. Build path through abstract nodes
    for (let i = 0; i < nodePath.length - 1; i++) {
      const fromNodeId = nodePath[i];
      const toNodeId = nodePath[i + 1];

      const edge = this.graph.getEdgeBetween(fromNodeId, toNodeId);
      if (!edge) {
        return null;
      }

      const fromNode = this.graph.getNode(fromNodeId)!;
      const toNode = this.graph.getNode(toNodeId)!;
      const fromTile = fromNode.tile;
      const toTile = toNode.tile;

      // Check path cache (stored on graph, shared across all instances)
      // Cache is direction-aware: A→B and B→A are cached separately
      if (this.options.cachePaths) {
        const cachedPath = this.graph.getCachedPath(edge.id, fromNodeId);
        if (cachedPath && cachedPath.length > 0) {
          // Path is cached for this exact direction, use as-is
          initialPath.push(...cachedPath.slice(1));
          DebugSpan.set(
            "$cachedSegmentsUsed",
            (prev) => ((prev as number) ?? 0) + 1,
          );
          continue;
        }
      }

      const segmentPath = this.findLocalPath(
        fromTile,
        toTile,
        edge.clusterX,
        edge.clusterY,
      );

      if (!segmentPath) {
        return null;
      }

      initialPath.push(...segmentPath.slice(1));

      // Cache the path for this direction
      if (this.options.cachePaths) {
        this.graph.setCachedPath(edge.id, fromNodeId, segmentPath);
      }
    }

    // 3. Find path from last node to end
    const lastNode = this.graph.getNode(nodePath[nodePath.length - 1])!;
    const lastNodeTile = lastNode.tile;

    const endX = this.map.x(to);
    const endY = this.map.y(to);
    const endClusterX = Math.floor(endX / this.graph.clusterSize);
    const endClusterY = Math.floor(endY / this.graph.clusterSize);
    const endSegment = this.findLocalPath(
      lastNodeTile,
      to,
      endClusterX,
      endClusterY,
    );

    if (!endSegment) {
      return null;
    }

    initialPath.push(...endSegment.slice(1));

    DebugSpan.set("initialPath", () => initialPath);

    // Smoothing moved to SmoothingTransformer - return raw path
    return initialPath;
  }

  private findNearestNode(tile: TileRef): AbstractNode | null {
    const x = this.map.x(tile);
    const y = this.map.y(tile);

    const clusterX = Math.floor(x / this.graph.clusterSize);
    const clusterY = Math.floor(y / this.graph.clusterSize);

    const clusterSize = this.graph.clusterSize;
    const minX = clusterX * clusterSize;
    const minY = clusterY * clusterSize;
    const maxX = Math.min(this.map.width() - 1, minX + clusterSize - 1);
    const maxY = Math.min(this.map.height() - 1, minY + clusterSize - 1);

    const cluster = this.graph.getCluster(clusterX, clusterY);
    if (!cluster || cluster.nodeIds.length === 0) {
      return null;
    }

    const candidateNodes = cluster.nodeIds.map((id) => this.graph.getNode(id)!);
    const maxDistance = clusterSize * clusterSize;

    return this.tileBFS.search(
      this.map.width(),
      this.map.height(),
      tile,
      maxDistance,
      (t: TileRef) => this.graph.getComponentId(t) !== LAND_MARKER,
      (t: TileRef, _dist: number) => {
        const tileX = this.map.x(t);
        const tileY = this.map.y(t);

        for (const node of candidateNodes) {
          if (node.x === tileX && node.y === tileY) {
            return node;
          }
        }

        if (tileX < minX || tileX > maxX || tileY < minY || tileY > maxY) {
          return null;
        }
      },
    );
  }

  private findAbstractPath(
    fromNodeId: number,
    toNodeId: number,
  ): number[] | null {
    return this.abstractAStar.findPath(fromNodeId, toNodeId);
  }

  private findLocalPath(
    from: TileRef,
    to: TileRef,
    clusterX: number,
    clusterY: number,
    multiCluster: boolean = false,
  ): TileRef[] | null {
    // Calculate cluster bounds
    const clusterSize = this.graph.clusterSize;

    let minX: number;
    let minY: number;
    let maxX: number;
    let maxY: number;

    if (multiCluster) {
      // 3×3 clusters centered on the starting cluster
      minX = Math.max(0, (clusterX - 1) * clusterSize);
      minY = Math.max(0, (clusterY - 1) * clusterSize);
      maxX = Math.min(this.map.width() - 1, (clusterX + 2) * clusterSize - 1);
      maxY = Math.min(this.map.height() - 1, (clusterY + 2) * clusterSize - 1);
    } else {
      minX = clusterX * clusterSize;
      minY = clusterY * clusterSize;
      maxX = Math.min(this.map.width() - 1, minX + clusterSize - 1);
      maxY = Math.min(this.map.height() - 1, minY + clusterSize - 1);
    }

    // Choose the appropriate BoundedAStar based on search area
    const selectedAStar = multiCluster
      ? this.localAStarMultiCluster
      : this.localAStar;

    // Run BoundedAStar on bounded region - works directly on map coords
    const path = selectedAStar.searchBounded(from, to, {
      minX,
      maxX,
      minY,
      maxY,
    });

    if (!path || path.length === 0) {
      return null;
    }

    // Fix endpoints: BoundedAStar clamps tiles to bounds, but node tiles may be
    // just outside cluster bounds. Ensure path starts/ends at exact requested tiles.
    if (path[0] !== from) {
      path.unshift(from);
    }
    if (path[path.length - 1] !== to) {
      path.push(to);
    }

    return path;
  }
}

// Helper class for resolving tiles to abstract nodes
// Assumes tiles are already water and component-filtered (by transformer pipeline)
class SourceResolver {
  constructor(
    private map: GameMap,
    private graph: AbstractGraph,
  ) {}

  // Resolves target to its abstract node
  resolveTarget(target: TileRef): AbstractNode | null {
    return this.getClusterNode(target);
  }

  // Maps sources → abstract nodes, returns Map<nodeId, sourceTile>
  resolveSourcesToNodes(sources: TileRef[]): Map<number, TileRef> {
    const nodeToSource = new Map<number, TileRef>();
    const nodeToDist = new Map<number, number>();

    for (const source of sources) {
      const node = this.getClusterNode(source);
      if (node === null) continue;

      const x = this.map.x(source);
      const y = this.map.y(source);
      const dist = Math.abs(node.x - x) + Math.abs(node.y - y);

      // Keep closest source per node
      const prevDist = nodeToDist.get(node.id);
      if (prevDist === undefined || dist < prevDist) {
        nodeToSource.set(node.id, source);
        nodeToDist.set(node.id, dist);
      }
    }

    return nodeToSource;
  }

  private getClusterNode(tile: TileRef): AbstractNode | null {
    const x = this.map.x(tile);
    const y = this.map.y(tile);
    const clusterX = Math.floor(x / this.graph.clusterSize);
    const clusterY = Math.floor(y / this.graph.clusterSize);

    const cluster = this.graph.getCluster(clusterX, clusterY);
    if (!cluster || cluster.nodeIds.length === 0) return null;

    // Return closest node to tile
    let bestNode: AbstractNode | null = null;
    let bestDist = Infinity;

    for (const nodeId of cluster.nodeIds) {
      const node = this.graph.getNode(nodeId);
      if (!node) continue;

      const dist = Math.abs(node.x - x) + Math.abs(node.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        bestNode = node;
      }
    }

    return bestNode;
  }
}
