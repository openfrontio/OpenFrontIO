import LocalStorage from "../../src/core/Storage";

export class MockMemoryStorage implements LocalStorage {
  private store = {};

  getItem(key: string): string | null {
    const value = this.store[key];
    return value !== undefined ? value : null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}
