import { Client } from "./Client";

// Per-game party numbers for the players present.
//
// A party's id is its invite code, so the game never sees it. Instead each
// party gets a small number, 1-based, in the join order of its first member
// present here — stable while the lobby only grows, and identical for every
// client because it is computed once on the server and sent to all of them.
// A party with fewer than two players present gets no number: there is
// nobody to seat beside, and a lone number would only reveal that the player
// queued with someone who isn't here. Spectators are not in the simulation
// and never count.
export function partyLookup(
  active: readonly Client[],
): (client: Client) => number | undefined {
  const counts = new Map<string, number>();
  for (const c of active) {
    if (c.spectator || c.partyID === undefined) continue;
    counts.set(c.partyID, (counts.get(c.partyID) ?? 0) + 1);
  }
  const numbers = new Map<string, number>();
  for (const c of active) {
    if (c.spectator || c.partyID === undefined) continue;
    if ((counts.get(c.partyID) ?? 0) < 2) continue;
    if (!numbers.has(c.partyID)) numbers.set(c.partyID, numbers.size + 1);
  }
  return (client: Client) =>
    client.spectator || client.partyID === undefined
      ? undefined
      : numbers.get(client.partyID);
}
