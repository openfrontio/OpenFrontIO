import { UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class NightModeLayer implements Layer {
  setGame(game: GameView) {
    this.game = game;
  }

  private darkenColor: [number, number, number] = [0, 0, 0];
  private darkenAlpha: number = 0.8;
  private flashlightRadius: number = 50;
  private userSettingsInstance = new UserSettings();
  private mouseX: number = 0;
  private mouseY: number = 0;

  // Add game reference
  private game: GameView | null = null;

  private handleMouseMove(event: MouseEvent) {
    const rect = this.transformHandler.boundingRect();
    this.mouseX = event.clientX - rect.left;
    this.mouseY = event.clientY - rect.top;
  }

  init(): void {}
  tick(): void {}
  redraw(): void {}

  constructor(
    private transformHandler: TransformHandler,
    game?: GameView, // Add game parameter
  ) {
    this.game = game ?? null;
    if (this.userSettingsInstance.nightMode()) {
      document.documentElement.classList.add("night");
    } else {
      document.documentElement.classList.remove("night");
    }
    document.addEventListener("mousemove", (e) => this.handleMouseMove(e));
  }

  // New method to set game reference after construction

  renderLayer(context: CanvasRenderingContext2D): void {
    if (!this.userSettingsInstance.nightMode()) return;

    const width = this.transformHandler.width();
    const height = this.transformHandler.boundingRect().height;
    const cellSize = this.transformHandler.scale;

    // Fill the entire screen with dark
    context.fillStyle = `rgba(${this.darkenColor[0]}, ${this.darkenColor[1]}, ${this.darkenColor[2]}, ${this.darkenAlpha})`;
    context.fillRect(0, 0, width, height);

    // ===== NEW: Render city lights =====
    if (this.game) {
      this.renderCityLights(context, cellSize);
    }

    // Render flashlight effect around mouse
    this.renderFlashlight(context, width, height, cellSize);
  }

  /**
   * Renders illumination for all cities on the map.
   * Creates a glow effect similar to satellite images of Earth at night.
   */
  private renderCityLights(
    context: CanvasRenderingContext2D,
    cellSize: number,
  ): void {
    // Get all cities in the game
    const cities = this.game!.units(UnitType.City);

    for (const city of cities) {
      // Get city position
      const tileRef = city.tile();
      const cityX = this.game!.x(tileRef);
      const cityY = this.game!.y(tileRef);

      // Convert tile coordinates to screen coordinates
      const screenX = cityX * cellSize;
      const screenY = cityY * cellSize;

      // Get city level for scaling the light effect
      const cityLevel = city.level();

      // Render city glow - you can customize this pattern
      this.renderCityGlow(context, screenX, screenY, cellSize, cityLevel);
    }
  }

  /**
   * Renders a glow effect for a single city.
   * Customize this method to achieve your desired lighting pattern.
   */
  private renderCityGlow(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    cellSize: number,
    level: number,
  ): void {
    // Example 1: Simple bright square (like a satellite image)
    const lightRadius = 5 + level * 2; // Larger cities have bigger glow

    for (let dy = -lightRadius; dy <= lightRadius; dy++) {
      for (let dx = -lightRadius; dx <= lightRadius; dx++) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= lightRadius) {
          // Brightness decreases with distance
          const brightness = 1 - distance / lightRadius;
          const alpha = this.darkenAlpha * 0.8 * brightness;

          context.fillStyle = `rgba(255, 220, 150, ${alpha})`;
          context.fillRect(
            x + dx * cellSize,
            y + dy * cellSize,
            cellSize,
            cellSize,
          );
        }
      }
    }

    // Example 2: Add a brighter core
    context.fillStyle = `rgba(255, 255, 200, ${this.darkenAlpha * 0.9})`;
    context.fillRect(x, y, cellSize, cellSize);
  }

  /**
   * Renders the flashlight effect around the mouse cursor.
   * Extracted from original renderLayer for better organization.
   */
  private renderFlashlight(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    cellSize: number,
  ): void {
    const startX =
      Math.floor(
        Math.max(this.mouseX - this.flashlightRadius * cellSize, 0) / cellSize,
      ) * cellSize;
    const endX =
      Math.ceil(
        Math.min(this.mouseX + this.flashlightRadius * cellSize, width) /
          cellSize,
      ) * cellSize;

    const startY =
      Math.floor(
        Math.max(this.mouseY - this.flashlightRadius * cellSize, 0) / cellSize,
      ) * cellSize;
    const endY =
      Math.ceil(
        Math.min(this.mouseY + this.flashlightRadius * cellSize, height) /
          cellSize,
      ) * cellSize;

    for (let y = startY; y < endY; y += cellSize) {
      for (let x = startX; x < endX; x += cellSize) {
        const dist = Math.hypot(
          (this.mouseX - (x + cellSize / 2)) / cellSize,
          (this.mouseY - (y + cellSize / 2)) / cellSize,
        );

        const brightness = Math.max(0, 1 - dist / this.flashlightRadius);

        if (brightness > 0) {
          context.fillStyle = `rgba(200,200,130,${(this.darkenAlpha / 2) * brightness})`;
          context.fillRect(x, y, cellSize, cellSize);
        }
      }
    }
  }
}
