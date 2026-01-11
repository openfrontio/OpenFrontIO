export interface PriorityQueue {
  push(node: number, priority: number): void;
  pop(): number;
  isEmpty(): boolean;
  clear(): void;
}

// Binary min-heap: O(log n) push/pop, works with any priority values
export class MinHeap implements PriorityQueue {
  private heap: Int32Array;
  private priorities: Float32Array;
  private size = 0;

  constructor(capacity: number) {
    this.heap = new Int32Array(capacity);
    this.priorities = new Float32Array(capacity);
  }

  push(node: number, priority: number): void {
    let i = this.size++;
    this.heap[i] = node;
    this.priorities[i] = priority;

    // Bubble up
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      // Swap
      const tmpNode = this.heap[parent];
      const tmpPri = this.priorities[parent];
      this.heap[parent] = this.heap[i];
      this.priorities[parent] = this.priorities[i];
      this.heap[i] = tmpNode;
      this.priorities[i] = tmpPri;
      i = parent;
    }
  }

  pop(): number {
    const result = this.heap[0];
    this.size--;
    if (this.size > 0) {
      this.heap[0] = this.heap[this.size];
      this.priorities[0] = this.priorities[this.size];

      // Bubble down
      let i = 0;
      while (true) {
        const left = (i << 1) + 1;
        const right = left + 1;
        let smallest = i;

        if (
          left < this.size &&
          this.priorities[left] < this.priorities[smallest]
        ) {
          smallest = left;
        }
        if (
          right < this.size &&
          this.priorities[right] < this.priorities[smallest]
        ) {
          smallest = right;
        }
        if (smallest === i) break;

        // Swap
        const tmpNode = this.heap[smallest];
        const tmpPri = this.priorities[smallest];
        this.heap[smallest] = this.heap[i];
        this.priorities[smallest] = this.priorities[i];
        this.heap[i] = tmpNode;
        this.priorities[i] = tmpPri;
        i = smallest;
      }
    }
    return result;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  clear(): void {
    this.size = 0;
  }
}

// Bucket queue: O(1) push/pop when priorities are integers
export class BucketQueue implements PriorityQueue {
  private buckets: Int32Array[];
  private bucketSizes: Int32Array;
  private minBucket: number;
  private maxBucket: number;
  private size: number;

  constructor(maxPriority: number) {
    this.maxBucket = maxPriority + 1;
    this.buckets = new Array(this.maxBucket);
    this.bucketSizes = new Int32Array(this.maxBucket);
    this.minBucket = this.maxBucket;
    this.size = 0;
  }

  push(node: number, priority: number): void {
    const bucket = Math.min(priority | 0, this.maxBucket - 1);

    if (!this.buckets[bucket]) {
      this.buckets[bucket] = new Int32Array(64);
    }

    const size = this.bucketSizes[bucket];
    if (size >= this.buckets[bucket].length) {
      const newBucket = new Int32Array(this.buckets[bucket].length * 2);
      newBucket.set(this.buckets[bucket]);
      this.buckets[bucket] = newBucket;
    }

    this.buckets[bucket][size] = node;
    this.bucketSizes[bucket]++;
    this.size++;

    if (bucket < this.minBucket) {
      this.minBucket = bucket;
    }
  }

  pop(): number {
    while (this.minBucket < this.maxBucket) {
      const size = this.bucketSizes[this.minBucket];
      if (size > 0) {
        this.bucketSizes[this.minBucket]--;
        this.size--;
        return this.buckets[this.minBucket][size - 1];
      }
      this.minBucket++;
    }
    return -1;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  clear(): void {
    this.bucketSizes.fill(0);
    this.minBucket = this.maxBucket;
    this.size = 0;
  }
}
