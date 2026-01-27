type StorageLike = {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
};

function isStorageLike(value: unknown): value is StorageLike {
  const candidate = value as Partial<StorageLike> | null | undefined;
  if (!candidate) return false;
  return (
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function" &&
    typeof candidate.clear === "function" &&
    typeof candidate.key === "function"
  );
}

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(String(key));
    },
    setItem(key: string, value: string) {
      map.set(String(key), String(value));
    },
  };
}

function ensureWebStorage(storageKey: "localStorage" | "sessionStorage"): void {
  let existing: unknown;
  try {
    existing = (globalThis as any)[storageKey];
  } catch {
    existing = undefined;
  }

  if (isStorageLike(existing)) {
    return;
  }

  Object.defineProperty(globalThis, storageKey, {
    value: createMemoryStorage(),
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

ensureWebStorage("localStorage");
ensureWebStorage("sessionStorage");
