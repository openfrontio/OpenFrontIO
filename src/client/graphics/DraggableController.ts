import { DraggableManager } from "./DraggableManager";

/**
 * Reusable drag controller that can make any HTMLElement draggable.
 * Persists position and lock state to localStorage.
 * Registers with DraggableManager for collision detection.
 */
export class DraggableController {
  private _locked = false;
  private _offsetX = 0;
  private _offsetY = 0;
  private _dragging = false;
  private _pointerId: number | null = null;
  private _startMouseX = 0;
  private _startMouseY = 0;
  private _startOffsetX = 0;
  private _startOffsetY = 0;
  private _committed = false;
  private _naturalRect: DOMRect | null = null;
  private _obstacleRects: DOMRect[] = [];
  private _isContentsDisplay = false;
  private _savedZIndex = "";
  private static readonly DRAG_THRESHOLD = 4;

  private readonly storageKey: string;
  private readonly el: HTMLElement;
  private _onMoved: (() => void) | null = null;
  private _onResize: (() => void) | null = null;

  private onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private onPointerUp = () => this.handlePointerUp();

  constructor(el: HTMLElement, storageKey: string) {
    this.el = el;
    this.storageKey = `draggable.${storageKey}`;
    this.load();
  }

  set onMoved(cb: (() => void) | null) {
    this._onMoved = cb;
  }

  set onResize(cb: (() => void) | null) {
    this._onResize = cb;
  }

  /** Called by DraggableManager when the element resizes. */
  notifyResize(): void {
    this._onResize?.();
  }

  /** True when the panel's center is in the right half of the viewport. */
  isOnRightSide(): boolean {
    const rect = this.el.getBoundingClientRect();
    return (rect.left + rect.right) / 2 > window.innerWidth / 2;
  }

  get locked(): boolean {
    return this._locked;
  }

  set locked(v: boolean) {
    this._locked = v;
    this.save();
  }

  getElement(): HTMLElement {
    return this.el;
  }

  /** Apply the current offset as a CSS transform on the element. */
  applyTransform(): void {
    // transform has no effect on display:contents elements
    if (this._isContentsDisplay) return;

    if (this._offsetX === 0 && this._offsetY === 0) {
      this.el.style.transform = "";
    } else {
      this.el.style.transform = `translate(${this._offsetX}px, ${this._offsetY}px)`;
    }
  }

  /** Start listening for drag events. */
  attach(): void {
    this._isContentsDisplay = getComputedStyle(this.el).display === "contents";
    this.el.addEventListener("pointerdown", this.onPointerDown);
    this.applyTransform();
    DraggableManager.instance.register(this);
    // Defer clamp until the element has its final layout
    requestAnimationFrame(() => this.clampToViewport());
  }

  /** Stop listening for drag events and clear the inline transform. */
  detach(): void {
    DraggableManager.instance.unregister(this);
    this.el.removeEventListener("pointerdown", this.onPointerDown);
    this.el.removeEventListener("pointermove", this.onPointerMove);
    this.el.removeEventListener("pointerup", this.onPointerUp);
    this.el.removeEventListener("lostpointercapture", this.onPointerUp);
    this.el.style.transform = "";
  }

  resetPosition(): void {
    this._offsetX = 0;
    this._offsetY = 0;
    this.applyTransform();
    this.save();
  }

  /** Public entry point for the manager to re-clamp after window resize. */
  clampAndApply(): void {
    this.clampToViewport();
  }

  /** Push this panel away from any overlapping panels, then clamp to viewport. */
  resolveOverlaps(): void {
    if (this._dragging) return;
    const rect = this.el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const nr = new DOMRect(
      rect.x - this._offsetX,
      rect.y - this._offsetY,
      rect.width,
      rect.height,
    );
    this._obstacleRects = DraggableManager.instance.snapshotObstacles(this);
    const prevX = this._offsetX;
    const prevY = this._offsetY;

    this.resolveCollisions(nr);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this._offsetX = Math.max(-nr.left, Math.min(vw - nr.right, this._offsetX));
    this._offsetY = Math.max(-nr.top, Math.min(vh - nr.bottom, this._offsetY));

    // If overlaps remain (obstacle at viewport edge), revert
    if (this.hasAnyOverlap(nr)) {
      this._offsetX = prevX;
      this._offsetY = prevY;
    }

    if (this._offsetX !== prevX || this._offsetY !== prevY) {
      this.applyTransform();
      this.save();
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this._locked) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, [data-no-drag]")) {
      return;
    }

    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    this._pointerId = e.pointerId;
    this._dragging = true;
    this._committed = false;
    this._startMouseX = e.clientX;
    this._startMouseY = e.clientY;
    this._startOffsetX = this._offsetX;
    this._startOffsetY = this._offsetY;

    this.el.addEventListener("pointermove", this.onPointerMove);
    this.el.addEventListener("pointerup", this.onPointerUp);
    this.el.addEventListener("lostpointercapture", this.onPointerUp);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this._dragging) return;

    // Require minimum movement before committing to a drag
    if (!this._committed) {
      const dx = e.clientX - this._startMouseX;
      const dy = e.clientY - this._startMouseY;
      if (
        dx * dx + dy * dy <
        DraggableController.DRAG_THRESHOLD * DraggableController.DRAG_THRESHOLD
      ) {
        return;
      }
      this._committed = true;
      // Cache the element's natural position (without transform offset)
      const rect = this.el.getBoundingClientRect();
      this._naturalRect = new DOMRect(
        rect.x - this._offsetX,
        rect.y - this._offsetY,
        rect.width,
        rect.height,
      );
      // Snapshot obstacle rects and boost z-index for the drag
      this._obstacleRects = DraggableManager.instance.snapshotObstacles(this);
      this._savedZIndex = this.el.style.zIndex;
      this.el.style.zIndex = "10000";
    }

    if (!this._naturalRect) return;
    const nr = this._naturalRect;
    const prevX = this._offsetX;
    const prevY = this._offsetY;

    this._offsetX = this._startOffsetX + (e.clientX - this._startMouseX);
    this._offsetY = this._startOffsetY + (e.clientY - this._startMouseY);

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Viewport clamp → collision resolution → re-clamp
    this._offsetX = Math.max(-nr.left, Math.min(vw - nr.right, this._offsetX));
    this._offsetY = Math.max(-nr.top, Math.min(vh - nr.bottom, this._offsetY));
    this.resolveCollisions(nr);
    this._offsetX = Math.max(-nr.left, Math.min(vw - nr.right, this._offsetX));
    this._offsetY = Math.max(-nr.top, Math.min(vh - nr.bottom, this._offsetY));

    // If overlaps remain (obstacle at viewport edge), revert
    if (this.hasAnyOverlap(nr)) {
      this._offsetX = prevX;
      this._offsetY = prevY;
    }

    this.applyTransform();
  }

  /**
   * AABB collision: for each obstacle, if the candidate rect overlaps,
   * push out on the axis with the smallest penetration (slide on the other).
   */
  private resolveCollisions(nr: DOMRect): void {
    for (const obs of this._obstacleRects) {
      const cl = nr.left + this._offsetX;
      const ct = nr.top + this._offsetY;
      const cr = nr.right + this._offsetX;
      const cb = nr.bottom + this._offsetY;

      if (
        cr <= obs.left ||
        cl >= obs.right ||
        cb <= obs.top ||
        ct >= obs.bottom
      ) {
        continue;
      }

      const overlapLeft = cr - obs.left;
      const overlapRight = obs.right - cl;
      const overlapTop = cb - obs.top;
      const overlapBottom = obs.bottom - ct;

      if (
        Math.min(overlapLeft, overlapRight) <
        Math.min(overlapTop, overlapBottom)
      ) {
        this._offsetX +=
          overlapLeft < overlapRight ? -overlapLeft : overlapRight;
      } else {
        this._offsetY +=
          overlapTop < overlapBottom ? -overlapTop : overlapBottom;
      }
    }
  }

  private hasAnyOverlap(nr: DOMRect): boolean {
    const cl = nr.left + this._offsetX;
    const ct = nr.top + this._offsetY;
    const cr = nr.right + this._offsetX;
    const cb = nr.bottom + this._offsetY;
    for (const obs of this._obstacleRects) {
      if (cr > obs.left && cl < obs.right && cb > obs.top && ct < obs.bottom) {
        return true;
      }
    }
    return false;
  }

  private handlePointerUp(): void {
    if (!this._dragging) return;
    const didMove = this._committed;
    this._dragging = false;
    this._committed = false;
    if (didMove) {
      this.el.style.zIndex = this._savedZIndex;
    }
    if (this._pointerId !== null) {
      try {
        this.el.releasePointerCapture(this._pointerId);
      } catch {
        // already released
      }
      this._pointerId = null;
    }
    this.el.removeEventListener("pointermove", this.onPointerMove);
    this.el.removeEventListener("pointerup", this.onPointerUp);
    this.el.removeEventListener("lostpointercapture", this.onPointerUp);
    if (didMove) {
      this.save();
      this._onMoved?.();
    }
  }

  /** Clamp restored offsets so the element stays fully within the viewport. */
  private clampToViewport(): void {
    if (this._offsetX === 0 && this._offsetY === 0) return;
    const rect = this.el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const prevX = this._offsetX;
    const prevY = this._offsetY;

    if (rect.left < 0) this._offsetX -= rect.left;
    else if (rect.right > vw) this._offsetX -= rect.right - vw;

    if (rect.top < 0) this._offsetY -= rect.top;
    else if (rect.bottom > vh) this._offsetY -= rect.bottom - vh;

    if (this._offsetX !== prevX || this._offsetY !== prevY) {
      this.applyTransform();
      this.save();
    }
  }

  private save(): void {
    const data = {
      locked: this._locked,
      x: this._offsetX,
      y: this._offsetY,
    };
    localStorage.setItem(this.storageKey, JSON.stringify(data));
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        this._locked = data.locked ?? false;
        this._offsetX = data.x ?? 0;
        this._offsetY = data.y ?? 0;
      }
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }
}
