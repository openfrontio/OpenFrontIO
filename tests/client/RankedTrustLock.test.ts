import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";

vi.mock("../../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    start(): void {}
    stop(): void {}
  },
}));

const lastBroadcast = vi.hoisted(() => ({
  current: null as { response: UserMeResponse | false } | null,
}));

vi.mock("../../src/client/UserMeBroadcast", () => ({
  lastUserMeResponse: () => lastBroadcast.current,
}));

// Registers <game-mode-selector> as a side effect.
import "../../src/client/GameModeSelector";

type Selector = HTMLElement & { updateComplete: Promise<unknown> };

function me(trustTier: "trusted" | "untrusted"): UserMeResponse {
  return { user: {}, player: { trustTier } } as unknown as UserMeResponse;
}

async function mount(): Promise<Selector> {
  const selector = document.createElement("game-mode-selector") as Selector;
  document.body.appendChild(selector);
  await selector.updateComplete;
  return selector;
}

async function broadcast(
  selector: Selector,
  response: UserMeResponse | false,
): Promise<void> {
  document.dispatchEvent(
    new CustomEvent("userMeResponse", { detail: response }),
  );
  await selector.updateComplete;
}

// No lobbies are pushed, so the only lock on the page is the Ranked button's.
function rankedLock(selector: Selector): HTMLElement | null {
  return selector.querySelector("[data-trust]");
}

beforeEach(() => {
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "",
    jwtAudience: "test",
    instanceId: "test",
    gitCommit: "test",
  };
  ClientEnv.reset();
  lastBroadcast.current = null;
});

afterEach(() => {
  document.body.innerHTML = "";
  window.BOOTSTRAP_CONFIG = undefined;
  ClientEnv.reset();
});

describe("Ranked button trust lock", () => {
  it("shows no lock before /users/@me has answered", async () => {
    const selector = await mount();
    expect(rankedLock(selector)).toBeNull();
  });

  it("shows a green open lock for a trusted viewer", async () => {
    const selector = await mount();
    await broadcast(selector, me("trusted"));
    const lock = rankedLock(selector);
    expect(lock?.dataset.trust).toBe("unlocked");
    expect(lock?.classList.contains("text-green-400")).toBe(true);
    expect(lock?.closest("button")?.textContent).toContain(
      "mode_selector.ranked_title",
    );
  });

  it("shows a red closed lock for an untrusted viewer", async () => {
    const selector = await mount();
    await broadcast(selector, me("untrusted"));
    const lock = rankedLock(selector);
    expect(lock?.dataset.trust).toBe("locked");
    expect(lock?.classList.contains("text-red-400")).toBe(true);
  });

  it("shows a red closed lock when signed out", async () => {
    const selector = await mount();
    await broadcast(selector, false);
    expect(rankedLock(selector)?.dataset.trust).toBe("locked");
  });

  it("reads a broadcast that went out before it mounted", async () => {
    lastBroadcast.current = { response: me("trusted") };
    const selector = await mount();
    expect(rankedLock(selector)?.dataset.trust).toBe("unlocked");
  });
});
