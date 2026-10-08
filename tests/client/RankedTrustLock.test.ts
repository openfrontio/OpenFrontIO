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
  return {
    user: { email: "player@example.com" },
    player: { trustTier },
  } as unknown as UserMeResponse;
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

describe("Ranked button trust popup", () => {
  let showPage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    showPage = vi.fn();
    (window as unknown as { showPage: unknown }).showPage = showPage;
  });

  afterEach(() => {
    delete (window as unknown as { showPage?: unknown }).showPage;
  });

  function rankedButton(selector: Selector): HTMLButtonElement {
    const button = [
      ...selector.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent?.includes("mode_selector.ranked_title"));
    expect(button).toBeDefined();
    return button!;
  }

  async function clickRanked(selector: Selector): Promise<void> {
    rankedButton(selector).click();
    await selector.updateComplete;
  }

  const dialog = (selector: Selector) =>
    selector.querySelector("confirm-dialog") as
      | (HTMLElement & { heading: string; message: string })
      | null;

  it("shows the ranked trust popup instead of opening ranked when untrusted", async () => {
    const selector = await mount();
    await broadcast(selector, me("untrusted"));
    await clickRanked(selector);
    expect(showPage).not.toHaveBeenCalled();
    expect(dialog(selector)?.heading).toBe(
      "mode_selector.ranked_trust_required_title",
    );
    expect(dialog(selector)?.message).toBe(
      "mode_selector.ranked_trust_required_body",
    );
  });

  it("tells a signed-out viewer to sign in first", async () => {
    const selector = await mount();
    await broadcast(selector, false);
    await clickRanked(selector);
    expect(showPage).not.toHaveBeenCalled();
    expect(dialog(selector)?.message).toBe(
      "mode_selector.ranked_trust_required_body_signed_out",
    );
  });

  it("closes the popup on dismiss", async () => {
    const selector = await mount();
    await broadcast(selector, me("untrusted"));
    await clickRanked(selector);
    dialog(selector)!.dispatchEvent(new CustomEvent("cancel"));
    await selector.updateComplete;
    expect(dialog(selector)).toBeNull();
  });

  it("opens ranked for a trusted viewer", async () => {
    const selector = await mount();
    await broadcast(selector, me("trusted"));
    await clickRanked(selector);
    expect(showPage).toHaveBeenCalledWith("page-ranked");
    expect(dialog(selector)).toBeNull();
  });

  it("opens ranked before /users/@me has answered", async () => {
    const selector = await mount();
    await clickRanked(selector);
    expect(showPage).toHaveBeenCalledWith("page-ranked");
  });
});
