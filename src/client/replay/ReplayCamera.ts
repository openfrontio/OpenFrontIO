/**
 * Pan and zoom for the replay viewer. Stores the world point at the centre
 * of the view and the zoom in CSS pixels per tile (setCameraState wants
 * device pixels, so multiply by the DPR). The game's TransformHandler
 * depends on GameView and InputHandler, which the viewer doesn't have.
 */

import { CAMERA_MAX_SPEED, CAMERA_SMOOTHING } from "../TransformHandler";

/** CSS pixels per tile. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 20;

export class ReplayCamera {
  x = 0;
  y = 0;
  zoom = 1;
  /** Where goTo() is heading, until it gets there or the user moves. */
  private target: { x: number; y: number } | null = null;

  constructor(
    private readonly mapWidth: number,
    private readonly mapHeight: number,
  ) {
    this.x = mapWidth / 2;
    this.y = mapHeight / 2;
  }

  /** Fit the whole map in view, like the game does at the start. */
  fit(viewWidth: number, viewHeight: number): void {
    this.target = null;
    this.x = this.mapWidth / 2;
    this.y = this.mapHeight / 2;
    this.zoom = clamp(
      Math.min(viewWidth / this.mapWidth, viewHeight / this.mapHeight) * 0.9,
    );
  }

  /** Move by a screen distance in CSS px, so the map follows the pointer. */
  panBy(dx: number, dy: number): void {
    this.target = null;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Glide to a world point (see step), like the game's GoToPlayerEvent. */
  goTo(x: number, y: number): void {
    this.target = { x, y };
  }

  /**
   * Move towards the goTo() target, `dtMs` after the last step. Same
   * easing and speed limit as TransformHandler.goTo.
   */
  step(dtMs: number): void {
    const t = this.target;
    if (t === null) return;
    if (Math.abs(t.x - this.x) + Math.abs(t.y - this.y) < 2) {
      this.target = null;
      return;
    }
    const r = 1 - Math.pow(CAMERA_SMOOTHING, dtMs / 1000);
    const move = (d: number) =>
      Math.max(Math.min(d * r, CAMERA_MAX_SPEED), -CAMERA_MAX_SPEED);
    this.x += move(t.x - this.x);
    this.y += move(t.y - this.y);
  }

  /** The world point under a viewport position (CSS px from its corner). */
  worldAt(
    sx: number,
    sy: number,
    viewWidth: number,
    viewHeight: number,
  ): { x: number; y: number } {
    return {
      x: this.x + (sx - viewWidth / 2) / this.zoom,
      y: this.y + (sy - viewHeight / 2) / this.zoom,
    };
  }

  /** Zoom by `factor`, keeping the world point under (sx, sy) in place. */
  zoomAt(
    sx: number,
    sy: number,
    factor: number,
    viewWidth: number,
    viewHeight: number,
  ): void {
    this.target = null;
    const ox = sx - viewWidth / 2;
    const oy = sy - viewHeight / 2;
    const wx = this.x + ox / this.zoom;
    const wy = this.y + oy / this.zoom;
    this.zoom = clamp(this.zoom * factor);
    this.x = wx - ox / this.zoom;
    this.y = wy - oy / this.zoom;
  }
}

/**
 * Turns pointers into camera moves: one pointer drags the map, two pinch
 * (zoom about their midpoint, and pan as it moves). Positions are CSS px
 * from the view's corner.
 */
export class CameraGestures {
  private readonly pointers = new Map<number, { x: number; y: number }>();

  constructor(private readonly camera: ReplayCamera) {}

  /** Whether any pointer is down. */
  get active(): boolean {
    return this.pointers.size > 0;
  }

  down(id: number, x: number, y: number): void {
    // A third finger is ignored rather than turning the pinch into a jump.
    if (this.pointers.size < 2) this.pointers.set(id, { x, y });
  }

  move(id: number, x: number, y: number, viewW: number, viewH: number): void {
    const p = this.pointers.get(id);
    if (p === undefined) return;
    if (this.pointers.size === 1) {
      this.camera.panBy(x - p.x, y - p.y);
    } else {
      const other = [...this.pointers].find(([k]) => k !== id)![1];
      const oldMid = midpoint(p, other);
      const newMid = midpoint({ x, y }, other);
      const oldDist = Math.hypot(p.x - other.x, p.y - other.y);
      const newDist = Math.hypot(x - other.x, y - other.y);
      if (oldDist > 0 && newDist > 0) {
        this.camera.zoomAt(oldMid.x, oldMid.y, newDist / oldDist, viewW, viewH);
      }
      this.camera.panBy(newMid.x - oldMid.x, newMid.y - oldMid.y);
    }
    p.x = x;
    p.y = y;
  }

  up(id: number): void {
    this.pointers.delete(id);
  }
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
