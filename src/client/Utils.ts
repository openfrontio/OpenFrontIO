import IntlMessageFormat from "intl-messageformat";
import enTranslations from "../../resources/lang/en.json";
import { MessageType } from "../core/game/Game";
import { LangSelector } from "./LangSelector";

/**
 * Converts a number of seconds into a compact string such as `5min 30s`.
 * Seconds below one minute are rendered as `Xs`.
 */
export function renderDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  let time = "";
  if (minutes > 0) time += `${minutes}min `;
  time += `${seconds}s`;
  return time.trim();
}

/**
 * Formats troop counts coming from the server (which are stored in tenths) so
 * the UI displays the human friendly value.
 */
export function renderTroops(troops: number): string {
  return renderNumber(troops / 10);
}

/**
 * Produces strings such as `1.5K` or `2M` for large numbers while keeping
 * smaller values unchanged. Optional precision can be provided with
 * `fixedPoints`.
 */
export function renderNumber(
  num: number | bigint,
  fixedPoints?: number,
): string {
  if (typeof num === "bigint") {
    if (num < 0n) num = 0n;

    if (num >= 10_000_000n) {
      const scaled = Number(num / 100_000n) / 10;
      return scaled.toFixed(fixedPoints ?? 1) + "M";
    }
    if (num >= 1_000_000n) {
      const scaled = Number(num / 10_000n) / 100;
      return scaled.toFixed(fixedPoints ?? 2) + "M";
    }
    if (num >= 100_000n) {
      return `${num / 1_000n}K`;
    }
    if (num >= 10_000n) {
      const scaled = Number(num / 100n) / 10;
      return scaled.toFixed(fixedPoints ?? 1) + "K";
    }
    if (num >= 1_000n) {
      const scaled = Number(num / 10n) / 100;
      return scaled.toFixed(fixedPoints ?? 2) + "K";
    }
    return num.toString();
  }

  num = Math.max(num, 0);

  if (num >= 10_000_000) {
    const value = Math.floor(num / 100000) / 10;
    return value.toFixed(fixedPoints ?? 1) + "M";
  }
  if (num >= 1_000_000) {
    const value = Math.floor(num / 10000) / 100;
    return value.toFixed(fixedPoints ?? 2) + "M";
  }
  if (num >= 100000) {
    return Math.floor(num / 1000) + "K";
  }
  if (num >= 10000) {
    const value = Math.floor(num / 100) / 10;
    return value.toFixed(fixedPoints ?? 1) + "K";
  }
  if (num >= 1000) {
    const value = Math.floor(num / 10) / 100;
    return value.toFixed(fixedPoints ?? 2) + "K";
  }
  return Math.floor(num).toString();
}

/**
 * Creates a canvas element pinned to the viewport that can be used as the
 * primary rendering surface for the game.
 */
export function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  // Set canvas style to fill the screen
  canvas.style.position = "fixed";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";

  const resize = () => {
    if (typeof window === "undefined") {
      if (canvas.width === 0) canvas.width = 1;
      if (canvas.height === 0) canvas.height = 1;
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    const targetWidth = Math.max(1, Math.floor(width * dpr));
    const targetHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== targetWidth) {
      canvas.width = targetWidth;
    }
    if (canvas.height !== targetHeight) {
      canvas.height = targetHeight;
    }
  };

  resize();

  if (typeof window !== "undefined") {
    const listener = () => resize();
    window.addEventListener("resize", listener, { passive: true });
    (canvas as any).__disposeResize__ = () =>
      window.removeEventListener("resize", listener);
  }

  return canvas;
}
/**
 * A polyfill for crypto.randomUUID that provides fallback implementations
 * for older browsers, particularly Safari versions < 15.4
 */
export function generateCryptoRandomUUID(): string {
  const cryptoObj: any =
    typeof globalThis !== "undefined" && (globalThis as any).crypto
      ? (globalThis as any).crypto
      : undefined;

  // Type guard to check if randomUUID is available
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }

  // Fallback using crypto.getRandomValues
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    return (([1e7] as any) + -1e3 + -4e3 + -8e3 + -1e11).replace(
      /[018]/g,
      (c: number): string =>
        (
          c ^
          (cryptoObj.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
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

  // Check if we're in a browser environment
  if (typeof document === "undefined") {
    // Non-browser fallback: Load English translations and resolve the key.
    // Performs simple {param} substitution (does NOT support full ICU features).
    self.enTranslations ??= enTranslations;

    const keys = key.split(".");
    let message: any = self.enTranslations;
    for (const k of keys) {
      if (message && typeof message === "object" && k in message) {
        message = message[k];
      } else {
        message = null;
        break;
      }
    }

    // Fall back to key if not found in translations
    if (typeof message !== "string") {
      message = key;
    }

    // Simple placeholder substitution without RegExp
    for (const [paramKey, paramValue] of Object.entries(params)) {
      const token = `{${paramKey}}`;
      message = message.split(token).join(String(paramValue));
    }
    return message;
  }

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

  const deepGet = (obj: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((acc, segment) => {
      if (acc && typeof acc === "object" && segment in (acc as any)) {
        return (acc as Record<string, unknown>)[segment];
      }
      return undefined;
    }, obj);

  const translations =
    (langSelector.translations as Record<string, unknown>) ?? {};
  const directMessage = translations[key];
  let message: unknown = directMessage;

  if (typeof message !== "string" || message.length === 0) {
    message = deepGet(translations, key);
  }

  if (
    (typeof message !== "string" || message.length === 0) &&
    langSelector.defaultTranslations
  ) {
    const defaults = langSelector.defaultTranslations as
      | Record<string, unknown>
      | undefined;
    const defaultDirect = defaults ? defaults[key] : undefined;
    message = defaultDirect;
    if (typeof message !== "string" || message.length === 0) {
      message = deepGet(defaults, key);
    }
  }

  if (typeof message !== "string" || message.length === 0) {
    return key;
  }

  try {
    const locale =
      typeof directMessage !== "string" && langSelector.currentLang !== "en"
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

/** Mapping from message severity to the Tailwind class we apply in the UI. */
type Severity = "fail" | "warn" | "success" | "info" | "blue" | "white";
export const severityColors: Record<Severity, string> = {
  fail: "text-red-400",
  warn: "text-yellow-400",
  success: "text-green-400",
  info: "text-gray-200",
  blue: "text-blue-400",
  white: "text-white",
};

/**
 * Returns the text color class the UI should use for a given message type.
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

/**
 * Renders the modifier key symbol appropriate for the current platform.
 */
export function getModifierKey(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMac = /Mac/.test(ua);
  if (isMac) {
    return "⌘"; // Command key
  } else {
    return "Ctrl";
  }
}

/**
 * Returns the localized label for the alt/option key depending on platform.
 */
export function getAltKey(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMac = /Mac/.test(ua);
  if (isMac) {
    return "⌥"; // Option key
  } else {
    return "Alt";
  }
}

/**
 * Fetches the stored number of games played, defaulting to zero when storage
 * is unavailable or corrupt.
 */
export function getGamesPlayed(): number {
  try {
    return parseInt(localStorage.getItem("gamesPlayed") ?? "0", 10) || 0;
  } catch (error) {
    console.warn("Failed to read games played from localStorage:", error);
    return 0;
  }
}

/**
 * Increments the games played counter persisted in local storage.
 */
export function incrementGamesPlayed(): void {
  try {
    localStorage.setItem("gamesPlayed", (getGamesPlayed() + 1).toString());
  } catch (error) {
    console.warn("Failed to increment games played in localStorage:", error);
  }
}

/**
 * Detects whether the current window is embedded inside an iframe. In cases
 * where cross-origin access throws, the function safely assumes `true`.
 */
export function isInIframe(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.self !== window.top;
  } catch (e) {
    // If we can't access window.top due to cross-origin restrictions,
    // we're definitely in an iframe
    return true;
  }
}

/**
 * Test helper to clear memoized translation state between Jest runs.
 */
export function __resetTranslationCacheForTesting(): void {
  const self = translateText as any;
  self.enTranslations = undefined;
  self.lastLang = null;
  if (self.formatterCache?.clear) {
    self.formatterCache.clear();
  } else {
    self.formatterCache = new Map();
  }
}
