import { EventBus, GameEvent } from "../core/EventBus";
import { UnitView } from "../core/game/GameView";
import { UserSettings } from "../core/game/UserSettings";
import { ReplaySpeedMultiplier } from "./utilities/ReplaySpeedMultiplier";

export class MouseUpEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class MouseOverEvent implements GameEvent {
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

export class DoBoatAttackEvent implements GameEvent {}

export class AttackRatioEvent implements GameEvent {
  constructor(public readonly attackRatio: number) {}
}

export class ReplaySpeedChangeEvent implements GameEvent {
  constructor(public readonly replaySpeedMultiplier: ReplaySpeedMultiplier) {}
}

export class CenterCameraEvent implements GameEvent {
  constructor() {}
}

export class CtrlKeyStateEvent implements GameEvent {
  constructor(public readonly isPressed: boolean) {}
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

  private moveInterval: NodeJS.Timeout | null = null;
  private activeKeys = new Set<string>();
  private keybinds: Record<string, string> = {};

  private readonly PAN_SPEED = 5;
  private readonly ZOOM_SPEED = 10;

  private userSettings: UserSettings = new UserSettings();

  private ctrlKeyPressed: boolean = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private eventBus: EventBus,
  ) {}

  initialize() {
    this.keybinds = {
      toggleView: "Space",
      centerCamera: "KeyC",
      moveUp: "KeyW",
      moveDown: "KeyS",
      moveLeft: "KeyA",
      moveRight: "KeyD",
      zoomOut: "KeyQ",
      zoomIn: "KeyE",
      attackRatioDown: "Digit1",
      attackRatioUp: "Digit2",
      boatAttack: "KeyB",
      modifierKey: "ControlLeft",
      altKey: "AltLeft",
      ...JSON.parse(localStorage.getItem("settings.keybinds") ?? "{}"),
    };

    // Mac users might have different keybinds
    const isMac = /Mac/.test(navigator.userAgent);
    if (isMac) {
      // Keep ControlLeft for macOS so Ctrl + click works
      // this.keybinds.modifierKey = "MetaLeft"; // Use Command key on Mac
    }

    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        this.onScroll(e);
        this.onShiftScroll(e);
        e.preventDefault();
      },
      { passive: false },
    );
    window.addEventListener("pointermove", this.onPointerMove.bind(this));
    this.canvas.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    window.addEventListener("mousemove", (e) => {
      if (e.movementX || e.movementY) {
        this.eventBus.emit(new MouseMoveEvent(e.clientX, e.clientY));
      }
    });
    this.pointers.clear();

    this.moveInterval = setInterval(() => {
      let deltaX = 0;
      let deltaY = 0;

      if (
        this.activeKeys.has(this.keybinds.moveUp) ||
        this.activeKeys.has("ArrowUp")
      )
        deltaY += this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveDown) ||
        this.activeKeys.has("ArrowDown")
      )
        deltaY -= this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveLeft) ||
        this.activeKeys.has("ArrowLeft")
      )
        deltaX += this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveRight) ||
        this.activeKeys.has("ArrowRight")
      )
        deltaX -= this.PAN_SPEED;

      if (deltaX || deltaY) {
        this.eventBus.emit(new DragEvent(deltaX, deltaY));
      }

      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      if (
        this.activeKeys.has(this.keybinds.zoomOut) ||
        this.activeKeys.has("Minus")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, this.ZOOM_SPEED));
      }
      if (
        this.activeKeys.has(this.keybinds.zoomIn) ||
        this.activeKeys.has("Equal")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, -this.ZOOM_SPEED));
      }
    }, 1);

    window.addEventListener("keydown", (e) => {
      if (e.code === this.keybinds.toggleView) {
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

      if (
        [
          this.keybinds.moveUp,
          this.keybinds.moveDown,
          this.keybinds.moveLeft,
          this.keybinds.moveRight,
          this.keybinds.zoomOut,
          this.keybinds.zoomIn,
          "ArrowUp",
          "ArrowLeft",
          "ArrowDown",
          "ArrowRight",
          "Minus",
          "Equal",
          this.keybinds.attackRatioDown,
          this.keybinds.attackRatioUp,
          this.keybinds.centerCamera,
          "ControlLeft",
          "ControlRight",
        ].includes(e.code)
      ) {
        this.activeKeys.add(e.code);

        // Track Ctrl key state for territory highlighting
        if (e.code === "ControlLeft" || e.code === "ControlRight") {
          if (!this.ctrlKeyPressed) {
            this.ctrlKeyPressed = true;
            this.eventBus.emit(new CtrlKeyStateEvent(true));
          }
        }
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === this.keybinds.toggleView) {
        e.preventDefault();
        this.alternateView = false;
        this.eventBus.emit(new AlternateViewEvent(false));
      }

      if (e.key.toLowerCase() === "r" && e.altKey && !e.ctrlKey) {
        e.preventDefault();
        this.eventBus.emit(new RefreshGraphicsEvent());
      }

      if (e.code === this.keybinds.boatAttack) {
        e.preventDefault();
        this.eventBus.emit(new DoBoatAttackEvent());
      }

      if (e.code === this.keybinds.attackRatioDown) {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(-10));
      }

      if (e.code === this.keybinds.attackRatioUp) {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(10));
      }

      if (e.code === this.keybinds.centerCamera) {
        e.preventDefault();
        this.eventBus.emit(new CenterCameraEvent());
      }

      this.activeKeys.delete(e.code);

      // Track Ctrl key state for territory highlighting
      if (e.code === "ControlLeft" || e.code === "ControlRight") {
        if (this.ctrlKeyPressed) {
          this.ctrlKeyPressed = false;
          this.eventBus.emit(new CtrlKeyStateEvent(false));
        }
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

    // Skip build menu for Ctrl key - only allow Alt key for build menu
    /*if (this.isAltKeyPressed(event)) {
      this.eventBus.emit(new ShowBuildMenuEvent(event.clientX, event.clientY));
      return;
    }*/
    if (this.isModifierKeyPressed(event)) {
      // Ctrl is pressed but we don't want to show build menu or radial menu
      // Just continue to normal click behavior
      this.eventBus.emit(new MouseUpEvent(event.x, event.y));
      return;
    }

    const dist =
      Math.abs(event.x - this.lastPointerDownX) +
      Math.abs(event.y - this.lastPointerDownY);
    if (dist < 10) {
      if (event.pointerType === "touch") {
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
      this.eventBus.emit(new MouseOverEvent(event.clientX, event.clientY));
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

    // On macOS, Control + left click is historically interpreted as a right click.
    // However, it's not a "real" right click from a multi-button mouse.
    // To distinguish the two, we check:
    // - event.ctrlKey is true (Control key held)
    // - event.buttons is 1 (left click only) instead of 2 (right button pressed)
    // This allows us to ignore legacy Control + click behavior and only trigger
    // the radial menu on actual right-click events.
    if (event.ctrlKey && event.buttons !== 2) {
      // Ignore legacy Control + left click (not a true right-click)
      return;
    }

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
    if (this.moveInterval !== null) {
      clearInterval(this.moveInterval);
    }
    this.activeKeys.clear();
  }

  isModifierKeyPressed(event: PointerEvent): boolean {
    return (
      (this.keybinds.modifierKey === "AltLeft" && event.altKey) ||
      (this.keybinds.modifierKey === "ControlLeft" && event.ctrlKey) ||
      (this.keybinds.modifierKey === "ShiftLeft" && event.shiftKey) ||
      (this.keybinds.modifierKey === "MetaLeft" && event.metaKey)
    );
  }

  isAltKeyPressed(event: PointerEvent): boolean {
    return (
      (this.keybinds.altKey === "AltLeft" && event.altKey) ||
      (this.keybinds.altKey === "ControlLeft" && event.ctrlKey) ||
      (this.keybinds.altKey === "ShiftLeft" && event.shiftKey) ||
      (this.keybinds.altKey === "MetaLeft" && event.metaKey)
    );
  }
}
