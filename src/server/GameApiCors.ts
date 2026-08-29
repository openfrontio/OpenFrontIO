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
  return siteHost !== undefined && origin === `https://${siteHost}`;
}

/**
 * Grant the game server's `/api` routes to the desktop app and to the site
 * behind the load balancer.
 *
 * The desktop client's renderer lives on `app://openfront` while the game
 * server is `openfront.io` (or a branch host on dev), so every `/api` call is
 * cross-origin. The web client is cross-origin too when the page came from a
 * load balancer host (`openfront.io`) but the page pins its game server to the
 * deployment that served it (`blue.openfront.io`, see ServerEnv.publicHost).
 * The POSTs send Authorization and Content-Type, which makes them non-simple,
 * so the browser preflights.
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
