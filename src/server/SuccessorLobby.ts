import type { GameID } from "../core/Schemas";
import type { GameServer } from "./GameServer";

export interface SuccessorLobbyDeps {
  // Mint a fresh game id on the current worker, or null if none is available.
  mintId: () => GameID | null;
  // Create a private successor lobby owned by `creator`, or null on failure
  // (e.g. an id collision).
  createGame: (id: GameID, creator: string) => GameServer | null;
}

// Give `game` the ability to spawn a successor private lobby (same creator,
// default settings) when its host reuses the lobby from the win screen or the
// in-game button. Every successor is wired the same way, so the group can keep
// reusing the lobby game after game without re-sharing a link — not just once.
export function wireSuccessorLobby(
  game: GameServer,
  creator: string,
  deps: SuccessorLobbyDeps,
): void {
  game.createSuccessorLobby = () => {
    const successorId = deps.mintId();
    if (successorId === null) {
      return null;
    }
    const successor = deps.createGame(successorId, creator);
    if (successor === null) {
      return null;
    }
    // Chain it so the successor can itself spawn a successor.
    wireSuccessorLobby(successor, creator, deps);
    return successorId;
  };
}
