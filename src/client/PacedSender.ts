/**
 * Sends queued work at a fixed minimum spacing.
 *
 * The server drops intents past its per-second budget, so a burst of batches
 * has to be spread out rather than emitted all at once.
 */
export class PacedSender {
  private readonly queue: (() => boolean)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly intervalMs: number) {}

  push(send: () => boolean): void {
    this.queue.push(send);
    if (this.timer === null) this.next();
  }

  clear(): void {
    this.queue.length = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private next(): void {
    const send = this.queue[0];
    if (send === undefined) {
      this.timer = null;
      return;
    }
    // Keep the item queued if it could not be sent, so a reconnect does not
    // lose it. leaveGame() clears the queue when the game is over.
    if (send()) this.queue.shift();
    this.timer = setTimeout(() => this.next(), this.intervalMs);
  }
}
