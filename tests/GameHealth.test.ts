import { describe, expect, it } from "vitest";
import { GameHealth, GameHealthContext } from "../src/client/GameHealth";

const healthy: GameHealthContext = {
  active: true,
  catchingUp: false,
  paused: false,
  hidden: false,
  networkEnabled: true,
};

function createHealth(): GameHealth {
  const health = new GameHealth();
  health.update(0, healthy);
  return health;
}

function baseline(health: GameHealth, ms: number): void {
  for (const now of [1000, 2000, 3000]) {
    health.recordRoundTrip(ms, now);
  }
}

function frames(
  health: GameHealth,
  start: number,
  duration: number,
  interval: number,
): number {
  let now = start;
  health.recordFrame(now);
  while (now < start + duration) {
    now += interval;
    health.recordFrame(now);
    health.update(now, healthy);
  }
  return now;
}

describe("GameHealth", () => {
  it.each([40, 215, 320])("accepts a player's normal %ims latency", (ms) => {
    const health = createHealth();
    baseline(health, ms);
    health.recordRoundTrip(ms, 4000);
    expect(health.update(4000, healthy).highLatency).toBe(false);
  });

  it("waits for a baseline, detects a spike, and clears on recovery", () => {
    const health = createHealth();
    health.recordRoundTrip(500, 1000);
    expect(health.update(1000, healthy).highLatency).toBe(false);
    health.reset(0);
    health.update(0, healthy);
    baseline(health, 40);
    health.recordRoundTrip(300, 4000);
    expect(health.update(4000, healthy).highLatency).toBe(true);
    health.recordRoundTrip(40, 5000);
    expect(health.update(5000, healthy).highLatency).toBe(false);
  });

  it("requires both relative and absolute increases and expires stale spikes", () => {
    const health = createHealth();
    baseline(health, 320);
    health.recordRoundTrip(600, 4000);
    expect(health.update(4000, healthy).highLatency).toBe(false);
    health.recordRoundTrip(800, 5000);
    expect(health.update(5000, healthy).highLatency).toBe(true);
    expect(health.update(15000, healthy).highLatency).toBe(false);
  });

  it("adapts its bounded baseline to a lasting connection change", () => {
    const health = createHealth();
    baseline(health, 40);
    for (let now = 4000; now <= 16000; now += 1000) {
      health.recordRoundTrip(400, now);
    }
    expect(health.update(16000, healthy).highLatency).toBe(false);
  });

  it("ignores invalid round trips", () => {
    const health = createHealth();
    baseline(health, 40);
    for (const ms of [-1, Infinity, NaN]) {
      health.recordRoundTrip(ms, 4000);
      expect(health.update(4000, healthy).highLatency).toBe(false);
    }
  });

  it("detects a missing turn without needing another turn or worker update", () => {
    const health = createHealth();
    health.recordTurn(100);
    expect(health.update(599, healthy).connectionUnstable).toBe(false);
    expect(health.update(600, healthy).connectionUnstable).toBe(true);
    health.recordTurn(601);
    expect(health.update(601, healthy).connectionUnstable).toBe(false);
  });

  it.each(["paused", "hidden"] as const)(
    "suppresses %s diagnostics and starts fresh on return",
    (key) => {
      const health = createHealth();
      expect(health.update(1000, { ...healthy, [key]: true })).toEqual({
        highLatency: false,
        connectionUnstable: false,
        performance: false,
      });
      expect(health.update(10000, healthy).connectionUnstable).toBe(false);
      expect(health.update(10499, healthy).connectionUnstable).toBe(false);
      expect(health.update(10500, healthy).connectionUnstable).toBe(true);
    },
  );

  it("suppresses inactive sessions and clears diagnostics and baseline on reset", () => {
    const health = createHealth();
    baseline(health, 40);
    health.recordRoundTrip(400, 4000);
    health.update(4000, { ...healthy, active: false });
    expect(health.update(5000, { ...healthy, active: false })).toEqual({
      highLatency: false,
      connectionUnstable: false,
      performance: false,
    });
    health.reset(5000);
    health.update(5000, healthy);
    health.recordRoundTrip(800, 6000);
    expect(health.update(6000, healthy).highLatency).toBe(false);
  });

  it("shows sustained catch-up and suppresses inflated RTT while recovering", () => {
    const health = createHealth();
    baseline(health, 40);
    health.update(4000, { ...healthy, catchingUp: true });
    expect(
      health.update(4999, { ...healthy, catchingUp: true }).performance,
    ).toBe(false);
    expect(
      health.update(5000, { ...healthy, catchingUp: true }).performance,
    ).toBe(true);
    health.update(5100, healthy);
    health.recordRoundTrip(400, 5200);
    expect(health.update(5200, healthy).highLatency).toBe(false);
    expect(health.update(5200, healthy).performance).toBe(false);
    health.recordRoundTrip(400, 6000);
    expect(health.update(6000, healthy).highLatency).toBe(true);
  });

  it("rejects pings sent during the final interval before visibility resumes", () => {
    const health = createHealth();
    baseline(health, 40);
    health.update(4000, { ...healthy, hidden: true });
    health.update(5000, healthy);
    health.recordRoundTrip(400, 5100);
    expect(health.update(5100, healthy).highLatency).toBe(false);
    health.recordRoundTrip(400, 6000);
    expect(health.update(6000, healthy).highLatency).toBe(true);
  });

  it("rejects pings from the final catch-up interval before recovery", () => {
    const health = createHealth();
    baseline(health, 40);
    health.update(4000, { ...healthy, catchingUp: true });
    health.update(5000, healthy);
    health.recordRoundTrip(400, 5100);
    expect(health.update(5100, healthy).highLatency).toBe(false);
  });

  it("rejects RTT across a long frame even before sustained low FPS", () => {
    const health = createHealth();
    baseline(health, 40);
    health.recordFrame(4000);
    health.recordFrame(4200);
    health.recordRoundTrip(400, 4300);
    expect(health.update(4300, healthy).highLatency).toBe(false);
    expect(health.update(4300, healthy).performance).toBe(false);
  });

  it("rejects a pong delivered before the first frame after a blocked main thread", () => {
    const health = createHealth();
    baseline(health, 40);
    health.recordFrame(4000);
    health.recordRoundTrip(400, 4300);
    expect(health.update(4300, healthy).highLatency).toBe(false);
  });

  it("does not mistake one long blocked frame for sustained low FPS", () => {
    const health = createHealth();
    health.recordFrame(0);
    health.recordFrame(5000);
    expect(health.update(5000, healthy).performance).toBe(false);
    frames(health, 5000, 1200, 16);
    expect(health.update(6200, healthy).performance).toBe(false);
  });

  it("requires sustained low FPS and recovers after a healthy frame window", () => {
    const health = createHealth();
    let now = frames(health, 0, 2000, 50);
    expect(health.update(now, healthy).performance).toBe(false);
    now = frames(health, now, 1000, 50);
    expect(health.update(now, healthy).performance).toBe(true);
    now = frames(health, now, 1200, 16);
    expect(health.update(now, healthy).performance).toBe(false);
  });

  it("does not accumulate intermittent low-FPS windows into a sustained warning", () => {
    const health = createHealth();
    let now = 0;
    for (let dip = 0; dip < 3; dip++) {
      now = frames(health, now, 1000, 50);
      expect(health.update(now, healthy).performance).toBe(false);
      now = frames(health, now, 1000, 31.25);
      expect(health.update(now, healthy).performance).toBe(false);
    }
  });

  it("accepts RTT after a moderate-FPS window interrupts an incomplete low-FPS streak", () => {
    const health = createHealth();
    baseline(health, 40);
    let now = frames(health, 4000, 1000, 50);
    now = frames(health, now, 1000, 31.25);
    now = frames(health, now, 500, 31.25);
    health.recordRoundTrip(300, now);
    expect(health.update(now, healthy).highLatency).toBe(true);
  });

  it.each([35, 40])(
    "keeps an active warning through 30–34 FPS and clears at %i FPS",
    (recoveryFps) => {
      const health = createHealth();
      let now = frames(health, 0, 3000, 50);
      expect(health.update(now, healthy).performance).toBe(true);
      for (const fps of [30, 32, 34]) {
        now = frames(health, now, 1200, 1000 / fps);
        expect(health.update(now, healthy).performance).toBe(true);
      }
      now = frames(health, now, 1500, 1000 / recoveryFps);
      expect(health.update(now, healthy).performance).toBe(false);
    },
  );

  it("keeps network warnings disabled for local games while diagnosing performance", () => {
    const health = createHealth();
    baseline(health, 40);
    health.recordRoundTrip(500, 4000);
    const local = { ...healthy, networkEnabled: false, catchingUp: true };
    health.update(5000, local);
    expect(health.update(6000, local)).toEqual({
      highLatency: false,
      connectionUnstable: false,
      performance: true,
    });
  });
});
