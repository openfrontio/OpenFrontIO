import http from "http";
import ipAnonymize from "ip-anonymize";
import { WebSocket } from "ws";
import { z } from "zod";
import { getServerConfigFromServer } from "../../../../../core/configuration/ConfigLoader";
import {
  ClientMessageSchema,
  ServerErrorMessage,
} from "../../../../../core/Schemas";
import { Client } from "../../../../Client";
import { GameManager } from "../../../../GameManager";
import { getUserMe, verifyClientToken } from "../../../../jwt";
import { logger } from "../../../../Logger";
import { PrivilegeRefresher } from "../../../../PrivilegeRefresher";

const config = getServerConfigFromServer();

const workerId = parseInt(process.env.WORKER_ID ?? "0");
const log = logger.child({ comp: `w_${workerId}` });

export async function preJoinMessageHandler(
  req: http.IncomingMessage,
  ws: WebSocket,
  privilegeRefresher: PrivilegeRefresher,
  gm: GameManager,
  message: string,
): Promise<void> {
  const result = await handleJoinMessage(
    req,
    ws,
    privilegeRefresher,
    gm,
    message,
  );
  if (result === undefined) {
    // The message was ignored, because it wasn't a "join" message
    // TODO: Rate limit this
    return;
  } else if (result.success === false) {
    // Join failure
    const { code, error, reason } = result;
    if (error) {
      ws.send(
        JSON.stringify({
          error,
          type: "error",
        } satisfies ServerErrorMessage),
      );
    }
    ws.close(code, reason);
  } else {
    // Join success
  }
}

async function handleJoinMessage(
  req: http.IncomingMessage,
  ws: WebSocket,
  privilegeRefresher: PrivilegeRefresher,
  gm: GameManager,
  message: string,
): Promise<
  | undefined
  | {
      success: true;
    }
  | {
      success: false;
      code: 1002;
      error: string;
      reason:
        | "ClientJoinMessageSchema"
        | "Flag invalid"
        | "Flag restricted"
        | "Forbidden"
        | "Not found"
        | "Pattern invalid"
        | "Pattern restricted"
        | "Pattern unlisted"
        | "Unauthorized";
    }
  | {
      success: false;
      code: 1011;
      reason: "Internal server error";
      error: string;
    }
> {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      forwarded || req.socket.remoteAddress || "unknown";

  try {
    // Parse and handle client messages
    const parsed = ClientMessageSchema.safeParse(
      JSON.parse(message.toString()),
    );
    if (!parsed.success) {
      const error = z.prettifyError(parsed.error);
      log.warn("Error parsing client message:", error);
      return {
        code: 1002,
        error,
        reason: "ClientJoinMessageSchema",
        success: false,
      };
    }
    const clientMsg = parsed.data;

    if (clientMsg.type === "ping") {
      // Ignore ping
      return;
    } else if (clientMsg.type !== "join") {
      log.warn(`Invalid message before join: ${JSON.stringify(clientMsg)}`);
      return;
    }

    // Verify this worker should handle this game
    const expectedWorkerId = config.workerIndex(clientMsg.gameID);
    if (expectedWorkerId !== workerId) {
      log.warn(
        `Worker mismatch: Game ${clientMsg.gameID} should be on worker ${
          expectedWorkerId
        }, but this is worker ${workerId}`,
      );
      return;
    }

    // Verify token signature
    const result = await verifyClientToken(clientMsg.token, config);
    if (result === false) {
      log.warn("Unauthorized: Invalid token");
      return {
        code: 1002,
        error: "The game server did not recognize your session token",
        reason: "Unauthorized",
        success: false,
      };
    }
    const { persistentId, claims } = result;

    let roles: string[] | undefined;
    let flares: string[] | undefined;

    const allowedFlares = config.allowedFlares();
    if (claims === null) {
      // Anonymous user
      if (allowedFlares !== undefined) {
        // Login is required
        log.warn("Unauthorized: Anonymous user attempted to join game");
        return {
          code: 1002,
          error: "A valid login is required to join this game",
          reason: "Unauthorized",
          success: false,
        };
      }
    } else {
      // Verify token and get player permissions
      const result = await getUserMe(clientMsg.token, config);
      if (result === false) {
        log.warn("Unauthorized: Token verification failed");
        return {
          code: 1002,
          error: "The game server did not recognize your session token",
          reason: "Unauthorized",
          success: false,
        };
      }
      ({ roles, flares } = result.player);

      if (allowedFlares !== undefined) {
        // Login is required
        const allowed =
          allowedFlares.length === 0 ||
          allowedFlares.some((f) => flares?.includes(f));
        if (!allowed) {
          log.warn(
            "Fobidden: player without an allowed flare attempted to join game",
          );
          return {
            code: 1002,
            error: "You are forbidden from joining this game",
            reason: "Forbidden",
            success: false,
          };
        }
      }
    }

    // Check if the flag is allowed
    if (clientMsg.flag !== undefined) {
      if (clientMsg.flag.startsWith("!")) {
        const allowed = privilegeRefresher
          .get()
          .isCustomFlagAllowed(clientMsg.flag, flares);
        if (allowed !== true) {
          log.warn(`Flag ${allowed}: ${clientMsg.flag}`);
          return {
            code: 1002,
            error: `The flag you have selected is ${allowed}.`,
            reason: `Flag ${allowed}`,
            success: false,
          };
        }
      }
    }

    // Check if the pattern is allowed
    if (clientMsg.pattern !== undefined) {
      const allowed = privilegeRefresher
        .get()
        .isPatternAllowed(clientMsg.pattern, flares);
      if (allowed !== true) {
        log.warn(`Pattern ${allowed}: ${clientMsg.pattern}`);
        return {
          code: 1002,
          error: `The pattern you have selected is ${allowed}.`,
          reason: `Pattern ${allowed}`,
          success: false,
        };
      }
    }

    // Create client
    const client = new Client(
      clientMsg.clientID,
      persistentId,
      claims,
      roles,
      flares,
      ip,
      clientMsg.username,
      ws,
      clientMsg.flag,
      clientMsg.pattern,
    );

    const wasFound = gm.addClient(client, clientMsg.gameID, clientMsg.lastTurn);

    if (!wasFound) {
      log.warn(`game ${clientMsg.gameID} not found on worker ${workerId}`);
      return {
        code: 1002,
        error: "The game was not found.",
        reason: "Not found",
        success: false,
      };
    }

    // Success
    return {
      success: true,
    };
  } catch (error) {
    log.warn(`error handling websocket message for ${ipAnonymize(ip)}`, error);
    return {
      code: 1011,
      error: error instanceof Error ? error.message : String(error),
      reason: "Internal server error",
      success: false,
    };
  }
}
