import { RankedType } from "@openfront/engine-api/game/GameTypes";
import type { MatchmakingMode } from "./Matchmaking";

// Kept tiny and free of game-client imports: Main (the homepage chunk) loads
// it statically.

// The queue a `/?requeue=` value reopens: "" (a bare `/?requeue`) = 1v1,
// "2v2" = 2v2, "clanwars" = clan wars. Ranked FFA has no queue any more, so
// "ffa" (a stale link or bookmark) reopens nothing; any other value falls
// back to 1v1.
export function requeueModeFromParam(param: string): MatchmakingMode | null {
  if (param === "ffa") return null;
  return param === "2v2" || param === "clanwars" ? param : "1v1";
}

// The queue the win modal's "play again" reopens for a finished game, or null
// when there is none (an unranked game, or a ranked FFA whose queue is gone).
export function requeueModeForRankedType(
  rankedType: RankedType | undefined,
): MatchmakingMode | null {
  switch (rankedType) {
    case RankedType.OneVOne:
      return "1v1";
    case RankedType.TwoVTwo:
      return "2v2";
    case RankedType.ClanWars:
      return "clanwars";
    default:
      return null;
  }
}

// Reads and strips the `requeue` param from the URL. Returns the mode to
// reopen, or null when the URL has no requeue param or its mode has no queue
// (the param is stripped in the second case too).
export function consumeRequeueUrl(
  location: Pick<Location, "search" | "pathname" | "hash">,
  replaceUrl: (url: string) => void,
): MatchmakingMode | null {
  const searchParams = new URLSearchParams(location.search);
  if (!searchParams.has("requeue")) {
    return null;
  }
  const mode = requeueModeFromParam(searchParams.get("requeue") ?? "");

  searchParams.delete("requeue");
  const newUrl =
    location.pathname +
    (searchParams.toString() ? `?${searchParams.toString()}` : "") +
    location.hash;
  replaceUrl(newUrl);
  return mode;
}
