/**
 * Controller — the main-thread analog of the worker's Execution.
 *
 * A Controller subscribes to events / game state and drives some slice of
 * the client side (input, UI state, view updates). The interface is just
 * lifecycle hooks; all coordination happens via the EventBus and direct
 * references the controller is given at construction time.
 *
 * Naming: previously "Layer" — the name was a leftover from the canvas2D
 * era when each entry in the array drew to the same 2D context. Now nothing
 * draws to a shared canvas, so they're plain controllers.
 */
export interface Controller {
  /** Called once at game start. Subscribe to events / set up state here. */
  init?: () => void;

  /**
   * Called per game tick (10Hz). Optional — pure event subscribers can omit.
   *
   * If `getTickIntervalMs()` returns > 0, the controller is throttled to that
   * wall-clock interval instead of running every tick.
   */
  tick?: () => void;

  /** Optional throttle on tick frequency, in milliseconds. */
  getTickIntervalMs?: () => number;
}
