import type { NextFunction, Request, Response } from "express";
import { ServerEnv } from "./ServerEnv";

/**
 * Origin the desktop app's renderer runs from. It loads from a privileged
 * custom scheme rather than https, so `app://openfront` is a real, fixed
 * origin — see the desktop repo's `src/main/protocol.ts`.
 */
export const DESKTOP_APP_ORIGIN = "app://openfront";

function isAllowedOrigin(origin: string): boolean {
  if (origin === DESKTOP_APP_ORIGIN) return true;
  const siteHost = ServerEnv.siteHost();
  if (siteHost !== undefined && origin === `https://${siteHost}`) return true;
  // Every deployment host in the fleet: a tab pinned to one deployment
  // reaches a game on another cross-origin (per-game routing by id letter,
  // docs/MultiServer.md), so each sibling's origin must be allowed. Own host
  // included — harmless (same-origin requests skip CORS) and keeps the rule
  // uniform.
  // And each member's PAGE host when GAME_DOMAIN splits the two names
  // (`blue.openfront.dev` for game host `blue.server.openfront.dev`): a
  // player who loads a colour's page directly rather than through the apex
  // arrives from that origin, and before the split it was the same name as
  // the game host and so already on this list.
  return Object.values(ServerEnv.cluster()).some((entry) => {
    if (origin === `https://${entry.host}`) return true;
    const pageHost = ServerEnv.pageHostFor(entry.host);
    return pageHost !== undefined && origin === `https://${pageHost}`;
  });
}

/**
 * Grant the game server's `/api` routes to the desktop app and to the page
 * host the players came from.
 *
 * A deployment has two hostnames (docs/MultiServer.md, "Two hostnames per
 * deployment"): the page host players load from — the apex `openfront.io`, or
 * `main.openfront.dev` served by the static Worker where GAME_DOMAIN is set —
 * and the game host this server answers on (`blue.openfront.io`,
 * `main.server.openfront.dev`; see ServerEnv.publicHost). Those are different
 * origins, so every `/api` call the page makes is cross-origin — which is why
 * the page host is allowed here alongside every game host in the fleet. The
 * desktop client's renderer is cross-origin for a different reason: it loads
 * from `app://openfront`. The POSTs send Authorization and Content-Type,
 * which makes them non-simple, so the browser preflights.
 *
 * Deliberately no `Access-Control-Allow-Credentials`: the play token travels
 * in the Authorization header, so nothing here needs cookies, and granting
 * credentials would widen what any future allowlisted origin can reach.
 */
export function applyGameApiCorsHeaders(
  requestOrigin: string | undefined,
  setHeader: (name: string, value: string) => void,
): void {
  // Set unconditionally: the response differs by Origin, so a cache must not
  // serve one origin's response to another.
  setHeader("Vary", "Origin");

  if (requestOrigin === undefined || !isAllowedOrigin(requestOrigin)) {
    return;
  }

  setHeader("Access-Control-Allow-Origin", requestOrigin);
  setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  setHeader("Access-Control-Max-Age", "86400");
}

/**
 * Express middleware form. Answers preflights directly — they carry no body
 * and no route needs to see them.
 *
 * A disallowed origin is still passed through rather than rejected: non-browser
 * callers (the admin bot, curl, server-to-server checks) legitimately send no
 * Origin or another one. We withhold permission and let the browser enforce it,
 * which is the only place the enforcement means anything.
 */
export function gameApiCors(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  applyGameApiCorsHeaders(req.headers.origin, res.setHeader.bind(res));

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}
