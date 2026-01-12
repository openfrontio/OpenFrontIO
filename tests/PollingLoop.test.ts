import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling } from "../src/server/PollingLoop";

vi.mock("../src/server/Logger", () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
    }),
  },
}));

describe("PollingLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not start the next task until the previous one completes", async () => {
    let taskCallCount = 0;
    let resolveTask: ((value?: void) => void) | undefined;

    const task = vi.fn().mockImplementation(() => {
      taskCallCount++;
      return new Promise<void>((resolve) => {
        resolveTask = resolve;
      });
    });

    startPolling(task, 100);

    // Initial call
    expect(taskCallCount).toBe(1);

    // Advance time past the interval - should NOT trigger next call yet
    await vi.advanceTimersByTimeAsync(200);
    expect(taskCallCount).toBe(1);

    // Resolve the first task
    if (resolveTask) resolveTask();

    // Wait for microtasks (promise callbacks, finally block) to run
    await new Promise(process.nextTick);

    // NOW advance time to trigger the scheduled continuation
    await vi.advanceTimersByTimeAsync(100);

    expect(taskCallCount).toBe(2);
  });

  it("should continue polling even if a task fails", async () => {
    let taskCallCount = 0;
    const task = vi.fn().mockImplementation(async () => {
      taskCallCount++;
      if (taskCallCount === 1) {
        throw new Error("Task failed");
      }
    });

    startPolling(task, 100);

    // First call
    expect(taskCallCount).toBe(1);

    // Wait for rejection and finally block
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    // Advance time
    await vi.advanceTimersByTimeAsync(100);

    // Second call
    expect(taskCallCount).toBe(2);
  });
});
