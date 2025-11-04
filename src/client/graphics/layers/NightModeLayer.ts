import { Cell, UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

export class NightModeLayer implements Layer {
  private darkenColor: [number, number, number] = [0, 0, 0];
  private darkenAlpha: number = 0.8;
  private flashlightRadius: number = 50;
  private userSettingsInstance = new UserSettings();
  private mouseX: number = 0;
  private mouseY: number = 0;
  private maxCityLightLevel: number = 15;

  private mouseMoveHandler = (e: MouseEvent) => this.handleMouseMove(e);

  private handleMouseMove(event: MouseEvent) {
    const rect = this.transformHandler.boundingRect();
    this.mouseX = event.clientX - rect.left;
    this.mouseY = event.clientY - rect.top;
  }

  init(): void {}
  tick(): void {}
  redraw(): void {}

  constructor(
    private game: GameView | null,
    private transformHandler: TransformHandler,
  ) {
    document.addEventListener("mousemove", this.mouseMoveHandler);
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

  private glowBitmaps: Map<number, ImageBitmap> = new Map();
  //lazy generator & cache for little lag
  private async getGlowBitmap(
    level: number,
    cellSize: number,
  ): Promise<ImageBitmap> {
    const cappedLevel = this.maxCityLightLevel;

    // Check cache first
    const cached = this.glowBitmaps.get(cappedLevel);
    if (cached) return cached;

    // Not in cache → generate, store, and return
    const bitmap = await this.createGlowBitmap(cappedLevel, cellSize);
    this.glowBitmaps.set(cappedLevel, bitmap);

    return bitmap;
  }

  private async createGlowBitmap(
    level: number,
    cellSize: number,
  ): Promise<ImageBitmap> {
    const lightRadius = (10 + level * 2) * cellSize;
    const size = lightRadius * 2;

    // Use OffscreenCanvas for faster bitmap creation
    const offscreen = new OffscreenCanvas(size, size);
    const ctx = offscreen.getContext("2d")!;

    // Glow gradient (you can customize color stops here)
    const gradient = ctx.createRadialGradient(
      lightRadius,
      lightRadius,
      0,
      lightRadius,
      lightRadius,
      lightRadius,
    );
    gradient.addColorStop(0, "rgba(255, 230, 120, 0.8)");
    gradient.addColorStop(0.4, "rgba(255, 180, 80, 0.4)");
    gradient.addColorStop(1, "rgba(255, 140, 40, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(lightRadius, lightRadius, lightRadius, 0, Math.PI * 2);
    ctx.fill();

    return await createImageBitmap(offscreen);
  }

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
      const screenPos = this.transformHandler.worldToScreenCoordinates(
        new Cell(cityX, cityY),
      );
      const screenX = screenPos.x;
      const screenY = screenPos.y;

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
  private async renderCityGlow(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    cellSize: number,
    level: number,
  ): Promise<void> {
    const glow = await this.getGlowBitmap(level, cellSize);

    // Compute radius for positioning (still capped)
    const cappedLevel = this.maxCityLightLevel;
    const radius = (10 + cappedLevel * 2) * cellSize;

    context.drawImage(glow, x - radius, y - radius);
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
  destroy?(): void {
    document.removeEventListener("mousemove", this.mouseMoveHandler);
  }
}
