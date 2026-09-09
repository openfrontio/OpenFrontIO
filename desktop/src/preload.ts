// Preload bridge exposing the openfrontDesktop global the game client expects
// (see src/client/DesktopShell.ts). Its mere presence makes isDesktopShell()
// true, which disables ads and Turnstile init. We implement only the cosmetic
// version call and the update bridge as "always current" — there is no update
// server offline, so the client must never gate multiplayer on it (solo is
// never gated anyway).

import { contextBridge } from "electron";

const SHELL_VERSION = "0.1.0-offline";

contextBridge.exposeInMainWorld("openfrontDesktop", {
  version: (): Promise<string> => Promise.resolve(SHELL_VERSION),
  update: {
    subscribe: (cb: (state: unknown) => void): (() => void) => {
      // Report "current" immediately: nothing to download offline.
      cb({ status: "current", bytes: 0, total: 0 });
      return () => {};
    },
    apply: (): Promise<void> => Promise.resolve(),
    retry: (): Promise<void> => Promise.resolve(),
    setInGame: (_inGame: boolean): Promise<void> => Promise.resolve(),
  },
  isOfflineShell: true,
  steam: null,
});
