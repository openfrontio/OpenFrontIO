import { GameView } from "../../../core/game/GameView";
import { GameMode } from "../../../core/game/Game";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class FogOfWarLayer implements Layer {
  private fogCanvas: HTMLCanvasElement;
  private fogContext: CanvasRenderingContext2D;
  private fogImageData: ImageData;
  
  // Fog of War state (0.0 = fully visible, 0.8-1.0 = fog)
  private fogMap: Float32Array;
  
  // Territory map
  // 0 = neutral
  // 1 = controlled by player
  private territoryMap: Uint8Array;
  
  // Chunk system for optimization
  private chunks: FogChunk[];
  private chunkSize: number = 8;
  private chunksX: number;
  private chunksY: number;
  
  // Territory tracking
  private territory: Set<number>; // stores indices: y * mapWidth + x
  
  // Update timing
  private lastFogUpdate: number = 0;
  private updateInterval: number = 100; // milliseconds - increased frequency for smoother transitions

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {
    this.territory = new Set();
    
    // Initialize fog map with Float32Array for smooth fading
    this.fogMap = new Float32Array(this.game.width() * this.game.height()).fill(1.0); // 1.0 = never seen
    
    // Initialize territory map
    this.territoryMap = new Uint8Array(this.game.width() * this.game.height()).fill(0);
    
    // Initialize chunks
    this.chunksX = Math.ceil(this.game.width() / this.chunkSize);
    this.chunksY = Math.ceil(this.game.height() / this.chunkSize);
    this.chunks = [];
    
    for (let y = 0; y < this.chunksY; y++) {
      for (let x = 0; x < this.chunksX; x++) {
        this.chunks.push({ 
          x, 
          y, 
          isDirty: true,
          startX: x * this.chunkSize,
          startY: y * this.chunkSize,
          endX: Math.min((x + 1) * this.chunkSize, this.game.width()),
          endY: Math.min((y + 1) * this.chunkSize, this.game.height())
        });
      }
    }
  }

  shouldTransform(): boolean {
    return true;
  }

  init() {
    // Create fog canvas
    this.fogCanvas = document.createElement("canvas");
    this.fogCanvas.width = this.game.width();
    this.fogCanvas.height = this.game.height();
    
    const context = this.fogCanvas.getContext("2d", { alpha: true });
    if (context === null) throw new Error("2d context not supported");
    this.fogContext = context;
    
    // Create image data for efficient rendering
    this.fogImageData = this.fogContext.createImageData(
      this.game.width(),
      this.game.height()
    );
    
    // Mark all chunks as dirty for initial render
    this.markAllChunksDirty();
  }

  redraw() {
    // Mark all chunks as dirty when redrawing
    this.markAllChunksDirty();
    this.renderFog();
  }

  tick() {
    // Only update fog in Fog of War mode
    if (this.game.config().gameConfig().gameMode !== GameMode.FogOfWar) {
      return;
    }
    
    const now = Date.now();
    if (now - this.lastFogUpdate < this.updateInterval) {
      return;
    }
    this.lastFogUpdate = now;

    let hasChanges = false;

    // Gradually fade out vision that is no longer updated
    // Only fade values that are less than 0.8 (visible areas)
    // This creates a smooth transition from visible (0.0) to remembered (0.8) to unknown (1.0)
    for (let i = 0; i < this.fogMap.length; i++) {
      if (this.fogMap[i] < 0.8) { // Only fade values that are less than 0.8 (visible areas)
        // Slowly return to 0.8 (remembered territory), but never to 1.0 (never seen)
        const newValue = Math.min(this.fogMap[i] + 0.005, 0.8); // Increased fade rate for smoother transition
        if (Math.abs(newValue - this.fogMap[i]) > 0.0001) {
          this.fogMap[i] = newValue;
          hasChanges = true;
          
          // Mark the chunk as dirty
          const x = i % this.game.width();
          const y = Math.floor(i / this.game.width());
          const chunkX = Math.floor(x / this.chunkSize);
          const chunkY = Math.floor(y / this.chunkSize);
          const chunkIndex = chunkY * this.chunksX + chunkX;
          if (chunkIndex < this.chunks.length) {
            this.chunks[chunkIndex].isDirty = true;
          }
        }
      }
    }

    // Update vision for player's units with dynamic fading
    const myPlayer = this.game.myPlayer();
    if (myPlayer) {
      const units = myPlayer.units();
      for (const unit of units) {
        // Get vision range based on unit type
        const visionRange = this.getUnitVisionRange(unit);
        this.updateVisionWithFade(unit.tile(), visionRange);
      }
      
      // Update vision for player's territory borders with 20 tile radius
      this.updateTerritoryBorderVision(myPlayer);
      
      // Update vision from allied players in Fog of War mode
      if (this.game.config().gameConfig().gameMode === GameMode.FogOfWar) {
        this.updateAlliedVision(myPlayer);
      }
    }

    // Update vision for claimed territory
    for (const idx of this.territory) {
      if (this.fogMap[idx] > 0.0) {
        this.fogMap[idx] = 0.0; // totally visible
        hasChanges = true;
        
        // Mark the chunk as dirty
        const x = idx % this.game.width();
        const y = Math.floor(idx / this.game.width());
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkY = Math.floor(y / this.chunkSize);
        const chunkIndex = chunkY * this.chunksX + chunkX;
        if (chunkIndex < this.chunks.length) {
          this.chunks[chunkIndex].isDirty = true;
        }
      }
    }

    // Only mark all chunks as dirty if there are significant changes
    // This optimization prevents unnecessary rendering when no visibility changes occur
    if (hasChanges) {
      // Additional check: if many chunks are dirty, it's more efficient to render all at once
      const dirtyChunkCount = this.chunks.filter(chunk => chunk.isDirty).length;
      if (dirtyChunkCount > this.chunks.length * 0.5) {
        this.markAllChunksDirty();
      }
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Only render if the game mode is Fog of War
    if (this.game.config().gameConfig().gameMode !== GameMode.FogOfWar) {
      return;
    }
    
    // Only render if there are dirty chunks
    if (this.hasDirtyChunks()) {
      this.renderFog();
    }
    
    // Draw the fog canvas onto the main context
    context.drawImage(
      this.fogCanvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height()
    );
  }

  private updateVisionWithFade(centerTile: number, radius: number) {
    const centerX = this.game.x(centerTile);
    const centerY = this.game.y(centerTile);
    
    // Create a circular vision range with dynamic fading
    const radiusSq = radius * radius;
    
    for (let i = -radius; i <= radius; i++) {
      for (let j = -radius; j <= radius; j++) {
        // Check if the tile is within the circular radius
        if (i * i + j * j <= radiusSq) {
          const dx = centerX + i;
          const dy = centerY + j;
          
          if (dx >= 0 && dy >= 0 && dx < this.game.width() && dy < this.game.height()) {
            const dist = Math.sqrt(i * i + j * j);
            if (dist < radius) {
              // Calculate fade based on distance: closer = more visible
              // Using a smoother curve for more natural transition
              const normalizedDist = Math.max(0.0, Math.min(1.0, dist / radius));
              // Apply easing function for smoother transition: 0.8 * (1 - (1 - dist)^2)
              const alpha = 0.8 * (1 - Math.pow(1 - normalizedDist, 2));
              const idx = dy * this.game.width() + dx;
              
              // Only update if the new value is lower (more visible)
              if (alpha < this.fogMap[idx]) {
                this.fogMap[idx] = alpha;
                
                // Mark the chunk as dirty
                const chunkX = Math.floor(dx / this.chunkSize);
                const chunkY = Math.floor(dy / this.chunkSize);
                const chunkIndex = chunkY * this.chunksX + chunkX;
                if (chunkIndex < this.chunks.length) {
                  this.chunks[chunkIndex].isDirty = true;
                }
              }
            }
          }
        }
      }
    }
  }

  // New method to update vision from allied players
  private updateAlliedVision(myPlayer: any) {
    // Get all allied players
    const alliedPlayers = this.game.playerViews().filter(player => 
      player.id() !== myPlayer.id() && myPlayer.isAlliedWith(player)
    );
    
    // Update vision from each allied player's units
    for (const alliedPlayer of alliedPlayers) {
      const units = alliedPlayer.units();
      for (const unit of units) {
        // Get vision range based on unit type
        const visionRange = this.getUnitVisionRange(unit);
        this.updateVisionWithFade(unit.tile(), visionRange);
      }
      
      // Update vision from allied player's territory borders
      if (typeof alliedPlayer.borderTiles === 'function') {
        const borderTilesResult = alliedPlayer.borderTiles();
        
        // Handle both synchronous and asynchronous borderTiles
        if (borderTilesResult instanceof Promise) {
          // For asynchronous case (PlayerView)
          borderTilesResult.then((result: any) => {
            const borderTiles = result.borderTiles || result;
            this.applyAlliedBorderVision(borderTiles);
          }).catch((error: any) => {
            console.warn("Failed to get allied player border tiles:", error);
          });
        } else {
          // For synchronous case
          const borderTiles = borderTilesResult;
          this.applyAlliedBorderVision(borderTiles);
        }
      }
    }
  }

  // Apply vision to allied border tiles and surrounding area
  private applyAlliedBorderVision(borderTiles: any) {
    // Set border tiles to fully visible (0.0)
    for (const tile of borderTiles) {
      const x = this.game.x(tile);
      const y = this.game.y(tile);
      
      if (x >= 0 && y >= 0 && x < this.game.width() && y < this.game.height()) {
        const idx = y * this.game.width() + x;
        if (this.fogMap[idx] > 0.0) {
          this.fogMap[idx] = 0.0; // totally visible
          
          // Mark the chunk as dirty
          const chunkX = Math.floor(x / this.chunkSize);
          const chunkY = Math.floor(y / this.chunkSize);
          const chunkIndex = chunkY * this.chunksX + chunkX;
          if (chunkIndex < this.chunks.length) {
            this.chunks[chunkIndex].isDirty = true;
          }
        }
      }
      
      // Also apply vision radius around each border tile
      this.updateVisionWithFade(tile, 20);
    }
  }

  private renderFog() {
    // Update only dirty chunks
    for (const chunk of this.chunks) {
      if (!chunk.isDirty) continue;
      
      // Render this chunk
      for (let y = chunk.startY; y < chunk.endY; y++) {
        for (let x = chunk.startX; x < chunk.endX; x++) {
          const idx = y * this.game.width() + x;
          
          // Calculate pixel index in image data
          const pixelIndex = (y * this.game.width() + x) * 4;
          
          // First draw the territory (layer below fog)
          if (this.territoryMap[idx] === 1) {
            // Draw territory with green tint
            this.fogImageData.data[pixelIndex + 0] = 0;      // R
            this.fogImageData.data[pixelIndex + 1] = 128;    // G
            this.fogImageData.data[pixelIndex + 2] = 0;      // B
            this.fogImageData.data[pixelIndex + 3] = 51;     // A (20% opacity)
          } else {
            // Clear territory pixel
            this.fogImageData.data[pixelIndex + 0] = 0;      // R
            this.fogImageData.data[pixelIndex + 1] = 0;      // G
            this.fogImageData.data[pixelIndex + 2] = 0;      // B
            this.fogImageData.data[pixelIndex + 3] = 0;      // A
          }
          
          // Then draw the fog layer on top with dynamic alpha
          const fogValue = this.fogMap[idx];
          
          // Apply fog with dynamic alpha based on visibility
          // 0.0 = totally visible (transparent)
          // 0.8-1.0 = fog (black with varying opacity)
          const alpha = Math.min(255, Math.max(0, Math.floor(fogValue * 255)));
          
          // Add subtle texture variation for visual interest
          const base = 20 + (Math.random() * 10); // Simple noise texture
          
          this.fogImageData.data[pixelIndex + 0] = base;     // R
          this.fogImageData.data[pixelIndex + 1] = base;     // G
          this.fogImageData.data[pixelIndex + 2] = base;     // B
          this.fogImageData.data[pixelIndex + 3] = alpha;    // A (dynamic opacity)
        }
      }
      
      // Mark chunk as clean
      chunk.isDirty = false;
    }
    
    // Put the updated image data to the canvas
    this.fogContext.putImageData(this.fogImageData, 0, 0);
  }

  private markAllChunksDirty() {
    for (const chunk of this.chunks) {
      chunk.isDirty = true;
    }
  }

  private hasDirtyChunks(): boolean {
    return this.chunks.some(chunk => chunk.isDirty);
  }

  // Public method to claim territory (make it permanently visible)
  public claimTerritory(x: number, y: number) {
    if (x >= 0 && y >= 0 && x < this.game.width() && y < this.game.height()) {
      const idx = y * this.game.width() + x;
      this.territory.add(idx);
      this.fogMap[idx] = 0.0; // totally visible
      
      // Mark the chunk as dirty
      const chunkX = Math.floor(x / this.chunkSize);
      const chunkY = Math.floor(y / this.chunkSize);
      const chunkIndex = chunkY * this.chunksX + chunkX;
      if (chunkIndex < this.chunks.length) {
        this.chunks[chunkIndex].isDirty = true;
      }
    }
  }
  
  // Get fog value at specific index
  public getFogValueAt(index: number): number {
    if (index >= 0 && index < this.fogMap.length) {
      return this.fogMap[index];
    }
    return 1.0; // Default to fully fogged if index is out of bounds
  }

  // Get vision range based on unit type
  private getUnitVisionRange(unit: any): number {
    // Get unit type
    const unitType = unit.type();
    
    // Get unit level (default to 1 if not available)
    const level = typeof unit.level === 'function' ? unit.level() : 1;
    
    // Calculate vision range boost: 20% per level
    const visionBoost = 1 + (level - 1) * 0.2;
    
    // Define base vision ranges for different unit types
    let baseVisionRange = 15; // Default vision range for other units
    
    switch(unitType) {
      case "City":
        baseVisionRange = 30;  // Cities have long vision range
        break;
      case "Port":
        baseVisionRange = 80;  // Ports have good vision range
        break;
      case "Defense Post":
        baseVisionRange = 70;  // Defense posts have moderate vision range
        break;
      case "Warship":
        baseVisionRange = 140;  // Warships have good vision range
        break;
      case "Missile Silo":
        baseVisionRange = 200;  // Missile silos have moderate vision range
        break;
      case "SAM Launcher":
        baseVisionRange = 400;  // SAM launchers have moderate vision range
        break;
      case "Factory":
        baseVisionRange = 35;  // Factories have moderate vision range
        break;
      case "Atom Bomb":
        baseVisionRange = 30;  // Atom bombs have limited vision range
        break;
      case "Hydrogen Bomb":
        baseVisionRange = 80;  // Hydrogen bombs have moderate vision range
        break;
      case "MIRV":
        baseVisionRange = 100;  // MIRV bombs have good vision range
        break;
    }
    
    // Apply vision boost for upgradable units
    // Upgradable units: City, Port, Missile Silo, SAM Launcher, Factory
    const upgradableUnits = ["City", "Port", "Missile Silo", "SAM Launcher", "Factory"];
    if (upgradableUnits.includes(unitType)) {
      return Math.round(baseVisionRange * visionBoost);
    }
    
    // Return base vision range for non-upgradable units
    return baseVisionRange;
  }

  // Update vision for territory borders
  private updateTerritoryBorderVision(player: any) {
    // Get player's border tiles
    if (typeof player.borderTiles === 'function') {
      const borderTilesResult = player.borderTiles();
      
      // Handle both synchronous and asynchronous borderTiles
      if (borderTilesResult instanceof Promise) {
        // For asynchronous case (PlayerView)
        borderTilesResult.then((result: any) => {
          const borderTiles = result.borderTiles || result;
          this.applyBorderVision(borderTiles);
        }).catch((error: any) => {
          console.warn("Failed to get border tiles:", error);
        });
      } else {
        // For synchronous case (PlayerImpl)
        const borderTiles = borderTilesResult;
        this.applyBorderVision(borderTiles);
      }
    }
  }

  // Apply vision to border tiles and surrounding area
  private applyBorderVision(borderTiles: any) {
    // Set border tiles to fully visible (0.0)
    for (const tile of borderTiles) {
      const x = this.game.x(tile);
      const y = this.game.y(tile);
      
      if (x >= 0 && y >= 0 && x < this.game.width() && y < this.game.height()) {
        const idx = y * this.game.width() + x;
        if (this.fogMap[idx] > 0.0) {
          this.fogMap[idx] = 0.0; // totally visible
          
          // Mark the chunk as dirty
          const chunkX = Math.floor(x / this.chunkSize);
          const chunkY = Math.floor(y / this.chunkSize);
          const chunkIndex = chunkY * this.chunksX + chunkX;
          if (chunkIndex < this.chunks.length) {
            this.chunks[chunkIndex].isDirty = true;
          }
        }
      }
      
      // Also apply vision radius around each border tile
      this.updateVisionWithFade(tile, 20);
    }
  }
}

// Chunk interface for optimization
interface FogChunk {
  x: number;
  y: number;
  isDirty: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}