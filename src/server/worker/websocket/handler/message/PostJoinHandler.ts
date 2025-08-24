import { Logger } from "winston";
import { z } from "zod";
import {
  ClientMessageSchema,
  ClientSendWinnerMessage,
  ServerErrorMessage,
} from "../../../../../core/Schemas";
import { Client } from "../../../../Client";
import { GameServer } from "../../../../GameServer";

export async function postJoinMessageHandler(
  gs: GameServer,
  log: Logger,
  client: Client,
  message: string,
) {
  try {
    const parsed = ClientMessageSchema.safeParse(JSON.parse(message));
    if (!parsed.success) {
      const error = z.prettifyError(parsed.error);
      log.error("Failed to parse client message", error, {
        clientID: client.clientID,
      });
      client.ws.send(
        JSON.stringify({
          error,
          message,
          type: "error",
        } satisfies ServerErrorMessage),
      );
      client.ws.close(1002, "ClientMessageSchema");
      return;
    }
    const clientMsg = parsed.data;
    switch (clientMsg.type) {
      case "intent": {
        if (clientMsg.intent.clientID !== client.clientID) {
          log.warn(
            `client id mismatch, client: ${client.clientID}, intent: ${clientMsg.intent.clientID}`,
          );
          return;
        }
        switch (clientMsg.intent.type) {
          case "mark_disconnected": {
            log.warn("Should not receive mark_disconnected intent from client");
            return;
          }

          // Handle kick_player intent via WebSocket
          case "kick_player": {
            const authenticatedClientID = client.clientID;

            // Check if the authenticated client is the lobby creator
            if (authenticatedClientID !== gs.lobbyCreatorID) {
              log.warn("Only lobby creator can kick players", {
                clientID: authenticatedClientID,
                creatorID: gs.lobbyCreatorID,
                gameID: gs.id,
                target: clientMsg.intent.target,
              });
              return;
            }

            // Don't allow lobby creator to kick themselves
            if (authenticatedClientID === clientMsg.intent.target) {
              log.warn("Cannot kick yourself", {
                clientID: authenticatedClientID,
              });
              return;
            }

            // Log and execute the kick
            log.info("Lobby creator initiated kick of player", {
              creatorID: authenticatedClientID,
              gameID: gs.id,
              kickMethod: "websocket",
              target: clientMsg.intent.target,
            });

            gs.kickClient(clientMsg.intent.target);
            return;
          }

          default: {
            gs.addIntent(clientMsg.intent);
            break;
          }
        }
        break;
      }
      case "ping": {
        gs.lastPingUpdate = Date.now();
        client.lastPing = Date.now();
        break;
      }
      case "hash": {
        client.hashes.set(clientMsg.turnNumber, clientMsg.hash);
        break;
      }
      case "winner": {
        handleWinner(gs, log, client, clientMsg);
        break;
      }
      default: {
        log.warn(`Unknown message type: ${clientMsg.type}`, {
          clientID: client.clientID,
        });
        break;
      }
    }
  } catch (error) {
    log.info(`error handline websocket request in game server: ${error}`, {
      clientID: client.clientID,
    });
  }
}

function handleWinner(
  gs: GameServer,
  log: Logger,
  client: Client,
  clientMsg: ClientSendWinnerMessage,
) {
  if (
    gs.outOfSyncClients.has(client.clientID) ||
    gs.kickedClients.has(client.clientID) ||
    gs.winner !== null ||
    client.reportedWinner !== null
  ) {
    return;
  }
  client.reportedWinner = clientMsg.winner;

  // Add client vote
  const winnerKey = JSON.stringify(clientMsg.winner);
  let potentialWinner = gs.winnerVotes.get(winnerKey);
  if (potentialWinner === undefined) {
    potentialWinner = { ips: new Set(), winner: clientMsg };
    gs.winnerVotes.set(winnerKey, potentialWinner);
  }
  potentialWinner.ips.add(client.ip);

  const activeUniqueIPs = new Set(gs.activeClients.map((c) => c.ip));

  // Require at least two unique IPs to agree
  if (activeUniqueIPs.size < 2) {
    return;
  }

  // Check if winner has majority
  if (potentialWinner.ips.size * 2 < activeUniqueIPs.size) {
    return;
  }

  // Vote succeeded
  gs.winner = potentialWinner.winner;
  log.info(
    `Winner determined by ${potentialWinner.ips.size}/${activeUniqueIPs.size} active IPs`,
    {
      gameID: gs.id,
      winnerKey,
    },
  );
  gs.archiveGame();
}
