import type {
  ClientDevice,
  ClientPlatform,
} from "@openfront/shared/WireSchemas";
import { isDesktopShell } from "./DesktopShell";
import { gamePortal } from "./GamePortal";
import { Platform } from "./Platform";

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

// OS-based, not width- or pointer-based: a narrow desktop window or a touch
// laptop is still a desktop, and the question the metric answers is which
// kind of hardware the player is on.
export function clientDevice(): ClientDevice {
  return Platform.isIOS || Platform.isAndroid ? "mobile" : "desktop";
}
