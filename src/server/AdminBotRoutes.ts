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
import { GameMode, GameType } from "../core/game/Game";
import {
  ADMIN_BOT_CLIENT_ID,
  type GameConfig,
  GameConfigSchema,
  type GameID,
  ID,
  IntentSchema,
  type LobbyAccent,
  LobbyAccentSchema,
  LobbyLabelSchema,
} from "../core/Schemas";
import type { GameManager } from "./GameManager";
import type { GameServer } from "./GameServer";
import { ServerEnv } from "./ServerEnv";

// Team-pinning caps. A lobby tops out well below these; they exist so a bad
// request can't allocate unbounded work, matching allowedPublicIds' own cap.
const MAX_TEAMS = 200;
const MAX_TEAM_MEMBERS = 50;

// Every member of a pool is hosted by the worker that served the request (ids
// are minted to hash to it), each with its own lobby loop and per-second
// broadcast. So this is a budget for one worker's event loop, not the 64 the
// sibling list would otherwise allow.
const MAX_POOL_MEMBERS = 8;

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

interface CreateGameRequest {
  config: Partial<GameConfig>;
  listed: boolean;
  featured: boolean;
  label: string | undefined;
  accent: LobbyAccent | undefined;
  teams: string[][] | undefined;
}

type ParsedCreateGame =
  | { ok: true; value: CreateGameRequest }
  | { ok: false; status: number; body: unknown };

const fail = (status: number, body: unknown): ParsedCreateGame => ({
  ok: false,
  status,
  body,
});

// Everything about a create request that can be judged before an id exists.
// Shared by create_game and create_pool so a pool's members are held to the
// same rules as a lone lobby.
function parseCreateGameRequest(reqBody: unknown): ParsedCreateGame {
  const parsed = GameConfigSchema.partial().safeParse(reqBody ?? {});
  if (!parsed.success) {
    return fail(400, { error: z.prettifyError(parsed.error) });
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
  //
  // `featured` rides alongside for the same reason. It lengthens the listing
  // deadline and gives the row a label of the host's choosing, which is only
  // safe because this endpoint is authenticated: an ordinary subscriber must
  // not be able to name their lobby "Official Event" or hold a listing open.
  const listedParsed = z
    .object({
      listed: z.boolean().optional(),
      featured: z.boolean().optional(),
      label: LobbyLabelSchema.optional(),
      accent: LobbyAccentSchema.optional(),
    })
    .safeParse(reqBody ?? {});
  if (!listedParsed.success) {
    return fail(400, { error: z.prettifyError(listedParsed.error) });
  }
  const listed = listedParsed.data.listed === true;
  const featured = listedParsed.data.featured === true;

  // Optional team pinning. Read alongside the config for the same reason as
  // `listed`: it is not a GameConfig field, so the parse above strips it and it
  // can never be smuggled in through update_game_config after the fact.
  //
  // Entries are publicIds. assignTeams honours a pinned slot unconditionally —
  // before and regardless of clan/friend grouping — so this is how a tournament
  // bot says who plays with whom instead of letting the balancer decide.
  const teamsParsed = z
    .object({
      teams: z
        .array(z.array(z.string()).max(MAX_TEAM_MEMBERS))
        .max(MAX_TEAMS)
        .optional(),
    })
    .safeParse(reqBody ?? {});
  if (!teamsParsed.success) {
    return fail(400, { error: z.prettifyError(teamsParsed.error) });
  }
  const teams = teamsParsed.data.teams;
  if (teams !== undefined) {
    // FFA never runs assignTeams, so a pin there would be silently inert.
    // Refuse rather than accept a request that cannot do what it asks.
    if (config.gameMode !== GameMode.Team) {
      return fail(400, { error: "teams require gameMode Team" });
    }
    // A publicId in two teams has no single answer (findIndex takes the first),
    // so the caller would get a team it did not ask for.
    const seen = new Set<string>();
    for (const team of teams) {
      for (const publicId of team) {
        if (seen.has(publicId)) {
          return fail(400, {
            error: `publicId in more than one team: ${publicId}`,
          });
        }
        seen.add(publicId);
      }
    }
    // A pin is an index into the team list, so one past the end resolves to
    // no team and the player is silently unpinned. Duos/Trios/Quads resolve
    // their count at START from who turned up, and omitting it resolves to 0
    // (GameImpl throws "Too few teams"), so neither can be checked here.
    const playerTeams = config.playerTeams;
    if (teams.length > 0) {
      if (typeof playerTeams !== "number") {
        return fail(400, { error: "teams_require_numeric_player_teams" });
      }
      if (teams.length > playerTeams) {
        return fail(400, {
          error: "teams_exceed_player_teams",
          playerTeams,
          teams: teams.length,
        });
      }
    }
  }
  // Private only: reject Public and Singleplayer. An omitted gameType defaults
  // to Private in createGame, so it's allowed through.
  if (config.gameType !== undefined && config.gameType !== GameType.Private) {
    return fail(400, { error: "admin bot can only create private games" });
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
      return fail(409, { error: "listing_whitelist_enabled" });
    }
    if (config.hostCheats !== undefined) {
      return fail(409, { error: "listing_host_cheats_enabled" });
    }
  }
  // Featuring only means anything for a listed lobby: it governs the listing
  // deadline and the browser row. Refuse rather than silently ignore, so a
  // caller that forgot `listed` finds out.
  if (featured && !listed) {
    return fail(400, { error: "featured_requires_listed" });
  }
  return {
    ok: true,
    value: {
      config,
      listed,
      featured,
      label: listedParsed.data.label,
      accent: listedParsed.data.accent,
      teams,
    },
  };
}

function lobbyResponse(game: GameServer, id: GameID, workerId: number) {
  return {
    ...game.gameInfo(),
    workerIndex: workerId,
    workerPath: ServerEnv.workerPath(id),
  };
}

// setListed first: the listing deadline is measured from the listing, and
// featuring is what decides how long that deadline is.
function applyListing(game: GameServer, request: CreateGameRequest): void {
  if (request.listed) game.setListed(true);
  if (request.featured) {
    game.setFeatured({ label: request.label, accent: request.accent });
  }
}

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
    const parsed = parseCreateGameRequest(req.body);
    if (!parsed.ok) return res.status(parsed.status).json(parsed.body);
    const request = parsed.value;
    const { config, teams } = request;

    const id = ServerEnv.generateGameIdForWorker(workerId);
    if (id === null) {
      log.warn(`admin bot: failed to mint game id on worker ${workerId}`);
      return res.status(500).json({ error: "Could not allocate game id" });
    }

    // A member has to be in its own pool, or it keeps nobody and routes every
    // joiner away. Only checkable once the id exists, so unlike the guards
    // above it costs a minted id — but still no lobby.
    if (config.pool !== undefined && !config.pool.siblings.includes(id)) {
      return res.status(400).json({ error: "pool_missing_own_id", id });
    }

    const game = gm.createGame(
      id,
      config,
      undefined,
      undefined,
      undefined,
      teams,
    );
    if (game === null) {
      return res.status(409).json({ error: "Game ID already exists" });
    }
    applyListing(game, request);
    log.info(`admin bot created game ${id}`, {
      listed: request.listed,
      featured: request.featured,
    });
    res.json(lobbyResponse(game, id, workerId));
  });

  // Create a pool of sibling lobbies in one call.
  //
  // This exists because a pool cannot be assembled one create_game at a time:
  // members name each other by game id, and an id does not exist until the
  // server mints it. Minting all N up front is what breaks that circularity.
  // `pool` stays create-time only — there is no patch route and ConfigPatch
  // does not copy it — so a pool can never change after its members exist.
  app.post("/api/adminbot/create_pool", requireAdminBotKey, (req, res) => {
    // A pool of one would never redirect anyone; refuse rather than create a
    // lobby that merely looks pooled.
    const countParsed = z
      .object({ count: z.number().int().min(2).max(MAX_POOL_MEMBERS) })
      .safeParse(req.body ?? {});
    if (!countParsed.success) {
      return res
        .status(400)
        .json({ error: z.prettifyError(countParsed.error) });
    }
    const count = countParsed.data.count;

    const parsed = parseCreateGameRequest(req.body);
    if (!parsed.ok) return res.status(parsed.status).json(parsed.body);
    const request = parsed.value;

    if (request.config.pool !== undefined) {
      return res.status(400).json({ error: "pool_is_generated" });
    }
    // A team pin names publicIds for ONE lobby. Repeated across members it
    // would be inert everywhere the hash did not send those players.
    if (request.teams !== undefined) {
      return res.status(400).json({ error: "teams_unsupported_for_pool" });
    }

    // Every id before any lobby: the sibling list has to be complete, and a
    // half-created pool would name members that do not exist. Nothing runs
    // between these checks and the creates below, so an id found free here is
    // still free there.
    const ids: GameID[] = [];
    for (let i = 0; i < count; i++) {
      const id = ServerEnv.generateGameIdForWorker(workerId);
      if (id === null || ids.includes(id) || gm.game(id) !== null) {
        log.warn(`admin bot: could not mint ${count} pool ids`, { workerId });
        return res.status(500).json({ error: "Could not allocate game ids" });
      }
      ids.push(id);
    }

    // One object, shared by every member: order is part of the assignment, so
    // members that disagree on it disagree about who belongs where.
    const pool = { id: crypto.randomUUID(), siblings: ids };
    const lobbies: GameServer[] = [];
    for (const id of ids) {
      const game = gm.createGame(id, { ...request.config, pool });
      if (game === null) {
        // Unreachable after the check above, and there is no way to unmake the
        // lobbies already created — so say so loudly rather than pretend.
        log.error(`admin bot: pool id ${id} taken after being checked free`);
        return res.status(500).json({ error: "Game ID already exists", id });
      }
      lobbies.push(game);
    }

    // Only the entry point is advertised. The pool exists so ONE row in the
    // browser can absorb more players than one lobby holds; listing every
    // member would spend N of the cluster's hosted-lobby slots on one event
    // and gain nothing, since a joiner who picks any member is routed anyway.
    applyListing(lobbies[0], request);

    log.info(`admin bot created a pool of ${count}`, {
      poolId: pool.id,
      entry: ids[0],
      listed: request.listed,
    });
    res.json({
      poolId: pool.id,
      lobbies: lobbies.map((game, i) => lobbyResponse(game, ids[i], workerId)),
    });
  });

  // Who joined this game, and the account behind each one. The public game
  // record carries no account id, so a host can otherwise see that 96 people
  // played and identify none of them. Key-gated like every route here — the
  // admin-bot key is the trust boundary, same as the stats endpoint above.
  app.get("/api/adminbot/game/:id/roster", requireAdminBotKey, (req, res) => {
    const id = req.params.id as string;
    if (!ownsGame(id, res)) return;

    const game = gm.game(id);
    if (game === null) {
      return res.status(404).json({ error: "Game not found" });
    }
    res.json({ gameID: id, players: game.roster() });
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
  // Returns the resulting team list so the caller can assert what landed: a
  // half-pinned lobby looks correct from the outside.
  app.post("/api/adminbot/game/:id/pin", requireAdminBotKey, (req, res) => {
    const id = req.params.id as string;
    if (!ownsGame(id, res)) return;

    const parsed = z
      .object({
        publicId: z.string().min(1),
        teamIndex: z.number().int().nonnegative(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const game = gm.game(id);
    if (game === null) {
      return res.status(404).json({ error: "Game not found" });
    }

    const result = game.addMatchmakingPin(
      parsed.data.publicId,
      parsed.data.teamIndex,
    );
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    log.info(`admin bot pinned a player on game ${id}`, {
      teamIndex: parsed.data.teamIndex,
    });
    res.json({ teams: result.teams });
  });

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
