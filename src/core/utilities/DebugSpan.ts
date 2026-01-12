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
      throw new Error("DebugSpan.end(): no open span");
    }

    // If name provided, close all spans up to and including the named one
    if (name) {
      while (stack.length > 0) {
        const span = stack.pop()!;
        span.timeEnd = performance.now();
        span.duration = span.timeEnd - span.timeStart;

        if (stack.length === 0) {
          globalThis.__DEBUG_SPANS__ = globalThis.__DEBUG_SPANS__ ?? [];
          globalThis.__DEBUG_SPANS__.push(span);

          while (globalThis.__DEBUG_SPANS__.length > 100) {
            globalThis.__DEBUG_SPANS__.shift();
          }
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
      globalThis.__DEBUG_SPANS__ = globalThis.__DEBUG_SPANS__ ?? [];
      globalThis.__DEBUG_SPANS__.push(span);

      while (globalThis.__DEBUG_SPANS__.length > 100) {
        globalThis.__DEBUG_SPANS__.shift();
      }
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
  get(): Span | undefined {
    if (!isEnabled()) return;

    globalThis.__DEBUG_SPANS__ = globalThis.__DEBUG_SPANS__ ?? [];
    return globalThis.__DEBUG_SPANS__[globalThis.__DEBUG_SPANS__.length - 1];
  },
};
