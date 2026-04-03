// Add global mocks or configuration here if needed
import "vitest-canvas-mock";

// Provide a fully-functional in-memory localStorage for all tests.
// jsdom's built-in localStorage can be a no-op stub when the environment
// is initialised without a valid URL (e.g. the --localstorage-file warning),
// which causes `removeItem` / `setItem` to be missing or throw.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});
