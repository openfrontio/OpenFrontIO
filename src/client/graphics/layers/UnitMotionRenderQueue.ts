import FastPriorityQueue from "fastpriorityqueue";

export type UnitMotionRenderQueueEntry = {
  unitId: number;
  version: number;
  priority: number;
  onScreenHint: boolean;
};

export class UnitMotionRenderQueue {
  private queue = new FastPriorityQueue<UnitMotionRenderQueueEntry>(
    (a, b) => a.priority > b.priority,
  );

  enqueue(entry: UnitMotionRenderQueueEntry): void {
    this.queue.add(entry);
  }

  pollValid(
    isValid: (entry: UnitMotionRenderQueueEntry) => boolean,
  ): UnitMotionRenderQueueEntry | null {
    while (!this.queue.isEmpty()) {
      const entry = this.queue.poll();
      if (!entry) {
        break;
      }
      if (isValid(entry)) {
        return entry;
      }
    }
    return null;
  }

  size(): number {
    return this.queue.size;
  }

  clear(): void {
    this.queue = new FastPriorityQueue<UnitMotionRenderQueueEntry>(
      (a, b) => a.priority > b.priority,
    );
  }
}
