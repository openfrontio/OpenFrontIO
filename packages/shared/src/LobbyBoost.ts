// Whether paying to boost a waiting lobby would move it up its queue (the
// list as the master orders it). It wouldn't when the lobby is at the front,
// or when the one directly ahead is counting down or was itself paid for:
// paid lobbies keep the order they were paid in. A lobby the list doesn't
// have yet was just created and sits at the back, behind the last one listed.
export function boostWouldMoveLobby<
  T extends { gameID: string; startsAt?: number },
>(queue: readonly T[], gameID: string, isPaid: (lobby: T) => boolean): boolean {
  const index = queue.findIndex((l) => l.gameID === gameID);
  const ahead = queue[(index < 0 ? queue.length : index) - 1];
  return ahead !== undefined && ahead.startsAt === undefined && !isPaid(ahead);
}
