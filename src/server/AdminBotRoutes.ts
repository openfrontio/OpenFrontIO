import crypto from "crypto";
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { Logger } from "winston";
import { z } from "zod";
import { GameType } from "../core/game/Game";
import {
  ADMIN_BOT_CLIENT_ID,
  GameConfigSchema,
  ID,
  IntentSchema,
} from "../core/Schemas";
import type { GameManager } from "./GameManager";
import { ServerEnv } from "./ServerEnv";

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Gate for the admin bot HTTP API. 404 when the feature is disabled (key unset)
// so the routes aren't advertised; 401 on a missing/incorrect key.
export const requireAdminBotKey: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const expected = ServerEnv.adminBotKey();
  if (expected === undefined) {
    res.status(404).end();
    return;
  }
  const provided = req.headers[ServerEnv.adminBotHeader()];
  if (typeof provided !== "string" || !timingSafeEqualStr(provided, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

export function registerAdminBotRoutes(opts: {
  app: Express;
  gm: GameManager;
  workerId: number;
  log: Logger;
}) {
  const { app, gm, workerId, log } = opts;

  // Validate game id format and that this worker owns it. Returns false and
  // sends the error response when the id is bad/misrouted.
  const ownsGame = (id: string, res: Response): boolean => {
    if (!ID.safeParse(id).success) {
      res.status(400).json({ error: "Invalid game ID" });
      return false;
    }
    if (ServerEnv.workerIndex(id) !== workerId) {
      res.status(400).json({ error: "Worker, game id mismatch" });
      return false;
    }
    return true;
  };

  // Create a private game. The worker mints a self-owned id and returns it, so
  // the bot doesn't need to know the sharding. nginx (and the vite dev proxy)
  // randomly route here to spread new games across workers.
  app.post("/api/adminbot/create_game", requireAdminBotKey, (req, res) => {
    const parsed = GameConfigSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const config = parsed.data;
    // Optional public listing (#4480). Read alongside the config, not from it:
    // `listed` lives on GameServer precisely so it can't be smuggled through
    // GameConfig, and the schema parse above strips it from `config` for us.
    //
    // Set at CREATE time rather than via a follow-up toggle because a bot never
    // needs to withdraw a listing by hand — a lobby delists itself the moment it
    // starts, fills or dies. The human toggle (POST /api/game/:id/listing) can't
    // serve a bot: it authorizes via isCreator + subscription, and an admin-bot
    // lobby is deliberately created with NO creatorPersistentID (below), so it has
    // no owner to match and no account to bill.
    const listedParsed = z
      .object({ listed: z.boolean().optional() })
      .safeParse(req.body ?? {});
    if (!listedParsed.success) {
      return res
        .status(400)
        .json({ error: z.prettifyError(listedParsed.error) });
    }
    const listed = listedParsed.data.listed === true;
    // Private only: reject Public and Singleplayer. An omitted gameType defaults
    // to Private in createGame, so it's allowed through.
    if (config.gameType !== undefined && config.gameType !== GameType.Private) {
      return res
        .status(400)
        .json({ error: "admin bot can only create private games" });
    }

    // Guard BEFORE minting a lobby, so an ineligible request doesn't leave an
    // orphan behind. Both mirror the human endpoint's refusals: a whitelisted
    // lobby would be advertised to everyone yet reject every joiner (and the
    // whitelist is stripped from the broadcast, so browsers couldn't tell why),
    // and host cheats give the host an edge over players recruited from the
    // browser. The cluster-wide MAX_HOSTED_LOBBIES cap is left to the master,
    // which already delists overflow as the authoritative backstop.
    if (listed) {
      if ((config.allowedPublicIds?.length ?? 0) > 0) {
        return res.status(409).json({ error: "listing_whitelist_enabled" });
      }
      if (config.hostCheats !== undefined) {
        return res.status(409).json({ error: "listing_host_cheats_enabled" });
      }
    }

    const id = ServerEnv.generateGameIdForWorker(workerId);
    if (id === null) {
      log.warn(`admin bot: failed to mint game id on worker ${workerId}`);
      return res.status(500).json({ error: "Could not allocate game id" });
    }

    const game = gm.createGame(id, config, undefined);
    if (game === null) {
      return res.status(409).json({ error: "Game ID already exists" });
    }
    if (listed) {
      game.setListed(true);
    }
    log.info(`admin bot created game ${id}`, { listed });
    res.json({
      ...game.gameInfo(),
      workerIndex: workerId,
      workerPath: ServerEnv.workerPath(id),
    });
  });

  // Read what's happening in a running game. The sim runs on the clients, so
  // this returns the latest live stats snapshot a majority of them agreed on
  // (liveStats is null until the first consensus is reached).
  app.get("/api/adminbot/game/:id/stats", requireAdminBotKey, (req, res) => {
    const id = req.params.id as string;
    if (!ownsGame(id, res)) return;

    const game = gm.game(id);
    if (game === null) {
      return res.status(404).json({ error: "Game not found" });
    }

    res.json({
      gameID: id,
      liveStats: game.liveStats(),
    });
  });

  // Send an intent. Honors the lobby-management intents; everything else 400.
  app.post("/api/adminbot/game/:id/intent", requireAdminBotKey, (req, res) => {
    const id = req.params.id as string;
    if (!ownsGame(id, res)) return;

    const parsed = IntentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const game = gm.game(id);
    if (game === null) {
      return res.status(404).json({ error: "Game not found" });
    }

    const result = game.handleIntent(parsed.data, {
      clientID: ADMIN_BOT_CLIENT_ID,
      isLobbyCreator: false,
      isAdmin: true,
      isAdminBot: true,
    });
    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.error ?? "error" });
    }
    log.info(`admin bot intent ${parsed.data.type} on game ${id}`);
    res.json(game.gameInfo());
  });
}
