import { renderDuration, translateText } from "../../client/Utils";
import {
  Difficulty,
  GameMapSize,
  GameMode,
  GameType,
} from "../../core/game/Game";
import { GameConfig } from "../../core/Schemas";

// Non-default settings worth surfacing, shared by the join modal (post-join
// config view and open-lobby rows) and the custom-lobby info tooltip on
// lobby cards. Pass null nationCount to skip the numeric-nations
// default comparison (it needs the map manifest, loaded only post-join).
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
    pm?.isHardNations ||
    (c.gameType === GameType.Private && c.difficulty !== Difficulty.Easy)
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
      value: `${parseFloat((c.startingGold / 1_000_000).toPrecision(12))}M`,
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
