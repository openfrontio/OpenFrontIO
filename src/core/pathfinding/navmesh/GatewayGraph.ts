import { Game } from '../../game/Game';
import { GameMap, TileRef } from '../../game/GameMap';
import { WaterComponents } from './WaterComponents';
import { FastBFS } from './FastBFS';

export interface Gateway {
  id: number;
  x: number;
  y: number;
  tile: TileRef;
  componentId: number;
}

export interface Edge {
  from: number;
  to: number;
  cost: number;
  path?: TileRef[];
  sectorX: number;
  sectorY: number;
}

export interface Sector {
  x: number;
  y: number;
  gateways: Gateway[];
  edges: Edge[];
}

export type BuildDebugInfo = {
  sectors: number | null;
  gateways: number | null;
  edges: number | null;
  actualBFSCalls: number | null;
  potentialBFSCalls: number | null;
  skippedByComponentFilter: number | null;
  timings: { [key: string]: number };
}

export class GatewayGraph {
  constructor(
    readonly sectors: ReadonlyMap<number, Sector>,
    readonly gateways: ReadonlyMap<number, Gateway>,
    readonly edges: ReadonlyMap<number, Edge[]>,
    readonly sectorSize: number,
    readonly sectorsX: number,
  ) {}

  getSectorKey(sectorX: number, sectorY: number): number {
    return sectorY * this.sectorsX + sectorX;
  }

  getSector(sectorX: number, sectorY: number): Sector | undefined {
    return this.sectors.get(this.getSectorKey(sectorX, sectorY));
  }

  getGateway(id: number): Gateway | undefined {
    return this.gateways.get(id);
  }

  getEdges(gatewayId: number): Edge[] {
    return this.edges.get(gatewayId) ?? [];
  }

  getNearbySectorGateways(sectorX: number, sectorY: number): Gateway[] {
    const nearby: Gateway[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sector = this.getSector(sectorX + dx, sectorY + dy);
        if (sector) {
          nearby.push(...sector.gateways);
        }
      }
    }
    return nearby;
  }

  getAllGateways(): Gateway[] {
    return Array.from(this.gateways.values());
  }
}

export class GatewayGraphBuilder {
  static readonly SECTOR_SIZE = 32;

  // Derived immutable state
  private readonly miniMap: GameMap;
  private readonly width: number;
  private readonly height: number;
  private readonly sectorsX: number;
  private readonly sectorsY: number;
  private readonly fastBFS: FastBFS;
  private readonly waterComponents: WaterComponents;

  // Mutable build state
  private sectors = new Map<number, Sector>();
  private gateways = new Map<number, Gateway>();
  private tileToGateway = new Map<TileRef, Gateway>();
  private edges = new Map<number, Edge[]>();
  private nextGatewayId = 0;

  // Programatically accessible debug info
  public debugInfo: BuildDebugInfo | null = null;

  constructor(
    private readonly game: Game,
    private readonly sectorSize: number,
  ) {
    this.miniMap = game.miniMap();
    this.width = this.miniMap.width();
    this.height = this.miniMap.height();
    this.sectorsX = Math.ceil(this.width / sectorSize);
    this.sectorsY = Math.ceil(this.height / sectorSize);
    this.fastBFS = new FastBFS(this.width * this.height);
    this.waterComponents = new WaterComponents(this.miniMap);
  }

  build(debug: boolean): GatewayGraph {
    performance.mark('navsat:build:start');

    if (debug) {
      console.log(`[DEBUG] Building gateway graph with sector size ${this.sectorSize} (${this.sectorsX}x${this.sectorsY} sectors)`);

      this.debugInfo = {
        sectors: null,
        gateways: null,
        edges: null,
        actualBFSCalls: null,
        potentialBFSCalls: null,
        skippedByComponentFilter: null,
        timings: {},
      }
    }

    // Initialize water components before building gateway graph
    performance.mark('navsat:build:water-component:start');
    this.waterComponents.initialize();
    performance.mark('navsat:build:water-component:end');
    const measure = performance.measure(
      'navsat:build:water-component',
      'navsat:build:water-component:start',
      'navsat:build:water-component:end'
    );

    if (debug) {
      console.log(`[DEBUG] Water Component Identification: ${measure.duration.toFixed(2)}ms`);
    }

    performance.mark('navsat:build:gateways:start');
    for (let sy = 0; sy < this.sectorsY; sy++) {
      for (let sx = 0; sx < this.sectorsX; sx++) {
        this.processSector(sx, sy);
      }
    }
    performance.mark('navsat:build:gateways:end');
    const gatewaysMeasure = performance.measure(
      'navsat:build:gateways',
      'navsat:build:gateways:start',
      'navsat:build:gateways:end'
    );

    if (debug) {
      console.log(`[DEBUG] Gateway identification: ${gatewaysMeasure.duration.toFixed(2)}ms`);

      this.debugInfo!.edges = 0;
      this.debugInfo!.potentialBFSCalls = 0;
      this.debugInfo!.skippedByComponentFilter = 0;
    }

    performance.mark('navsat:build:edges:start');
    for (const sector of this.sectors.values()) {
      const gws = sector.gateways;
      const numGateways = gws.length;

      if (debug) {
        this.debugInfo!.potentialBFSCalls! += (numGateways * (numGateways - 1)) / 2;

        for (let i = 0; i < gws.length; i++) {
          for (let j = i + 1; j < gws.length; j++) {
            if (gws[i].componentId !== gws[j].componentId) {
              this.debugInfo!.skippedByComponentFilter!++;
            }
          }
        }
      }

      this.buildSectorConnections(sector);

      if (debug) {
        // Divide by 2 because bidirectional
        this.debugInfo!.edges! += sector.edges.length / 2;
      }
    }

    if (debug) {
      this.debugInfo!.actualBFSCalls = this.debugInfo!.potentialBFSCalls! - this.debugInfo!.skippedByComponentFilter!;
    }

    performance.mark('navsat:build:edges:end');
    const edgesMeasure = performance.measure(
      'navsat:build:edges',
      'navsat:build:edges:start',
      'navsat:build:edges:end'
    );

    if (debug) {
      console.log(`[DEBUG] Edges Identification: ${edgesMeasure.duration.toFixed(2)}ms`);
      console.log(`[DEBUG]   Potential BFS calls: ${this.debugInfo!.potentialBFSCalls}`);
      console.log(`[DEBUG]   Skipped by component filter: ${this.debugInfo!.skippedByComponentFilter} (${((this.debugInfo!.skippedByComponentFilter! / this.debugInfo!.potentialBFSCalls!) * 100).toFixed(1)}%)`);
      console.log(`[DEBUG]   Actual BFS calls: ${this.debugInfo!.actualBFSCalls}`);
      console.log(`[DEBUG]   Edges Found: ${this.debugInfo!.edges} (${((this.debugInfo!.edges! / this.debugInfo!.actualBFSCalls!) * 100).toFixed(1)}% success rate)`);
    }

    performance.mark('navsat:build:end');
    const totalMeasure = performance.measure(
      'navsat:build:total',
      'navsat:build:start',
      'navsat:build:end'
    );

    if (debug) {
      console.log(`[DEBUG] Gateway graph built in ${totalMeasure.duration.toFixed(2)}ms`);
      console.log(`[DEBUG] Gateways: ${this.gateways.size}`);
      console.log(`[DEBUG] Sectors: ${this.sectors.size}`);
    }

    return new GatewayGraph(
      this.sectors,
      this.gateways,
      this.edges,
      this.sectorSize,
      this.sectorsX
    );
  }

  private getSectorKey(sectorX: number, sectorY: number): number {
    return sectorY * this.sectorsX + sectorX;
  }

  private getOrCreateGateway(x: number, y: number): Gateway {
    const tile = this.miniMap.ref(x, y);

    // O(1) lookup using tile reference
    const existing = this.tileToGateway.get(tile);
    if (existing) {
      return existing;
    }

    const gateway: Gateway = {
      id: this.nextGatewayId++,
      x: x,
      y: y,
      tile: tile,
      componentId: this.waterComponents.getComponentId(tile)
    };

    this.gateways.set(gateway.id, gateway);
    this.tileToGateway.set(tile, gateway);
    return gateway;
  }

  private addGatewayToSector(sector: Sector, gateway: Gateway): void {
    // Check for duplicates: a gateway at a sector corner can be
    // detected by both horizontal and vertical edge scans
    for (const existingGw of sector.gateways) {
      if (existingGw.x === gateway.x && existingGw.y === gateway.y) {
        return;
      }
    }

    // Gateway doesn't exist in sector yet, add it
    sector.gateways.push(gateway);
  }

  private processSector(sx: number, sy: number): void {
    const sectorKey = this.getSectorKey(sx, sy);
    let sector = this.sectors.get(sectorKey);

    if (!sector) {
      sector = { x: sx, y: sy, gateways: [], edges: [] };
      this.sectors.set(sectorKey, sector);
    }

    const baseX = sx * this.sectorSize;
    const baseY = sy * this.sectorSize;

    if (sx < this.sectorsX - 1) {
      const edgeX = Math.min(baseX + this.sectorSize - 1, this.width - 1);
      const newGateways = this.findGatewaysOnVerticalEdge(edgeX, baseY);

      for (const gateway of newGateways) {
        this.addGatewayToSector(sector, gateway);

        const rightSectorKey = this.getSectorKey(sx + 1, sy);
        let rightSector = this.sectors.get(rightSectorKey);

        if (!rightSector) {
          rightSector = { x: sx + 1, y: sy, gateways: [], edges: [] };
          this.sectors.set(rightSectorKey, rightSector);
        }

        this.addGatewayToSector(rightSector, gateway);
      }
    }

    if (sy < this.sectorsY - 1) {
      const edgeY = Math.min(baseY + this.sectorSize - 1, this.height - 1);
      const newGateways = this.findGatewaysOnHorizontalEdge(edgeY, baseX);

      for (const gateway of newGateways) {
        this.addGatewayToSector(sector, gateway);

        const bottomSectorKey = this.getSectorKey(sx, sy + 1);
        let bottomSector = this.sectors.get(bottomSectorKey);

        if (!bottomSector) {
          bottomSector = { x: sx, y: sy + 1, gateways: [], edges: [] };
          this.sectors.set(bottomSectorKey, bottomSector);
        }

        this.addGatewayToSector(bottomSector, gateway);
      }
    }
  }

  private findGatewaysOnVerticalEdge(
    x: number, baseY: number
  ): Gateway[] {
    const gateways: Gateway[] = [];
    const maxY = Math.min(baseY + this.sectorSize, this.height);

    let gatewayStart = -1;

    const tryAddGateway = (y: number) => {
      if (gatewayStart === -1) return

      const gatewayLength = y - gatewayStart;
      const midY = gatewayStart + Math.floor(gatewayLength / 2);

      gatewayStart = -1;

      const gateway = this.getOrCreateGateway(x, midY);
      gateways.push(gateway);
    }

    for (let y = baseY; y < maxY; y++) {
      const tile = this.miniMap.ref(x, y);
      const nextTile = x + 1 < this.miniMap.width() ? this.miniMap.ref(x + 1, y) : -1;
      const isGateway = this.miniMap.isWater(tile) && nextTile !== -1 && this.miniMap.isWater(nextTile);

      if (isGateway) {
        if (gatewayStart === -1) {
          gatewayStart = y;
        }
      } else {
        tryAddGateway(y)
      }
    }

    tryAddGateway(maxY);

    return gateways;
  }

  private findGatewaysOnHorizontalEdge(
    y: number, baseX: number
  ): Gateway[] {
    const gateways: Gateway[] = [];
    const maxX = Math.min(baseX + this.sectorSize, this.width);

    let gatewayStart = -1;

    const tryAddGateway = (x: number) => {
      if (gatewayStart === -1) return

      const gatewayLength = x - gatewayStart;
      const midX = gatewayStart + Math.floor(gatewayLength / 2);

      gatewayStart = -1;

      const gateway = this.getOrCreateGateway(midX, y);
      gateways.push(gateway);
    }

    for (let x = baseX; x < maxX; x++) {
      const tile = this.miniMap.ref(x, y);
      const nextTile = y + 1 < this.miniMap.height() ? this.miniMap.ref(x, y + 1) : -1;
      const isGateway = this.miniMap.isWater(tile) && nextTile !== -1 && this.miniMap.isWater(nextTile);

      if (isGateway) {
        if (gatewayStart === -1) {
          gatewayStart = x;
        }
      } else {
        tryAddGateway(x);
      }
    }

    tryAddGateway(maxX);

    return gateways;
  }

  private buildSectorConnections(sector: Sector): void {
    const gateways = sector.gateways;

    // Calculate bounding box once for this sector
    const sectorMinX = sector.x * this.sectorSize;
    const sectorMinY = sector.y * this.sectorSize;
    const sectorMaxX = Math.min(this.width - 1, sectorMinX + this.sectorSize - 1);
    const sectorMaxY = Math.min(this.height - 1, sectorMinY + this.sectorSize - 1);

    for (let i = 0; i < gateways.length; i++) {
      const fromGateway = gateways[i];

      // Build list of target gateways (only those we haven't processed yet)
      const targetGateways: Gateway[] = [];
      for (let j = i + 1; j < gateways.length; j++) {
        // Skip if gateways are in different water components
        if (gateways[i].componentId !== gateways[j].componentId) {
          continue;
        }

        targetGateways.push(gateways[j]);
      }

      if (targetGateways.length === 0) {
        continue;
      }

      // Single BFS to find all reachable target gateways
      const reachableGateways = this.findAllReachableGatewaysInBounds(
        fromGateway.tile,
        targetGateways,
        sectorMinX,
        sectorMaxX,
        sectorMinY,
        sectorMaxY
      );

      // Create edges for all reachable gateways
      for (const [targetId, cost] of reachableGateways.entries()) {
        if (!this.edges.has(fromGateway.id)) {
          this.edges.set(fromGateway.id, []);
        }

        if (!this.edges.has(targetId)) {
          this.edges.set(targetId, []);
        }

        // Check for existing edges - gateways may live in 2 sectors, keep only cheaper connection
        const existingEdgeFromI = this.edges.get(fromGateway.id)!.find(e => e.to === targetId);
        const existingEdgeFromJ = this.edges.get(targetId)!.find(e => e.to === fromGateway.id);

        // If edge doesn't exist or new cost is cheaper, update it
        if (!existingEdgeFromI || cost < existingEdgeFromI.cost) {
          const edge1: Edge = {
            from: fromGateway.id,
            to: targetId,
            cost: cost,
            sectorX: sector.x,
            sectorY: sector.y
          };

          const edge2: Edge = {
            from: targetId,
            to: fromGateway.id,
            cost: cost,
            sectorX: sector.x,
            sectorY: sector.y
          };

          // Add to sector edges for tracking
          sector.edges.push(edge1, edge2);

          if (existingEdgeFromI) {
            const idx1 = this.edges.get(fromGateway.id)!.indexOf(existingEdgeFromI);
            this.edges.get(fromGateway.id)![idx1] = edge1;

            const idx2 = this.edges.get(targetId)!.indexOf(existingEdgeFromJ!);
            this.edges.get(targetId)![idx2] = edge2;
          } else {
            this.edges.get(fromGateway.id)!.push(edge1);
            this.edges.get(targetId)!.push(edge2);
          }
        }
      }
    }
  }

  private findAllReachableGatewaysInBounds(
    from: TileRef,
    targetGateways: Gateway[],
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): Map<number, number> {
    const fromX = this.miniMap.x(from);
    const fromY = this.miniMap.y(from);

    // Create a map of tile positions to gateway IDs for fast lookup
    const tileToGateway = new Map<TileRef, number>();
    let maxManhattanDist = 0;

    for (const gateway of targetGateways) {
      tileToGateway.set(gateway.tile, gateway.id);
      const dx = Math.abs(gateway.x - fromX);
      const dy = Math.abs(gateway.y - fromY);
      maxManhattanDist = Math.max(maxManhattanDist, dx + dy);
    }

    const maxDistance = maxManhattanDist * 4; // Allow path deviation
    const reachable = new Map<number, number>();
    let foundCount = 0;

    this.fastBFS.search(
      this.miniMap.width(), this.miniMap.height(), from, maxDistance,
      (tile: number) => this.miniMap.isWater(tile),
      (tile: number, dist: number) => {
        const x = this.miniMap.x(tile);
        const y = this.miniMap.y(tile);

        // Reject if outside of bounding box
        const isStartOrEnd = tile === from || tileToGateway.has(tile);
        if (!isStartOrEnd && (x < minX || x > maxX || y < minY || y > maxY)) {
          return null;
        }

        // Check if this tile is one of our target gateways
        const gatewayId = tileToGateway.get(tile);

        if (gatewayId !== undefined) {
          reachable.set(gatewayId, dist);
          foundCount++;

          // Early exit if we've found all target gateways
          if (foundCount === targetGateways.length) {
            return dist; // Return to stop BFS
          }
        }
      },
    );

    return reachable;
  }
}
