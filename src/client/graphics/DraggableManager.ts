import { DraggableController } from "./DraggableController";

const GAP = 4;

export class DraggableManager {
  private static _instance: DraggableManager | null = null;
  private controllers = new Set<DraggableController>();
  private resizeObserver = new ResizeObserver(() => this.onPanelResize());
  private _resizeFrame = 0;

  static get instance(): DraggableManager {
    this._instance ??= new DraggableManager();
    return this._instance;
  }

  register(ctrl: DraggableController): void {
    this.controllers.add(ctrl);
    this.resizeObserver.observe(ctrl.getElement());
  }

  unregister(ctrl: DraggableController): void {
    this.controllers.delete(ctrl);
    this.resizeObserver.unobserve(ctrl.getElement());
  }

  private onPanelResize(): void {
    cancelAnimationFrame(this._resizeFrame);
    this._resizeFrame = requestAnimationFrame(() => {
      for (const ctrl of this.controllers) {
        ctrl.resolveOverlaps();
        ctrl.notifyResize();
      }
    });
  }

  snapshotObstacles(exclude: DraggableController): DOMRect[] {
    const rects: DOMRect[] = [];
    const g = GAP / 2;
    for (const ctrl of this.controllers) {
      if (ctrl === exclude) continue;
      const r = ctrl.getElement().getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rects.push(new DOMRect(r.x - g, r.y - g, r.width + GAP, r.height + GAP));
    }
    return rects;
  }

  reclampAll(): void {
    for (const ctrl of this.controllers) {
      ctrl.clampAndApply();
    }
  }
}
