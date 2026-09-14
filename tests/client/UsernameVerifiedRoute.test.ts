import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { showInGameConfirm } = vi.hoisted(() => ({
  showInGameConfirm: vi.fn(async () => false),
}));
vi.mock("../../src/client/InGameModal", () => ({ showInGameConfirm }));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  showToast: vi.fn(),
}));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: () => false,
    getUsername: vi.fn(async () => null),
    addAuthListener: vi.fn(),
  },
}));
vi.mock("../../src/client/SteamSDK", () => ({
  steamSDK: { isOnSteam: () => false, getPersonaName: vi.fn(async () => null) },
}));

import { UsernameInput } from "../../src/client/UsernameInput";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

// A subscriber whose bare name isn't usable yet: entitled, but never set (or
// server-renamed to TEMPORARY####).
function subscriberWithoutName(): UserMeResponse {
  return {
    user: { email: "player@example.com" },
    player: {
      publicId: "p",
      usernameStatus: "premium",
      usernameBase: null,
      username: null,
      nextUsernameChangeAt: null,
    },
  } as unknown as UserMeResponse;
}

describe("username-input verified toggle", () => {
  let el: UsernameInput;

  beforeEach(async () => {
    if (!customElements.get("username-input")) {
      customElements.define("username-input", UsernameInput);
    }
    el = document.createElement("username-input") as UsernameInput;
    document.body.appendChild(el);
    await el.updateComplete;
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: subscriberWithoutName() }),
    );
    await el.updateComplete;
    window.location.hash = "";
  });

  afterEach(() => {
    el.remove();
    window.location.hash = "";
    vi.clearAllMocks();
  });

  it("sends an entitled player with no name to the username form", async () => {
    // Used to open the account modal, which no longer hosts the username
    // form — it moved to its own modal.
    const toggle = el.querySelector<HTMLButtonElement>(
      'button[aria-pressed="false"]',
    );
    expect(toggle).toBeTruthy();
    toggle!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(window.location.hash).toBe("#modal=change-username");
    // No sub upsell — they're already entitled.
    expect(showInGameConfirm).not.toHaveBeenCalled();
  });
});
