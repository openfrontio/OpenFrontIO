const TERRITORY_PATTERN_KEY = "territoryPattern";
const TERRITORY_PATTERN_BASE64_KEY = "territoryPatternBase64";

export function getSelectedPattern(): string | undefined {
  return localStorage.getItem(TERRITORY_PATTERN_KEY) ?? undefined;
}

export function setSelectedPattern(patternKey: string): void {
  localStorage.setItem(TERRITORY_PATTERN_KEY, patternKey);
}

export function getSelectedPatternBase64(): string | undefined {
  return localStorage.getItem(TERRITORY_PATTERN_BASE64_KEY) ?? undefined;
}

export function setSelectedPatternBase64(base64: string): void {
  localStorage.setItem(TERRITORY_PATTERN_BASE64_KEY, base64);
}
