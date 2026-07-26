/**
 * Sends queued work at a fixed minimum spacing.
 *
 * The server drops intents past its per-second budget, so a burst of batches
 * has to be spread out rather than emitted all at once.
 */
export class PacedSender {
  private readonly queue: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly intervalMs: number) {}

  push(send: () => void): void {
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
    const send = this.queue.shift();
    if (send === undefined) {
      this.timer = null;
      return;
    }
    send();
    this.timer = setTimeout(() => this.next(), this.intervalMs);
  }
}
