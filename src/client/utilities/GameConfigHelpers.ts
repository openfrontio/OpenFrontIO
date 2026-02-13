import { GameMapType, UnitType } from "../../core/game/Game";

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
