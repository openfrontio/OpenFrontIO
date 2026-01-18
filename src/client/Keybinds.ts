export type KeybindMap = Record<string, string>;

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

const DEFAULT_KEYBINDS: KeybindMap = {
  toggleView: "Space",
  closeView: "Escape",
  resetGfx: "ShiftLeft+KeyR",
  togglePerformanceOverlay: "ShiftLeft+KeyD",
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
  attackRatioDown: "KeyT",
  attackRatioUp: "KeyY",
  attackModifier: "ShiftLeft+MouseLeft",
  attackRatioScrollDown: "ShiftLeft+ScrollDown",
  attackRatioScrollUp: "ShiftLeft+ScrollUp",
  boatAttack: "KeyB",
  groundAttack: "KeyG",
  swapDirection: "KeyU",
  zoomOut: "KeyQ",
  zoomIn: "KeyE",
  zoomOutAlt: "Minus",
  zoomInAlt: "Equal",
  centerCamera: "KeyC",
  moveUp: "KeyW",
  moveLeft: "KeyA",
  moveDown: "KeyS",
  moveRight: "KeyD",
  moveUpAlt: "ArrowUp",
  moveLeftAlt: "ArrowLeft",
  moveDownAlt: "ArrowDown",
  moveRightAlt: "ArrowRight",
  autoUpgrade: "MouseMiddle",
  modifierKey: isMac ? "MetaLeft+MouseLeft" : "ControlLeft+MouseLeft",
  altKey: "AltLeft+MouseLeft",
};

export function getDefaultKeybinds(): KeybindMap {
  return { ...DEFAULT_KEYBINDS };
}
