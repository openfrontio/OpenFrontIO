import { PacedSender } from "../../src/client/PacedSender";

const INTERVAL = 150;

describe("PacedSender", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("sends the first item immediately", () => {
    const sender = new PacedSender(INTERVAL);
    const sent: number[] = [];

    sender.push(() => sent.push(0));

    expect(sent).toEqual([0]);
  });

  test("holds the rest until their turn", () => {
    const sender = new PacedSender(INTERVAL);
    const sent: number[] = [];

    for (let i = 0; i < 4; i++) sender.push(() => sent.push(i));

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

    for (let i = 0; i < batches; i++) sender.push(() => sent.push(i));
    vi.advanceTimersByTime(INTERVAL * batches);

    expect(sent).toEqual(Array.from({ length: batches }, (_, i) => i));
  });

  test("never sends faster than the interval", () => {
    const sender = new PacedSender(INTERVAL);
    const times: number[] = [];

    for (let i = 0; i < 15; i++) sender.push(() => times.push(Date.now()));
    vi.advanceTimersByTime(INTERVAL * 15);

    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(INTERVAL);
    }
  });

  test("orders queued later still go out behind the current one", () => {
    const sender = new PacedSender(INTERVAL);
    const sent: string[] = [];

    sender.push(() => sent.push("first"));
    sender.push(() => sent.push("second"));
    expect(sent).toEqual(["first"]);

    vi.advanceTimersByTime(INTERVAL);
    expect(sent).toEqual(["first", "second"]);
  });

  test("clear() drops anything still queued", () => {
    const sender = new PacedSender(INTERVAL);
    const sent: number[] = [];

    for (let i = 0; i < 10; i++) sender.push(() => sent.push(i));
    sender.clear();
    vi.advanceTimersByTime(INTERVAL * 20);

    expect(sent).toEqual([0]);
  });

  test("an interval of zero still preserves order", () => {
    const sender = new PacedSender(0);
    const sent: number[] = [];

    for (let i = 0; i < 5; i++) sender.push(() => sent.push(i));
    vi.runAllTimers();

    expect(sent).toEqual([0, 1, 2, 3, 4]);
  });
});
