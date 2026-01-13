type Span = {
  name: string;
  timeStart: number;
  timeEnd?: number;
  duration?: number;
  data: Record<string, unknown>;
  children: Span[];
};

const stack: Span[] = [];

function isEnabled(): boolean {
  return globalThis.__DEBUG_SPAN_ENABLED__ === true;
}

export const DebugSpan = {
  isEnabled,
  enable(): void {
    globalThis.__DEBUG_SPAN_ENABLED__ = true;
  },
  disable(): void {
    globalThis.__DEBUG_SPAN_ENABLED__ = false;
  },
  start(name: string): void {
    if (!isEnabled()) return;

    const span: Span = {
      name,
      timeStart: performance.now(),
      data: {},
      children: [],
    };

    const parent = stack[stack.length - 1];
    parent?.children.push(span);
    stack.push(span);
  },
  end(name?: string): void {
    if (!isEnabled()) return;

    if (stack.length === 0) {
      const payload = name ? `"${name}"` : "";
      throw new Error(`DebugSpan.end(${payload}): no open span`);
    }

    // If name provided, close all spans up to and including the named one
    if (name) {
      while (stack.length > 0) {
        const span = stack.pop()!;
        span.timeEnd = performance.now();
        span.duration = span.timeEnd - span.timeStart;

        if (stack.length === 0) {
          DebugSpan.storeSpan(span);
        }

        if (span.name === name) break;
      }
      return;
    }

    // Default: close just the current span
    const span = stack.pop()!;
    span.timeEnd = performance.now();
    span.duration = span.timeEnd - span.timeStart;

    if (stack.length === 0) {
      DebugSpan.storeSpan(span);
    }
  },
  storeSpan(span: Span): void {
    if (!isEnabled()) return;

    globalThis.__DEBUG_SPANS__ = globalThis.__DEBUG_SPANS__ ?? [];
    globalThis.__DEBUG_SPANS__.push(span);

    const extractData = (span: Span): Record<string, unknown> => {
      return Object.fromEntries(
        Object.entries(span.data).filter(
          ([key]) => typeof key === "string" && key.startsWith("$"),
        ),
      );
    };

    const properties = {
      timings: { total: span.duration },
      data: extractData(span),
    };

    if (span.children.length > 0) {
      const getChildren = (span: Span): Span[] =>
        span.children.flatMap((child) => [child, ...getChildren(child)]);
      const children = getChildren(span);
      for (const childSpan of children) {
        properties.timings[childSpan.name] = childSpan.duration;
        const childData = extractData(childSpan);
        for (const key of Object.keys(childData)) {
          properties.data[key] = childData[key];
        }
      }
    }

    try {
      performance.measure(span.name, {
        start: span.timeStart,
        end: span.timeEnd,
        detail: properties,
      });
    } catch (err) {
      console.error("DebugSpan.storeSpan: performance.measure failed", err);
      console.error("Span:", span);
    }

    while (globalThis.__DEBUG_SPANS__.length > 100) {
      globalThis.__DEBUG_SPANS__.shift();
    }
  },
  wrap<T>(name: string, fn: () => T): T {
    this.start(name);

    try {
      return fn();
    } finally {
      this.end(name);
    }
  },
  set(
    key: string,
    valueFn: (previous: unknown) => unknown,
    root: boolean = true,
  ): void {
    if (!isEnabled()) return;

    if (stack.length === 0) {
      throw new Error(`DebugSpan.set("${key}"): no open span`);
    }

    const span = root ? stack[0] : stack[stack.length - 1];
    span.data[key] = valueFn(span.data[key]);
  },
  getLastSpan(name?: string): Span | undefined {
    if (!isEnabled()) return;

    if (name) {
      for (let i = globalThis.__DEBUG_SPANS__?.length - 1 || 0; i >= 0; i--) {
        const span = globalThis.__DEBUG_SPANS__[i];
        if (span.name === name) {
          return span;
        }
      }

      return undefined;
    }

    globalThis.__DEBUG_SPANS__ = globalThis.__DEBUG_SPANS__ ?? [];
    return globalThis.__DEBUG_SPANS__[globalThis.__DEBUG_SPANS__.length - 1];
  },
};
