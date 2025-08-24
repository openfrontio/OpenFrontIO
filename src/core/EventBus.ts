export type GameEvent = object;

export type EventConstructor<T extends GameEvent = GameEvent> = new (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => T;

export class EventBus {
  private readonly listeners: Map<
    EventConstructor,
    Array<(event: GameEvent) => void>
  > = new Map();

  emit<T extends GameEvent>(event: T): void {
    const eventConstructor = event.constructor as EventConstructor<T>;
    const callbacks = this.listeners.get(eventConstructor);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(event);
      }
    }
  }

  on<T extends GameEvent>(
    eventType: EventConstructor<T>,
    callback: (event: T) => void,
  ): void {
    let callbacks = this.listeners.get(eventType);
    if (callbacks === undefined) {
      callbacks = [];
      this.listeners.set(eventType, callbacks);
    }
    callbacks.push(callback as (event: GameEvent) => void);
  }

  off<T extends GameEvent>(
    eventType: EventConstructor<T>,
    callback: (event: T) => void,
  ): void {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      const index = callbacks.indexOf(callback as (event: GameEvent) => void);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }
}
