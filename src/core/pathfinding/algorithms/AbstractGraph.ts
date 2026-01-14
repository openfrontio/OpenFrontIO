import { GameMap, TileRef } from "../../game/GameMap";
import { DebugSpan } from "../../utilities/DebugSpan";
import { BFSGrid } from "./BFS.Grid";
import { ConnectedComponents } from "./ConnectedComponents";

export interface AbstractNode {
  id: number;
  x: number;
  y: number;
  tile: TileRef;
  componentId: number;
}

export interface AbstractEdge {
  id: number;
  nodeA: number; // Lower node ID (canonical order: nodeA < nodeB)
  nodeB: number; // Higher node ID
  cost: number;
  clusterX: number;
  clusterY: number;
}

export interface Cluster {
  x: number;
  y: number;
  nodeIds: number[];
}

export class AbstractGraph {
  // Nodes (array indexed by id)
  private readonly _nodes: AbstractNode[] = [];

  // Edges (bidirectional, stored once)
  private readonly _edges: AbstractEdge[] = [];
  private readonly _nodeEdgeIds: number[][] = []; // nodeId → edge IDs

  // Clusters (array indexed by clusterKey)
  private readonly _clusters: Cluster[] = [];

  // Path cache indexed by edge.id (shared across all users)
  private _pathCache: (TileRef[] | null)[] = [];

  // Water components for componentId lookup
  private _waterComponents: ConnectedComponents | null = null;

  constructor(
    readonly clusterSize: number,
    readonly clustersX: number,
    readonly clustersY: number,
  ) {}

  getNode(id: number): AbstractNode | undefined {
    return this._nodes[id];
  }

  getAllNodes(): readonly AbstractNode[] {
    return this._nodes;
  }

  get nodeCount(): number {
    return this._nodes.length;
  }

  getEdge(id: number): AbstractEdge | undefined {
    return this._edges[id];
  }

  getNodeEdges(nodeId: number): AbstractEdge[] {
    const edgeIds = this._nodeEdgeIds[nodeId];
    if (!edgeIds) return [];
    return edgeIds.map((id) => this._edges[id]);
  }

  getEdgeBetween(nodeA: number, nodeB: number): AbstractEdge | undefined {
    const edgeIds = this._nodeEdgeIds[nodeA];
    if (!edgeIds) return undefined;

    for (const edgeId of edgeIds) {
      const edge = this._edges[edgeId];
      if (edge.nodeA === nodeB || edge.nodeB === nodeB) {
        return edge;
      }
    }
    return undefined;
  }

  getOtherNode(edge: AbstractEdge, nodeId: number): number {
    return edge.nodeA === nodeId ? edge.nodeB : edge.nodeA;
  }

  getAllEdges(): readonly AbstractEdge[] {
    return this._edges;
  }

  get edgeCount(): number {
    return this._edges.length;
  }

  /**
   * Get cached path for edge in specific direction
   * @param edgeId Edge ID
   * @param fromNodeId The starting node of the traversal (determines direction)
   */
  getCachedPath(edgeId: number, fromNodeId: number): TileRef[] | null {
    const edge = this._edges[edgeId];
    if (!edge) return null;
    // Direction: 0 if traversing A→B, 1 if traversing B→A
    const direction = fromNodeId === edge.nodeA ? 0 : 1;
    const cacheIndex = edgeId * 2 + direction;
    return this._pathCache[cacheIndex] ?? null;
  }

  /**
   * Cache path for edge in specific direction
   * @param edgeId Edge ID
   * @param fromNodeId The starting node of the traversal (determines direction)
   * @param path The path tiles
   */
  setCachedPath(edgeId: number, fromNodeId: number, path: TileRef[]): void {
    const edge = this._edges[edgeId];
    if (!edge) return;
    // Direction: 0 if traversing A→B, 1 if traversing B→A
    const direction = fromNodeId === edge.nodeA ? 0 : 1;
    const cacheIndex = edgeId * 2 + direction;
    this._pathCache[cacheIndex] = path;
  }

  _initPathCache(): void {
    // Double the cache size to store both directions
    this._pathCache = new Array(this._edges.length * 2).fill(null);
  }

  setWaterComponents(wc: ConnectedComponents): void {
    this._waterComponents = wc;
  }

  getComponentId(tile: TileRef): number {
    return this._waterComponents?.getComponentId(tile) ?? 0;
  }

  getClusterKey(clusterX: number, clusterY: number): number {
    return clusterY * this.clustersX + clusterX;
  }

  getCluster(clusterX: number, clusterY: number): Cluster | undefined {
    return this._clusters[this.getClusterKey(clusterX, clusterY)];
  }

  getClusterNodes(clusterX: number, clusterY: number): AbstractNode[] {
    const cluster = this.getCluster(clusterX, clusterY);
    if (!cluster) return [];
    return cluster.nodeIds.map((id) => this._nodes[id]);
  }

  getNearbyClusterNodes(clusterX: number, clusterY: number): AbstractNode[] {
    const nodes: AbstractNode[] = [];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cluster = this.getCluster(clusterX + dx, clusterY + dy);
        if (cluster) {
          for (const nodeId of cluster.nodeIds) {
            nodes.push(this._nodes[nodeId]);
          }
        }
      }
    }

    return nodes;
  }

  _addNode(node: AbstractNode): void {
    this._nodes[node.id] = node;
    this._nodeEdgeIds[node.id] = [];
  }

  _addEdge(edge: AbstractEdge): void {
    this._edges[edge.id] = edge;
    this._nodeEdgeIds[edge.nodeA].push(edge.id);
    this._nodeEdgeIds[edge.nodeB].push(edge.id);
  }

  _setCluster(key: number, cluster: Cluster): void {
    this._clusters[key] = cluster;
  }

  _addNodeToCluster(clusterKey: number, nodeId: number): void {
    if (!this._clusters[clusterKey]) {
      // This shouldn't happen if clusters are pre-created
      return;
    }

    this._clusters[clusterKey].nodeIds.push(nodeId);
  }
}

export class AbstractGraphBuilder {
  static readonly CLUSTER_SIZE = 32;

  // Derived immutable state
  private readonly width: number;
  private readonly height: number;
  private readonly clustersX: number;
  private readonly clustersY: number;
  private readonly tileBFS: BFSGrid;
  private readonly waterComponents: ConnectedComponents;

  // Build state
  private graph!: AbstractGraph;
  private tileToNode = new Map<TileRef, AbstractNode>();
  private nextNodeId = 0;
  private nextEdgeId = 0;
  private edgeBetween = new Map<number, Map<number, AbstractEdge>>();

  constructor(
    private readonly map: GameMap,
    private readonly clusterSize: number = AbstractGraphBuilder.CLUSTER_SIZE,
  ) {
    this.width = map.width();
    this.height = map.height();
    this.clustersX = Math.ceil(this.width / clusterSize);
    this.clustersY = Math.ceil(this.height / clusterSize);
    this.tileBFS = new BFSGrid(this.width * this.height);
    this.waterComponents = new ConnectedComponents(map);
  }

  build(): AbstractGraph {
    DebugSpan.start("AbstractGraphBuilder:build");

    this.graph = new AbstractGraph(
      this.clusterSize,
      this.clustersX,
      this.clustersY,
    );

    // Initialize water components
    this.waterComponents.initialize();

    // Pre-create all clusters
    for (let cy = 0; cy < this.clustersY; cy++) {
      for (let cx = 0; cx < this.clustersX; cx++) {
        const key = this.graph.getClusterKey(cx, cy);
        this.graph._setCluster(key, { x: cx, y: cy, nodeIds: [] });
      }
    }

    // Find nodes (gateways) at cluster boundaries
    DebugSpan.start("nodes");
    for (let cy = 0; cy < this.clustersY; cy++) {
      for (let cx = 0; cx < this.clustersX; cx++) {
        this.processCluster(cx, cy);
      }
    }
    DebugSpan.end();

    // Build edges between nodes in same cluster
    DebugSpan.start("edges");
    for (let cy = 0; cy < this.clustersY; cy++) {
      for (let cx = 0; cx < this.clustersX; cx++) {
        const cluster = this.graph.getCluster(cx, cy);
        if (!cluster || cluster.nodeIds.length === 0) continue;
        this.buildClusterConnections(cx, cy);
      }
    }
    DebugSpan.end();

    DebugSpan.set("nodes", () => this.graph.getAllNodes());
    DebugSpan.set("edges", () => this.graph.getAllEdges());
    DebugSpan.set("nodesCount", () => this.graph.nodeCount);
    DebugSpan.set("edgesCount", () => this.graph.edgeCount);
    DebugSpan.set("clustersCount", () => this.clustersX * this.clustersY);

    // Initialize path cache after all edges are built
    this.graph._initPathCache();

    // Store water components for componentId lookups
    this.graph.setWaterComponents(this.waterComponents);

    DebugSpan.end(); // AbstractGraphBuilder:build

    return this.graph;
  }

  private getOrCreateNode(x: number, y: number): AbstractNode {
    const tile = this.map.ref(x, y);

    const existing = this.tileToNode.get(tile);
    if (existing) {
      return existing;
    }

    const node: AbstractNode = {
      id: this.nextNodeId++,
      x,
      y,
      tile,
      componentId: this.waterComponents.getComponentId(tile),
    };

    this.graph._addNode(node);
    this.tileToNode.set(tile, node);
    return node;
  }

  private addNodeToCluster(
    clusterX: number,
    clusterY: number,
    node: AbstractNode,
  ): void {
    const cluster = this.graph.getCluster(clusterX, clusterY);
    if (!cluster) return;

    // Check for duplicates (node at cluster corner can be found by both edge scans)
    if (!cluster.nodeIds.includes(node.id)) {
      cluster.nodeIds.push(node.id);
    }
  }

  private processCluster(cx: number, cy: number): void {
    const baseX = cx * this.clusterSize;
    const baseY = cy * this.clusterSize;

    // Right edge (vertical boundary to next cluster)
    if (cx < this.clustersX - 1) {
      const edgeX = Math.min(baseX + this.clusterSize - 1, this.width - 1);
      const nodes = this.findNodesOnVerticalEdge(edgeX, baseY);

      for (const node of nodes) {
        this.addNodeToCluster(cx, cy, node);
        this.addNodeToCluster(cx + 1, cy, node);
      }
    }

    // Bottom edge (horizontal boundary to next cluster)
    if (cy < this.clustersY - 1) {
      const edgeY = Math.min(baseY + this.clusterSize - 1, this.height - 1);
      const nodes = this.findNodesOnHorizontalEdge(edgeY, baseX);

      for (const node of nodes) {
        this.addNodeToCluster(cx, cy, node);
        this.addNodeToCluster(cx, cy + 1, node);
      }
    }
  }

  private findNodesOnVerticalEdge(x: number, baseY: number): AbstractNode[] {
    const nodes: AbstractNode[] = [];
    const maxY = Math.min(baseY + this.clusterSize, this.height);

    let spanStart = -1;

    const tryAddNode = (y: number) => {
      if (spanStart === -1) return;

      const spanLength = y - spanStart;
      const midY = spanStart + Math.floor(spanLength / 2);
      spanStart = -1;

      const node = this.getOrCreateNode(x, midY);
      nodes.push(node);
    };

    for (let y = baseY; y < maxY; y++) {
      const tile = this.map.ref(x, y);
      const nextTile = x + 1 < this.map.width() ? this.map.ref(x + 1, y) : -1;
      const isEntrance =
        this.map.isWater(tile) && nextTile !== -1 && this.map.isWater(nextTile);

      if (isEntrance) {
        if (spanStart === -1) {
          spanStart = y;
        }
      } else {
        tryAddNode(y);
      }
    }

    tryAddNode(maxY);
    return nodes;
  }

  private findNodesOnHorizontalEdge(y: number, baseX: number): AbstractNode[] {
    const nodes: AbstractNode[] = [];
    const maxX = Math.min(baseX + this.clusterSize, this.width);

    let spanStart = -1;

    const tryAddNode = (x: number) => {
      if (spanStart === -1) return;

      const spanLength = x - spanStart;
      const midX = spanStart + Math.floor(spanLength / 2);
      spanStart = -1;

      const node = this.getOrCreateNode(midX, y);
      nodes.push(node);
    };

    for (let x = baseX; x < maxX; x++) {
      const tile = this.map.ref(x, y);
      const nextTile = y + 1 < this.map.height() ? this.map.ref(x, y + 1) : -1;
      const isEntrance =
        this.map.isWater(tile) && nextTile !== -1 && this.map.isWater(nextTile);

      if (isEntrance) {
        if (spanStart === -1) {
          spanStart = x;
        }
      } else {
        tryAddNode(x);
      }
    }

    tryAddNode(maxX);
    return nodes;
  }

  private buildClusterConnections(cx: number, cy: number): void {
    const cluster = this.graph.getCluster(cx, cy);
    if (!cluster) return;

    const nodeIds = cluster.nodeIds;
    const nodes = nodeIds.map((id) => this.graph.getNode(id)!);

    // Calculate cluster bounds
    const clusterMinX = cx * this.clusterSize;
    const clusterMinY = cy * this.clusterSize;
    const clusterMaxX = Math.min(
      this.width - 1,
      clusterMinX + this.clusterSize - 1,
    );
    const clusterMaxY = Math.min(
      this.height - 1,
      clusterMinY + this.clusterSize - 1,
    );

    for (let i = 0; i < nodes.length; i++) {
      const fromNode = nodes[i];

      // Build list of target nodes (only those we haven't processed with this node)
      const targetNodes: AbstractNode[] = [];
      for (let j = i + 1; j < nodes.length; j++) {
        // Skip if nodes are in different water components
        if (nodes[i].componentId !== nodes[j].componentId) {
          continue;
        }
        targetNodes.push(nodes[j]);
      }

      if (targetNodes.length === 0) continue;

      // Single BFS to find all reachable target nodes
      const reachable = this.findAllReachableNodesInBounds(
        fromNode.tile,
        targetNodes,
        clusterMinX,
        clusterMaxX,
        clusterMinY,
        clusterMaxY,
      );

      // Create edges for all reachable nodes
      for (const [targetId, cost] of reachable.entries()) {
        this.addOrUpdateEdge(fromNode.id, targetId, cost, cx, cy);
      }
    }
  }

  /**
   * Add or update edge between two nodes.
   * Edges are bidirectional and stored once with canonical order (nodeA < nodeB).
   * If edge exists with higher cost, update it.
   */
  private addOrUpdateEdge(
    nodeIdA: number,
    nodeIdB: number,
    cost: number,
    clusterX: number,
    clusterY: number,
  ): void {
    // Canonical order: lower ID first
    const [lo, hi] =
      nodeIdA < nodeIdB ? [nodeIdA, nodeIdB] : [nodeIdB, nodeIdA];

    // Check for existing edge
    let nodeMap = this.edgeBetween.get(lo);
    if (!nodeMap) {
      nodeMap = new Map();
      this.edgeBetween.set(lo, nodeMap);
    }

    const existingEdge = nodeMap.get(hi);

    if (existingEdge) {
      // Update if new cost is cheaper
      if (cost < existingEdge.cost) {
        existingEdge.cost = cost;
        existingEdge.clusterX = clusterX;
        existingEdge.clusterY = clusterY;
      }
      return;
    }

    // Create new edge
    const edge: AbstractEdge = {
      id: this.nextEdgeId++,
      nodeA: lo,
      nodeB: hi,
      cost,
      clusterX,
      clusterY,
    };

    nodeMap.set(hi, edge);
    this.graph._addEdge(edge);
  }

  private findAllReachableNodesInBounds(
    from: TileRef,
    targetNodes: AbstractNode[],
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
  ): Map<number, number> {
    const fromX = this.map.x(from);
    const fromY = this.map.y(from);

    // Create a map of tile positions to node IDs for fast lookup
    const tileToNodeId = new Map<TileRef, number>();
    let maxManhattanDist = 0;

    for (const node of targetNodes) {
      tileToNodeId.set(node.tile, node.id);
      const dx = Math.abs(node.x - fromX);
      const dy = Math.abs(node.y - fromY);
      maxManhattanDist = Math.max(maxManhattanDist, dx + dy);
    }

    const maxDistance = maxManhattanDist * 4; // Allow path deviation
    const reachable = new Map<number, number>();
    let foundCount = 0;

    this.tileBFS.search(
      this.map.width(),
      this.map.height(),
      from,
      maxDistance,
      (tile: number) => this.map.isWater(tile),
      (tile: number, dist: number) => {
        const x = this.map.x(tile);
        const y = this.map.y(tile);

        // Reject if outside of bounding box (except start/target)
        const isStartOrTarget = tile === from || tileToNodeId.has(tile);
        if (
          !isStartOrTarget &&
          (x < minX || x > maxX || y < minY || y > maxY)
        ) {
          return null;
        }

        // Check if this tile is one of our target nodes
        const nodeId = tileToNodeId.get(tile);

        if (nodeId !== undefined) {
          reachable.set(nodeId, dist);
          foundCount++;

          // Early exit if we've found all target nodes
          if (foundCount === targetNodes.length) {
            return dist; // Return to stop BFS
          }
        }
      },
    );

    return reachable;
  }
}
