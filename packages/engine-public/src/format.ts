// Framework-agnostic display formatting helpers shared by the engine and
// client. No engine/client dependencies — safe for either side to import.

export function renderTroops(troops: number): string {
  return renderNumber(troops / 10);
}

export function renderNumber(
  num: number | bigint,
  fixedPoints?: number,
): string {
  num = Number(num);
  num = Math.max(num, 0);

  if (num >= 10_000_000) {
    const value = Math.floor(num / 100000) / 10;
    return value.toFixed(fixedPoints ?? 1) + "M";
  } else if (num >= 1_000_000) {
    const value = Math.floor(num / 10000) / 100;
    return value.toFixed(fixedPoints ?? 2) + "M";
  } else if (num >= 100000) {
    return Math.floor(num / 1000) + "K";
  } else if (num >= 10000) {
    const value = Math.floor(num / 100) / 10;
    return value.toFixed(fixedPoints ?? 1) + "K";
  } else if (num >= 1000) {
    const value = Math.floor(num / 10) / 100;
    return value.toFixed(fixedPoints ?? 2) + "K";
  } else {
    return Math.floor(num).toString();
  }
}
