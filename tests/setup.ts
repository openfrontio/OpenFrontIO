const mockStorage: Record<string, string> = {};

Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (key: string) => mockStorage[key] || null,
    setItem: (key: string, value: string) => {
      mockStorage[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete mockStorage[key];
    },
    clear: () => {
      for (const key in mockStorage) {
        delete mockStorage[key];
      }
    },
  },
  writable: true,
});
