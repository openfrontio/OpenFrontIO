import { afterEach, describe, expect, it, vi } from "vitest";
import { AdGatekeeper } from "../../src/client/AdGatekeeper";

describe("AdGatekeeper", () => {
  const originalBody = document.body;

  afterEach(() => {
    if (document.body === null) document.documentElement.append(originalBody);
    window.localStorage.clear();
  });

  it("makes no reading when document.body is null instead of throwing", async () => {
    document.body.remove();
    expect(document.body).toBeNull();

    const gate = new AdGatekeeper();
    const listener = vi.fn();
    gate.subscribe(listener);
    gate.start();

    const probe = (
      gate as unknown as { baitBlocked: () => Promise<boolean | null> }
    ).baitBlocked();
    await expect(probe).resolves.toBeNull();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
    expect(gate.canShowAds).toBe(false);
    expect(window.localStorage.getItem("adblock-detected")).toBeNull();
    gate.stop();
  });

  it("ignores an inconclusive probe and applies the next reading", async () => {
    const probe = vi
      .fn<() => Promise<boolean | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(false);
    const gate = new AdGatekeeper({ probe, pollMs: 60_000 });
    const listener = vi.fn();
    gate.subscribe(listener);

    gate.start();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith("clear", true),
    );
    expect(probe).toHaveBeenCalledTimes(2);
    gate.stop();
  });
});
