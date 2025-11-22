import { TileRef } from "../../../core/game/GameMap";
import { GameView } from "../../../core/game/GameView";
import { PingType } from "../../../core/game/Ping";
import { Fx } from "./Fx";

export class PingFx implements Fx {
  private readonly durationMs: number = 3000; // Ping visible for 3 seconds
  private startTime: number;
  private readonly pingColor: string;
  private get icon(): HTMLImageElement | null {
    return PingFx.iconCache.get(this.pingType) ?? null;
  }

  constructor(
    private game: GameView,
    private pingType: PingType,
    private tile: TileRef,
  ) {
    this.startTime = performance.now();
    this.pingColor = this.getPingColor(pingType);
    // Trigger preload but don't store the result
    const iconPath = this.getIconPath(pingType);
    if (iconPath) {
      PingFx.preloadIcon(pingType, iconPath);
    }
  }

  private getPingColor(pingType: PingType): string {
    switch (pingType) {
      case "attack":
        return "rgba(255, 0, 0, 0.7)"; // Red
      case "retreat":
        return "rgba(0, 255, 0, 0.7)"; // Green
      case "defend":
        return "rgba(0, 0, 255, 0.7)"; // Blue
      case "watchOut":
        return "rgba(255, 255, 0, 0.7)"; // Yellow
      default:
        return "rgba(128, 128, 128, 0.7)"; // Default to gray
    }
  }

  private getIconPath(pingType: PingType): string | null {
    switch (pingType) {
      case "attack":
        return "/resources/images/SwordIconWhite.svg";
      case "retreat":
        return "/resources/images/BackIconWhite.svg";
      case "defend":
        return "/resources/images/ShieldIconWhite.svg";
      case "watchOut":
        return "/resources/images/ExclamationMarkIcon.svg";
      default:
        return null;
    }
  }
  private static iconCache = new Map<PingType, HTMLImageElement | null>();
  private static preloadIcon(pingType: PingType, iconPath: string): void {
    if (!PingFx.iconCache.has(pingType)) {
      PingFx.iconCache.set(pingType, null); // Reserve spot immediately
      const img = new Image();
      img.onload = () => {
        PingFx.iconCache.set(pingType, img);
      };
      img.onerror = () => {
        console.error(`Failed to load ping icon: ${iconPath}`);
        PingFx.iconCache.set(pingType, null); // Mark as failed
      };
      img.src = iconPath;
    }
  }

  private static readonly PING_RADIUS = 15;
  private static readonly ICON_SIZE = 20;

  renderTick(_duration: number, context: CanvasRenderingContext2D): boolean {
    const elapsed = performance.now() - this.startTime;
    if (elapsed > this.durationMs) {
      return false; // Fx is finished
    }

    const x = this.game.x(this.tile);
    const y = this.game.y(this.tile);

    // Calculate offset to center coordinates (same as canvas drawing)
    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;

    context.save();
    context.globalAlpha = 1 - elapsed / this.durationMs; // Fade out effect

    // Draw colored circle
    context.fillStyle = this.pingColor;
    context.beginPath();
    context.arc(x + offsetX, y + offsetY, PingFx.PING_RADIUS, 0, 2 * Math.PI);
    context.fill();

    // Draw icon
    if (this.icon && this.icon.complete) {
      context.drawImage(
        this.icon,
        x + offsetX - PingFx.ICON_SIZE / 2,
        y + offsetY - PingFx.ICON_SIZE / 2,
        PingFx.ICON_SIZE,
        PingFx.ICON_SIZE,
      );
    }

    context.restore();
    return true; // Fx is still active
  }
}
