import LocalStorage from "../core/Storage";

class BrowserStorage implements LocalStorage {
  private storage: Storage;

  constructor(storage?: Storage) {
    this.storage = storage ? storage : window.localStorage;
  }

  getItem(key: string) {
    return this.storage.getItem(key);
  }

  setItem(key: string, value: string) {
    this.storage.setItem(key, value);
  }

  removeItem(key: string) {
    this.storage.removeItem(key);
  }

  clear() {
    this.storage.clear();
  }
}

export default BrowserStorage;
