export const NAME_LAYER_ICON_GAP = 4;
export const NAME_LAYER_MAX_ZOOM_SCALE = 17;
export const NAME_LAYER_TROOP_MARGIN_RATIO = -0.05;

export interface NameLayerVisibilityInput {
  isLayerVisible: boolean;
  transformScale: number;
  baseSize: number;
  isOnScreen: boolean;
}

export interface NameLayerLayoutInput {
  fontSize: number;
  iconSize: number;
  iconCount: number;
  centeredIconCount: number;
  hasFlag: boolean;
  flagAspectRatio: number;
  nameWidth: number;
  troopWidth: number;
}

export interface NameLayerLayout {
  flag: { x: number; y: number; width: number; height: number } | null;
  nameText: { x: number; y: number };
  troopText: { x: number; y: number };
  iconPositions: { x: number; y: number }[];
  centeredIconPositions: { x: number; y: number }[];
  height: number;
  width: number;
  rows: { iconsY: number | null; nameY: number; troopsY: number };
}

const SUPPORTED_TEXT_CHARS = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_ üÜ.[]+-=(),':!?/@#$%&\"".split(
    "",
  ),
);

const warnedUnsupportedGlyphs = new Set<string>();

export function computeNameLayerVisible({
  isLayerVisible,
  transformScale,
  baseSize,
  isOnScreen,
}: NameLayerVisibilityInput): boolean {
  const size = transformScale * baseSize;
  return (
    isLayerVisible &&
    size >= 7 &&
    !(transformScale > NAME_LAYER_MAX_ZOOM_SCALE && size > 100) &&
    isOnScreen
  );
}

export function computeNameLayerScale(baseSize: number): number {
  return Math.min(baseSize * 0.25, 3);
}

export function computeNameLayerFontSize(baseSize: number): number {
  return Math.max(4, Math.floor(baseSize * 0.4));
}

export function computeNameLayerLayout({
  fontSize,
  iconSize,
  iconCount,
  centeredIconCount,
  hasFlag,
  flagAspectRatio,
  nameWidth,
  troopWidth,
}: NameLayerLayoutInput): NameLayerLayout {
  const visibleIconCount = Math.max(0, iconCount);
  const iconRowHeight = visibleIconCount > 0 ? iconSize : 0;
  const iconRowWidth =
    visibleIconCount > 0
      ? visibleIconCount * iconSize +
        (visibleIconCount - 1) * NAME_LAYER_ICON_GAP
      : 0;
  const flagHeight = hasFlag ? fontSize : 0;
  const flagWidth = hasFlag ? Math.max(0, flagHeight * flagAspectRatio) : 0;
  const nameRowHeight = fontSize;
  const troopMargin = fontSize * NAME_LAYER_TROOP_MARGIN_RATIO;
  const troopHeight = fontSize;
  const nameRowWidth = flagWidth + nameWidth;
  const totalHeight = iconRowHeight + nameRowHeight + troopMargin + troopHeight;
  const width = Math.max(iconRowWidth, nameRowWidth, troopWidth);

  let cursorY = -totalHeight / 2;
  const iconsY = visibleIconCount > 0 ? cursorY + iconRowHeight / 2 : null;
  cursorY += iconRowHeight;
  const nameY = cursorY + nameRowHeight / 2;
  cursorY += nameRowHeight + troopMargin;
  const troopsY = cursorY + troopHeight / 2;

  const iconPositions: { x: number; y: number }[] = [];
  if (visibleIconCount > 0 && iconsY !== null) {
    const startX = -iconRowWidth / 2 + iconSize / 2;
    for (let i = 0; i < visibleIconCount; i++) {
      iconPositions.push({
        x: startX + i * (iconSize + NAME_LAYER_ICON_GAP),
        y: iconsY,
      });
    }
  }

  const nameStartX = -nameRowWidth / 2;
  const flag = hasFlag
    ? {
        x: nameStartX + flagWidth / 2,
        y: nameY,
        width: flagWidth,
        height: flagHeight,
      }
    : null;
  const nameTextX = nameStartX + flagWidth + nameWidth / 2;
  const centeredIconPositions = Array.from(
    { length: centeredIconCount },
    () => ({
      x: 0,
      y: nameY,
    }),
  );

  return {
    flag,
    nameText: { x: nameTextX, y: nameY },
    troopText: { x: 0, y: troopsY },
    iconPositions,
    centeredIconPositions,
    height: totalHeight,
    width,
    rows: { iconsY, nameY, troopsY },
  };
}

export function computeTraitorFlashDurationSeconds(
  remainingTicks: number,
): number | null {
  const remainingSeconds = Math.round((remainingTicks / 10) * 2) / 2;
  if (remainingSeconds > 15) {
    return null;
  }

  const clampedSeconds = Math.max(0, Math.min(15, remainingSeconds));
  const normalizedTime = clampedSeconds / 15;
  const easedProgress = 1 - Math.pow(1 - normalizedTime, 3);
  return 0.2 + (1.0 - 0.2) * easedProgress;
}

export function computeTraitorFlashAlpha(
  remainingTicks: number,
  nowMs: number,
): number {
  const duration = computeTraitorFlashDurationSeconds(remainingTicks);
  if (duration === null) {
    return 1;
  }

  const durationMs = Math.max(1, duration * 1000);
  const phase = (nowMs % durationMs) / durationMs;
  const wave = phase < 0.5 ? phase / 0.5 : (1 - phase) / 0.5;
  const eased = 0.5 - Math.cos(wave * Math.PI) / 2;
  return 1 - eased * 0.7;
}

export function replaceUnsupportedNameGlyphs(
  value: string,
  warn: (message: string) => void = console.warn,
): string {
  let changed = false;
  let result = "";

  for (const char of value) {
    if (SUPPORTED_TEXT_CHARS.has(char)) {
      result += char;
      continue;
    }

    changed = true;
    result += "?";
    if (!warnedUnsupportedGlyphs.has(char)) {
      warnedUnsupportedGlyphs.add(char);
      warn(`NameLayer unsupported glyph replaced with ?: ${char}`);
    }
  }

  return changed ? result : value;
}

export function resetNameLayerGlyphWarningsForTests(): void {
  warnedUnsupportedGlyphs.clear();
}
