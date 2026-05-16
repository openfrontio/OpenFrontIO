// Back-compat re-export shim.
// The view classes physically live in src/client/view/ — this re-export keeps
// the older `import { GameView } from "src/core/game/GameView"` path working.
//
// TODO: remove this shim once all 50+ importers have been updated to point at
// src/client/view/ directly, and the 6 core files that reference PlayerView /
// UnitView / GameView as union types (Player | PlayerView etc.) are refactored
// to use Player / Unit / Game interfaces instead.

export { GameView } from "../../client/view/GameView";
export { PlayerView } from "../../client/view/PlayerView";
export { UnitView } from "../../client/view/UnitView";
