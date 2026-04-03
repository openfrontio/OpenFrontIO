import { quickChatPhrases } from "./ChatModal";

export type PresetSlotType = "quickchat" | "emoji" | "trade";

export interface PresetSlot {
  type: PresetSlotType;
  // quickchat only
  category?: string;
  key?: string;
}

export const DEFAULT_PRESETS: PresetSlot[] = [
  { type: "quickchat", category: "help", key: "troops" },
  { type: "emoji" },
  { type: "quickchat", category: "attack", key: "attack" },
];

const STORAGE_KEY = "quickchat.presets.v4";
const MIN_SLOTS = 1;
const MAX_SLOTS = 5;

/** Singleton service that persists and retrieves quick-chat preset configuration from localStorage. */
export class QuickChatPresetService {
  private static instance: QuickChatPresetService;

  /** Returns the singleton instance, creating it on first call. */
  static getInstance(): QuickChatPresetService {
    if (!QuickChatPresetService.instance) {
      QuickChatPresetService.instance = new QuickChatPresetService();
    }
    return QuickChatPresetService.instance;
  }

  /** Returns saved presets from localStorage, falling back to DEFAULT_PRESETS if missing or invalid. */
  load(): PresetSlot[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [...DEFAULT_PRESETS];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0)
        return [...DEFAULT_PRESETS];
      const valid = (parsed.slice(0, MAX_SLOTS) as PresetSlot[]).filter((s) =>
        this.isValidSlot(s),
      );
      return valid.length > 0 ? valid : [...DEFAULT_PRESETS];
    } catch {
      return [...DEFAULT_PRESETS];
    }
  }

  /** Persists the given preset slots to localStorage. Throws if count is out of range. */
  save(slots: PresetSlot[]): void {
    if (slots.length < MIN_SLOTS || slots.length > MAX_SLOTS) {
      throw new Error(
        `Preset count must be between ${MIN_SLOTS} and ${MAX_SLOTS}`,
      );
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  }

  /** Returns true if the slot has a valid type and all required fields for that type. */
  isValidSlot(slot: PresetSlot): boolean {
    if (!slot?.type) return false;
    if (slot.type === "quickchat") {
      if (!slot.category || !slot.key) return false;
      return !!quickChatPhrases[slot.category]?.some((p) => p.key === slot.key);
    }
    // emoji and trade are always valid
    return slot.type === "emoji" || slot.type === "trade";
  }
}
