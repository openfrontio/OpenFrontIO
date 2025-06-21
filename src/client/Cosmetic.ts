export class TerritoryPatternStorage {
  private readonly PATTERN_KEY = "territoryPattern";
  private readonly PATTERN_BASE64_KEY = "territoryPatternBase64";
  private storage: Storage;

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
  }

  getSelectedPattern(): string | undefined {
    return this.storage.getItem(this.PATTERN_KEY) ?? undefined;
  }

  setSelectedPattern(patternKey: string): void {
    this.storage.setItem(this.PATTERN_KEY, patternKey);
  }

  getSelectedPatternBase64(): string | undefined {
    return this.storage.getItem(this.PATTERN_BASE64_KEY) ?? undefined;
  }

  setSelectedPatternBase64(base64: string): void {
    this.storage.setItem(this.PATTERN_BASE64_KEY, base64);
  }
}
