import Benchmark from "benchmark";
import {
  BucketQueue,
  MinHeap,
} from "../../src/core/pathfinding/algorithms/PriorityQueue";

const results: string[] = [];

// Setup queues
const minHeap = new MinHeap(10000);
const bucketQueue = new BucketQueue(100); // Max priority 100

new Benchmark.Suite()
  .add("MinHeap Push/Pop (Cycle)", () => {
    for (let i = 0; i < 100; i++) {
      minHeap.push(i, Math.random() * 100);
    }
    while (!minHeap.isEmpty()) {
      minHeap.pop();
    }
    minHeap.clear();
  })
  .add("BucketQueue Push/Pop (Cycle)", () => {
    for (let i = 0; i < 100; i++) {
      bucketQueue.push(i, Math.floor(Math.random() * 100));
    }
    while (!bucketQueue.isEmpty()) {
      bucketQueue.pop();
    }
    bucketQueue.clear();
  })
  .on("cycle", (event: any) => {
    results.push(String(event.target));
  })
  .on("complete", () => {
    console.log("\n=== Priority Queue Performance Benchmark Results ===");
    for (const result of results) {
      console.log(result);
    }
  })
  .run({ async: true });
