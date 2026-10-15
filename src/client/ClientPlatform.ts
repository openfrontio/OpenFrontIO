import type { ClientPlatform } from "@openfront/shared/WireSchemas";
import { isDesktopShell } from "./DesktopShell";
import { gamePortal } from "./GamePortal";

// The desktop shell is only distributed through Steam, so the shell itself
// (not a working Steam client, which may be absent) is the signal.
export function clientPlatform(): ClientPlatform {
  if (isDesktopShell()) return "steam";
  if (typeof window !== "undefined") {
    const portal = gamePortal.name();
    if (portal !== null) return portal;
  }
  return "web";
}
