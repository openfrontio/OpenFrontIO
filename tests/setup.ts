// Add global mocks or configuration here if needed

// Provide a small, spec-like in-memory localStorage for test environments
// that may expose a non-complete or broken `localStorage` object.
// This file is the single source of truth for test polyfills used by Vitest
// (configured via `vite.config.ts` -> `setupFiles`).
function createTestLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
  } as Storage;
}

if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.getItem !== "function"
) {
  Object.defineProperty(globalThis, "localStorage", {
    value: createTestLocalStorage(),
    configurable: true,
    writable: true,
  });
}
