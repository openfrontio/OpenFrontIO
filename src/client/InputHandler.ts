import { EventBus, GameEvent } from "../core/EventBus";
import { PlayerBuildableUnitType, UnitType } from "../core/game/Game";
import { GameView, UnitView } from "../core/game/GameView";
import { UserSettings } from "../core/game/UserSettings";
import { UIState } from "./graphics/UIState";
import { Platform } from "./Platform";
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
 * Event emitted when one or more warships are selected or deselected.
 * For single selection: unit is set, units is empty.
 * For multi selection: units contains all selected warships, unit is null.
 * For deselection: isSelected is false.
 */
export class UnitSelectionEvent implements GameEvent {
  constructor(
    public readonly unit: UnitView | null,
    public readonly isSelected: boolean,
    public readonly units: UnitView[] = [],
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
  constructor(
    public readonly structureTypes: PlayerBuildableUnitType[] | null,
  ) {}
}

export class GhostStructureChangedEvent implements GameEvent {
  constructor(public readonly ghostStructure: PlayerBuildableUnitType | null) {}
}

export class ConfirmGhostStructureEvent implements GameEvent {}

export class SwapRocketDirectionEvent implements GameEvent {
  constructor(public readonly rocketDirectionUp: boolean) {}
}

/** Emitted while the user is drawing a shift+drag selection rectangle */
export class WarshipSelectionBoxUpdateEvent implements GameEvent {
  constructor(
    public readonly startX: number,
    public readonly startY: number,
    public readonly endX: number,
    public readonly endY: number,
  ) {}
}

/** Emitted when the user releases the mouse after drawing a selection rectangle */
export class WarshipSelectionBoxCompleteEvent implements GameEvent {
  constructor(
    public readonly startX: number,
    public readonly startY: number,
    public readonly endX: number,
    public readonly endY: number,
  ) {}
}

/** Emitted when the selection box is cancelled (e.g. Escape or no drag) */
export class WarshipSelectionBoxCancelEvent implements GameEvent {}

/** Emitted when the player triggers select-all-warships hotkey */
export class SelectAllWarshipsEvent implements GameEvent {}

/** Emitted when a touch long-press is detected (shows crosshair indicator) */
export class TouchLongPressStartEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
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

export class TogglePauseIntentEvent implements GameEvent {}

export class GameSpeedUpIntentEvent implements GameEvent {}

export class GameSpeedDownIntentEvent implements GameEvent {}

export class CenterCameraEvent implements GameEvent {
  constructor() {}
}

export class AutoUpgradeEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ToggleCoordinateGridEvent implements GameEvent {
  constructor(public readonly enabled: boolean) {}
}

export class TickMetricsEvent implements GameEvent {
  constructor(
    public readonly tickExecutionDuration?: number,
    public readonly tickDelay?: number,
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

  // Warship selection box state
  private selectionBoxActive: boolean = false;
  // True while warships are selected via box (waiting for move target click)
  private multiSelectionActive: boolean = false;

  // Touch long-press state
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressActive: boolean = false;
  private suppressNextTap: boolean = false;
  private readonly LONG_PRESS_MS = 800;

  private moveInterval: NodeJS.Timeout | null = null;
  private activeKeys = new Set<string>();
  private keybinds: Record<string, string> = {};
  private coordinateGridEnabled = false;

  private readonly PAN_SPEED = 5;
  private readonly ZOOM_SPEED = 10;
  private readonly DRAG_THRESHOLD_PX = 10;

  private readonly userSettings: UserSettings = new UserSettings();

  constructor(
    private gameView: GameView,
    public uiState: UIState,
    private canvas: HTMLCanvasElement,
    private eventBus: EventBus,
  ) {}

  initialize() {
    this.keybinds = this.userSettings.keybinds(Platform.isMac);

    // Listen for warship selection to change cursor
    this.eventBus.on(UnitSelectionEvent, (e) => {
      if (e.isSelected && (e.units ?? []).length > 0) {
        // Multi-selection active
        this.multiSelectionActive = true;
        this.canvas.style.cursor = "crosshair";
      } else if (e.isSelected) {
        // Single warship selected — cursor crosshair, but not multi
        this.multiSelectionActive = false;
        this.canvas.style.cursor = "crosshair";
      } else {
        // Deselected
        this.multiSelectionActive = false;
        if (!this.selectionBoxActive) {
          this.canvas.style.cursor = "";
        }
      }
    });

    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("pointercancel", (e) => this.onPointerUp(e));
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
    // Clear all tracked keys when the window loses focus so keys that had
    // their keyup swallowed by the browser (e.g. cmd+zoom) don't stay stuck.
    // Also release the hold-to-view state and any active pointer/drag state
    // so the alternate view and drags aren't left latched when focus returns.
    window.addEventListener("blur", () => {
      this.activeKeys.clear();
      if (this.alternateView) {
        this.alternateView = false;
        this.eventBus.emit(new AlternateViewEvent(false));
      }
      this.pointerDown = false;
      this.pointers.clear();
      if (this.longPressTimer !== null) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      this.longPressActive = false;
      this.suppressNextTap = false;
      if (this.selectionBoxActive || this.multiSelectionActive) {
        this.selectionBoxActive = false;
        this.multiSelectionActive = false;
        this.eventBus.emit(new WarshipSelectionBoxCancelEvent());
      }
      this.canvas.style.cursor = "";
    });
    this.pointers.clear();

    this.moveInterval = setInterval(() => {
      let deltaX = 0;
      let deltaY = 0;

      // Skip if shift is held down
      if (this.activeKeys.has(this.keybinds.shiftKey)) {
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
        this.activeKeys.has("Minus") ||
        this.activeKeys.has("NumpadSubtract")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, this.ZOOM_SPEED));
      }
      if (
        this.activeKeys.has(this.keybinds.zoomIn) ||
        this.activeKeys.has("Equal") ||
        this.activeKeys.has("NumpadAdd")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, -this.ZOOM_SPEED));
      }
    }, 1);

    window.addEventListener("keydown", (e) => {
      const isTextInput = this.isTextInputTarget(e.target);
      if (isTextInput && e.code !== "Escape") {
        return;
      }

      if (this.keybindMatchesEvent(e, this.keybinds.toggleView)) {
        e.preventDefault();
        if (!this.alternateView) {
          this.alternateView = true;
          this.eventBus.emit(new AlternateViewEvent(true));
        }
      }

      if (
        this.keybindMatchesEvent(e, this.keybinds.coordinateGrid) &&
        !e.repeat
      ) {
        e.preventDefault();
        this.coordinateGridEnabled = !this.coordinateGridEnabled;
        this.eventBus.emit(
          new ToggleCoordinateGridEvent(this.coordinateGridEnabled),
        );
      }

      if (e.code === "Escape") {
        e.preventDefault();
        this.eventBus.emit(new CloseViewEvent());
        this.setGhostStructure(null);
        if (this.selectionBoxActive || this.multiSelectionActive) {
          this.selectionBoxActive = false;
          this.multiSelectionActive = false;
          this.eventBus.emit(new WarshipSelectionBoxCancelEvent());
        }
      }

      if (
        (e.code === "Enter" || e.code === "NumpadEnter") &&
        this.uiState.ghostStructure !== null
      ) {
        e.preventDefault();
        this.eventBus.emit(new ConfirmGhostStructureEvent());
      }

      // Don't track zoom keys when a meta/ctrl modifier is held — that means
      // the browser is handling its own zoom (cmd+/cmd-) and the keyup will
      // never fire, which would leave the key stuck in activeKeys forever.
      // Also covers numpad zoom shortcuts (Ctrl+NumpadAdd/NumpadSubtract).
      const isBrowserZoomCombo =
        (e.metaKey || e.ctrlKey) &&
        (e.code === "Minus" ||
          e.code === "Equal" ||
          e.code === "NumpadAdd" ||
          e.code === "NumpadSubtract");

      if (
        !isBrowserZoomCombo &&
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
          "NumpadAdd",
          "NumpadSubtract",
          this.keybinds.attackRatioDown,
          this.keybinds.attackRatioUp,
          this.keybinds.centerCamera,
          "ControlLeft",
          "ControlRight",
          this.keybinds.shiftKey,
        ].includes(e.code)
      ) {
        this.activeKeys.add(e.code);
      }

      // Shift = warship box selection mode.
      // If a ghost structure is active, discard it first.
      if (e.code === this.keybinds.shiftKey) {
        if (this.uiState.ghostStructure !== null) {
          this.setGhostStructure(null);
        }
        this.canvas.style.cursor = "crosshair";
      }
    });
    window.addEventListener("keyup", (e) => {
      const isTextInput = this.isTextInputTarget(e.target);
      if (isTextInput && !this.activeKeys.has(e.code)) {
        return;
      }

      // When the meta (cmd) or ctrl key is released, any keys that were held
      // simultaneously will have had their keyup swallowed by the browser
      // (e.g. cmd+Plus for browser zoom). Clear zoom-related keys to
      // prevent them staying stuck in activeKeys.
      if (
        e.code === "MetaLeft" ||
        e.code === "MetaRight" ||
        e.code === "ControlLeft" ||
        e.code === "ControlRight"
      ) {
        this.activeKeys.delete("Minus");
        this.activeKeys.delete("Equal");
        this.activeKeys.delete("NumpadAdd");
        this.activeKeys.delete("NumpadSubtract");
        this.activeKeys.delete(this.keybinds.zoomIn);
        this.activeKeys.delete(this.keybinds.zoomOut);
      }

      if (this.keybindMatchesEvent(e, this.keybinds.toggleView)) {
        e.preventDefault();
        this.alternateView = false;
        this.eventBus.emit(new AlternateViewEvent(false));
      }

      const resetKey = this.keybinds.resetGfx ?? "KeyR";
      if (e.code === resetKey && this.isAltKeyHeld(e)) {
        e.preventDefault();
        this.eventBus.emit(new RefreshGraphicsEvent());
      }

      if (this.keybindMatchesEvent(e, this.keybinds.boatAttack)) {
        e.preventDefault();
        this.eventBus.emit(new DoBoatAttackEvent());
      }

      if (this.keybindMatchesEvent(e, this.keybinds.groundAttack)) {
        e.preventDefault();
        this.eventBus.emit(new DoGroundAttackEvent());
      }

      if (this.keybindMatchesEvent(e, this.keybinds.attackRatioDown)) {
        e.preventDefault();
        const increment = this.userSettings.attackRatioIncrement();
        this.eventBus.emit(new AttackRatioEvent(-increment));
      }

      if (this.keybindMatchesEvent(e, this.keybinds.attackRatioUp)) {
        e.preventDefault();
        const increment = this.userSettings.attackRatioIncrement();
        this.eventBus.emit(new AttackRatioEvent(increment));
      }

      if (this.keybindMatchesEvent(e, this.keybinds.centerCamera)) {
        e.preventDefault();
        this.eventBus.emit(new CenterCameraEvent());
      }

      if (e.code === this.keybinds.selectAllWarships) {
        e.preventDefault();
        this.eventBus.emit(new SelectAllWarshipsEvent());
      }

      // Two-phase build keybind matching: exact code match first, then digit/Numpad alias.
      const matchedBuild = this.resolveBuildKeybind(e.code, e.shiftKey);
      if (matchedBuild !== null) {
        e.preventDefault();
        this.setGhostStructure(matchedBuild);
      }

      if (this.keybindMatchesEvent(e, this.keybinds.swapDirection)) {
        e.preventDefault();
        const nextDirection = !this.uiState.rocketDirectionUp;
        this.eventBus.emit(new SwapRocketDirectionEvent(nextDirection));
      }

      if (!e.repeat && this.keybindMatchesEvent(e, this.keybinds.pauseGame)) {
        e.preventDefault();
        this.eventBus.emit(new TogglePauseIntentEvent());
      }
      if (!e.repeat && this.keybindMatchesEvent(e, this.keybinds.gameSpeedUp)) {
        e.preventDefault();
        this.eventBus.emit(new GameSpeedUpIntentEvent());
      }
      if (
        !e.repeat &&
        this.keybindMatchesEvent(e, this.keybinds.gameSpeedDown)
      ) {
        e.preventDefault();
        this.eventBus.emit(new GameSpeedDownIntentEvent());
      }

      // Shift-D to toggle performance overlay
      if (e.code === "KeyD" && e.shiftKey) {
        e.preventDefault();
        console.log("TogglePerformanceOverlayEvent");
        this.eventBus.emit(new TogglePerformanceOverlayEvent());
      }

      this.activeKeys.delete(e.code);

      // Reset crosshair when Shift is released (unless selection box or multi-selection still active)
      if (
        e.code === this.keybinds.shiftKey &&
        !this.selectionBoxActive &&
        !this.multiSelectionActive
      ) {
        this.canvas.style.cursor = "";
      }
    });
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

      // Start long-press timer for touch devices
      if (event.pointerType === "touch") {
        this.longPressActive = false;
        if (this.longPressTimer !== null) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          this.longPressActive = true;
          this.canvas.style.cursor = "crosshair";
          this.eventBus.emit(
            new TouchLongPressStartEvent(
              this.lastPointerDownX,
              this.lastPointerDownY,
            ),
          );
        }, this.LONG_PRESS_MS);
      }
    } else if (this.pointers.size === 2) {
      // Second finger down — cancel any pending long-press to avoid
      // triggering selection mode mid-pinch
      if (this.longPressTimer !== null) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      if (this.longPressActive) {
        this.longPressActive = false;
        this.canvas.style.cursor = "";
      }
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

    // Clean up long-press state
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    const wasLongPress = this.longPressActive;
    this.longPressActive = false;
    if (wasLongPress) {
      this.canvas.style.cursor = "";
      // If long-press fired but no drag happened (selectionBoxActive is false),
      // suppress the tap so we don't emit a spurious TouchEvent
      if (!this.selectionBoxActive) {
        this.suppressNextTap = true;
      }
    }

    // Complete selection box if it was active
    if (this.selectionBoxActive) {
      this.selectionBoxActive = false;
      const dist =
        Math.abs(event.clientX - this.lastPointerDownX) +
        Math.abs(event.clientY - this.lastPointerDownY);
      if (dist >= this.DRAG_THRESHOLD_PX) {
        this.eventBus.emit(
          new WarshipSelectionBoxCompleteEvent(
            this.lastPointerDownX,
            this.lastPointerDownY,
            event.clientX,
            event.clientY,
          ),
        );
        return;
      } else {
        this.eventBus.emit(new WarshipSelectionBoxCancelEvent());
      }
    }

    if (this.isModifierKeyPressed(event)) {
      this.suppressNextTap = false;
      this.eventBus.emit(new ShowBuildMenuEvent(event.clientX, event.clientY));
      return;
    }
    if (this.isAltKeyPressed(event)) {
      this.suppressNextTap = false;
      this.eventBus.emit(new ShowEmojiMenuEvent(event.clientX, event.clientY));
      return;
    }

    const dist =
      Math.abs(event.x - this.lastPointerDownX) +
      Math.abs(event.y - this.lastPointerDownY);
    if (dist < this.DRAG_THRESHOLD_PX) {
      if (event.pointerType === "touch") {
        if (this.suppressNextTap) {
          this.suppressNextTap = false;
          event.preventDefault();
          return;
        }
        this.eventBus.emit(new TouchEvent(event.x, event.y));
        event.preventDefault();
        return;
      }

      if (
        !this.userSettings.leftClickOpensMenu() ||
        event.shiftKey ||
        this.gameView.inSpawnPhase() // No Radial Menu during spawn phase, only spawn point selection
      ) {
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
      if (event.ctrlKey) {
        if (!realCtrl) {
          // Pinch-to-zoom gesture (trackpad): small deltas, amplify.
          // Ignore large deltas — those are browser zoom shortcuts (cmd+/cmd-)
          // which fire synthetic wheel events we don't want to handle.
          if (Math.abs(event.deltaY) <= 10) {
            this.eventBus.emit(
              new ZoomEvent(event.x, event.y, event.deltaY * 10),
            );
          }
        }
        // Always return when ctrlKey is set — whether it's a real ctrl scroll,
        // a pinch gesture, or a browser zoom event, none should reach the
        // regular scroll path below.
        return;
      }
      // Regular scroll wheel: ignore tiny residual momentum events that macOS
      // keeps sending after a gesture ends (especially after browser zoom changes
      // devicePixelRatio, which can cause these to accumulate into runaway zoom).
      if (Math.abs(event.deltaY) < 2) return;
      this.eventBus.emit(new ZoomEvent(event.x, event.y, event.deltaY));
    }
  }

  private onShiftScroll(event: WheelEvent) {
    if (event.shiftKey) {
      const scrollValue = event.deltaY === 0 ? event.deltaX : event.deltaY;
      const increment = this.userSettings.attackRatioIncrement();
      const ratio = scrollValue > 0 ? -increment : increment;
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

      // Cancel long-press if finger moved significantly before timer fires
      if (this.longPressTimer !== null) {
        const moveDist =
          Math.abs(event.clientX - this.lastPointerDownX) +
          Math.abs(event.clientY - this.lastPointerDownY);
        if (moveDist >= this.DRAG_THRESHOLD_PX) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }
      }

      // If shift is held OR touch long-press is active OR selection box already
      // started, continue emitting selection box updates
      if (
        this.selectionBoxActive ||
        this.activeKeys.has(this.keybinds.shiftKey) ||
        this.longPressActive
      ) {
        this.selectionBoxActive = true;
        this.eventBus.emit(
          new WarshipSelectionBoxUpdateEvent(
            this.lastPointerDownX,
            this.lastPointerDownY,
            event.clientX,
            event.clientY,
          ),
        );
      } else {
        this.eventBus.emit(new DragEvent(deltaX, deltaY));
      }

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
    if (this.gameView.inSpawnPhase()) {
      return;
    }
    if (this.uiState.ghostStructure !== null) {
      this.setGhostStructure(null);
      return;
    }
    this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
  }

  private setGhostStructure(ghostStructure: PlayerBuildableUnitType | null) {
    this.uiState.ghostStructure = ghostStructure;
    this.eventBus.emit(new GhostStructureChangedEvent(ghostStructure));
  }

  /**
   * Parses a keybind value that may include a "Shift+" prefix.
   * e.g. "Shift+KeyB" → { shift: true, code: "KeyB" }
   *      "KeyB"       → { shift: false, code: "KeyB" }
   */
  private parseKeybind(value: string): { shift: boolean; code: string } {
    if (value?.startsWith("Shift+")) {
      return { shift: true, code: value.slice(6) };
    }
    return { shift: false, code: value };
  }

  /**
   * Returns true if the keyboard event matches the given keybind value,
   * including optional Shift+ prefix support.
   */
  private keybindMatchesEvent(e: KeyboardEvent, keybindValue: string): boolean {
    const parsed = this.parseKeybind(keybindValue);
    return e.code === parsed.code && e.shiftKey === parsed.shift;
  }

  /**
   * Extracts the digit character from KeyboardEvent.code.
   * Codes look like "Digit0".."Digit9" (6 chars, digit at index 5) and
   * "Numpad0".."Numpad9" (7 chars, digit at index 6). Returns null if not a digit key.
   */
  private digitFromKeyCode(code: string): string | null {
    if (
      code?.length === 6 &&
      code.startsWith("Digit") &&
      /^[0-9]$/.test(code[5])
    )
      return code[5];
    if (
      code?.length === 7 &&
      code.startsWith("Numpad") &&
      /^[0-9]$/.test(code[6])
    )
      return code[6];
    return null;
  }

  /** Strict equality only: used for first-pass exact KeyboardEvent.code match. */
  private buildKeybindMatches(
    code: string,
    shiftKey: boolean,
    keybindValue: string,
  ): boolean {
    const parsed = this.parseKeybind(keybindValue);
    return code === parsed.code && shiftKey === parsed.shift;
  }

  /** Digit/Numpad alias match: used only when no exact match was found. */
  private buildKeybindMatchesDigit(
    code: string,
    shiftKey: boolean,
    keybindValue: string,
  ): boolean {
    const parsed = this.parseKeybind(keybindValue);
    if (shiftKey !== parsed.shift) return false;
    const digit = this.digitFromKeyCode(code);
    const bindDigit = this.digitFromKeyCode(parsed.code);
    return digit !== null && bindDigit !== null && digit === bindDigit;
  }

  /**
   * Resolves a keyup code to a build action: exact code match first, then digit/Numpad alias.
   * Returns the UnitType to set as ghost, or null if no build keybind matched.
   */
  private resolveBuildKeybind(
    code: string,
    shiftKey: boolean,
  ): PlayerBuildableUnitType | null {
    const buildKeybinds: ReadonlyArray<{
      key: string;
      type: PlayerBuildableUnitType;
    }> = [
      { key: "buildCity", type: UnitType.City },
      { key: "buildFactory", type: UnitType.Factory },
      { key: "buildPort", type: UnitType.Port },
      { key: "buildDefensePost", type: UnitType.DefensePost },
      { key: "buildMissileSilo", type: UnitType.MissileSilo },
      { key: "buildSamLauncher", type: UnitType.SAMLauncher },
      { key: "buildAtomBomb", type: UnitType.AtomBomb },
      { key: "buildHydrogenBomb", type: UnitType.HydrogenBomb },
      { key: "buildWarship", type: UnitType.Warship },
      { key: "buildMIRV", type: UnitType.MIRV },
    ];
    for (const { key, type } of buildKeybinds) {
      if (this.buildKeybindMatches(code, shiftKey, this.keybinds[key]))
        return type;
    }
    for (const { key, type } of buildKeybinds) {
      if (this.buildKeybindMatchesDigit(code, shiftKey, this.keybinds[key]))
        return type;
    }
    return null;
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
      if (input.type === "range") {
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

  private isAltKeyHeld(event: KeyboardEvent): boolean {
    if (
      this.keybinds.altKey === "AltLeft" ||
      this.keybinds.altKey === "AltRight"
    ) {
      return event.altKey && !event.ctrlKey;
    }
    if (
      this.keybinds.altKey === "ControlLeft" ||
      this.keybinds.altKey === "ControlRight"
    ) {
      return event.ctrlKey;
    }
    if (
      this.keybinds.altKey === "ShiftLeft" ||
      this.keybinds.altKey === "ShiftRight"
    ) {
      return event.shiftKey;
    }
    if (
      this.keybinds.altKey === "MetaLeft" ||
      this.keybinds.altKey === "MetaRight"
    ) {
      return event.metaKey;
    }
    return false;
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
