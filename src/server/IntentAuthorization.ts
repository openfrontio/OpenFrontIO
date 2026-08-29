import { GameType } from "../core/game/Game";
import { ClientID, Intent } from "../core/Schemas";
import { hostCheatsEnabled } from "./ConfigPatch";

export interface IntentActor {
  clientID: ClientID; // stamped onto the intent
  isLobbyCreator: boolean;
  isAdmin: boolean; // role-based admin/root (also true for the admin bot)
  isAdminBot: boolean; // the trusted admin-bot HTTP API
}

// Outcome of dispatching an intent. `status` is an HTTP-style code: 200 on
// success. The admin-bot route maps a non-200 straight to its response; the
// websocket path logs it and drops the message.
export interface IntentOutcome {
  status: number;
  error?: string;
}

// The game state the guards read.
export interface IntentGameState {
  isPublic: boolean;
  isListed: boolean;
  hasStarted: boolean;
}

// The actor and game-state guards of GameServer.handleIntent, in the order
// it applies them: the first that fails is the outcome; null means the
// intent may go ahead. Pure, so every combination is table-testable. What
// needs the roster (resolving a kick target) or changes the game stays in
// handleIntent.
export function authorizeIntent(
  intent: Intent,
  actor: IntentActor,
  game: IntentGameState,
): IntentOutcome | null {
  // The admin bot only manages private games.
  if (actor.isAdminBot && game.isPublic) {
    return { status: 403, error: "admin bot cannot act on public games" };
  }

  switch (intent.type) {
    case "mark_disconnected":
      return { status: 400, error: "mark_disconnected is server-internal" };

    case "kick_player":
      if (!actor.isLobbyCreator && !actor.isAdmin) {
        return {
          status: 403,
          error: "only the lobby creator or an admin can kick players",
        };
      }
      // A listed lobby recruits strangers from the public browser; letting
      // the host kick them is a griefing vector. Admins keep the power for
      // moderation. The listed flag survives game start on purpose, so a
      // publicly recruited game stays kick-free like a real public game.
      if (game.isListed && !actor.isAdmin) {
        return {
          status: 403,
          error: "the host cannot kick players in a publicly listed lobby",
        };
      }
      return null;

    case "update_game_config":
      if (!actor.isLobbyCreator && !actor.isAdminBot) {
        return {
          status: 403,
          error: "only the lobby creator can update game config",
        };
      }
      if (game.isPublic) {
        return { status: 403, error: "cannot update a public game" };
      }
      if (game.hasStarted) {
        return { status: 409, error: "game already started" };
      }
      if (intent.config.gameType === GameType.Public) {
        return { status: 400, error: "cannot change a game to public" };
      }
      // Host cheats give the host an asymmetric advantage over players
      // recruited from the lobby browser. Listing is likewise rejected
      // while cheats are on (Worker's listing endpoint), so a listed
      // lobby can never have them.
      if (game.isListed && hostCheatsEnabled(intent.config.hostCheats)) {
        return {
          status: 409,
          error: "cannot enable host cheats in a publicly listed lobby",
        };
      }
      // Likewise a join whitelist: a listed lobby must stay joinable by
      // anyone who finds it, and listing is permanent, so the whitelist is
      // rejected rather than delisting the lobby.
      if (game.isListed && (intent.config.allowedPublicIds?.length ?? 0) > 0) {
        return {
          status: 409,
          error: "cannot enable a join whitelist in a publicly listed lobby",
        };
      }
      return null;

    case "toggle_game_start_timer":
      if (!actor.isLobbyCreator && !actor.isAdminBot) {
        return { status: 403, error: "only the lobby creator can start" };
      }
      if (game.isPublic) {
        return { status: 403, error: "cannot start a public game" };
      }
      if (game.hasStarted) {
        return { status: 409, error: "game already started" };
      }
      return null;

    case "toggle_pause":
      if (!actor.isLobbyCreator && !actor.isAdminBot) {
        return { status: 403, error: "only the lobby creator can pause" };
      }
      if (game.isListed && !actor.isAdminBot) {
        return {
          status: 403,
          error: "the host cannot pause a publicly listed game",
        };
      }
      // Pausing only makes sense once the game is running.
      if (!game.hasStarted) {
        return { status: 409, error: "game not started" };
      }
      return null;

    default:
      // Gameplay intents: websocket players only.
      if (actor.isAdminBot) {
        return { status: 400, error: "intent not permitted for admin bot" };
      }
      return null;
  }
}
