import { PacedSender } from "../../src/client/PacedSender";

const INTERVAL = 150;

describe("PacedSender", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Mirrors Transport.sendIntent, which reports whether the socket took it.
  function record(sent: number[], id: number) {
    return () => {
      sent.push(id);
      return true;
    };
  }

  test("sends the first item immediately", () => {
    const sender = new PacedSender(INTERVAL);
    const sent: number[] = [];

    sender.push(record(sent, 0));

    expect(sent).toEqual([0]);
  });

  test("holds the rest until their turn", () => {
    const sender = new PacedSender(INTERVAL);
    const sent: number[] = [];

    for (let i = 0; i < 4; i++) sender.push(record(sent, i));

    expect(sent).toEqual([0]);
    vi.advanceTimersByTime(INTERVAL);
    expect(sent).toEqual([0, 1]);
    vi.advanceTimersByTime(INTERVAL * 2);
    expect(sent).toEqual([0, 1, 2, 3]);
  });

  test("delivers a whole fleet order in order", () => {
    const sender = new PacedSender(INTERVAL);
    const sent: number[] = [];
    const batches = 15;

    for (let i = 0; i < batches; i++) sender.push(record(sent, i));
    vi.advanceTimersByTime(INTERVAL * batches);

    expect(sent).toEqual(Array.from({ length: batches }, (_, i) => i));
  });

  test("never sends faster than the interval", () => {
    const sender = new PacedSender(INTERVAL);
    const times: number[] = [];

    for (let i = 0; i < 15; i++) {
      sender.push(() => {
        times.push(Date.now());
        return true;
      });
    }
    vi.advanceTimersByTime(INTERVAL * 15);

    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(INTERVAL);
    }
  });

  test("keeps unsent batches queued while disconnected", () => {
    const sender = new PacedSender(INTERVAL);
    const sent: number[] = [];
    let connected = false;

    for (let i = 0; i < 3; i++) {
      sender.push(() => {
        if (!connected) return false;
        sent.push(i);
        return true;
      });
    }

    vi.advanceTimersByTime(INTERVAL * 10);
    expect(sent).toEqual([]);

    connected = true;
    vi.advanceTimersByTime(INTERVAL * 3);
    expect(sent).toEqual([0, 1, 2]);
  });

  test("retries the failed batch before the ones behind it", () => {
    const sender = new PacedSender(INTERVAL);
    const order: number[] = [];
    let failFirst = true;

    sender.push(() => {
      if (failFirst) return false;
      order.push(0);
      return true;
    });
    sender.push(record(order, 1));

    expect(order).toEqual([]);
    failFirst = false;
    vi.advanceTimersByTime(INTERVAL * 2);

    expect(order).toEqual([0, 1]);
  });

  test("clear() drops anything still queued", () => {
    const sender = new PacedSender(INTERVAL);
    const sent: number[] = [];

    for (let i = 0; i < 10; i++) sender.push(record(sent, i));
    sender.clear();
    vi.advanceTimersByTime(INTERVAL * 20);

    expect(sent).toEqual([0]);
  });

  test("an interval of zero still preserves order", () => {
    const sender = new PacedSender(0);
    const sent: number[] = [];

    for (let i = 0; i < 5; i++) sender.push(record(sent, i));
    vi.runAllTimers();

    expect(sent).toEqual([0, 1, 2, 3, 4]);
  });
});
