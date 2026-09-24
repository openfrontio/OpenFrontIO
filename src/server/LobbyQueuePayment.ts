import { LOBBY_QUEUE_CUTOFF_MS } from "../core/Schemas";
import { ServerEnv } from "./ServerEnv";

export type LobbyQueuePaymentResult =
  | { type: "success" }
  | { type: "insufficient_balance" }
  | { type: "error"; message: string };

/**
 * Charges the host for putting their listed lobby in the public queue
 * (infra POST /users/@me/lobby_queue). Sent with the host's token, so the API
 * charges that player, plus our API key so the per-IP limit doesn't pool every
 * host behind this server. The charge is idempotent per (player, gameID), so a
 * retry after a timeout can't double-charge.
 */
export async function payForLobbyQueue(
  token: string,
  gameID: string,
): Promise<LobbyQueuePaymentResult> {
  try {
    const response = await fetch(
      `${ServerEnv.jwtIssuer()}/users/@me/lobby_queue`,
      {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: {
          authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-api-key": ServerEnv.apiKey(),
        },
        body: JSON.stringify({ gameID }),
      },
    );
    if (response.ok) return { type: "success" };
    if (response.status === 400) {
      const body = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      if (
        body?.code === "insufficient_balance" ||
        body?.code === "insufficient_balance_debt"
      ) {
        return { type: "insufficient_balance" };
      }
    }
    return {
      type: "error",
      message: `api returned ${response.status}`,
    };
  } catch (e) {
    return { type: "error", message: `lobby queue payment failed: ${e}` };
  }
}

// The slice of GameServer the queue route needs, so the rules are testable
// without a live game.
export interface QueueableLobby {
  isCreator(persistentId: string): boolean;
  isPublic(): boolean;
  isListed(): boolean;
  isQueued(): boolean;
  inLobby(): boolean;
  startsAt(): number | undefined;
  autoStartAt(): number | undefined;
  queueForPublic(): void;
}

export type QueueLobbyOutcome =
  | { status: 200; body: { queued: true } }
  | { status: 402 | 403 | 409 | 502; body: { error: string } };

/**
 * The host of a listed lobby pays to put it in the public Special queue.
 * Checks run before the charge so a refusal never costs anything; `pay` is
 * skipped when already queued, so a retried click is free.
 */
export async function queueListedLobby(
  game: QueueableLobby,
  persistentId: string,
  pay: () => Promise<LobbyQueuePaymentResult>,
): Promise<QueueLobbyOutcome> {
  if (!game.isCreator(persistentId)) {
    return { status: 403, body: { error: "Only the lobby creator can queue" } };
  }
  if (game.isQueued()) {
    return { status: 200, body: { queued: true } };
  }
  if (game.isPublic() || !game.isListed() || !game.inLobby()) {
    return { status: 409, body: { error: "queue_not_listed" } };
  }
  // The host's own start countdown is already running, or the listing is
  // about to auto-start.
  const autoStartAt = game.autoStartAt();
  if (
    game.startsAt() !== undefined ||
    (autoStartAt !== undefined &&
      autoStartAt - Date.now() < LOBBY_QUEUE_CUTOFF_MS)
  ) {
    return { status: 409, body: { error: "queue_lobby_starting" } };
  }

  const payment = await pay();
  if (payment.type === "insufficient_balance") {
    return { status: 402, body: { error: "insufficient_balance" } };
  }
  if (payment.type === "error") {
    return { status: 502, body: { error: "queue_payment_failed" } };
  }

  // The lobby can fill and start while the charge is in flight; queueing it
  // then does nothing (only lobbies are reported), and the host still got
  // the game they paid to fill.
  game.queueForPublic();
  return { status: 200, body: { queued: true } };
}
