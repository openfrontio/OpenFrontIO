import {
  ClientMessageSchema,
  ClientSendWinnerMessage,
  ServerErrorMessage,
} from "../../../../../core/Schemas";
import { Client } from "../../../../Client";
import { GameServer } from "../../../../GameServer";
import { Logger } from "winston";
import { z } from "zod";
import { declareWinner, isLobbyOnChain } from "../../../../contract";
import type { Address } from "viem";

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

function resolveWinnerWalletAddress(
  gs: GameServer,
  clientMsg: ClientSendWinnerMessage,
  log: Logger
): Address | null {
  try {
    if (!clientMsg.winner) {
      log.warn("No winner in client message");
      return null;
    }

    if (clientMsg.winner[0] === "player") {
      // Winner is a single player - get their wallet address
      const winnerClientID = clientMsg.winner[1];
      const client = gs.getClient(winnerClientID);
      
      if (!client) {
        log.warn("Winner client not found", { winnerClientID });
        return null;
      }

      if (!client.walletAddress) {
        log.warn("Winner client has no wallet address", { winnerClientID });
        return null;
      }

      return client.walletAddress as Address;
    } else if (clientMsg.winner[0] === "team") {
      // Winner is a team - need to determine which team member gets the prize
      // For now, we'll select the first team member as the winner
      // TODO: Implement proper team winner selection logic (e.g., most contribution, random, etc.)
      const teamName = clientMsg.winner[1];
      const teamMembers = clientMsg.winner.slice(2) as string[];
      
      if (teamMembers.length === 0) {
        log.warn("No team members found for winning team", { teamName });
        return null;
      }

      // Use first team member as winner for now
      const firstMemberClientID = teamMembers[0];
      const client = gs.getClient(firstMemberClientID);
      
      if (!client) {
        log.warn("Team winner client not found", { firstMemberClientID, teamName });
        return null;
      }

      if (!client.walletAddress) {
        log.warn("Team winner client has no wallet address", { 
          firstMemberClientID, 
          teamName 
        });
        return null;
      }

      log.info("Selected team member as winner", {
        teamName,
        winnerClientID: firstMemberClientID,
        winnerAddress: client.walletAddress,
        totalTeamMembers: teamMembers.length,
      });

      return client.walletAddress as Address;
    }

    log.warn("Unknown winner type", { winner: clientMsg.winner });
    return null;
  } catch (error) {
    log.error("Error resolving winner wallet address", { error });
    return null;
  }
}

async function declareWinnerOnChain(
  gs: GameServer,
  log: Logger,
  clientMsg: ClientSendWinnerMessage
): Promise<void> {
  try {
    // Check if this game corresponds to an on-chain lobby
    const lobbyId = gs.id;
    
    log.info("Checking if game is on-chain", { gameID: lobbyId });
    
    const isOnChain = await isLobbyOnChain(lobbyId);
    if (!isOnChain) {
      log.info("Game is not on-chain, skipping blockchain winner declaration", {
        gameID: lobbyId,
      });
      return;
    }

    // Resolve winner to wallet address
    const winnerAddress = resolveWinnerWalletAddress(gs, clientMsg, log);
    if (!winnerAddress) {
      log.warn("Could not resolve winner wallet address, skipping blockchain declaration", {
        gameID: lobbyId,
        winner: clientMsg.winner,
      });
      return;
    }

    log.info("Declaring winner on blockchain", {
      gameID: lobbyId,
      winnerAddress,
      winner: clientMsg.winner,
    });

    // Call smart contract to declare winner
    const txHash = await declareWinner({
      lobbyId,
      winnerAddress,
    });

    if (txHash) {
      log.info("Winner successfully declared on blockchain", {
        gameID: lobbyId,
        winnerAddress,
        transactionHash: txHash,
      });
      
      // Store transaction hash for later reference
      gs.winnerDeclaredTxHash = txHash;
    } else {
      log.error("Failed to declare winner on blockchain - no transaction hash returned", {
        gameID: lobbyId,
        winnerAddress,
      });
    }
  } catch (error) {
    log.error("Error in blockchain winner declaration", {
      gameID: gs.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Don't throw - we don't want blockchain failures to break the game
  }
}

function handleWinner(
  gs: GameServer,
  log: Logger,
  client: Client, clientMsg: ClientSendWinnerMessage) {
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

  // Require at least two unique IPs to agree (skip in development for testing)
  const isDev = process.env.NODE_ENV !== 'production';
  
  log.info("Winner voting status", {
    gameID: gs.id,
    activeUniqueIPs: activeUniqueIPs.size,
    votesForWinner: potentialWinner.ips.size,
    isDevelopment: isDev,
    winner: clientMsg.winner
  });
  
  if (activeUniqueIPs.size < 2 && !isDev) {
    log.info("Not enough unique IPs for voting in production", {
      required: 2,
      actual: activeUniqueIPs.size
    });
    return;
  }

  // Check if winner has majority (or allow single player in development)
  if (!isDev && potentialWinner.ips.size * 2 < activeUniqueIPs.size) {
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

  // Declare winner on blockchain if this is an on-chain game
  log.info("🏆 Attempting to declare winner on blockchain", {
    gameID: gs.id,
    winner: clientMsg.winner
  });
  
  declareWinnerOnChain(gs, log, clientMsg).catch((error) => {
    log.error("❌ Failed to declare winner on blockchain", {
      gameID: gs.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  gs.archiveGame();
}
