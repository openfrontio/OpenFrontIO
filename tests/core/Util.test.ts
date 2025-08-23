import { getClientID } from "../../src/core/Util";

describe("Util", () => {
  class InMemoryLocalStorage {
    private readonly store = new Map<string, string>();
    getItem(key: string): string | null {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
      this.store.set(key, String(value));
    }
    removeItem(key: string): void {
      this.store.delete(key);
    }
    clear(): void {
      this.store.clear();
    }
  }

  beforeEach(() => {
    (globalThis as any).localStorage = new InMemoryLocalStorage();
  });

  test("creates and persists a new client", () => {
    expect((globalThis as any).localStorage.getItem("client_id")).toBeNull();

    const id = getClientID("testGameID");

    expect(typeof id).toBe("string");
    expect(id).toMatch(/^[0-9a-zA-Z]{8}$/);

    const stored = (globalThis as any).localStorage.getItem("client_id");
    expect(stored).toBe(id);
  });

  test("creates two games and make sure only last one is updated", () => {
    const id1 = getClientID("testGameID1");
    const id2 = getClientID("testGameID2");

    expect(id1).not.toBe(id2);

    const stored = (globalThis as any).localStorage.getItem("client_id");
    expect(stored).toBe(id2);
  });

  test("creates two games with same game id, make sure the id stays the same", () => {
    const id1 = getClientID("testGameID1");
    const id2 = getClientID("testGameID1");

    expect(id1).toBe(id2);

    const stored = (globalThis as any).localStorage.getItem("client_id");
    expect(stored).toBe(id1);
  });
});
