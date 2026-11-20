import { LobbyQueuePaymentResult } from "./LobbyQueuePayment";

// The slice of GameServer (and the worker's view of the queue) the boost
// route needs, so the rules are testable without a live game.
export interface BoostableLobby {
  hasConnectedClient(persistentId: string): boolean;
  // A public lobby the master schedules (ffa, team, special), still a lobby.
  isScheduledLobby(): boolean;
  // Boosted already, or someone's charge for it is in flight.
  isBoosted(): boolean;
  startsAt(): number | undefined;
  wouldMoveUp(): boolean;
  setBoostPending(pending: boolean): void;
  boost(persistentId: string): void;
}

export type BoostLobbyOutcome =
  | { status: 200; body: { boosted: true } }
  | { status: 402 | 403 | 409 | 502; body: { error: string } };

/**
 * A player in a scheduled public lobby pays to move it to the front of its
 * queue, right behind the lobby that's counting down. Checks run before the
 * charge so a refusal never costs anything.
 *
 * One boost per lobby: the API's charge is idempotent per (player, gameID),
 * so a second boost by the same player would be free. The lobby is marked
 * pending before the charge so two clicks can't both pay.
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
  if (game.isBoosted()) {
    return { status: 409, body: { error: "boost_already_boosted" } };
  }
  if (game.startsAt() !== undefined) {
    return { status: 409, body: { error: "boost_lobby_starting" } };
  }
  if (!game.wouldMoveUp()) {
    return { status: 409, body: { error: "boost_already_next" } };
  }

  game.setBoostPending(true);
  const payment = await pay();
  if (payment.type !== "success") {
    game.setBoostPending(false);
    return payment.type === "insufficient_balance"
      ? { status: 402, body: { error: "insufficient_balance" } }
      : { status: 502, body: { error: "boost_payment_failed" } };
  }

  // The lobby can reach the front on its own while the charge is in flight;
  // the boost is still recorded, it just no longer changes the order.
  game.boost(persistentId);
  return { status: 200, body: { boosted: true } };
}
