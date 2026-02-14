import { EventBus, GameEvent } from "../core/EventBus";
import { UnitType } from "../core/game/Game";
import { PlayerView, UnitView } from "../core/game/GameView";
import { UserSettings } from "../core/game/UserSettings";
import { UIState } from "./graphics/UIState";
import {
  ensureUiSessionRuntimeStarted,
  getUiSessionStorageCachedValue,
  readUiSessionStorage,
  UI_SESSION_RUNTIME_EVENTS,
  type UiSessionKeyboardChangedDetail,
} from "./runtime/UiSessionRuntime";
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
export class TouchEvent implements GameEvent {
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

export class TogglePerformanceOverlayEvent implements GameEvent {}

export class ToggleStructureEvent implements GameEvent {
  constructor(public readonly structureTypes: UnitType[] | null) {}
}

export class GhostStructureChangedEvent implements GameEvent {
  constructor(public readonly ghostStructure: UnitType | null) {}
}

export class SwapRocketDirectionEvent implements GameEvent {
  constructor(public readonly rocketDirectionUp: boolean) {}
}

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

export class DoGroundAttackEvent implements GameEvent {}

export class AttackRatioEvent implements GameEvent {
  constructor(public readonly attackRatio: number) {}
}

export class ReplaySpeedChangeEvent implements GameEvent {
  constructor(public readonly replaySpeedMultiplier: ReplaySpeedMultiplier) {}
}

export class CenterCameraEvent implements GameEvent {
  constructor() {}
}

export class AutoUpgradeEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class TickMetricsEvent implements GameEvent {
  constructor(
    public readonly tickExecutionDuration?: number,
    public readonly tickDelay?: number,
  ) {}
}

export class GoToPlayerEvent implements GameEvent {
  constructor(public player: PlayerView) {}
}

export class GoToPositionEvent implements GameEvent {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export class GoToUnitEvent implements GameEvent {
  constructor(public unit: UnitView) {}
}

export class ShowSettingsModalEvent {
  constructor(
    public readonly isVisible: boolean = true,
    public readonly shouldPause: boolean = false,
    public readonly isPaused: boolean = false,
  ) {}
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
  private readonly KEYBINDS_STORAGE_KEY = "settings.keybinds";

  private readonly userSettings: UserSettings = new UserSettings();

  constructor(
    public uiState: UIState,
    private canvas: HTMLCanvasElement,
    private eventBus: EventBus,
  ) {}

  initialize() {
    // Mac users might have different keybinds
    const isMac = /Mac/.test(navigator.userAgent);

    this.keybinds = {
      toggleView: "Space",
      centerCamera: "KeyC",
      moveUp: "KeyW",
      moveDown: "KeyS",
      moveLeft: "KeyA",
      moveRight: "KeyD",
      zoomOut: "KeyQ",
      zoomIn: "KeyE",
      attackRatioDown: "KeyT",
      attackRatioUp: "KeyY",
      boatAttack: "KeyB",
      groundAttack: "KeyG",
      swapDirection: "KeyU",
      modifierKey: isMac ? "MetaLeft" : "ControlLeft",
      altKey: "AltLeft",
      buildCity: "Digit1",
      buildFactory: "Digit2",
      buildPort: "Digit3",
      buildDefensePost: "Digit4",
      buildMissileSilo: "Digit5",
      buildSamLauncher: "Digit6",
      buildWarship: "Digit7",
      buildAtomBomb: "Digit8",
      buildHydrogenBomb: "Digit9",
      buildMIRV: "Digit0",
    };
    const cachedKeybinds = getUiSessionStorageCachedValue(
      this.KEYBINDS_STORAGE_KEY,
    );
    if (typeof cachedKeybinds === "string" && cachedKeybinds.length > 0) {
      this.applySerializedKeybinds(cachedKeybinds);
    }
    void this.hydrateKeybindsFromSessionStorage();

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

      // Skip if shift is held down
      if (
        this.activeKeys.has("ShiftLeft") ||
        this.activeKeys.has("ShiftRight")
      ) {
        return;
      }

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

    void ensureUiSessionRuntimeStarted();
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.keyboardChanged,
      this.handleSessionKeyboardChanged as EventListener,
    );
  }

  private async hydrateKeybindsFromSessionStorage() {
    const stored = await readUiSessionStorage(this.KEYBINDS_STORAGE_KEY);
    if (typeof stored !== "string" || stored.length === 0) {
      return;
    }

    this.applySerializedKeybinds(stored);
  }

  private applySerializedKeybinds(serialized: string) {
    try {
      const parsed = JSON.parse(serialized);
      // flatten { key: {key, value} } -> { key: value } and accept legacy string values
      const saved = Object.fromEntries(
        Object.entries(parsed)
          .map(([k, v]) => {
            let val: unknown;
            if (v && typeof v === "object" && "value" in v) {
              val = (v as { value: unknown }).value;
            } else {
              val = v;
            }

            if (typeof val !== "string") {
              return [k, undefined];
            }
            return [k, val];
          })
          .filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
      this.keybinds = {
        ...this.keybinds,
        ...saved,
      };
    } catch (error) {
      console.warn("Invalid keybinds JSON:", error);
    }
  }

  private handleSessionKeyboardChanged = (
    event: CustomEvent<UiSessionKeyboardChangedDetail>,
  ) => {
    const detail = event.detail;
    if (!detail?.code) {
      return;
    }

    if (detail.isDown) {
      this.handleSessionKeyDown(detail.code);
      return;
    }

    this.handleSessionKeyUp(detail.code);
  };

  private handleSessionKeyDown(code: string) {
    const isTextInput = this.isTextInputTarget(document.activeElement);
    if (isTextInput && code !== "Escape") {
      return;
    }

    if (code === this.keybinds.toggleView) {
      if (!this.alternateView) {
        this.alternateView = true;
        this.eventBus.emit(new AlternateViewEvent(true));
      }
    }

    if (code === "Escape") {
      this.eventBus.emit(new CloseViewEvent());
      this.setGhostStructure(null);
    }

    if (this.isTrackedActiveKey(code)) {
      this.activeKeys.add(code);
    }
  }

  private handleSessionKeyUp(code: string) {
    const isTextInput = this.isTextInputTarget(document.activeElement);
    if (isTextInput && !this.activeKeys.has(code)) {
      return;
    }

    if (code === this.keybinds.toggleView) {
      this.alternateView = false;
      this.eventBus.emit(new AlternateViewEvent(false));
    }

    const resetKey = this.keybinds.resetGfx ?? "KeyR";
    if (code === resetKey && this.isAltKeyActive()) {
      this.eventBus.emit(new RefreshGraphicsEvent());
    }

    if (code === this.keybinds.boatAttack) {
      this.eventBus.emit(new DoBoatAttackEvent());
    }

    if (code === this.keybinds.groundAttack) {
      this.eventBus.emit(new DoGroundAttackEvent());
    }

    if (code === this.keybinds.attackRatioDown) {
      this.eventBus.emit(new AttackRatioEvent(-10));
    }

    if (code === this.keybinds.attackRatioUp) {
      this.eventBus.emit(new AttackRatioEvent(10));
    }

    if (code === this.keybinds.centerCamera) {
      this.eventBus.emit(new CenterCameraEvent());
    }

    if (code === this.keybinds.buildCity) {
      this.setGhostStructure(UnitType.City);
    }

    if (code === this.keybinds.buildFactory) {
      this.setGhostStructure(UnitType.Factory);
    }

    if (code === this.keybinds.buildPort) {
      this.setGhostStructure(UnitType.Port);
    }

    if (code === this.keybinds.buildDefensePost) {
      this.setGhostStructure(UnitType.DefensePost);
    }

    if (code === this.keybinds.buildMissileSilo) {
      this.setGhostStructure(UnitType.MissileSilo);
    }

    if (code === this.keybinds.buildSamLauncher) {
      this.setGhostStructure(UnitType.SAMLauncher);
    }

    if (code === this.keybinds.buildAtomBomb) {
      this.setGhostStructure(UnitType.AtomBomb);
    }

    if (code === this.keybinds.buildHydrogenBomb) {
      this.setGhostStructure(UnitType.HydrogenBomb);
    }

    if (code === this.keybinds.buildWarship) {
      this.setGhostStructure(UnitType.Warship);
    }

    if (code === this.keybinds.buildMIRV) {
      this.setGhostStructure(UnitType.MIRV);
    }

    if (code === this.keybinds.swapDirection) {
      const nextDirection = !this.uiState.rocketDirectionUp;
      this.eventBus.emit(new SwapRocketDirectionEvent(nextDirection));
    }

    if (
      code === "KeyD" &&
      (this.activeKeys.has("ShiftLeft") || this.activeKeys.has("ShiftRight"))
    ) {
      this.eventBus.emit(new TogglePerformanceOverlayEvent());
    }

    this.activeKeys.delete(code);
  }

  private isTrackedActiveKey(code: string): boolean {
    return [
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
      "ShiftLeft",
      "ShiftRight",
      "AltLeft",
      "AltRight",
      "MetaLeft",
      "MetaRight",
    ].includes(code);
  }

  private isAltKeyActive(): boolean {
    if (
      this.keybinds.altKey === "AltLeft" ||
      this.keybinds.altKey === "AltRight"
    ) {
      return (
        (this.activeKeys.has("AltLeft") || this.activeKeys.has("AltRight")) &&
        !this.activeKeys.has("ControlLeft") &&
        !this.activeKeys.has("ControlRight")
      );
    }
    if (
      this.keybinds.altKey === "ControlLeft" ||
      this.keybinds.altKey === "ControlRight"
    ) {
      return (
        this.activeKeys.has("ControlLeft") || this.activeKeys.has("ControlRight")
      );
    }
    if (
      this.keybinds.altKey === "ShiftLeft" ||
      this.keybinds.altKey === "ShiftRight"
    ) {
      return this.activeKeys.has("ShiftLeft") || this.activeKeys.has("ShiftRight");
    }
    if (
      this.keybinds.altKey === "MetaLeft" ||
      this.keybinds.altKey === "MetaRight"
    ) {
      return this.activeKeys.has("MetaLeft") || this.activeKeys.has("MetaRight");
    }
    return false;
  }

  private onPointerDown(event: PointerEvent) {
    if (event.button === 1) {
      event.preventDefault();
      this.eventBus.emit(new AutoUpgradeEvent(event.clientX, event.clientY));
      return;
    }

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
    if (event.button === 1) {
      event.preventDefault();
      return;
    }

    if (event.button > 0) {
      return;
    }
    this.pointerDown = false;
    this.pointers.clear();

    if (this.isModifierKeyPressed(event)) {
      this.eventBus.emit(new ShowBuildMenuEvent(event.clientX, event.clientY));
      return;
    }
    if (this.isAltKeyPressed(event)) {
      this.eventBus.emit(new ShowEmojiMenuEvent(event.clientX, event.clientY));
      return;
    }

    const dist =
      Math.abs(event.x - this.lastPointerDownX) +
      Math.abs(event.y - this.lastPointerDownY);
    if (dist < 10) {
      if (event.pointerType === "touch") {
        this.eventBus.emit(new TouchEvent(event.x, event.y));
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
      const scrollValue = event.deltaY === 0 ? event.deltaX : event.deltaY;
      const ratio = scrollValue > 0 ? -10 : 10;
      this.eventBus.emit(new AttackRatioEvent(ratio));
    }
  }

  private onPointerMove(event: PointerEvent) {
    if (event.button === 1) {
      event.preventDefault();
      return;
    }

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
    if (this.uiState.ghostStructure !== null) {
      this.setGhostStructure(null);
      return;
    }
    this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
  }

  private setGhostStructure(ghostStructure: UnitType | null) {
    this.uiState.ghostStructure = ghostStructure;
    this.eventBus.emit(new GhostStructureChangedEvent(ghostStructure));
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

  private isTextInputTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    if (element.tagName === "TEXTAREA" || element.isContentEditable) {
      return true;
    }
    if (element.tagName === "INPUT") {
      const input = element as HTMLInputElement;
      if (input.id === "attack-ratio" && input.type === "range") {
        return false;
      }
      return true;
    }
    return false;
  }

  destroy() {
    if (this.moveInterval !== null) {
      clearInterval(this.moveInterval);
    }
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.keyboardChanged,
      this.handleSessionKeyboardChanged as EventListener,
    );
    this.activeKeys.clear();
  }

  isModifierKeyPressed(event: PointerEvent): boolean {
    return (
      ((this.keybinds.modifierKey === "AltLeft" ||
        this.keybinds.modifierKey === "AltRight") &&
        event.altKey) ||
      ((this.keybinds.modifierKey === "ControlLeft" ||
        this.keybinds.modifierKey === "ControlRight") &&
        event.ctrlKey) ||
      ((this.keybinds.modifierKey === "ShiftLeft" ||
        this.keybinds.modifierKey === "ShiftRight") &&
        event.shiftKey) ||
      ((this.keybinds.modifierKey === "MetaLeft" ||
        this.keybinds.modifierKey === "MetaRight") &&
        event.metaKey)
    );
  }

  isAltKeyPressed(event: PointerEvent): boolean {
    return (
      ((this.keybinds.altKey === "AltLeft" ||
        this.keybinds.altKey === "AltRight") &&
        event.altKey) ||
      ((this.keybinds.altKey === "ControlLeft" ||
        this.keybinds.altKey === "ControlRight") &&
        event.ctrlKey) ||
      ((this.keybinds.altKey === "ShiftLeft" ||
        this.keybinds.altKey === "ShiftRight") &&
        event.shiftKey) ||
      ((this.keybinds.altKey === "MetaLeft" ||
        this.keybinds.altKey === "MetaRight") &&
        event.metaKey)
    );
  }
}
