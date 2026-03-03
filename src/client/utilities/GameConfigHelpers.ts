import { GameMapType, UnitType } from "../../core/game/Game";
import { GameConfig } from "../../core/Schemas";

/**
 * Maps a slider value (0-400) to the nations config value.
 * 0 → "disabled", value === defaultNationCount → "default", otherwise → number.
 */
export function sliderToNationsConfig(
  sliderValue: number,
  defaultNationCount: number,
): GameConfig["nations"] {
  if (sliderValue === 0) return "disabled";
  if (sliderValue === defaultNationCount) return "default";
  return sliderValue;
}

/**
 * Maps a nations config value to a slider-friendly number.
 * "disabled" → 0, "default" → defaultNationCount, number → number.
 */
export function nationsConfigToSlider(
  nations: GameConfig["nations"],
  defaultNationCount: number,
): number {
  if (nations === "disabled") return 0;
  if (nations === "default") return defaultNationCount;
  return nations;
}

export function toOptionalNumber(
  value: number | string | undefined,
): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

export function preventDisallowedKeys(
  e: KeyboardEvent,
  disallowedKeys: string[],
): void {
  if (disallowedKeys.includes(e.key)) {
    e.preventDefault();
  }
}

export function parseBoundedIntegerFromInput(
  input: HTMLInputElement,
  {
    min,
    max,
    stripPattern = /[eE+-]/g,
    radix = 10,
  }: {
    min: number;
    max: number;
    stripPattern?: RegExp;
    radix?: number;
  },
): number | undefined {
  input.value = input.value.replace(stripPattern, "");
  const value = parseInt(input.value, radix);

  if (isNaN(value) || value < min || value > max) {
    return undefined;
  }

  return value;
}

export function parseBoundedFloatFromInput(
  input: HTMLInputElement,
  { min, max }: { min: number; max: number },
): number | undefined {
  const value = parseFloat(input.value);

  if (isNaN(value) || value < min || value > max) {
    return undefined;
  }

  return value;
}

export function getBotsForCompactMap(
  bots: number,
  compactMapEnabled: boolean,
): number {
  if (compactMapEnabled && bots === 400) {
    return 100;
  }

  if (!compactMapEnabled && bots === 100) {
    return 400;
  }

  return bots;
}

export function getNationsForCompactMap(
  nations: number,
  defaultNationCount: number,
  compactMapEnabled: boolean,
): number {
  const compactCount = Math.max(0, Math.floor(defaultNationCount * 0.25));
  if (compactMapEnabled) {
    // Only reduce if at the full default
    if (nations === defaultNationCount) {
      return compactCount;
    }
    return nations;
  }
  // Restoring from compact: if at the compact default, go back to full default
  if (nations === compactCount) {
    return defaultNationCount;
  }
  return nations;
}

export function getRandomMapType(): GameMapType {
  const maps = Object.values(GameMapType);
  const randIdx = Math.floor(Math.random() * maps.length);
  return maps[randIdx] as GameMapType;
}

export function getUpdatedDisabledUnits(
  disabledUnits: UnitType[],
  unit: UnitType,
  checked: boolean,
): UnitType[] {
  return checked
    ? [...disabledUnits, unit]
    : disabledUnits.filter((u) => u !== unit);
}
