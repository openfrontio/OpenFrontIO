// Add global mocks or configuration here if needed
Object.defineProperty(globalThis, "localStorage", {
  value: window.localStorage,
  configurable: true,
});
