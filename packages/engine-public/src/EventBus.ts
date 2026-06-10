// Event type contracts shared with the public schema layer. The runtime
// EventBus implementation lives in engine/EventBus.ts and re-exports these.
export type GameEvent = object;

export interface EventConstructor<T extends GameEvent = GameEvent> {
  new (...args: any[]): T;
}
