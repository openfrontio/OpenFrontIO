import { GameID } from "@openfront/engine-api/Schemas";
import { CloseCode, CloseReason } from "@openfront/shared/CloseCodes";
import { Logger } from "winston";
import WebSocket from "ws";
import { GameManager } from "./GameManager";

// Hands a "rejoin" message's socket to the client's game, or closes it with
// GameNotFound. A miss is routine — most are a tab rejoining after its game
// ended, which the client already handles — so it logs at info like the join
// path's not-found, and names which of the two cases it was.
export function rejoinOrClose(
  gm: GameManager,
  log: Logger,
  workerId: number,
  ws: WebSocket,
  persistentID: string,
  gameID: GameID,
  lastTurn: number,
): void {
  if (gm.rejoinClient(ws, persistentID, gameID, lastTurn)) return;
  // An ended game stays in GameManager until its next tick prunes it; to
  // the rejoining client it is already gone.
  const game = gm.game(gameID);
  if (game === null || game.hasEnded()) {
    log.info(`game ${gameID} not found on worker ${workerId}`, { gameID });
  } else {
    log.info(`rejoining client not in game ${gameID}`, { gameID });
  }
  ws.close(CloseCode.GameNotFound, CloseReason.GameNotFound);
}
