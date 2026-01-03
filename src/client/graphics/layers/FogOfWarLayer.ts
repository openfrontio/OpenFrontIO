import { GameView } from "../../../core/game/GameView";
import { GameMode } from "../../../core/game/Game";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

interface FogChunk {
  x: number; y: number; isDirty: boolean;
  startX: number; startY: number; endX: number; endY: number;
}

/**
 * Camada gráfica responsável por renderizar o efeito visual do Fog of War (nevoeiro de guerra).
 * Controla a visibilidade dos elementos gráficos baseado na lógica do servidor.
 */
export class FogOfWarLayer implements Layer {
  private fullW: number;
  private fullH: number;
  private scale: number = 1;
  private lowW: number;
  private lowH: number;

  private fogMap: Uint8ClampedArray;
  private visionBuffer: Uint8ClampedArray;
  private territoryMap: Uint8Array;

  private fogCanvas: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImageData: ImageData;

  private chunks: FogChunk[] = [];
  private readonly CHUNK_SIZE = 16;

  private lastVisionUpdate = 0;
  private readonly VISION_INTERVAL = 100;

  private _observedPlayer: any = null;
  
  // Cache to track units and borders that have already granted vision
  private visionCache: Map<string, {centerTile: number, radius: number}> = new Map();
  private borderVisionCache: Map<string, Set<number>> = new Map();
  
  private MOBILE_FOG_THRESHOLD = 204; // Represents fog 0.8 (204/255 ≈ 0.8)
  
  // Track previous alliances to detect changes
  private previousAllies: Set<string> = new Set();

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {
    this.fullW = game.width();
    this.fullH = game.height();

    const area = this.fullW * this.fullH;
    if (area > 3_000_000) this.scale = 4;
    else if (area > 1_200_000) this.scale = 2;
    else if (area > 500_000) this.scale = 2;
    else this.scale = 1;

    this.lowW = Math.ceil(this.fullW / this.scale);
    this.lowH = Math.ceil(this.fullH / this.scale);
    const lowSize = this.lowW * this.lowH;

    this.fogMap = new Uint8ClampedArray(lowSize).fill(255);
    this.visionBuffer = new Uint8ClampedArray(lowSize).fill(255);
    this.territoryMap = new Uint8Array(lowSize);

    this.setupChunks();
  }

  private setupChunks() {
    const chunksX = Math.ceil(this.lowW / this.CHUNK_SIZE);
    const chunksY = Math.ceil(this.lowH / this.CHUNK_SIZE);
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        this.chunks.push({
          x: cx, y: cy, isDirty: true,
          startX: cx * this.CHUNK_SIZE,
          startY: cy * this.CHUNK_SIZE,
          endX: Math.min((cx + 1) * this.CHUNK_SIZE, this.lowW),
          endY: Math.min((cy + 1) * this.CHUNK_SIZE, this.lowH),
        });
      }
    }
  }

  shouldTransform(): boolean { return true; }

  init() {
    this.fogCanvas = document.createElement("canvas");
    this.fogCanvas.width = this.lowW;
    this.fogCanvas.height = this.lowH;
    const ctx = this.fogCanvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D context not supported");
    this.fogCtx = ctx;
    this.fogImageData = this.fogCtx.createImageData(this.lowW, this.lowH);
    this.markAllDirty();
    
    // Initialize the vision buffer
    this.visionBuffer.fill(255);
  }

  redraw() { this.markAllDirty(); this.renderFog(); }

  async tick() {
    if (this.game.config().gameConfig().gameMode !== GameMode.FogOfWar) return;
    const now = performance.now();

    if (now - this.lastVisionUpdate >= this.VISION_INTERVAL) {
      await this.updateVision();
      this.lastVisionUpdate = now;
    }

    this.handleAllianceChanges();
    this.applyPermanentTerritory();
    this.updateMobileUnitFogVisibility();
    if (this.hasDirtyChunks()) this.renderFog();
  }

  renderLayer(ctx: CanvasRenderingContext2D) {
    if (this.game.config().gameConfig().gameMode !== GameMode.FogOfWar) return;
    if (this.hasDirtyChunks()) this.renderFog();
    ctx.drawImage(this.fogCanvas, -this.fullW / 2, -this.fullH / 2, this.fullW, this.fullH);
  }

  // UNITS AND BORDERS GIVE VISION
  private async updateVision() {
    // Clear the vision buffer completely on each update
    // This ensures that only areas with active vision sources remain visible
    this.visionBuffer.fill(255);
    
    const player = this._observedPlayer || this.game.myPlayer();
    if (!player) return;

    const allies = [player];
    this.game.playerViews().forEach(p => {
      if (p.id() !== player.id() && player.isAlliedWith(p)) allies.push(p);
    });

    // Create a new cache to compare with the previous one
    const newVisionCache: Map<string, {centerTile: number, radius: number, type: string}> = new Map();
    const newBorderVisionCache: Map<string, Set<number>> = new Map();
    
    // First apply vision from fixed units and borders
    const fixedEntities: Array<{player: any, unit: any, radius: number}> = [];
    const mobileEntities: Array<{player: any, unit: any, radius: number}> = [];
    
    // Separate fixed units from mobile ones
    for (const p of allies) {
      for (const unit of p.units()) {
        const radius = this.getUnitVisionRange(unit);
        const unitType = unit.type?.() || "";
        const isFixed = ["City", "Port", "Defense Post", "Missile Silo", "SAM Launcher", "Factory"].includes(unitType);
        
        if (isFixed) {
          fixedEntities.push({player: p, unit, radius});
        } else {
          mobileEntities.push({player: p, unit, radius});
        }
      }
    }
    
    // Apply vision from fixed units first
    for (const {player, unit, radius} of fixedEntities) {
      const unitKey = `${player.id()}-${unit.id()}`;
      newVisionCache.set(unitKey, {centerTile: unit.tile(), radius, type: 'fixed'});
      this.applyVisionCircle(unit.tile(), radius);
    }
    
    // Apply vision from borders
    await this.applyBorderVision(allies, newBorderVisionCache);
    
    // Now apply vision from mobile units only where necessary
    for (const {player, unit, radius} of mobileEntities) {
      const unitKey = `${player.id()}-${unit.id()}`;
      newVisionCache.set(unitKey, {centerTile: unit.tile(), radius, type: 'mobile'});
      
      // Check if the mobile unit can reveal at least 25% of its vision range
      const tileRef = unit.tile();
      const canActivateVision = this.canUnitActivateVision(tileRef, radius);
      
      // Activate unit vision if it can reveal 25% or more of its field
      if (canActivateVision) {
        this.applyVisionCircle(unit.tile(), radius);
      }
    }

    // Update caches
    this.visionCache = newVisionCache;
    this.borderVisionCache = newBorderVisionCache;

    this.applyVisionToFogMap();
  }

  // New method to apply vision from border tiles
  private async applyBorderVision(alliedPlayers: any[], newBorderVisionCache: Map<string, Set<number>>) {
    // Process all borders at once to avoid inconsistencies
    const borderData: Array<{playerId: string, borderTiles: number[]}> = [];
    
    // Collect all borders first
    for (const player of alliedPlayers) {
      try {
        const borderTiles = await player.borderTiles();
        borderData.push({
          playerId: player.id(),
          borderTiles: borderTiles.borderTiles
        });
      } catch (e) {
        // In case of error, continue with other players
        console.warn("Failed to get border tiles for player", player.id(), e);
      }
    }
    
    // Now apply vision from borders
    for (const {playerId, borderTiles} of borderData) {
      newBorderVisionCache.set(playerId, new Set(borderTiles));
      
      // Apply vision from borders only where necessary
      for (const tile of borderTiles) {
        // Check if the border is in an area already visible
        const lx = Math.floor(this.game.x(tile) / this.scale);
        const ly = Math.floor(this.game.y(tile) / this.scale);
        const idx = ly * this.lowW + lx;
        
        // If the area is not visible (buffer is still 255), apply vision from the border
        if (this.visionBuffer[idx] === 255) {
          this.applyVisionCircle(tile, 20); // Fixed radius of 20 tiles for border vision
        }
        // If the area is already visible, we don't need to apply additional vision
      }
    }
  }

  private applyVisionCircle(centerTile: number, radius: number) {
    const cx = this.game.x(centerTile);
    const cy = this.game.y(centerTile);
    const r2 = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      const wy = cy + dy;
      if (wy < 0 || wy >= this.fullH) continue;
      const maxDx = Math.floor(Math.sqrt(r2 - dy * dy));

      for (let dx = -maxDx; dx <= maxDx; dx++) {
        const wx = cx + dx;
        if (wx < 0 || wx >= this.fullW) continue;

        const lx = Math.floor(wx / this.scale);
        const ly = Math.floor(wy / this.scale);
        if (lx >= 0 && lx < this.lowW && ly >= 0 && ly < this.lowH) {
          this.visionBuffer[ly * this.lowW + lx] = 0;
        }
      }
    }
  }
  


  private applyVisionToFogMap() {
    let changed = false;
    for (let i = 0; i < this.fogMap.length; i++) {
      // Check if this tile is owned by a player
      const lowX = i % this.lowW;
      const lowY = Math.floor(i / this.lowW);
      const fullX = lowX * this.scale;
      const fullY = lowY * this.scale;
      
      // Get the owner of this tile
      const ownerID = this.getTileOwnerID(fullX, fullY);
      const myPlayer = this._observedPlayer || this.game.myPlayer();
      
      // Skip processing for player's own territory tiles
      if (ownerID !== 0 && myPlayer && ownerID === myPlayer.smallID()) {
        // Player's own territory tiles never go to fog 0.8
        if (this.fogMap[i] !== 0) {
          this.fogMap[i] = 0;
          this.markTileDirty(i);
          changed = true;
        }
        continue;
      }
      
      // Handle ally territory tiles - they should always be fog 0 as long as they are still allies
      if (ownerID !== 0 && myPlayer && this.isAlly(ownerID, myPlayer)) {
        // Ally's territory tiles should always be fog 0
        if (this.fogMap[i] !== 0) {
          this.fogMap[i] = 0;
          this.markTileDirty(i);
          changed = true;
        }
        continue;
      }
      
      if (this.territoryMap[i]) continue;

      const newFog = this.visionBuffer[i] === 0 ? 0 : (this.fogMap[i] <= 204 ? 204 : 255);
      if (this.fogMap[i] !== newFog) {
        this.fogMap[i] = newFog;
        this.markTileDirty(i);
        changed = true;
      }
    }
    if (changed) this.renderFog();
  }

  private applyPermanentTerritory() {
    let changed = false;
    for (let i = 0; i < this.territoryMap.length; i++) {
      if (this.territoryMap[i] && this.fogMap[i] !== 0) {
        this.fogMap[i] = 0;
        this.markTileDirty(i);
        changed = true;
      }
    }
    if (changed) this.renderFog();
  }

  public claimTerritory(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.fullW || y >= this.fullH) return;
    const fullIdx = y * this.fullW + x;
    const lowIdx = this.fullToLow(fullIdx);
    this.territoryMap[lowIdx] = 1;
    this.fogMap[lowIdx] = 0;
    this.markTileDirty(lowIdx);
  }

  private renderFog() {
    const data = this.fogImageData.data;
    for (const chunk of this.chunks) {
      if (!chunk.isDirty) continue;
      for (let y = chunk.startY; y < chunk.endY; y++) {
        for (let x = chunk.startX; x < chunk.endX; x++) {
          const i = y * this.lowW + x;
          const p = i * 4;

          // Check if this tile is owned by a player
          const fullX = x * this.scale;
          const fullY = y * this.scale;
          
          // Get the owner of this tile
          const ownerID = this.getTileOwnerID(fullX, fullY);
          const myPlayer = this._observedPlayer || this.game.myPlayer();
          
          if (this.territoryMap[i]) {
            data[p] = 0; data[p+1] = 128; data[p+2] = 0; data[p+3] = 70;
          } else if (ownerID !== 0) {
            // This tile is owned by some player
            // Territory tiles always have fog 0, even if not in vision range
            if (myPlayer && (ownerID === myPlayer.smallID() || this.isAlly(ownerID, myPlayer))) {
              // Player's own territory or ally's territory - no fog (fog 0)
              data[p] = data[p+1] = data[p+2] = data[p+3] = 0;
            } else {
              // Enemy territory - also fog 0 (no fog) as per requirement
              data[p] = data[p+1] = data[p+2] = data[p+3] = 0;
            }
          } else {
            // No owner (neutral territory) - normal fog behavior
            data[p] = data[p+1] = data[p+2] = data[p+3] = 0;
          }

          const fog = this.fogMap[i];
          // Player's own territory tiles and ally territory tiles never show fog 0.8
          if (ownerID !== 0 && myPlayer && (ownerID === myPlayer.smallID() || this.isAlly(ownerID, myPlayer))) {
            // Keep fog at 0 for player's own territory and ally territory
            data[p+3] = 0;
          } else if (fog >= 204) {
            const gray = 12 + (i & 15);
            data[p] = gray; data[p+1] = gray; data[p+2] = gray;
            data[p+3] = fog;
          }
        }
      }
      chunk.isDirty = false;
    }
    this.fogCtx.putImageData(this.fogImageData, 0, 0);
  }

  private fullToLow(fullIdx: number): number {
    const x = fullIdx % this.fullW;
    const y = Math.floor(fullIdx / this.fullW);
    const lx = Math.floor(x / this.scale);
    const ly = Math.floor(y / this.scale);
    return Math.min(ly, this.lowH - 1) * this.lowW + Math.min(lx, this.lowW - 1);
  }

  private markTileDirty(lowIdx: number) {
    const x = lowIdx % this.lowW;
    const y = Math.floor(lowIdx / this.lowW);
    const cx = Math.floor(x / this.CHUNK_SIZE);
    const cy = Math.floor(y / this.CHUNK_SIZE);
    const idx = cy * Math.ceil(this.lowW / this.CHUNK_SIZE) + cx;
    if (idx < this.chunks.length) this.chunks[idx].isDirty = true;
  }

  private markAllDirty() { this.chunks.forEach(c => c.isDirty = true); }
  private hasDirtyChunks(): boolean { return this.chunks.some(c => c.isDirty); }

  public getFogValueAt(fullIdx: number): number {
    const low = this.fullToLow(fullIdx);
    return this.fogMap[low] / 255;
  }

  // Helper method to get tile owner ID
  private getTileOwnerID(x: number, y: number): number {
    // Convert screen coordinates to game coordinates
    const gameX = Math.floor(x);
    const gameY = Math.floor(y);
    
    // Check if coordinates are valid
    if (gameX < 0 || gameX >= this.game.width() || gameY < 0 || gameY >= this.game.height()) {
      return 0;
    }
    
    // Get the tile reference
    const tileRef = this.game.ref(gameX, gameY);
    
    // Return the owner ID
    return this.game.ownerID(tileRef);
  }

  // Helper method to check if a player ID belongs to an ally
  private isAlly(ownerID: number, myPlayer: any): boolean {
    if (ownerID === myPlayer.smallID()) {
      return true; // Own player is considered an ally
    }
    
    // Check if the owner is an ally
    const ownerPlayer = this.game.playerBySmallID(ownerID);
    if (ownerPlayer && ownerPlayer.isPlayer()) {
      return myPlayer.isAlliedWith(ownerPlayer);
    }
    
    return false;
  }

  // Method to check if a unit can reveal at least 25% of its vision field
  private canUnitActivateVision(centerTile: number, radius: number): boolean {
    const cx = this.game.x(centerTile);
    const cy = this.game.y(centerTile);
    const r2 = radius * radius;
    
    let totalTiles = 0;
    let visibleTiles = 0;
    
    // Count how many tiles of the vision field are already visible vs total
    for (let dy = -radius; dy <= radius; dy++) {
      const wy = cy + dy;
      if (wy < 0 || wy >= this.fullH) continue;
      const maxDx = Math.floor(Math.sqrt(r2 - dy * dy));
      
      for (let dx = -maxDx; dx <= maxDx; dx++) {
        const wx = cx + dx;
        if (wx < 0 || wx >= this.fullW) continue;
        
        const lx = Math.floor(wx / this.scale);
        const ly = Math.floor(wy / this.scale);
        if (lx >= 0 && lx < this.lowW && ly >= 0 && ly < this.lowH) {
          totalTiles++;
          const idx = ly * this.lowW + lx;
          // Count as visible if the buffer is 0 (fog 0)
          if (this.visionBuffer[idx] === 0) {
            visibleTiles++;
          }
        }
      }
    }
    
  
    const visibilityRatio = visibleTiles / totalTiles;
    return visibilityRatio < 0.75;
  }
  
  private getUnitVisionRange(unit: any): number {
    const type = unit.type?.() || "";
    const level = unit.level?.() ?? 1;
    const boost = 1 + (level - 1) * 0.2;
    const base: Record<string, number> = {
      "City": 30, "Port": 80, "Defense Post": 70, "Warship": 140,
      "Missile Silo": 200, "SAM Launcher": 400, "Factory": 35
    };
    const range = base[type] ?? 15;
    const upgradable = ["City", "Port", "Missile Silo", "SAM Launcher", "Factory"];
    return upgradable.includes(type) ? Math.round(range * boost) : range;
  }
  
  private handleAllianceChanges() {
    const player = this._observedPlayer || this.game.myPlayer();
    if (!player) return;
    
    // Create current allies set
    const currentAllies = new Set<string>();
    currentAllies.add(player.id());
    
    this.game.playerViews().forEach(p => {
      if (p.id() !== player.id() && player.isAlliedWith(p)) {
        currentAllies.add(p.id());
      }
    });
    
    // Check for alliance changes
    const oldAlliesArray = Array.from(this.previousAllies);
    const newAlliesArray = Array.from(currentAllies);
    
    // If alliance composition changed, we could add logic here if needed
    if (oldAlliesArray.length !== newAlliesArray.length || 
        oldAlliesArray.some(id => !currentAllies.has(id)) ||
        newAlliesArray.some(id => !this.previousAllies.has(id))) {
      
      // Update the previous allies set
      this.previousAllies = currentAllies;
    }
  }

  public setObservedPlayer(player: any) {
    this._observedPlayer = player;
    this.fogMap.fill(255);
    this.visionBuffer.fill(255);
    this.territoryMap.fill(0);
    this.markAllDirty();
    
    // Clear caches when the observed player changes
    this.visionCache.clear();
    this.borderVisionCache.clear();
    
    
    // Reset alliance tracking
    this.previousAllies.clear();
    if (player) {
      this.previousAllies.add(player.id());
      this.game.playerViews().forEach(p => {
        if (p.id() !== player.id() && player.isAlliedWith(p)) {
          this.previousAllies.add(p.id());
        }
      });
    }
  }

  private updateMobileUnitFogVisibility() {
    // This method is now simplified since we're not tracking units with distance anymore
    // The visibility is now determined in real-time based on fog level
  }
  
  // Method to check if a mobile unit should be rendered as opacued or invisible
  public getMobileUnitFogEffect(unitId: number): { isOpacued: boolean, isInvisible: boolean } {
    // Find the unit in the game
    const unit = this.game.unit(unitId);
    if (!unit) {
      // Unit doesn't exist, should be visible (or not rendered at all)
      return { isOpacued: false, isInvisible: false };
    }
    
    const player = this._observedPlayer || this.game.myPlayer();
    if (!player) {
      return { isOpacued: false, isInvisible: false };
    }
    
    // Check if unit owner is an ally
    const unitOwner = unit.owner?.();
    if (unitOwner && player.isAlliedWith(unitOwner)) {
      // Units from allies should always be visible
      return { isOpacued: false, isInvisible: false };
    }
    
    // Get the fog value at the unit's position
    const unitTile = unit.tile();
    const unitX = this.game.x(unitTile);
    const unitY = this.game.y(unitTile);
    const lowX = Math.floor(unitX / this.scale);
    const lowY = Math.floor(unitY / this.scale);
    
    if (lowX >= 0 && lowX < this.lowW && lowY >= 0 && lowY < this.lowH) {
      const idx = lowY * this.lowW + lowX;
      const fogValue = this.fogMap[idx];
      
      // If fog is 0.8 or higher (204/255), the mobile unit should be opacued
      if (fogValue >= this.MOBILE_FOG_THRESHOLD) {
        return { isOpacued: true, isInvisible: false };
      }
    }
    
    return { isOpacued: false, isInvisible: false };
  }
  
  // Method to check if a fixed unit should be rendered based on fog level
  public getFixedUnitFogVisibility(unit: any): { isVisible: boolean } {
    const player = this._observedPlayer || this.game.myPlayer();
    if (!player) {
      return { isVisible: true };
    }
    
    // Check if unit owner is an ally
    const unitOwner = unit.owner?.();
    if (unitOwner && player.isAlliedWith(unitOwner)) {
      // Units from allies should always be visible
      return { isVisible: true };
    }
    
    // Get the fog value at the unit's position
    const unitTile = unit.tile();
    const unitX = this.game.x(unitTile);
    const unitY = this.game.y(unitTile);
    const lowX = Math.floor(unitX / this.scale);
    const lowY = Math.floor(unitY / this.scale);
    
    if (lowX >= 0 && lowX < this.lowW && lowY >= 0 && lowY < this.lowH) {
      const idx = lowY * this.lowW + lowX;
      const fogValue = this.fogMap[idx];
      
      // If fog is 0.8 or higher (204/255), the fixed unit should not be visible
      if (fogValue >= this.MOBILE_FOG_THRESHOLD) {
        return { isVisible: false };
      }
    }
    
    return { isVisible: true };
  }
  
  public clearObservedPlayer() { this._observedPlayer = null; }
}