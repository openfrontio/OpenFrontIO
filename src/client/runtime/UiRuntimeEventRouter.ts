import { takeUiEvents, type DioxusUiEvent } from "../UiRuntimeBridge";

const ROUTER_POLL_INTERVAL_MS = 50;

type RuntimeEventHandler = (event: DioxusUiEvent) => void | Promise<void>;

interface RuntimeSubscription {
  types: Set<string>;
  handler: RuntimeEventHandler;
}

let started = false;
let nextSubscriptionId = 1;
const subscriptions = new Map<number, RuntimeSubscription>();

type RuntimeEventWaiter = {
  predicate?: (event: DioxusUiEvent) => boolean;
  resolve: (event: DioxusUiEvent | undefined) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

const waitersByType = new Map<string, RuntimeEventWaiter[]>();

function drainWaiters(event: DioxusUiEvent): void {
  const waiters = waitersByType.get(event.type);
  if (!waiters || waiters.length === 0) {
    return;
  }

  const remaining: RuntimeEventWaiter[] = [];
  for (const waiter of waiters) {
    if (waiter.predicate && !waiter.predicate(event)) {
      remaining.push(waiter);
      continue;
    }
    clearTimeout(waiter.timeoutHandle);
    waiter.resolve(event);
  }

  if (remaining.length === 0) {
    waitersByType.delete(event.type);
  } else {
    waitersByType.set(event.type, remaining);
  }
}

async function routeEvent(event: DioxusUiEvent): Promise<void> {
  drainWaiters(event);

  for (const subscription of subscriptions.values()) {
    if (!subscription.types.has(event.type)) {
      continue;
    }
    await subscription.handler(event);
  }
}

function pumpEvents(): void {
  const events = takeUiEvents();
  if (events.length === 0) {
    return;
  }

  for (const event of events) {
    void routeEvent(event);
  }
}

export function startUiRuntimeEventRouter(): void {
  if (started) {
    return;
  }
  setInterval(() => {
    pumpEvents();
  }, ROUTER_POLL_INTERVAL_MS);
  started = true;
}

export function subscribeUiRuntimeEvents(
  eventTypes: string[],
  handler: RuntimeEventHandler,
): () => void {
  startUiRuntimeEventRouter();

  const id = nextSubscriptionId++;
  subscriptions.set(id, {
    types: new Set(eventTypes),
    handler,
  });

  return () => {
    subscriptions.delete(id);
  };
}

export function waitForUiRuntimeEvent(
  eventType: string,
  options?: {
    timeoutMs?: number;
    predicate?: (event: DioxusUiEvent) => boolean;
  },
): Promise<DioxusUiEvent | undefined> {
  startUiRuntimeEventRouter();

  const timeoutMs =
    typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : 250;

  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      const waiters = waitersByType.get(eventType);
      if (!waiters) {
        resolve(undefined);
        return;
      }

      const nextWaiters = waiters.filter(
        (waiter) => waiter.timeoutHandle !== timeoutHandle,
      );
      if (nextWaiters.length === 0) {
        waitersByType.delete(eventType);
      } else {
        waitersByType.set(eventType, nextWaiters);
      }
      resolve(undefined);
    }, timeoutMs);

    const waiter: RuntimeEventWaiter = {
      predicate: options?.predicate,
      resolve,
      timeoutHandle,
    };
    const waiters = waitersByType.get(eventType) ?? [];
    waiters.push(waiter);
    waitersByType.set(eventType, waiters);
  });
}
