import { GameMode } from "../../../../core/game/Game";
import { translateText } from "../../../Utils";

// Shared game-type labelling for the paginated history lists (clan + player).
// Both ClanGame and PublicPlayerGame satisfy this structural shape, so the
// label logic lives in one place and can't drift between the two views.
export type GameTypeFields = {
  mode?: string;
  playerTeams?: string | null;
  rankedType?: string;
};

// FFA is "no team grouping". Match the server's `GameMode.FFA` enum literal
// first, then fall back to an absent `playerTeams` ONLY when `mode` itself is
// missing (older rows / server bug). Crucially we do NOT treat `playerTeams
// === null` as FFA on its own: legacy Team games store `player_teams = NULL`
// (the server buckets those into "team"), so a null-with-a-mode row is still a
// Team game and must not be relabelled FFA.
export function isFfa(game: GameTypeFields): boolean {
  if (game.mode === GameMode.FFA) return true;
  if (
    game.mode === undefined &&
    (game.playerTeams === null || game.playerTeams === undefined)
  ) {
    return true;
  }
  return false;
}

// FFA / Duos / 7 Teams / Humans vs Nations / Ranked 1v1 — derived from the same
// fields the bucket filter uses, so the label always agrees with the active tab.
export function formatGameType(game: GameTypeFields): string {
  if (game.rankedType && game.rankedType !== "unranked") {
    // `rankedType` (e.g. "1v1") is a server-authoritative token interpolated
    // verbatim — there is only one value today and it reads identically in
    // every locale. If more ranked variants appear, map them through keys.
    return translateText("clan_modal.history_type_ranked", {
      ranked: game.rankedType,
    });
  }
  if (isFfa(game)) {
    return translateText("clan_modal.history_type_ffa");
  }
  const pt = game.playerTeams;
  if (pt === "Humans Vs Nations") {
    return translateText("clan_modal.history_type_hvn");
  }
  if (pt === "Duos" || pt === "Trios" || pt === "Quads") {
    return translateText(`clan_modal.history_type_${pt.toLowerCase()}`);
  }
  if (pt && /^\d+$/.test(pt)) {
    return translateText("clan_modal.history_type_n_teams", {
      count: Number(pt),
    });
  }
  return translateText("clan_modal.history_type_team");
}
