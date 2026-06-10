import type { UnitState } from "../types";

/** Event data emitted by GameView for map interactions. */
export interface MapPointerEvent {
  /** CSS pixel X relative to viewport (clientX). */
  screenX: number;
  /** CSS pixel Y relative to viewport (clientY). */
  screenY: number;
  /** World-space X (fractional; floor for tile column). */
  worldX: number;
  /** World-space Y (fractional; floor for tile row). */
  worldY: number;
  /** Tile column (integer, -1 if out of bounds). */
  tileX: number;
  /** Tile row (integer, -1 if out of bounds). */
  tileY: number;
  /** Territory owner at this tile (0 = unowned/OOB). */
  ownerID: number;
  /** Nearest mobile unit under cursor, or null. */
  unit: UnitState | null;
  /** Nearest structure under cursor, or null. */
  structure: UnitState | null;
  /** Mouse button: 0 = left, 1 = middle, 2 = right. */
  button: number;
  /** Shift key held. */
  shiftKey: boolean;
  /** Ctrl/Meta key held. */
  ctrlKey: boolean;
  /** Alt key held. */
  altKey: boolean;
}

/** Scroll event data emitted by GameView. */
export interface MapScrollEvent {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Alt-view temporarily peeked (space hold — enables altview + gridview). */
export interface AltViewPeekEvent {
  active: boolean;
}

/** Grid-view default toggled (persistent resting state changed via 'M'). */
export interface GridViewToggleEvent {
  active: boolean;
}

/** Map of event names to their payload types. */
export interface GameViewEventMap {
  /** Left-click (pointerdown + pointerup with < 10px movement). */
  click: MapPointerEvent;
  /** Double-click. */
  dblclick: MapPointerEvent;
  /** Middle-click (auxclick with button 1). */
  middleclick: MapPointerEvent;
  /** Right-click / context menu. */
  contextmenu: MapPointerEvent;
  /** Hovered entity changed (owner, unit, or structure differs from previous). */
  hover: MapPointerEvent;
  /** Scroll with modifier keys (unmodified scroll is consumed by zoom). */
  scroll: MapScrollEvent;
  /** User selected a radial menu item. */
  menuselect: RadialMenuSelectEvent;
  /** Alt-view temporarily peeked (space hold — enables altview + gridview). */
  altviewpeek: AltViewPeekEvent;
  /** Grid-view default toggled (M key). */
  gridviewtoggle: GridViewToggleEvent;
  /** WebGL Context successfully restored after a loss. (Requires full state re-upload) */
  contextrestored: { type: "restored" };
}

/** A single item in the radial context menu. */
export interface RadialMenuItem {
  /** Unique identifier for this action. */
  id: string;
  /** Emoji key into the atlas (e.g. "⚔️"), or empty string for no icon. */
  icon: string;
  /** RGB color [0–1]. */
  color: [number, number, number];
  /** Whether this action is currently available. */
  enabled: boolean;
  /** If present, clicking this item opens a submenu with these items. */
  subItems?: RadialMenuItem[];
}

/** Emitted when the user selects a radial menu item. */
export interface RadialMenuSelectEvent {
  /** Index of the selected segment. */
  index: number;
  /** The item's id. */
  id: string;
}

export type GameViewEventType = keyof GameViewEventMap;
