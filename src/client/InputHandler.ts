import { EventBus, GameEvent } from "../core/EventBus";
import { UnitView } from "../core/game/GameView";
import { UserSettings } from "../core/game/UserSettings";

export class MouseUpEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

/**
 * Event emitted when a unit is selected or deselected
 */
export class UnitSelectionEvent implements GameEvent {
  constructor(
    public readonly unit: UnitView | null,
    public readonly isSelected: boolean,
  ) {}
}

export class MouseDownEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class MouseMoveEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ContextMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ZoomEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly delta: number,
  ) {}
}

export class DragEvent implements GameEvent {
  constructor(
    public readonly deltaX: number,
    public readonly deltaY: number,
  ) {}
}

export class AlternateViewEvent implements GameEvent {
  constructor(public readonly alternateView: boolean) {}
}

export class CloseViewEvent implements GameEvent {}

export class RefreshGraphicsEvent implements GameEvent {}

export class ShowBuildMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}
export class ShowEmojiMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class AttackRatioEvent implements GameEvent {
  constructor(public readonly attackRatio: number) {}
}

export class CenterCameraEvent implements GameEvent {
  constructor() {}
}

export class InputHandler {
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;

  private lastPointerDownX: number = 0;
  private lastPointerDownY: number = 0;

  private pointers: Map<number, PointerEvent> = new Map();

  private lastPinchDistance: number = 0;

  private pointerDown: boolean = false;

  private alternateView = false;

  private moveInterval: NodeJS.Timeout = null;
  private activeKeys = new Set<string>();

  private readonly PAN_SPEED = 5;
  private readonly ZOOM_SPEED = 10;

  private userSettings: UserSettings = new UserSettings();

  constructor(
    private canvas: HTMLCanvasElement,
    private eventBus: EventBus,
  ) {}

  initialize() {
    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        this.onScroll(e);
        this.onShiftScroll(e);
        e.preventDefault();
      },
      {
        passive: false,
      },
    );
    window.addEventListener("pointermove", this.onPointerMove.bind(this));
    this.canvas.addEventListener("contextmenu", (e: MouseEvent) => {
      this.onContextMenu(e);
    });
    window.addEventListener("mousemove", (e) => {
      if (e.movementX == 0 && e.movementY == 0) {
        return;
      }
      this.eventBus.emit(new MouseMoveEvent(e.clientX, e.clientY));
    });
    this.pointers.clear();

    // Initialize the combined movement interval
    this.moveInterval = setInterval(() => {
      let deltaX = 0;
      let deltaY = 0;

      // Handle both WASD and arrow keys
      if (this.activeKeys.has("KeyW") || this.activeKeys.has("ArrowUp"))
        deltaY += this.PAN_SPEED;
      if (this.activeKeys.has("KeyS") || this.activeKeys.has("ArrowDown"))
        deltaY -= this.PAN_SPEED;
      if (this.activeKeys.has("KeyA") || this.activeKeys.has("ArrowLeft"))
        deltaX += this.PAN_SPEED;
      if (this.activeKeys.has("KeyD") || this.activeKeys.has("ArrowRight"))
        deltaX -= this.PAN_SPEED;

      if (deltaX !== 0 || deltaY !== 0) {
        this.eventBus.emit(new DragEvent(deltaX, deltaY));
      }

      // Handle zooming
      const screenCenterX = window.innerWidth / 2;
      const screenCenterY = window.innerHeight / 2;

      if (this.activeKeys.has("Minus") || this.activeKeys.has("KeyQ")) {
        this.eventBus.emit(
          new ZoomEvent(screenCenterX, screenCenterY, this.ZOOM_SPEED),
        );
      }
      if (this.activeKeys.has("Equal") || this.activeKeys.has("KeyE")) {
        this.eventBus.emit(
          new ZoomEvent(screenCenterX, screenCenterY, -this.ZOOM_SPEED),
        );
      }
    }, 1);

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (!this.alternateView) {
          this.alternateView = true;
          this.eventBus.emit(new AlternateViewEvent(true));
        }
      }

      if (e.code === "Escape") {
        e.preventDefault();
        this.eventBus.emit(new CloseViewEvent());
      }

      // Add all movement keys to activeKeys
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowLeft",
          "ArrowDown",
          "ArrowRight",
          "Minus",
          "Equal",
          "KeyE",
          "KeyQ",
          "Digit1",
          "Digit2",
          "KeyC",
          "ControlLeft",
          "ControlRight",
        ].includes(e.code)
      ) {
        this.activeKeys.add(e.code);
      }
    });

    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        this.alternateView = false;
        this.eventBus.emit(new AlternateViewEvent(false));
      }
      if (e.key.toLowerCase() === "r" && e.altKey && !e.ctrlKey) {
        e.preventDefault();
        this.eventBus.emit(new RefreshGraphicsEvent());
      }

      if (e.code === "Digit1") {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(-10));
      }

      if (e.code === "Digit2") {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(10));
      }

      if (e.code === "KeyC") {
        e.preventDefault();
        this.eventBus.emit(new CenterCameraEvent());
      }

      // Remove all movement keys from activeKeys
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowLeft",
          "ArrowDown",
          "ArrowRight",
          "Minus",
          "Equal",
          "KeyE",
          "KeyQ",
          "Digit1",
          "Digit2",
          "KeyC",
          "ControlLeft",
          "ControlRight",
        ].includes(e.code)
      ) {
        this.activeKeys.delete(e.code);
      }
    });
  }

  private onPointerDown(event: PointerEvent) {
    if (event.button > 0) {
      return;
    }

    this.pointerDown = true;
    this.pointers.set(event.pointerId, event);

    if (this.pointers.size === 1) {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;

      this.lastPointerDownX = event.clientX;
      this.lastPointerDownY = event.clientY;

      this.eventBus.emit(new MouseDownEvent(event.clientX, event.clientY));
    } else if (this.pointers.size === 2) {
      this.lastPinchDistance = this.getPinchDistance();
    }
  }

  onPointerUp(event: PointerEvent) {
    if (event.button > 0) {
      return;
    }
    this.pointerDown = false;
    this.pointers.clear();

    if (event.ctrlKey) {
      this.eventBus.emit(new ShowBuildMenuEvent(event.clientX, event.clientY));
      return;
    }
    if (event.altKey) {
      this.eventBus.emit(new ShowEmojiMenuEvent(event.clientX, event.clientY));
      return;
    }

    const dist =
      Math.abs(event.x - this.lastPointerDownX) +
      Math.abs(event.y - this.lastPointerDownY);
    if (dist < 10) {
      if (event.pointerType == "touch") {
        this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
        event.preventDefault();
        return;
      }

      if (!this.userSettings.leftClickOpensMenu() || event.shiftKey) {
        this.eventBus.emit(new MouseUpEvent(event.x, event.y));
      } else {
        this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
      }
    }
  }

  private onScroll(event: WheelEvent) {
    if (!event.shiftKey) {
      const realCtrl =
        this.activeKeys.has("ControlLeft") ||
        this.activeKeys.has("ControlRight");
      const ratio = event.ctrlKey && !realCtrl ? 10 : 1; // Compensate pinch-zoom low sensitivity
      this.eventBus.emit(new ZoomEvent(event.x, event.y, event.deltaY * ratio));
    }
  }

  private onShiftScroll(event: WheelEvent) {
    if (event.shiftKey) {
      const ratio = event.deltaY > 0 ? -10 : 10;
      this.eventBus.emit(new AttackRatioEvent(ratio));
    }
  }

  private onPointerMove(event: PointerEvent) {
    if (event.button > 0) {
      return;
    }

    this.pointers.set(event.pointerId, event);

    if (!this.pointerDown) {
      return;
    }

    if (this.pointers.size === 1) {
      const deltaX = event.clientX - this.lastPointerX;
      const deltaY = event.clientY - this.lastPointerY;

      this.eventBus.emit(new DragEvent(deltaX, deltaY));

      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
    } else if (this.pointers.size === 2) {
      const currentPinchDistance = this.getPinchDistance();
      const pinchDelta = currentPinchDistance - this.lastPinchDistance;

      if (Math.abs(pinchDelta) > 1) {
        const zoomCenter = this.getPinchCenter();
        this.eventBus.emit(
          new ZoomEvent(zoomCenter.x, zoomCenter.y, -pinchDelta * 2),
        );
        this.lastPinchDistance = currentPinchDistance;
      }
    }
  }

  private onContextMenu(event: MouseEvent) {
    event.preventDefault();
    this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
  }

  private getPinchDistance(): number {
    const pointerEvents = Array.from(this.pointers.values());
    const dx = pointerEvents[0].clientX - pointerEvents[1].clientX;
    const dy = pointerEvents[0].clientY - pointerEvents[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getPinchCenter(): { x: number; y: number } {
    const pointerEvents = Array.from(this.pointers.values());
    return {
      x: (pointerEvents[0].clientX + pointerEvents[1].clientX) / 2,
      y: (pointerEvents[0].clientY + pointerEvents[1].clientY) / 2,
    };
  }

  destroy() {
    clearInterval(this.moveInterval);
    this.activeKeys.clear();
  }
}
