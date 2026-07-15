/**
 * 2D camera: pan/zoom → column-major mat3 for WebGL2 vertex shaders.
 *
 * Pure viewport math — no DOM event listeners. Input handling lives
 * in GameView, which calls panBy / zoomAtScreen / etc.
 *
 * Coordinate system:
 *   World: (0,0) top-left, (mapWidth, mapHeight) bottom-right, +Y down.
 *   Clip:  (-1,-1) bottom-left, (1,1) top-right.
 *
 * The mat3 maps world → clip:
 *   sx = zoom * 2 / canvasWidth
 *   sy = zoom * -2 / canvasHeight   (Y flip)
 *   tx = -offsetX * sx
 *   ty = -offsetY * sy
 */

import { renderDpr } from "./utils/Dpr";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 20;
const DBLCLICK_MIN_ZOOM = 0.7;
const DBLCLICK_MAX_ZOOM = 3;

export class Camera {
  offsetX: number;
  offsetY: number;
  zoom: number;

  private mapW: number;
  private mapH: number;
  private canvasW = 1;
  private canvasH = 1;
  private mat = new Float32Array(9);
  private dirty = true;
  /** True until fitMap() has been called with valid canvas dimensions. */
  private needsInitialFit = true;

  constructor(mapWidth: number, mapHeight: number) {
    this.mapW = mapWidth;
    this.mapH = mapHeight;
    this.offsetX = mapWidth / 2;
    this.offsetY = mapHeight / 2;
    this.zoom = 1;
  }

  /** Update canvas pixel dimensions. Triggers initial fitMap on first call. */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = renderDpr();
    this.canvasW = Math.round(cssWidth * dpr);
    this.canvasH = Math.round(cssHeight * dpr);
    if (this.needsInitialFit) {
      this.fitMap();
    }
    this.dirty = true;
  }

  /** Fit the map into the viewport (~90% fill). */
  fitMap(): void {
    this.offsetX = this.mapW / 2;
    this.offsetY = this.mapH / 2;
    const sx = this.canvasW / this.mapW;
    const sy = this.canvasH / this.mapH;
    this.zoom = Math.min(sx, sy) * 0.9;
    this.dirty = true;
    this.needsInitialFit = false;
  }

  /** Center the camera on a bounding box with padding (1.4 ≈ 71% fill). */
  focusBBox(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    padding = 1.4,
  ): void {
    this.offsetX = (minX + maxX + 1) / 2;
    this.offsetY = (minY + maxY + 1) / 2;
    const bboxW = maxX - minX + 1;
    const bboxH = maxY - minY + 1;
    const sx = this.canvasW / bboxW;
    const sy = this.canvasH / bboxH;
    this.zoom = Math.max(
      DBLCLICK_MIN_ZOOM,
      Math.min(DBLCLICK_MAX_ZOOM, Math.min(sx, sy) / padding),
    );
    this.clampOffset();
    this.dirty = true;
  }

  /** Set the camera center to a world position. */
  panTo(worldX: number, worldY: number): void {
    this.offsetX = worldX;
    this.offsetY = worldY;
    this.clampOffset();
    this.dirty = true;
  }

  /** Shift the camera center by a world-space delta (used for drag panning). */
  panBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.clampOffset();
    this.dirty = true;
  }

  /** Restore camera state, skipping the initial fitMap. */
  setCameraState(x: number, y: number, z: number): void {
    this.offsetX = x;
    this.offsetY = y;
    this.zoom = z;
    this.needsInitialFit = false;
    this.dirty = true;
  }

  /** Multiply zoom by a factor (centered on current view). */
  zoomBy(factor: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    this.clampOffset();
    this.dirty = true;
  }

  /** Set absolute zoom level. */
  zoomTo(level: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
    this.clampOffset();
    this.dirty = true;
  }

  /**
   * Zoom by a factor while keeping a screen point fixed in world space.
   * Used for wheel-zoom: the world position under the cursor stays put.
   */
  zoomAtScreen(factor: number, screenX: number, screenY: number): void {
    const worldBefore = this.screenToWorld(screenX, screenY);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const worldAfter = this.screenToWorld(screenX, screenY);
    this.offsetX += worldBefore.x - worldAfter.x;
    this.offsetY += worldBefore.y - worldAfter.y;
    this.clampOffset();
    this.dirty = true;
  }

  /** Return the column-major mat3 camera matrix (world → clip). */
  getMatrix(): Float32Array {
    if (this.dirty) {
      const sx = (this.zoom * 2) / this.canvasW;
      const sy = (this.zoom * -2) / this.canvasH; // Y flip
      const tx = -this.offsetX * sx;
      const ty = -this.offsetY * sy;
      const m = this.mat;
      m[0] = sx;
      m[1] = 0;
      m[2] = 0;
      m[3] = 0;
      m[4] = sy;
      m[5] = 0;
      m[6] = tx;
      m[7] = ty;
      m[8] = 1;
      this.dirty = false;
    }
    return this.mat;
  }

  /** Convert screen pixel position to world coordinates. */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const dpr = renderDpr();
    const ndcX = ((screenX * dpr) / this.canvasW) * 2 - 1;
    const ndcY = -(((screenY * dpr) / this.canvasH) * 2 - 1);
    const sx = (this.zoom * 2) / this.canvasW;
    const sy = (this.zoom * -2) / this.canvasH;
    return {
      x: (ndcX - -this.offsetX * sx) / sx,
      y: (ndcY - -this.offsetY * sy) / sy,
    };
  }

  /** Convert world coordinates to screen pixel position (CSS pixels). */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const dpr = renderDpr();
    return {
      x: (this.zoom * (worldX - this.offsetX)) / dpr + this.canvasW / (2 * dpr),
      y: (this.zoom * (worldY - this.offsetY)) / dpr + this.canvasH / (2 * dpr),
    };
  }

  private clampOffset(): void {
    const halfVpW = this.canvasW / (2 * this.zoom);
    const halfVpH = this.canvasH / (2 * this.zoom);
    this.offsetX = Math.max(
      -halfVpW,
      Math.min(this.mapW + halfVpW, this.offsetX),
    );
    this.offsetY = Math.max(
      -halfVpH,
      Math.min(this.mapH + halfVpH, this.offsetY),
    );
  }
}
