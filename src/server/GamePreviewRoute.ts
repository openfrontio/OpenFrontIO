import type { Express, Request } from "express";
import fsPromises from "fs/promises";
import { parse } from "node-html-parser";
import path from "path";
import type { Logger } from "winston";
import { z } from "zod";
import type { ServerConfig } from "../core/configuration/Config";
import { GAME_ID_REGEX, GameInfo } from "../core/Schemas";
import { replacer } from "../core/Util";
import type { GameManager } from "./GameManager";
import {
  buildPreview,
  escapeHtml,
  ExternalGameInfo,
  ExternalGameInfoSchema,
} from "./GamePreviewBuilder";
import { renderHtmlContent, setHtmlNoCacheHeaders } from "./RenderHtml";

const requestOrigin = (req: Request, config: ServerConfig): string => {
  const protoHeader = (req.headers["x-forwarded-proto"] as string) ?? "";
  const proto = protoHeader.split(",")[0]?.trim() || req.protocol || "https";
  const host = req.get("host") ?? `${config.subdomain()}.${config.domain()}`;

  // Force https only for the configured public domain (and its subdomains).
  // This avoids hardcoding hostnames while ensuring we don't force https on
  // localhost or arbitrary custom hosts.
  const hostname = host.split(":")[0].toLowerCase();
  const domain = config.domain().toLowerCase();
  const forceHttps = hostname === domain || hostname.endsWith(`.${domain}`);

  return `${forceHttps ? "https" : proto}://${host}`;
};

export function registerGamePreviewRoute(opts: {
  app: Express;
  gm: GameManager;
  config: ServerConfig;
  workerId: number;
  log: Logger;
  baseDir: string;
}) {
  const { app, gm, config, log, baseDir } = opts;

  const gameIDSchema = z.string().regex(GAME_ID_REGEX);

  const fetchPublicGameInfo = async (
    gameID: string,
  ): Promise<ExternalGameInfo | null> => {
    if (!gameIDSchema.safeParse(gameID).success) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const apiDomain = config.jwtIssuer();
      const encodedID = encodeURIComponent(gameID);
      const response = await fetch(`${apiDomain}/game/${encodedID}`, {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json();
      const parsed = ExternalGameInfoSchema.safeParse(data);
      if (!parsed.success) {
        log.warn("Invalid ExternalGameInfo from API", {
          gameID,
          issues: parsed.error.issues,
        });
        return null;
      }
      return parsed.data;
    } catch (error) {
      log.warn("failed to fetch public game info", { gameID, error });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };

  app.get("/game/:id", async (req, res) => {
    const gameID = req.params.id;

    // Validate gameID format
    if (!GAME_ID_REGEX.test(gameID)) {
      return res.status(400).json({ error: "Invalid game ID format" });
    }

    const game = gm.game(gameID);

    const lobby: GameInfo | null = game ? game.gameInfo() : null;

    try {
      const publicInfo = await fetchPublicGameInfo(gameID); // Fetch from central API (DB/Auth)

      // If we have neither live lobby info nor archived public info, we can't show anything
      if (!lobby && !publicInfo) {
        return res.redirect(302, "/");
      }

      const origin = requestOrigin(req, config);
      const meta = buildPreview(
        gameID,
        origin,
        config.workerPath(gameID),
        lobby,
        publicInfo,
        config,
      );

      // Always serve HTML with meta tags for /game/:id route
      const staticHtml = path.join(baseDir, "../../static/index.html");
      const rootHtml = path.join(baseDir, "../../index.html");
      let filePath: string | null = null;

      try {
        await fsPromises.access(staticHtml);
        filePath = staticHtml;
      } catch {
        try {
          await fsPromises.access(rootHtml);
          filePath = rootHtml;
        } catch {
          // Neither file exists
        }
      }

      if (filePath) {
        const html = await renderHtmlContent(filePath);
        const root = parse(html);
        const head = root.querySelector("head");
        if (head) {
          head
            .querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')
            .forEach((el) => el.remove());

          const tagsToInject = [
            `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
            `<meta property="og:description" content="${escapeHtml(meta.description || meta.title)}" />`,
            `<meta property="og:url" content="${escapeHtml(meta.joinUrl)}" />`,
            `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
            `<meta name="twitter:card" content="summary_large_image" />`,
            `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
            `<meta name="twitter:description" content="${escapeHtml(meta.description || meta.title)}" />`,
            `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`,
          ];

          tagsToInject.forEach((tag) =>
            head.insertAdjacentHTML("beforeend", tag),
          );
        }

        setHtmlNoCacheHeaders(res);
        return res.status(200).send(root.toString());
      }

      // Fallback to JSON if HTML file not found
      res.setHeader("Content-Type", "application/json");
      return res.send(JSON.stringify(lobby ?? publicInfo, replacer));
    } catch (error) {
      log.error("failed to render join preview", { error });
      return res.status(500).send("Unable to render lobby preview");
    }
  });
}
