/**
 * MapInteraction — handles all DOM pointer and keyboard events for GameView.
 *
 * Owns:
 * - Drag state: dragging, lastX/Y, downX/Y
 * - Menu hover state: menuHoveredSeg
 * - Timing guards: lastMenuDismissAt, lastGhostClickAt
 * - Ghost preview flag: hasGhostPreview
 * - Alt-view flag: altView (affiliation recoloring, configurable hold key)
 * - Grid-view flag: gridView (coordinate grid, configurable toggle key)
 * - Hover tracking: lastHoverOwner, lastHoverUnitId, lastHoverStructureId, lastHoverTileX/Y
 *
 * All handler methods (pointerdown, pointermove, pointerup, keydown, keyup, wheel, contextmenu, auxclick, dblclick)
 * are defined here and bound by GameView.
 */

import type {
  GameViewEventMap,
  GameViewEventType,
  MapPointerEvent,
} from "./events";
import { KeyboardPan } from "./keyboard-pan";
import type { GPURenderer } from "./renderer";

const HIT_RADIUS_PX = 16;
const CLICK_THRESHOLD_SQ = 100;

/** Describes a hold-key binding (key held = active, released = inactive). */
export interface HoldKeyBinding {
  /** KeyboardEvent.code to match (e.g. "Space", "KeyM"). */
  code: string;
  /** Require shift modifier. Default false. */
  shift?: boolean;
}

/** Describes a toggle-key binding (each press toggles). */
export interface ToggleKeyBinding {
  /** KeyboardEvent.key to match (e.g. "m", "g"). */
  key: string;
}

/** Configurable keybindings for MapInteraction. */
export interface MapKeyBindings {
  /** Hold to peek alt-view (affiliation recoloring) + grid. */
  altViewPeek: HoldKeyBinding;
  /** Toggle grid overlay on/off. */
  gridToggle: ToggleKeyBinding;
}

/** Extension default: Space hold for altView peek, 'm' toggle for grid. */
export const DEFAULT_KEY_BINDINGS: MapKeyBindings = {
  altViewPeek: { code: "Space" },
  gridToggle: { key: "m" },
};

/** Replay default: Shift+M hold for altView peek, 'm' toggle for grid. */
export const REPLAY_KEY_BINDINGS: MapKeyBindings = {
  altViewPeek: { code: "KeyG", shift: true },
  gridToggle: { key: "g" },
};

interface InteractionDeps {
  renderer: GPURenderer;
  emit: <K extends GameViewEventType>(
    event: K,
    payload: GameViewEventMap[K],
  ) => void;
  raf: typeof requestAnimationFrame;
  caf: typeof cancelAnimationFrame;
  keyBindings?: MapKeyBindings;
}

export class MapInteraction {
  private deps: InteractionDeps;
  private keys: MapKeyBindings;

  // Drag state
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;

  // Hover tracking
  private lastHoverOwner = 0;
  private lastHoverUnitId: number | null = null;
  private lastHoverStructureId: number | null = null;
  private lastHoverTileX = -1;
  private lastHoverTileY = -1;

  // Timing guards
  private hasGhostPreview = false;
  private lastGhostClickAt = 0;
  private lastMenuDismissAt = 0;

  // Menu hover
  private menuHoveredSeg = -1;

  // Grid-view: coordinate grid overlay. Toggled by configured key, persisted.
  private gridViewBase = false;
  private gridView = false;

  // Alt-view: affiliation recoloring (no persistent toggle).
  private altView = false;

  // Alt-view peek hold state.
  private peekHeld = false;

  // Interaction settings (mutable — updated live by extension)
  fitZoomOnDoubleClick = true;

  // Keyboard camera control (WASD pan + C fit-zoom)
  private keyboardPan: KeyboardPan;

  constructor(deps: InteractionDeps) {
    this.deps = deps;
    this.keys = deps.keyBindings ?? DEFAULT_KEY_BINDINGS;
    this.keyboardPan = new KeyboardPan(deps.renderer, deps.raf, deps.caf);
  }

  // ---- Pointer event handlers ----

  handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;

    // If radial menu is open, clicking outside dismisses it
    if (this.deps.renderer.radialMenuVisible) {
      const hit = this.deps.renderer.radialMenuHitTest(e.clientX, e.clientY);
      if (hit === -1) {
        this.deps.renderer.hideRadialMenu();
        this.menuHoveredSeg = -1;
        this.lastMenuDismissAt = performance.now();
      }
      return; // consume the event either way — don't start dragging
    }

    if (this.hasGhostPreview) this.lastGhostClickAt = performance.now();
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  handlePointerMove(e: PointerEvent): void {
    // Update radial menu hover
    if (this.deps.renderer.radialMenuVisible) {
      const hit = this.deps.renderer.radialMenuHitTest(e.clientX, e.clientY);
      if (hit !== this.menuHoveredSeg) {
        this.menuHoveredSeg = hit;
        this.deps.renderer.setRadialMenuHover(hit);
      }
      return; // don't pan or update game hover while menu is open
    }

    if (this.dragging) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const dpr = window.devicePixelRatio || 1;
      this.deps.renderer.panBy(
        -(dx * dpr) / this.deps.renderer.zoom,
        -(dy * dpr) / this.deps.renderer.zoom,
      );
      return;
    }
    this.updateHover(e);
  }

  handlePointerUp(e: PointerEvent): void {
    if (e.button !== 0) return;

    // If radial menu is open, a click on a segment or center selects it.
    // Don't hide the menu here — the menuselect handler decides whether to
    // close or open a submenu.
    if (this.deps.renderer.radialMenuVisible) {
      if (this.menuHoveredSeg !== -1) {
        const item = this.deps.renderer.getRadialMenuItemAt(
          this.menuHoveredSeg,
        );
        if (item && item.enabled) {
          this.deps.emit("menuselect", {
            index: this.menuHoveredSeg,
            id: item.id,
          });
        }
        if (!this.deps.renderer.radialMenuVisible) {
          this.lastMenuDismissAt = performance.now();
        }
        this.menuHoveredSeg = -1;
      }
      return;
    }

    if (!this.dragging) return;
    this.dragging = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const dx = e.clientX - this.downX;
    const dy = e.clientY - this.downY;
    if (dx * dx + dy * dy < CLICK_THRESHOLD_SQ) {
      this.deps.emit("click", this.buildEvent(e, 0));
    }
  }

  // ---- Keyboard event handlers ----

  handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.deps.renderer.radialMenuVisible) {
      this.deps.renderer.hideRadialMenu();
      this.menuHoveredSeg = -1;
      this.lastMenuDismissAt = performance.now();
    }
    if (
      this.matchesHold(e, this.keys.altViewPeek) &&
      !e.repeat &&
      !this.peekHeld
    ) {
      e.preventDefault();
      this.peekHeld = true;
      this.applyAltView(true);
      this.applyGridView(true);
      this.deps.emit("altviewpeek", { active: true });
    }
    if (e.key === this.keys.gridToggle.key && !e.shiftKey && !e.repeat) {
      this.gridViewBase = !this.gridViewBase;
      this.applyGridView(this.gridViewBase);
      this.deps.emit("gridviewtoggle", { active: this.gridViewBase });
    }
    this.keyboardPan.handleKeyDown(e);
  }

  handleKeyUp(e: KeyboardEvent): void {
    if (e.code === this.keys.altViewPeek.code && this.peekHeld) {
      e.preventDefault();
      this.peekHeld = false;
      this.applyAltView(false);
      this.applyGridView(this.gridViewBase);
      this.deps.emit("altviewpeek", { active: false });
    }
    this.keyboardPan.handleKeyUp(e);
  }

  private matchesHold(e: KeyboardEvent, binding: HoldKeyBinding): boolean {
    return e.code === binding.code && (!binding.shift || e.shiftKey);
  }

  // ---- Other event handlers ----

  handleWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.shiftKey || e.ctrlKey || e.altKey) {
      this.deps.emit("scroll", {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
      });
      return;
    }
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.deps.renderer.zoomAtScreen(factor, e.clientX, e.clientY);
  }

  handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
    // Dismiss any open menu first — the external manager will decide whether to reopen
    if (this.deps.renderer.radialMenuVisible) {
      this.deps.renderer.hideRadialMenu();
      this.menuHoveredSeg = -1;
      this.lastMenuDismissAt = performance.now();
    }
    this.deps.emit("contextmenu", this.buildEvent(e, 2));
  }

  handleAuxClick(e: MouseEvent): void {
    if (e.button !== 1) return;
    e.preventDefault();
    this.deps.emit("middleclick", this.buildEvent(e, 1));
  }

  handleDblClick(e: MouseEvent): void {
    // Suppress fitzoom if menu is open or was recently open
    if (this.deps.renderer.radialMenuVisible) return;
    const now = performance.now();
    if (now - this.lastMenuDismissAt < 500) return;

    const evt = this.buildEvent(e, 0);
    if (this.fitZoomOnDoubleClick && now - this.lastGhostClickAt > 500) {
      if (evt.ownerID !== 0) this.deps.renderer.focusOwner(evt.ownerID);
      else this.deps.renderer.fitMap();
    }
    this.deps.emit("dblclick", evt);
  }

  // ---- Hover tracking ----

  private updateHover(e: PointerEvent): void {
    const world = this.deps.renderer.screenToWorld(e.clientX, e.clientY);
    const tileX = Math.floor(world.x);
    const tileY = Math.floor(world.y);
    const ownerID = this.deps.renderer.getOwnerAtWorld(world.x, world.y);
    const hitRadius = HIT_RADIUS_PX / this.deps.renderer.zoom;
    const unit = this.deps.renderer.getUnitAtWorld(world.x, world.y, hitRadius);
    const structure = this.deps.renderer.getStructureAtWorld(
      world.x,
      world.y,
      hitRadius,
    );
    const unitId = unit?.id ?? null;
    const structureId = structure?.id ?? null;

    if (
      ownerID !== this.lastHoverOwner ||
      unitId !== this.lastHoverUnitId ||
      structureId !== this.lastHoverStructureId ||
      tileX !== this.lastHoverTileX ||
      tileY !== this.lastHoverTileY
    ) {
      this.lastHoverOwner = ownerID;
      this.lastHoverUnitId = unitId;
      this.lastHoverStructureId = structureId;
      this.lastHoverTileX = tileX;
      this.lastHoverTileY = tileY;
      this.deps.renderer.setHighlightOwner(ownerID);
      this.deps.emit("hover", {
        screenX: e.clientX,
        screenY: e.clientY,
        worldX: world.x,
        worldY: world.y,
        tileX,
        tileY,
        ownerID,
        unit,
        structure,
        button: 0,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey || e.metaKey,
        altKey: e.altKey,
      });
    }
  }

  private buildEvent(e: MouseEvent, button: number): MapPointerEvent {
    const world = this.deps.renderer.screenToWorld(e.clientX, e.clientY);
    const hitRadius = HIT_RADIUS_PX / this.deps.renderer.zoom;
    return {
      screenX: e.clientX,
      screenY: e.clientY,
      worldX: world.x,
      worldY: world.y,
      tileX: Math.floor(world.x),
      tileY: Math.floor(world.y),
      ownerID: this.deps.renderer.getOwnerAtWorld(world.x, world.y),
      unit: this.deps.renderer.getUnitAtWorld(world.x, world.y, hitRadius),
      structure: this.deps.renderer.getStructureAtWorld(
        world.x,
        world.y,
        hitRadius,
      ),
      button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey || e.metaKey,
      altKey: e.altKey,
    };
  }

  // ---- View helpers ----

  private applyAltView(active: boolean): void {
    if (active === this.altView) return;
    this.altView = active;
    this.deps.renderer.setAltView(active);
  }

  private applyGridView(active: boolean): void {
    if (active === this.gridView) return;
    this.gridView = active;
    this.deps.renderer.setGridView(active);
  }

  // ---- Public API ----

  setDefaultGridView(v: boolean): void {
    this.gridViewBase = v;
    if (!this.peekHeld) this.applyGridView(v);
  }

  setHasGhostPreview(v: boolean): void {
    this.hasGhostPreview = v;
  }

  getMenuHoveredSeg(): number {
    return this.menuHoveredSeg;
  }

  setMenuHoveredSeg(v: number): void {
    this.menuHoveredSeg = v;
  }

  setLocalPlayerID(id: number): void {
    this.keyboardPan.setLocalPlayerID(id);
  }

  setPanSpeed(speed: number): void {
    this.keyboardPan.setPanSpeed(speed);
  }

  setZoomSpeed(speed: number): void {
    this.keyboardPan.setZoomSpeed(speed);
  }

  dispose(): void {
    this.keyboardPan.dispose();
  }
}
