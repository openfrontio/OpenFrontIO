import { LobbyQueuePaymentResult } from "./LobbyQueuePayment";

// How long a lobby stays reserved for a disconnected player whose boost
// charge ended without a known outcome, so they can come back and retry
// before anyone else may pay.
export const BOOST_HOLD_MS = 60_000;

// The slice of GameServer (and the worker's view of the queue) the boost
// route needs, so the rules are testable without a live game.
export interface BoostableLobby {
  hasConnectedClient(persistentId: string): boolean;
  // A public lobby the master schedules (ffa, team, special), still a lobby.
  isScheduledLobby(): boolean;
  // Boosted already, a charge for it is in flight, or another player's charge
  // ended without a known outcome and still holds the lobby.
  boostBlockedFor(persistentId: string): boolean;
  // This player's earlier charge ended without a known outcome.
  boostHeldFor(persistentId: string): boolean;
  startsAt(): number | undefined;
  wouldMoveUp(): boolean;
  // The lobby is this player's to boost while their charge is in flight.
  reserveBoost(persistentId: string): void;
  releaseBoost(): void;
  // The charge may or may not have gone through: only the same player may
  // try again (their retry can't charge twice).
  holdBoostForPayer(): void;
  // Records the boost for the player holding the reservation.
  boost(): void;
}

export type BoostLobbyOutcome =
  | { status: 200; body: { boosted: true } }
  | { status: 402 | 403 | 409 | 502; body: { error: string } };

/**
 * A player in a scheduled public lobby pays to move it to the front of its
 * queue, right behind the lobby that's counting down. Checks run before the
 * charge so a refusal never costs anything. They go by the master's last
 * broadcast, so a lobby that moved up in the last moment can still be charged
 * for a boost that no longer changes the order.
 *
 * One boost per lobby: the API's charge is idempotent per (player, gameID),
 * so a second boost by the same player would be free. The lobby is reserved
 * before the charge so two clicks can't both pay. A charge that fails without
 * a clear answer (a timeout, an API error) may still have gone through, so
 * the lobby stays reserved for that player while they are connected and for
 * BOOST_HOLD_MS after they drop; their retry is free if it did.
 * That retry skips the queue-position checks: the player may already have
 * paid, so the charge is replayed and the boost recorded wherever the lobby
 * now stands.
 */
export async function boostScheduledLobby(
  game: BoostableLobby,
  persistentId: string,
  pay: () => Promise<LobbyQueuePaymentResult>,
): Promise<BoostLobbyOutcome> {
  if (!game.hasConnectedClient(persistentId)) {
    return { status: 403, body: { error: "boost_not_in_lobby" } };
  }
  if (!game.isScheduledLobby()) {
    return { status: 409, body: { error: "boost_unavailable" } };
  }
  if (game.boostBlockedFor(persistentId)) {
    return { status: 409, body: { error: "boost_already_boosted" } };
  }
  if (!game.boostHeldFor(persistentId)) {
    if (game.startsAt() !== undefined) {
      return { status: 409, body: { error: "boost_lobby_starting" } };
    }
    if (!game.wouldMoveUp()) {
      return { status: 409, body: { error: "boost_already_next" } };
    }
  }

  game.reserveBoost(persistentId);
  const payment = await pay();
  if (payment.type === "insufficient_balance") {
    game.releaseBoost();
    return { status: 402, body: { error: "insufficient_balance" } };
  }
  if (payment.type !== "success") {
    if (payment.refused) game.releaseBoost();
    else game.holdBoostForPayer();
    return { status: 502, body: { error: "boost_payment_failed" } };
  }

  // The lobby can reach the front on its own while the charge is in flight;
  // the boost is still recorded, it just no longer changes the order.
  game.boost();
  return { status: 200, body: { boosted: true } };
}
