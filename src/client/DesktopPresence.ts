// Thin renderer wrapper over the desktop shell's presence bridge. Mirrors
// SteamSDK.ts; all Steam-specific work lives in the Electron main process.
//
// This module deliberately knows NOTHING about Steam. It reports game state;
// the shell decides what Steam and Discord make of it.

export type PresenceState = "menu" | "lobby" | "game" | "spectating";

export interface PresencePayload {
  state: PresenceState;
  gameType?: string;
  gameMode?: string;
  map?: string;
  playerCount?: number;
  maxPlayers?: number;
  lobbyId?: string;
  teamId?: string;
  teamSize?: number;
}

interface PresenceBridge {
  presence?: { set(payload: PresencePayload | null): Promise<void> };
  invite?: {
    consumePending(): Promise<string | null>;
    subscribe(cb: (gameId: string) => void): () => void;
    openInviteDialog(): Promise<boolean>;
  };
  shell?: { api?: number };
}

// window.openfrontDesktop is declared `unknown` by DesktopShell.ts (kept loose
// there on purpose). We know the shape the Electron preload exposes, so narrow
// it locally rather than re-declaring the global (a second `declare global`
// with a different type triggers TS2717).
function bridge(): PresenceBridge | undefined {
  return window.openfrontDesktop as PresenceBridge | undefined;
}

class DesktopPresence {
  // shell.api >= 2 is the capability signal for these namespaces, and every
  // method below gates on it rather than relying on optional chaining alone.
  // Optional chaining would be enough today -- presence/invite and api: 2
  // shipped in the same shell commit, so no released shell has one without
  // the other -- but it makes the client's contract "call whatever happens to
  // be present" instead of "call what the shell declares it supports". A shell
  // that ever exposed half the surface without bumping api would be silently
  // half-driven; this refuses it instead.
  isAvailable(): boolean {
    const api = bridge()?.shell?.api;
    return typeof api === "number" && api >= 2;
  }

  set(payload: PresencePayload | null): void {
    if (!this.isAvailable()) return;
    try {
      void bridge()
        ?.presence?.set(payload)
        ?.catch(() => undefined);
    } catch {
      // A bridge that throws synchronously must not take the game down --
      // presence is cosmetic.
    }
  }

  async consumePendingInvite(): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      return (await bridge()?.invite?.consumePending()) ?? null;
    } catch {
      return null;
    }
  }

  subscribeInvites(cb: (gameId: string) => void): () => void {
    if (!this.isAvailable()) return () => undefined;
    try {
      return bridge()?.invite?.subscribe(cb) ?? (() => undefined);
    } catch {
      // A bridge that throws synchronously must not abort the caller's
      // initialisation. Invites are cosmetic; whatever the caller wires up
      // after this call may not be.
      return () => undefined;
    }
  }

  async openInviteDialog(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      return (await bridge()?.invite?.openInviteDialog()) ?? false;
    } catch {
      return false;
    }
  }
}

export const desktopPresence = new DesktopPresence();
