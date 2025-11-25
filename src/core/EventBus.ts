export type GameEvent = object;

export interface EventConstructor<T extends GameEvent = GameEvent> {
  new (...args: any[]): T;
}

export class EventBus {
  private listeners: Map<
    EventConstructor,
    Array<{ id: number; callback: (event: GameEvent) => void }>
  > = new Map();
  private nextId = 0;

  emit<T extends GameEvent>(event: T): void {
    const eventConstructor = event.constructor as EventConstructor<T>;

    const callbacks = this.listeners.get(eventConstructor);
    if (callbacks) {
      for (const callback of callbacks) {
        callback.callback(event);
      }
    }
  }

  on<T extends GameEvent>(
    eventType: EventConstructor<T>,
    callback: (event: T) => void,
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    const id = this.nextId++;
    this.listeners
      .get(eventType)!
      .push({ id, callback: callback as (event: GameEvent) => void });

    return () => {
      const callbacks = this.listeners.get(eventType);
      if (callbacks) {
        const index = callbacks.findIndex((item) => item.id === id);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  off<T extends GameEvent>(
    eventType: EventConstructor<T>,
    callback: (event: T) => void,
  ): void {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      const index = callbacks.findIndex((item) => item.callback === callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }
}
