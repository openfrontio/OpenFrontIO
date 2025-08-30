export enum Action {
  // View and camera controls
  TOGGLE_VIEW,
  CENTER_CAMERA,

  // Movement controls
  MOVE_UP,
  MOVE_DOWN,
  MOVE_LEFT,
  MOVE_RIGHT,

  // Zoom controls
  ZOOM_OUT,
  ZOOM_IN,

  // Attack controls
  ATTACK_RATIO_DOWN,
  ATTACK_RATIO_UP,
  BOAT_ATTACK,
  GROUND_ATTACK,

  // Modifier keys
  MODIFIER_KEY,
  ALT_KEY
}

export const ActionKeybindMapDefaults = new Map<Action, string>([
  [Action.TOGGLE_VIEW, " "],
  [Action.CENTER_CAMERA, "c"],
  [Action.MOVE_UP, "w"],
  [Action.MOVE_DOWN, "s"],
  [Action.MOVE_LEFT, "a"],
  [Action.MOVE_RIGHT, "d"],
  [Action.ZOOM_OUT, "q"],
  [Action.ZOOM_IN, "e"],
  [Action.ATTACK_RATIO_DOWN, "1"],
  [Action.ATTACK_RATIO_UP, "2"],
  [Action.BOAT_ATTACK, "b"],
  [Action.GROUND_ATTACK, "g"],
  [Action.MODIFIER_KEY, "ControlLeft"],
  [Action.ALT_KEY, "AltLeft"],
]);
