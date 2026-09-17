import type { ClientPlatform } from "../core/Schemas";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { isDesktopShell } from "./DesktopShell";

// The desktop shell is only distributed through Steam, so the shell itself
// (not a working Steam client, which may be absent) is the signal.
export function clientPlatform(): ClientPlatform {
  if (isDesktopShell()) return "steam";
  if (typeof window !== "undefined" && crazyGamesSDK.isOnCrazyGames()) {
    return "crazygames";
  }
  return "web";
}
