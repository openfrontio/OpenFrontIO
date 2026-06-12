import { FlatBinaryHeap } from "../src/core/execution/utils/FlatBinaryHeap";

describe("FlatBinaryHeap", () => {
  test("dequeues tiles in ascending priority order", () => {
    const heap = new FlatBinaryHeap();
    const entries: [number, number][] = [
      [100, 5.0],
      [200, 1.0],
      [300, 3.0],
      [400, 2.0],
      [500, 4.0],
    ];
    for (const [tile, pri] of entries) {
      heap.enqueue(tile, pri);
    }
    expect(heap.size()).toBe(5);
    expect(heap.dequeue()).toBe(200);
    expect(heap.dequeue()).toBe(400);
    expect(heap.dequeue()).toBe(300);
    expect(heap.dequeue()).toBe(500);
    expect(heap.dequeue()).toBe(100);
    expect(heap.size()).toBe(0);
  });

  test("throws when dequeuing an empty heap", () => {
    const heap = new FlatBinaryHeap();
    expect(() => heap.dequeue()).toThrow("heap empty");
  });

  test("clear empties the heap without breaking subsequent use", () => {
    const heap = new FlatBinaryHeap();
    heap.enqueue(1, 1);
    heap.enqueue(2, 2);
    heap.clear();
    expect(heap.size()).toBe(0);
    heap.enqueue(3, 3);
    expect(heap.dequeue()).toBe(3);
  });

  test("grows past its initial capacity and stays ordered", () => {
    const heap = new FlatBinaryHeap(4);
    // Insert in descending priority so every enqueue sifts up.
    const n = 1000;
    for (let i = 0; i < n; i++) {
      heap.enqueue(i, n - i);
    }
    expect(heap.size()).toBe(n);
    for (let i = 0; i < n; i++) {
      expect(heap.dequeue()).toBe(n - 1 - i);
    }
  });
});
