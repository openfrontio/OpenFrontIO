import {
  Difficulty,
  GameMapSize,
  GameMode,
  GameType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { html, type TemplateResult } from "lit";
import { formatGameType as formatGameTypeBase } from "../components/baseComponents/stats/GameTypeLabels";
import { renderDuration, translateText } from "../Utils";

// The homepage lobby card's modifier pill, one size down: a lobby can run a
// dozen settings and they all have to fit beside the preview.
export const LOBBY_SETTING_TAG =
  "rounded bg-malibu-blue px-1.5 py-0.5 text-[11px] font-bold tracking-widest text-white";

export const FLAT_SETTING_TAG =
  "rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/70";

export const MODE_BADGE_CLASS =
  "border-[#38bdf8]/25 bg-[#38bdf8]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#38bdf8]";
export const VISIBILITY_BADGE_CLASS =
  "border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/45";

/** Formats a game's visibility label (e.g. Public, Private, Hosted, Singleplayer). */
export function formatGameVisibility(
  gameType?: GameType,
  visibleAt?: number,
): string {
  switch (gameType) {
    case GameType.Public:
      return translateText("account_modal.games_type_public");
    case GameType.Private:
      return visibleAt !== undefined
        ? translateText("detailed_view.source_hosted")
        : translateText("account_modal.games_type_private");
    case GameType.Singleplayer:
      return translateText("account_modal.games_type_singleplayer");
    default:
      return translateText("game_info_modal.unknown_game_type");
  }
}

/** Formats a game mode label from a GameConfig. */
export function formatGameType(game: GameConfig): string {
  return formatGameTypeBase({
    mode: game.gameMode,
    playerTeams:
      game.playerTeams !== undefined && game.playerTeams !== null
        ? String(game.playerTeams)
        : undefined,
    rankedType: game.rankedType,
  });
}

export const DISABLED_UNIT_KEYS: Record<string, string> = {
  City: "unit_type.city",
  Port: "unit_type.port",
  "Defense Post": "unit_type.defense_post",
  "SAM Launcher": "unit_type.sam_launcher",
  "Missile Silo": "unit_type.missile_silo",
  Warship: "unit_type.warship",
  Factory: "unit_type.factory",
  "Atom Bomb": "unit_type.atom_bomb",
  "Hydrogen Bomb": "unit_type.hydrogen_bomb",
  MIRV: "unit_type.mirv",
  "Trade Ship": "player_stats_table.unit.trade",
  Transport: "player_stats_table.unit.trans",
  "MIRV Warhead": "player_stats_table.unit.mirvw",
};

const millions = (gold: number) =>
  `${parseFloat((gold / 1_000_000).toPrecision(12))}M`;

// Non-default settings worth surfacing, shared by the join modal (post-join
// config view and open-lobby rows), the in-game menu and the custom-lobby
// info tooltip on lobby cards. Pass null nationCount to skip the
// numeric-nations default comparison (it needs the map's nation list).
export function notableLobbySettings(
  c: GameConfig,
  nationCount: number | null,
): { label: string; value: string }[] {
  const isTeam = c.gameMode === GameMode.Team;
  const enabled = translateText("common.enabled");
  const disabled = translateText("common.disabled");
  const pm = c.publicGameModifiers;
  const items: { label: string; value: string }[] = [];
  if (pm?.isCrowded)
    items.push({
      label: translateText("host_modal.crowded"),
      value: enabled,
    });
  if (
    c.nations !== "disabled" &&
    (pm?.isHardNations ||
      (c.gameType === GameType.Private && c.difficulty !== Difficulty.Easy))
  )
    items.push({
      label: translateText("difficulty.difficulty"),
      value: translateText(`difficulty.${c.difficulty.toLowerCase()}`),
    });
  if (c.infiniteTroops)
    items.push({
      label: translateText("game_settings.infinite_troops"),
      value: enabled,
    });
  if (c.infiniteGold)
    items.push({
      label: translateText("game_settings.infinite_gold"),
      value: enabled,
    });
  if (c.instantBuild)
    items.push({
      label: translateText("game_settings.instant_build"),
      value: enabled,
    });
  if (c.randomSpawn)
    items.push({
      label: translateText("game_settings.random_spawn"),
      value: enabled,
    });
  if (c.maxTimerValue)
    items.push({
      label: translateText("private_lobby.game_length"),
      value: renderDuration(c.maxTimerValue * 60),
    });
  if (c.winThresholdTenths)
    items.push({
      label: translateText("game_settings.win_threshold"),
      value: `${c.winThresholdTenths / 10}%`,
    });
  if (
    c.spawnImmunityDuration &&
    Math.round(c.spawnImmunityDuration / 10) !== 5
  ) {
    items.push({
      label: translateText("private_lobby.pvp_immunity"),
      value: renderDuration(Math.round(c.spawnImmunityDuration / 10)),
    });
  }
  if (c.startingGold)
    items.push({
      label: translateText("private_lobby.starting_gold"),
      value: millions(c.startingGold),
    });
  if (c.goldMultiplier)
    items.push({
      label: translateText("game_settings.gold_multiplier"),
      value: `x${c.goldMultiplier}`,
    });
  if (c.customAllianceDuration === 0 || c.disableAlliances)
    items.push({
      label: translateText("public_game_modifier.disable_alliances_label"),
      value: disabled,
    });
  else if (
    typeof c.customAllianceDuration === "number" &&
    // 5 minutes is the sim fallback (Config.allianceDuration), so an
    // explicit 5 changes nothing worth surfacing.
    c.customAllianceDuration !== 5
  )
    items.push({
      label: translateText("public_game_modifier.disable_alliances_label"),
      value: renderDuration(c.customAllianceDuration * 60),
    });
  if (c.waterNukes)
    items.push({
      label: translateText("game_settings.water_nukes"),
      value: enabled,
    });
  if (c.doomsdayClock?.enabled)
    items.push({
      label: translateText("game_settings.doomsday_clock"),
      value: translateText(
        `doomsday_clock_speed.${c.doomsdayClock.speed ?? "normal"}`,
      ),
    });
  if (c.overtime?.enabled)
    items.push({
      label: translateText("overtime.title"),
      value: renderDuration((c.overtime.startMinutes ?? 30) * 60),
    });
  if (c.anonymizeNames)
    items.push({
      label: translateText("host_modal.anonymous_players"),
      value: enabled,
    });
  if ((isTeam && !c.donateGold) || (!isTeam && c.donateGold))
    items.push({
      label: translateText("host_modal.donate_gold"),
      value: c.donateGold ? enabled : disabled,
    });
  if ((isTeam && !c.donateTroops) || (!isTeam && c.donateTroops))
    items.push({
      label: translateText("host_modal.donate_troops"),
      value: c.donateTroops ? enabled : disabled,
    });
  const isCompact =
    c.gameMapSize === GameMapSize.Compact || c.publicGameModifiers?.isCompact;
  if (isCompact)
    items.push({
      label: translateText("game_settings.compact_map"),
      value: enabled,
    });
  {
    const defaultBots = isCompact ? 100 : 400;
    if (c.bots !== defaultBots)
      items.push({
        label: translateText("game_settings.bots"),
        value: String(c.bots),
      });
  }
  if (nationCount !== null) {
    const defaultNations = isCompact
      ? Math.max(0, Math.floor(nationCount * 0.25))
      : nationCount;
    if (typeof c.nations === "number" && c.nations !== defaultNations)
      items.push({
        label: translateText("game_settings.nations"),
        value: String(c.nations),
      });
  }
  if (c.nations === "disabled" && !(c.gameType === GameType.Public && isTeam))
    items.push({
      label: translateText("game_settings.nations"),
      value: disabled,
    });
  return items;
}

/**
 * One setting as a single tag: a switched-on setting is just its name, any
 * other value follows it ("Bots: 100").
 */
export function lobbySettingTagText(setting: {
  label: string;
  value: string;
}): string {
  // Some labels (e.g. game_settings.bots) already end with ": " or "：".
  const label = setting.label.replace(/[:\uFF1A\s]+$/u, "");
  return setting.value === translateText("common.enabled")
    ? label
    : `${label}: ${setting.value}`;
}

function renderModifierSection(
  isUnits: boolean,
  items: string[],
  className: string,
  flat: boolean,
): TemplateResult {
  const boxCls = flat
    ? className
    : `${className} p-3 rounded-lg border ${
        isUnits
          ? "bg-red-500/10 border-red-500/20"
          : "bg-yellow-500/10 border-yellow-500/20"
      }`.trim();
  const titleCls = flat
    ? `mb-1 text-[10px] ${isUnits ? "text-red-400/80" : "text-yellow-400/80"}`
    : `mb-2 text-xs ${isUnits ? "text-red-400" : "text-yellow-400"}`;
  const pillCls = flat
    ? `rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
        isUnits
          ? "border-red-500/25 bg-red-500/10 text-red-300"
          : "border-yellow-500/25 bg-yellow-500/10 text-yellow-300"
      }`
    : `px-2 py-1 text-xs rounded font-bold border ${
        isUnits
          ? "bg-red-500/20 text-red-200 border-red-500/30"
          : "bg-yellow-500/20 text-yellow-200 border-yellow-500/30"
      }`;
  const inner = html`
    <div class="font-bold uppercase tracking-widest ${titleCls}">
      ${translateText(
        isUnits ? "private_lobby.disabled_units" : "private_lobby.host_cheats",
      )}
    </div>
    <div class="flex flex-wrap ${flat ? "gap-1.5" : "gap-2"}">
      ${items.map((item) => html`<span class=${pillCls}>${item}</span>`)}
    </div>
  `;
  return isUnits
    ? html`<div data-disabled-units class=${boxCls}>${inner}</div>`
    : html`<div data-host-cheats class=${boxCls}>${inner}</div>`;
}

/** The units the lobby turned off; null when none are. */
export function disabledUnitsBox(
  c: GameConfig,
  className = "",
  variant: "boxed" | "flat" = "boxed",
): TemplateResult | null {
  if (!c.disabledUnits?.length) return null;
  const items = c.disabledUnits.map((u) => {
    const key = DISABLED_UNIT_KEYS[u];
    return key ? translateText(key) : u;
  });
  return renderModifierSection(true, items, className, variant === "flat");
}

/** Extracts host cheats as translated display strings. */
export function hostCheatsList(c: GameConfig): string[] {
  const hc = c.hostCheats;
  if (!hc) return [];
  const cheats: string[] = [];
  if (hc.infiniteGold)
    cheats.push(translateText("game_settings.infinite_gold"));
  if (hc.infiniteTroops)
    cheats.push(translateText("game_settings.infinite_troops"));
  if (hc.goldMultiplier)
    cheats.push(
      `${translateText("game_settings.gold_multiplier")}: x${hc.goldMultiplier}`,
    );
  if (hc.startingGold)
    cheats.push(
      `${translateText("private_lobby.starting_gold")}: ${millions(hc.startingGold)}`,
    );
  return cheats;
}

/** The lobby host's cheats; null when there are none. */
export function hostCheatsBox(
  c: GameConfig,
  className = "",
  variant: "boxed" | "flat" = "boxed",
): TemplateResult | null {
  const cheats = hostCheatsList(c);
  if (cheats.length === 0) return null;
  return renderModifierSection(false, cheats, className, variant === "flat");
}
