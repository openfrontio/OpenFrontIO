import IntlMessageFormat from "intl-messageformat";
import { MessageType } from "../core/game/Game";
import { LangSelector } from "./LangSelector";

export function renderDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  let time = "";
  if (minutes > 0) time += `${minutes}min `;
  time += `${seconds}s`;
  return time.trim();
}

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

export function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  // Set canvas style to fill the screen
  canvas.style.position = "fixed";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";

  return canvas;
}
/**
 * A polyfill for crypto.randomUUID that provides fallback implementations
 * for older browsers, particularly Safari versions < 15.4
 */
export function generateCryptoRandomUUID(): string {
  // Type guard to check if randomUUID is available
  if (crypto !== undefined && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  // Fallback using crypto.getRandomValues
  if (crypto !== undefined && "getRandomValues" in crypto) {
    return (([1e7] as any) + -1e3 + -4e3 + -8e3 + -1e11).replace(
      /[018]/g,
      (c: number): string =>
        (
          c ^
          (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
        ).toString(16),
    );
  }

  // Last resort fallback using Math.random
  // Note: This is less cryptographically secure but ensures functionality
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (c: string): string => {
      const r: number = (Math.random() * 16) | 0;
      const v: number = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    },
  );
}

export const translateText = (
  key: string,
  params: Record<string, string | number> = {},
): string => {
  const self = translateText as any;
  self.formatterCache ??= new Map();
  self.lastLang ??= null;

  const langSelector = document.querySelector("lang-selector") as LangSelector;
  if (!langSelector) {
    console.warn("LangSelector not found in DOM");
    return key;
  }

  if (
    !langSelector.translations ||
    Object.keys(langSelector.translations).length === 0
  ) {
    return key;
  }

  if (self.lastLang !== langSelector.currentLang) {
    self.formatterCache.clear();
    self.lastLang = langSelector.currentLang;
  }

  let message = langSelector.translations[key];

  if (!message && langSelector.defaultTranslations) {
    const defaultTranslations = langSelector.defaultTranslations;
    if (defaultTranslations && defaultTranslations[key]) {
      message = defaultTranslations[key];
    }
  }

  if (!message) return key;

  try {
    const locale =
      !langSelector.translations[key] && langSelector.currentLang !== "en"
        ? "en"
        : langSelector.currentLang;
    const cacheKey = `${key}:${locale}:${message}`;
    let formatter = self.formatterCache.get(cacheKey);

    if (!formatter) {
      formatter = new IntlMessageFormat(message, locale);
      self.formatterCache.set(cacheKey, formatter);
    }

    return formatter.format(params) as string;
  } catch (e) {
    console.warn("ICU format error", e);
    return message;
  }
};

/**
 * Severity colors mapping for message types
 */
export const severityColors: Record<string, string> = {
  fail: "text-red-400",
  warn: "text-yellow-400",
  success: "text-green-400",
  info: "text-gray-200",
  blue: "text-blue-400",
  white: "text-white",
};

/**
 * Gets the CSS classes for styling message types based on their severity
 * @param type The message type to get styling for
 * @returns CSS class string for the message type
 */
export function getMessageTypeClasses(type: MessageType): string {
  switch (type) {
    case MessageType.SAM_HIT:
    case MessageType.CAPTURED_ENEMY_UNIT:
    case MessageType.RECEIVED_GOLD_FROM_TRADE:
    case MessageType.CONQUERED_PLAYER:
      return severityColors["success"];
    case MessageType.ATTACK_FAILED:
    case MessageType.ALLIANCE_REJECTED:
    case MessageType.ALLIANCE_BROKEN:
    case MessageType.UNIT_CAPTURED_BY_ENEMY:
    case MessageType.UNIT_DESTROYED:
      return severityColors["fail"];
    case MessageType.ATTACK_CANCELLED:
    case MessageType.ATTACK_REQUEST:
    case MessageType.ALLIANCE_ACCEPTED:
    case MessageType.SENT_GOLD_TO_PLAYER:
    case MessageType.SENT_TROOPS_TO_PLAYER:
    case MessageType.RECEIVED_GOLD_FROM_PLAYER:
    case MessageType.RECEIVED_TROOPS_FROM_PLAYER:
      return severityColors["blue"];
    case MessageType.MIRV_INBOUND:
    case MessageType.NUKE_INBOUND:
    case MessageType.HYDROGEN_BOMB_INBOUND:
    case MessageType.SAM_MISS:
    case MessageType.ALLIANCE_EXPIRED:
    case MessageType.NAVAL_INVASION_INBOUND:
    case MessageType.RENEW_ALLIANCE:
      return severityColors["warn"];
    case MessageType.CHAT:
    case MessageType.ALLIANCE_REQUEST:
      return severityColors["info"];
    default:
      console.warn(`Message type ${type} has no explicit color`);
      return severityColors["white"];
  }
}

export function getModifierKey(): string {
  const isMac = /Mac/.test(navigator.userAgent);
  if (isMac) {
    return "⌘"; // Command key
  } else {
    return "Ctrl";
  }
}

export function getAltKey(): string {
  const isMac = /Mac/.test(navigator.userAgent);
  if (isMac) {
    return "⌥"; // Option key
  } else {
    return "Alt";
  }
}

export function getGamesPlayed(): number {
  try {
    return parseInt(localStorage.getItem("gamesPlayed") ?? "0", 10) || 0;
  } catch (error) {
    console.warn("Failed to read games played from localStorage:", error);
    return 0;
  }
}

export function incrementGamesPlayed(): void {
  try {
    localStorage.setItem("gamesPlayed", (getGamesPlayed() + 1).toString());
  } catch (error) {
    console.warn("Failed to increment games played in localStorage:", error);
  }
}

export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch (e) {
    // If we can't access window.top due to cross-origin restrictions,
    // we're definitely in an iframe
    return true;
  }
}

export async function getSvgAspectRatio(src: string): Promise<number | null> {
  const self = getSvgAspectRatio as any;
  self.svgAspectRatioCache ??= new Map();

  const cached = self.svgAspectRatioCache.get(src);
  if (cached !== undefined) return cached;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(src, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    const text = await resp.text();

    // Try parse viewBox
    const vbMatch = text.match(/viewBox="([^"]+)"/i);
    if (vbMatch) {
      const parts = vbMatch[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
        const [, , vbW, vbH] = parts;
        if (vbW > 0 && vbH > 0) {
          const ratio = vbW / vbH;
          self.svgAspectRatioCache.set(src, ratio);
          return ratio;
        }
      }
    }

    // Fallback to width/height attributes (may be with units; strip px)
    const widthMatch = text.match(/<svg[^>]*\swidth="([^"]+)"/i);
    const heightMatch = text.match(/<svg[^>]*\sheight="([^"]+)"/i);
    if (widthMatch && heightMatch) {
      const parseNum = (s: string) => Number(s.replace(/[^0-9.]/g, ""));
      const w = parseNum(widthMatch[1]);
      const h = parseNum(heightMatch[1]);
      if (w > 0 && h > 0) {
        const ratio = w / h;
        self.svgAspectRatioCache.set(src, ratio);
        return ratio;
      }
    }
    // Not an SVG or no usable metadata
  } catch (e) {
    // fetch may fail due to CORS or non-SVG..
  }

  return null;
}
