/**
 * Browser-global shims for running client code (src/client/view, theme,
 * WebGLFrameBuilder) under Node. Import this FIRST — ESM executes imports in
 * order, so it must precede any module that touches these globals.
 *
 * UserSettings reads localStorage lazily; an in-memory store means every
 * setting resolves to its default, which is also the deterministic choice.
 */
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

export {};
