import type { Express } from "express";
import path from "path";
import type { Logger } from "winston";
import { renderAppShell } from "./RenderHtml";

/**
 * Serve the app shell at `/player/<publicId>`, the canonical profile link: the
 * client opens that player's profile on load (see playerProfileUrl).
 *
 * In production the site Worker answers these paths, and the master's SPA
 * fallback already answers a bare `/player/<id>` here. This is for the
 * worker-prefixed form (`/w<n>/player/<id>`, routed to a worker by nginx and
 * stripped of its prefix before routing), so a standalone or dev deployment
 * opens a profile link the same way production does. The id isn't checked:
 * the client shows its own not-found state for a player that doesn't exist.
 */
export function registerPlayerProfileRoute(opts: {
  app: Express;
  log: Logger;
  baseDir: string;
}) {
  const { app, log, baseDir } = opts;
  const htmlPath = path.join(baseDir, "../../static/index.html");

  // Express matches a trailing slash too (non-strict routing).
  app.get("/player/:publicId", async (_req, res) => {
    try {
      await renderAppShell(res, htmlPath);
    } catch (error) {
      log.error("failed to render the app shell for a profile link", {
        error,
      });
      res.status(500).send("Internal Server Error");
    }
  });
}
