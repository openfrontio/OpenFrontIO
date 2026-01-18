import { EventBus, GameEvent } from "../core/EventBus";
import { UnitType } from "../core/game/Game";
import { UnitView } from "../core/game/GameView";
import { UserSettings } from "../core/game/UserSettings";
import { UIState } from "./graphics/UIState";
import { getDefaultKeybinds } from "./Keybinds";
import { ReplaySpeedMultiplier } from "./utilities/ReplaySpeedMultiplier";

type ParsedKeybind = { primary: string; modifiers: string[] };

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);
const MOUSE_CODES = new Set(["MouseLeft", "MouseMiddle"]);

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
  private parsedKeybinds = new Map<string, ParsedKeybind>();

  private readonly onKeybindsChanged = () => this.reloadKeybindsFromStorage();

  private readonly PAN_SPEED = 5;
  private readonly ZOOM_SPEED = 10;

  private readonly userSettings: UserSettings = new UserSettings();

  constructor(
    public uiState: UIState,
    private canvas: HTMLCanvasElement,
    private eventBus: EventBus,
  ) {}

  initialize() {
    // Load keybinds from storage (and listen for runtime updates).
    this.reloadKeybindsFromStorage();
    window.addEventListener(
      "settings.keybinds.changed",
      this.onKeybindsChanged,
    );

    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        this.onScroll(e);
        this.onAttackRatioScroll(e);
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

      // Skip if the attack modifier is held down.
      if (this.isAttackModifierActive()) {
        return;
      }

      if (
        this.isKeybindActive(this.keybinds.moveUp) ||
        this.isKeybindActive(this.keybinds.moveUpAlt)
      )
        deltaY += this.PAN_SPEED;
      if (
        this.isKeybindActive(this.keybinds.moveDown) ||
        this.isKeybindActive(this.keybinds.moveDownAlt)
      )
        deltaY -= this.PAN_SPEED;
      if (
        this.isKeybindActive(this.keybinds.moveLeft) ||
        this.isKeybindActive(this.keybinds.moveLeftAlt)
      )
        deltaX += this.PAN_SPEED;
      if (
        this.isKeybindActive(this.keybinds.moveRight) ||
        this.isKeybindActive(this.keybinds.moveRightAlt)
      )
        deltaX -= this.PAN_SPEED;

      if (deltaX || deltaY) {
        this.eventBus.emit(new DragEvent(deltaX, deltaY));
      }

      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      if (
        this.isKeybindActive(this.keybinds.zoomOut) ||
        this.isKeybindActive(this.keybinds.zoomOutAlt)
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, this.ZOOM_SPEED));
      }
      if (
        this.isKeybindActive(this.keybinds.zoomIn) ||
        this.isKeybindActive(this.keybinds.zoomInAlt)
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, -this.ZOOM_SPEED));
      }
    }, 1);

    window.addEventListener("keydown", (e) => {
      const isTextInput = this.isTextInputTarget(e.target);
      const closeViewKey = "Escape";
      const allowCloseViewInInput = true;
      if (isTextInput && (!allowCloseViewInInput || e.code !== closeViewKey)) {
        return;
      }

      this.activeKeys.add(e.code);

      if (this.matchesKeybind(e, this.keybinds.toggleView)) {
        e.preventDefault();
        if (!this.alternateView) {
          this.alternateView = true;
          this.eventBus.emit(new AlternateViewEvent(true));
        }
      }

      if (this.matchesKeybind(e, closeViewKey)) {
        e.preventDefault();
        this.eventBus.emit(new CloseViewEvent());
        this.setGhostStructure(null);
      }
    });
    window.addEventListener("keyup", (e) => {
      const isTextInput = this.isTextInputTarget(e.target);
      if (isTextInput && !this.activeKeys.has(e.code)) {
        return;
      }

      if (this.matchesKeybindPrimary(e, this.keybinds.toggleView)) {
        e.preventDefault();
        this.alternateView = false;
        this.eventBus.emit(new AlternateViewEvent(false));
      }

      const resetKey = this.keybinds.resetGfx;
      if (this.matchesKeybind(e, resetKey)) {
        e.preventDefault();
        this.eventBus.emit(new RefreshGraphicsEvent());
      }

      if (this.matchesKeybind(e, this.keybinds.boatAttack)) {
        e.preventDefault();
        this.eventBus.emit(new DoBoatAttackEvent());
      }

      if (this.matchesKeybind(e, this.keybinds.groundAttack)) {
        e.preventDefault();
        this.eventBus.emit(new DoGroundAttackEvent());
      }

      if (this.matchesKeybind(e, this.keybinds.attackRatioDown)) {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(-10));
      }

      if (this.matchesKeybind(e, this.keybinds.attackRatioUp)) {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(10));
      }

      if (this.matchesKeybind(e, this.keybinds.centerCamera)) {
        e.preventDefault();
        this.eventBus.emit(new CenterCameraEvent());
      }

      if (this.matchesKeybind(e, this.keybinds.buildCity)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.City);
      }

      if (this.matchesKeybind(e, this.keybinds.buildFactory)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.Factory);
      }

      if (this.matchesKeybind(e, this.keybinds.buildPort)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.Port);
      }

      if (this.matchesKeybind(e, this.keybinds.buildDefensePost)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.DefensePost);
      }

      if (this.matchesKeybind(e, this.keybinds.buildMissileSilo)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.MissileSilo);
      }

      if (this.matchesKeybind(e, this.keybinds.buildSamLauncher)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.SAMLauncher);
      }

      if (this.matchesKeybind(e, this.keybinds.buildAtomBomb)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.AtomBomb);
      }

      if (this.matchesKeybind(e, this.keybinds.buildHydrogenBomb)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.HydrogenBomb);
      }

      if (this.matchesKeybind(e, this.keybinds.buildWarship)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.Warship);
      }

      if (this.matchesKeybind(e, this.keybinds.buildMIRV)) {
        e.preventDefault();
        this.setGhostStructure(UnitType.MIRV);
      }

      if (this.matchesKeybind(e, this.keybinds.swapDirection)) {
        e.preventDefault();
        const nextDirection = !this.uiState.rocketDirectionUp;
        this.eventBus.emit(new SwapRocketDirectionEvent(nextDirection));
      }

      if (this.matchesKeybind(e, this.keybinds.togglePerformanceOverlay)) {
        e.preventDefault();
        this.eventBus.emit(new TogglePerformanceOverlayEvent());
      }

      this.activeKeys.delete(e.code);
    });
  }

  private onPointerDown(event: PointerEvent) {
    if (this.matchesPointerKeybind(event, this.keybinds.autoUpgrade)) {
      event.preventDefault();
      this.eventBus.emit(new AutoUpgradeEvent(event.clientX, event.clientY));
      return;
    }

    if (event.button > 0) return;

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

    if (!this.pointerDown) {
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

      const attackModifierActive = this.matchesPointerKeybind(
        event,
        this.keybinds.attackModifier,
      );
      if (!this.userSettings.leftClickOpensMenu() || attackModifierActive) {
        this.eventBus.emit(new MouseUpEvent(event.x, event.y));
      } else {
        this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
      }
    }
  }

  private onScroll(event: WheelEvent) {
    if (event.deltaY === 0 && event.deltaX !== 0) {
      return;
    }

    const scrollValue = event.deltaY === 0 ? event.deltaX : event.deltaY;
    if (scrollValue === 0) return;

    const direction = scrollValue > 0 ? "down" : "up";
    const ratioKeybind =
      direction === "down"
        ? this.keybinds.attackRatioScrollDown
        : this.keybinds.attackRatioScrollUp;
    if (this.matchesWheelKeybind(event, ratioKeybind, direction)) {
      return;
    }

    const realCtrl =
      this.activeKeys.has("ControlLeft") || this.activeKeys.has("ControlRight");
    const ratio = event.ctrlKey && !realCtrl ? 10 : 1; // Compensate pinch-zoom low sensitivity
    this.eventBus.emit(new ZoomEvent(event.x, event.y, event.deltaY * ratio));
  }

  private onAttackRatioScroll(event: WheelEvent) {
    if (event.deltaY === 0 && event.deltaX !== 0) {
      return;
    }

    const scrollValue = event.deltaY === 0 ? event.deltaX : event.deltaY;
    if (scrollValue === 0) return;

    const direction = scrollValue > 0 ? "down" : "up";
    const keybind =
      direction === "down"
        ? this.keybinds.attackRatioScrollDown
        : this.keybinds.attackRatioScrollUp;
    if (!this.matchesWheelKeybind(event, keybind, direction)) {
      return;
    }

    const ratio = direction === "down" ? -10 : 10;
    this.eventBus.emit(new AttackRatioEvent(ratio));
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

  private reloadKeybindsFromStorage() {
    let saved: Record<string, string> = {};
    try {
      const parsed = JSON.parse(
        localStorage.getItem("settings.keybinds") ?? "{}",
      );

      saved = Object.fromEntries(
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
    } catch (e) {
      console.warn("Invalid keybinds JSON:", e);
    }

    this.keybinds = {
      ...getDefaultKeybinds(),
      ...saved,
    };
    this.parsedKeybinds.clear();
  }

  destroy() {
    if (this.moveInterval !== null) {
      clearInterval(this.moveInterval);
    }
    this.activeKeys.clear();
    window.removeEventListener(
      "settings.keybinds.changed",
      this.onKeybindsChanged,
    );
  }

  private isAttackModifierActive(): boolean {
    return this.isKeybindActive(this.keybinds.attackModifier);
  }

  isModifierKeyPressed(event: PointerEvent): boolean {
    return this.matchesPointerKeybind(event, this.keybinds.modifierKey);
  }

  private parseKeybind(keybind: string | undefined): ParsedKeybind | null {
    if (!keybind || keybind === "Null") return null;
    const cached = this.parsedKeybinds.get(keybind);
    if (cached) return cached;

    const parts = keybind
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;

    const modifiers: string[] = [];
    let primary: string | null = null;
    for (const part of parts) {
      if (MODIFIER_CODES.has(part)) {
        modifiers.push(part);
      } else {
        primary = part;
      }
    }
    primary ??= modifiers.pop() ?? null;
    if (!primary) return null;

    const parsed = { primary, modifiers };
    this.parsedKeybinds.set(keybind, parsed);
    return parsed;
  }

  private isKeybindActive(keybind: string | undefined): boolean {
    const parsed = this.parseKeybind(keybind);
    if (!parsed) return false;
    if (!this.activeKeys.has(parsed.primary)) return false;
    if (
      parsed.modifiers.length === 0 &&
      !MODIFIER_CODES.has(parsed.primary) &&
      this.hasActiveModifiers()
    ) {
      return false;
    }
    for (const modifier of parsed.modifiers) {
      if (!this.activeKeys.has(modifier)) return false;
    }
    return true;
  }

  private matchesKeybind(
    event: KeyboardEvent,
    keybind: string | undefined,
  ): boolean {
    const parsed = this.parseKeybind(keybind);
    if (!parsed) return false;
    if (event.code !== parsed.primary) return false;
    if (
      parsed.modifiers.length === 0 &&
      !MODIFIER_CODES.has(parsed.primary) &&
      this.hasActiveModifiers()
    ) {
      return false;
    }
    for (const modifier of parsed.modifiers) {
      if (!this.activeKeys.has(modifier)) return false;
    }
    return true;
  }

  private matchesKeybindPrimary(
    event: KeyboardEvent,
    keybind: string | undefined,
  ): boolean {
    const parsed = this.parseKeybind(keybind);
    if (!parsed) return false;
    return event.code === parsed.primary;
  }

  private matchesWheelKeybind(
    event: WheelEvent,
    keybind: string | undefined,
    direction: "up" | "down",
  ): boolean {
    const parsed = this.parseKeybind(keybind);
    if (!parsed) return false;

    const expected = direction === "up" ? "ScrollUp" : "ScrollDown";
    if (parsed.primary !== expected) return false;

    if (parsed.modifiers.length === 0 && this.hasWheelModifiers(event)) {
      return false;
    }

    for (const modifier of parsed.modifiers) {
      if (!this.isWheelModifierHeld(event, modifier)) return false;
    }

    return true;
  }

  private hasWheelModifiers(event: WheelEvent): boolean {
    return event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
  }

  private isWheelModifierHeld(event: WheelEvent, code: string): boolean {
    if (code === "AltLeft" || code === "AltRight") return event.altKey;
    if (code === "ControlLeft" || code === "ControlRight") return event.ctrlKey;
    if (code === "ShiftLeft" || code === "ShiftRight") return event.shiftKey;
    if (code === "MetaLeft" || code === "MetaRight") return event.metaKey;
    return false;
  }

  private matchesPointerKeybind(
    event: PointerEvent,
    keybind: string | undefined,
  ): boolean {
    const parsed = this.parseKeybind(keybind);
    if (!parsed) return false;

    if (parsed.primary === "MouseLeft" && parsed.modifiers.length === 0) {
      return false;
    }

    const pointerCode = this.getPointerCode(event);
    if (!pointerCode) return false;

    if (MOUSE_CODES.has(parsed.primary)) {
      if (parsed.primary !== pointerCode) return false;
    } else {
      if (pointerCode !== "MouseLeft") return false;
      if (!this.isPointerCodeActive(event, parsed.primary)) return false;
    }

    for (const modifier of parsed.modifiers) {
      if (!this.isPointerCodeActive(event, modifier)) return false;
    }

    return true;
  }

  private isPointerCodeActive(event: PointerEvent, code: string): boolean {
    if (MOUSE_CODES.has(code)) {
      return this.getPointerCode(event) === code;
    }
    if (MODIFIER_CODES.has(code)) {
      return this.isPointerModifierHeld(event, code);
    }
    return this.activeKeys.has(code);
  }

  private isPointerModifierHeld(event: PointerEvent, code: string): boolean {
    if (code === "AltLeft" || code === "AltRight") return event.altKey;
    if (code === "ControlLeft" || code === "ControlRight") return event.ctrlKey;
    if (code === "ShiftLeft" || code === "ShiftRight") return event.shiftKey;
    if (code === "MetaLeft" || code === "MetaRight") return event.metaKey;
    return false;
  }

  private getPointerCode(event: PointerEvent): string | null {
    if (event.button === 0) return "MouseLeft";
    if (event.button === 1) return "MouseMiddle";
    if (event.button === 2) return "MouseRight";
    return null;
  }

  private hasActiveModifiers(): boolean {
    for (const code of this.activeKeys) {
      if (MODIFIER_CODES.has(code)) {
        return true;
      }
    }
    return false;
  }

  isAltKeyPressed(event: PointerEvent): boolean {
    return this.matchesPointerKeybind(event, this.keybinds.altKey);
  }
}
