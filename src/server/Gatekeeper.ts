import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Logger } from "winston";
import { Client } from "./Client";

// Hooks for an optional security module (see src/server/README.md). The
// module lives in the src/server/gatekeeper submodule; without it, every hook
// is a no-op and the game behaves exactly as it would with no module at all.

export interface IntentObservation {
  client: Client;
  // The intent as received, stamped with the sender's clientID when it got
  // far enough to be stamped.
  intent: unknown;
  intentType: string | null;
  outcome: "accepted" | "rejected";
  // The turn the intent arrived during.
  turn: number;
  reasonCode?: string;
}

// One match's hooks. Calls arrive in game order.
export interface MatchGatekeeper {
  clientJoined(client: Client): void;
  intentObserved(observation: IntentObservation): void;
  turnCommitted(turnNumber: number, intentCount: number): void;
  // Called when the match ends, whether or not it started. GameServer.end()
  // can run more than once; guardGatekeeper passes on only the first call.
  matchEnded(totalTurns: number): void;
}

export interface Gatekeeper {
  matchOpened(match: { gameID: string }): MatchGatekeeper;
}

export const noopMatchGatekeeper: MatchGatekeeper = {
  clientJoined: () => undefined,
  intentObserved: () => undefined,
  turnCommitted: () => undefined,
  matchEnded: () => undefined,
};

export const noopGatekeeper: Gatekeeper = {
  matchOpened: () => noopMatchGatekeeper,
};

// The module must never break a game: a hook that throws is logged and
// treated as a no-op, and matchEnded is delivered at most once.
export function guardGatekeeper(inner: Gatekeeper, log: Logger): Gatekeeper {
  const guard = <A extends unknown[]>(
    name: string,
    fn: (...args: A) => void,
  ) => {
    return (...args: A) => {
      try {
        fn(...args);
      } catch (error) {
        log.error(`gatekeeper ${name} failed`, { error: String(error) });
      }
    };
  };
  return {
    matchOpened: (match) => {
      let hooks: MatchGatekeeper;
      try {
        hooks = inner.matchOpened(match);
      } catch (error) {
        log.error("gatekeeper matchOpened failed", { error: String(error) });
        return noopMatchGatekeeper;
      }
      let ended = false;
      return {
        clientJoined: guard("clientJoined", (c) => hooks.clientJoined(c)),
        intentObserved: guard("intentObserved", (o) => hooks.intentObserved(o)),
        turnCommitted: guard("turnCommitted", (t, n) =>
          hooks.turnCommitted(t, n),
        ),
        matchEnded: guard("matchEnded", (totalTurns) => {
          if (ended) return;
          ended = true;
          hooks.matchEnded(totalTurns);
        }),
      };
    },
  };
}

const MODULE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gatekeeper",
);

// Loads the module's default export, a factory returning a Gatekeeper, when
// the submodule is checked out. A missing submodule is the normal case for
// forks and public CI; a module that is present but fails to load is logged
// as an error. Either way the game falls back to the no-op.
export async function loadGatekeeper(
  log: Logger,
  dir: string = MODULE_DIR,
): Promise<Gatekeeper> {
  const entry = path.join(dir, "index.ts");
  if (!existsSync(entry)) {
    log.info("no gatekeeper module, using no-op");
    return noopGatekeeper;
  }
  try {
    // A computed specifier, so the build doesn't require the file to exist.
    const mod = (await import(pathToFileURL(entry).href)) as {
      default: (log: Logger) => Gatekeeper;
    };
    const gatekeeper = guardGatekeeper(mod.default(log), log);
    log.info("gatekeeper module loaded");
    return gatekeeper;
  } catch (error) {
    log.error("gatekeeper module failed to load, using no-op", {
      error: String(error),
    });
    return noopGatekeeper;
  }
}
