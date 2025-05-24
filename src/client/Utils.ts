import { LangSelector } from "./LangSelector";

export function renderTroops(troops: number): string {
  return renderNumber(troops / 10);
}

export function renderNumber(num: number): string {
  num = Math.max(num, 0);

  if (num >= 10_000_000) {
    const value = Math.floor(num / 100000) / 10;
    return value.toFixed(1) + "M";
  } else if (num >= 1_000_000) {
    const value = Math.floor(num / 10000) / 100;
    return value.toFixed(2) + "M";
  } else if (num >= 100000) {
    return Math.floor(num / 1000) + "K";
  } else if (num >= 10000) {
    const value = Math.floor(num / 100) / 10;
    return value.toFixed(1) + "K";
  } else if (num >= 1000) {
    const value = Math.floor(num / 10) / 100;
    return value.toFixed(2) + "K";
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

// Re-export translateText from LangSelector
export const translateText = (
  key: string,
  params: Record<string, string | number> = {},
): string => {
  const langSelector = document.querySelector("lang-selector") as LangSelector;
  if (!langSelector) {
    console.warn("LangSelector not found in DOM");
    return key;
  }

  // Wait for translations to be loaded
  if (
    !langSelector.translations ||
    Object.keys(langSelector.translations).length === 0
  ) {
    return key;
  }

  return langSelector.translateText(key, params);
};

export type RoleStyle = {
  label: string;
  flagWrapper: string;
  nameText: string;
  roleText: string;
  badgeBg: string;
  priority: number;
};

export const roleStyles = {
  cre: {
    label: "Creator",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-yellow-200 via-yellow-300 to-yellow-200 animate-shimmer",
    nameText: "text-2xl font-bold text-yellow-200 drop-shadow",
    roleText: "text-yellow-200 font-semibold",
    badgeBg: "bg-yellow-100/20 border-yellow-200/30",
    priority: 1,
  },
  adm: {
    label: "Admin",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-red-500 via-red-600 to-red-500 animate-shimmer",
    nameText: "text-2xl font-bold text-red-400 drop-shadow",
    roleText: "text-red-300 font-semibold",
    badgeBg: "bg-red-500/20 border-red-400/30",
    priority: 2,
  },
  ass: {
    label: "Admin Assistant",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-orange-200 via-orange-300 to-orange-200 animate-shimmer",
    nameText: "text-2xl font-bold text-orange-300 drop-shadow",
    roleText: "text-orange-300 font-semibold",
    badgeBg: "bg-orange-200/20 border-orange-300/30",
    priority: 3,
  },
  mod: {
    label: "Mod",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-orange-400 via-orange-500 to-orange-400 animate-shimmer",
    nameText: "text-2xl font-bold text-orange-300 drop-shadow",
    roleText: "text-orange-300 font-semibold",
    badgeBg: "bg-orange-400/20 border-orange-300/30",
    priority: 4,
  },
  sta: {
    label: "Support Staff",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-yellow-300 via-yellow-400 to-yellow-300 animate-shimmer",
    nameText: "text-2xl font-bold text-yellow-300 drop-shadow",
    roleText: "text-yellow-300 font-semibold",
    badgeBg: "bg-yellow-300/20 border-yellow-300/30",
    priority: 5,
  },
  rst: {
    label: "Retired Staff",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-[#5964f2] to-[#4451d1] animate-shimmer",
    nameText: "text-2xl font-bold text-[#b3c2ff] drop-shadow",
    roleText: "text-[#b3c2ff] font-semibold",
    badgeBg: "bg-[#5964f2]/20 border-[#5964f2]/30",
    priority: 6,
  },
  cho: {
    label: "Chocolate!",
    flagWrapper: "choco-flag-wrapper",
    nameText: "choco-name-text",
    roleText: "choco-role-text",
    badgeBg: "choco-badge-bg",
    priority: 7,
  },
  act: {
    label: "Active Contributor",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-green-500 to-green-700 animate-shimmer",
    nameText: "text-2xl font-bold text-green-300 drop-shadow",
    roleText: "text-green-300 font-semibold",
    badgeBg: "bg-green-500/20 border-green-400/30",
    priority: 8,
  },
  cor: {
    label: "Core Contributor",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-green-600 to-green-900 animate-shimmer",
    nameText: "text-2xl font-bold text-green-200 drop-shadow",
    roleText: "text-green-200 font-semibold",
    badgeBg: "bg-green-700/20 border-green-400/30",
    priority: 9,
  },
  ctr: {
    label: "Contributor",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-green-400 to-green-600 animate-shimmer",
    nameText: "text-2xl font-bold text-green-300 drop-shadow",
    roleText: "text-green-300 font-semibold",
    badgeBg: "bg-green-500/20 border-green-300/30",
    priority: 10,
  },
  trd: {
    label: "Translator Dev",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-purple-400 to-purple-600 animate-shimmer",
    nameText: "text-2xl font-bold text-purple-300 drop-shadow",
    roleText: "text-purple-300 font-semibold",
    badgeBg: "bg-purple-500/20 border-purple-400/30",
    priority: 11,
  },
  htr: {
    label: "Head Translator",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-teal-400 to-teal-600 animate-shimmer",
    nameText: "text-2xl font-bold text-teal-300 drop-shadow",
    roleText: "text-teal-300 font-semibold",
    badgeBg: "bg-teal-500/20 border-teal-400/30",
    priority: 12,
  },
  tra: {
    label: "Translator",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-blue-400 to-blue-600 animate-shimmer",
    nameText: "text-2xl font-bold text-blue-300 drop-shadow",
    roleText: "text-blue-300 font-semibold",
    badgeBg: "bg-blue-500/20 border-blue-400/30",
    priority: 13,
  },
  ccr: {
    label: "Content Creator",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-orange-500 to-orange-700 animate-shimmer",
    nameText: "text-2xl font-bold text-orange-300 drop-shadow",
    roleText: "text-orange-300 font-semibold",
    badgeBg: "bg-orange-500/20 border-orange-400/30",
    priority: 14,
  },
  bet: {
    label: "Beta Tester",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-teal-500 to-teal-700 animate-shimmer",
    nameText: "text-2xl font-bold text-teal-300 drop-shadow",
    roleText: "text-teal-300 font-semibold",
    badgeBg: "bg-teal-500/20 border-teal-400/30",
    priority: 15,
  },
  dca: {
    label: "Dev Chat Access",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-purple-500 to-purple-700 animate-shimmer",
    nameText: "text-2xl font-bold text-purple-300 drop-shadow",
    roleText: "text-purple-300 font-semibold",
    badgeBg: "bg-purple-500/20 border-purple-400/30",
    priority: 16,
  },
  eas: {
    label: "Early Access Supporter",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-yellow-500 to-yellow-400 animate-shimmer",
    nameText: "text-2xl font-bold text-yellow-400 drop-shadow",
    roleText: "text-yellow-400 font-semibold",
    badgeBg: "bg-yellow-400/20 border-yellow-300/30",
    priority: 17,
  },
  mhr: {
    label: "Money Haters",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-[#a05cca] to-[#8b4fb6] animate-shimmer",
    nameText: "text-2xl font-bold text-[#d1b3f9] drop-shadow",
    roleText: "text-[#d1b3f9] font-semibold",
    badgeBg: "bg-[#a05cca]/20 border-[#a05cca]/30",
    priority: 18,
  },
  bst: {
    label: "Server Booster",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-pink-500 to-pink-700 animate-shimmer",
    nameText: "text-2xl font-bold text-pink-300 drop-shadow",
    roleText: "text-pink-300 font-semibold",
    badgeBg: "bg-pink-500/20 border-pink-400/30",
    priority: 19,
  },
  og0: {
    label: "OG",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-yellow-300 to-yellow-200 animate-shimmer",
    nameText: "text-2xl font-bold text-yellow-300 drop-shadow",
    roleText: "text-yellow-300 font-semibold",
    badgeBg: "bg-yellow-200/20 border-yellow-300/30",
    priority: 20,
  },
  og1: {
    label: "OG100",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-lime-300 to-lime-500 animate-shimmer",
    nameText: "text-2xl font-bold text-lime-300 drop-shadow",
    roleText: "text-lime-300 font-semibold",
    badgeBg: "bg-lime-300/20 border-lime-300/30",
    priority: 21,
  },
  cha: {
    label: "Challenger",
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-blue-500 to-blue-700",
    nameText: "text-2xl font-bold text-blue-300 drop-shadow",
    roleText: "text-blue-300 font-semibold",
    badgeBg: "bg-blue-500/20 border-blue-400/30",
    priority: 22,
  },
  pin: {
    label: "Ping",
    flagWrapper: "p-[3px] rounded-full bg-gray-400",
    nameText: "text-2xl font-bold text-gray-300 drop-shadow",
    roleText: "text-gray-300 font-semibold",
    badgeBg: "bg-gray-400/20 border-gray-300/30",
    priority: 23,
  },
  dsp: {
    label: "Development Stream Ping",
    flagWrapper: "p-[3px] rounded-full bg-blue-400",
    nameText: "text-2xl font-bold text-blue-200 drop-shadow",
    roleText: "text-blue-200 font-semibold",
    badgeBg: "bg-blue-400/20 border-blue-200/30",
    priority: 24,
  },
  bot: {
    label: "Bot",
    flagWrapper: "p-[3px] rounded-full bg-gray-400",
    nameText: "text-2xl font-bold text-gray-300 drop-shadow",
    roleText: "text-gray-300 font-semibold",
    badgeBg: "bg-gray-400/20 border-gray-300/30",
    priority: 25,
  },
  mem: {
    label: "Member",
    flagWrapper: "p-[3px] rounded-full bg-gray-400",
    nameText: "text-2xl font-bold text-gray-300 drop-shadow",
    roleText: "text-gray-300 font-semibold",
    badgeBg: "bg-gray-400/20 border-gray-300/30",
    priority: 26,
  },
} as const satisfies Record<string, RoleStyle>;

export type RankStyle = {
  bg: string;
  bgLight: string;
  border: string;
  text: string;
  flagWrapper: string;
  nameText: string;
  glow?: boolean;
};

export const rankStyles = {
  "New Player": {
    bg: "bg-gray-500/20",
    bgLight: "bg-gray-500/20",
    border: "border-gray-400/30",
    text: "text-gray-300",
    flagWrapper: "p-[3px] rounded-full bg-gray-500",
    nameText: "text-xl font-bold text-gray-300",
  },
  "Logged-in Player": {
    bg: "bg-blue-500/20",
    bgLight: "bg-blue-500/20",
    border: "border-blue-400/30",
    text: "text-blue-300",
    flagWrapper: "p-[3px] rounded-full bg-blue-500",
    nameText: "text-xl font-bold text-blue-300",
  },
  "Seen Player": {
    bg: "bg-green-500/20",
    bgLight: "bg-green-500/20",
    border: "border-green-400/30",
    text: "text-green-300",
    flagWrapper: "p-[3px] rounded-full bg-green-500",
    nameText: "text-xl font-bold text-green-300",
  },
  "Known Player": {
    bg: "bg-yellow-500/20",
    bgLight: "bg-yellow-500/20",
    border: "border-yellow-400/30",
    text: "text-yellow-300",
    flagWrapper: "p-[3px] rounded-full bg-yellow-500",
    nameText: "text-xl font-bold text-yellow-300",
  },
  "Well-Known Player": {
    bg: "bg-orange-500/20",
    bgLight: "bg-orange-500/20",
    border: "border-orange-400/30",
    text: "text-orange-300",
    flagWrapper: "p-[3px] rounded-full bg-orange-500",
    nameText: "text-xl font-bold text-orange-300",
  },
  "Veteran Player": {
    bg: "bg-purple-500/20",
    bgLight: "bg-purple-500/20",
    border: "border-purple-400/30",
    text: "text-purple-300",
    flagWrapper: "p-[3px] rounded-full bg-purple-500",
    nameText: "text-xl font-bold text-purple-300",
  },
  "Best-Known Player": {
    bg: "bg-red-500/20",
    bgLight: "bg-red-500/20",
    border: "border-red-400/30",
    text: "text-red-300",
    glow: true,
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-red-500 via-red-600 to-red-500 animate-shimmer",
    nameText: "text-2xl font-bold text-red-300 drop-shadow",
  },
  "Elite Player": {
    bg: "bg-cyan-500/20",
    bgLight: "bg-cyan-500/20",
    border: "border-cyan-400/30",
    text: "text-cyan-300",
    glow: true,
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-cyan-500 via-cyan-600 to-cyan-500 animate-shimmer",
    nameText: "text-2xl font-bold text-cyan-300 drop-shadow",
  },
  Legend: {
    bg: "bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-400",
    bgLight: "bg-yellow-500/20",
    border: "border-yellow-300",
    text: "text-yellow-200",
    glow: true,
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-400 animate-shimmer",
    nameText: "text-2xl font-bold text-yellow-200 drop-shadow",
  },
  "Mythic Player": {
    bg: "bg-gradient-to-r from-indigo-500 via-pink-500 to-indigo-500",
    bgLight: "bg-indigo-500/20",
    border: "border-pink-300",
    text: "text-pink-200",
    glow: true,
    flagWrapper:
      "p-[3px] rounded-full bg-gradient-to-r from-indigo-500 via-pink-500 to-indigo-500 animate-shimmer",
    nameText: "text-2xl font-bold text-pink-200 drop-shadow",
  },
} as const satisfies Record<string, RankStyle>;

export const achievementsData = [
  {
    id: "builder_1",
    title: "Rookie Builder",
    description: "Build 1 structure in a single game",
    difficulty: "easy",
    secret: false,
  },
  {
    id: "builder_5",
    title: "Apprentice Builder",
    description: "Build 5 structures in a single game",
    difficulty: "easy",
    secret: false,
  },
  {
    id: "builder_10",
    title: "Skilled Builder",
    description: "Build 10 structures in a single game",
    difficulty: "easy",
    secret: false,
  },
  {
    id: "builder_15",
    title: "Advanced Builder",
    description: "Build 15 structures in a single game",
    difficulty: "medium",
    secret: false,
  },
  {
    id: "builder_25",
    title: "Expert Builder",
    description: "Build 25 structures in a single game",
    difficulty: "medium",
    secret: false,
  },
  {
    id: "builder_50",
    title: "Architect",
    description: "Build 50 structures in a single game",
    difficulty: "hard",
    secret: false,
  },
  {
    id: "first_win",
    title: "First Win",
    description: "Win your first public game",
    difficulty: "medium",
    secret: false,
  },
  {
    id: "three_win_streak",
    title: "3 Win Streak",
    description: "Win 3 games in a row",
    difficulty: "medium",
    secret: false,
  },
  {
    id: "nuker_10",
    title: "Strategic Bomber",
    description: "Launch 10 nuclear bombs in total",
    difficulty: "medium",
    secret: false,
  },
  {
    id: "mirv_clutch",
    title: "Final Measure",
    description: "Launch a MIRV in a single game",
    difficulty: "medium",
    secret: false,
  },
  {
    id: "mirv_5x",
    title: "No Measures Left",
    description: "Launch 5 MIRVs in a single game",
    difficulty: "hard",
    secret: false,
  },
  {
    id: "mirv_10x",
    title: "Total Overkill",
    description: "Launch 10 MIRVs in a single game",
    difficulty: "impossible",
    secret: true,
  },
  {
    id: "five_win_streak",
    title: "5 Win Streak",
    description: "Win 5 games in a row",
    difficulty: "hard",
    secret: false,
  },
  {
    id: "chocolate",
    title: "Chocolate!",
    description: "Get chocolate role!",
    difficulty: "impossible",
    secret: true,
  },
  {
    id: "perfect_offense",
    title: "Perfect Offense",
    description:
      "Win a game using 100% Troops and 100% Attack Ratio for the entire match.",
    difficulty: "impossible",
    secret: false,
  },
];
