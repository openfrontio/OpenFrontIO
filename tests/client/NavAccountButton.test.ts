import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateAccountNavButton } from "../../src/client/NavAccountButton";
import type { UserMeResponse } from "../../src/core/ApiSchemas";

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  getDiscordAvatarUrl: vi.fn(() => "https://cdn/discord-avatar.png"),
}));

// Mirror the nav-button DOM the DesktopNavBar renders.
function mountNav() {
  document.body.innerHTML = `
    <button id="nav-account-button">
      <span id="nav-account-loading-spinner"></span>
      <img id="nav-account-avatar" class="hidden" />
      <svg id="nav-account-person-icon" class="hidden"></svg>
      <span id="nav-account-email-badge" class="hidden"></span>
      <span id="nav-account-signin-text" class="hidden"></span>
    </button>`;
  return {
    button: document.getElementById("nav-account-button")!,
    avatar: document.getElementById("nav-account-avatar") as HTMLImageElement,
    personIcon: document.getElementById("nav-account-person-icon")!,
    emailBadge: document.getElementById("nav-account-email-badge")!,
    signInText: document.getElementById("nav-account-signin-text")!,
  };
}

// Build a /users/@me `user` object with only the identities under test.
function userMe(user: UserMeResponse["user"]): UserMeResponse {
  return { user, player: {} as UserMeResponse["player"] };
}

const hidden = (el: Element) => el.classList.contains("hidden");

describe("updateAccountNavButton", () => {
  beforeEach(() => mountNav());

  it("shows the sign-in prompt for a signed-out user", () => {
    const nav = mountNav();
    updateAccountNavButton(false);
    expect(hidden(nav.signInText)).toBe(false);
    expect(hidden(nav.avatar)).toBe(true);
  });

  it("shows the Steam avatar (not the sign-in prompt) for a Steam session", () => {
    const nav = mountNav();
    updateAccountNavButton(
      userMe({
        steam: {
          steamId: "76561198024013188",
          personaName: "Jish",
          avatarUrl: "https://avatars.steamstatic.com/abc_full.jpg",
        },
      }),
    );
    // The core regression: a Steam-authed user must read as logged in.
    expect(hidden(nav.signInText)).toBe(true);
    expect(hidden(nav.avatar)).toBe(false);
    expect(nav.avatar.getAttribute("src")).toBe(
      "https://avatars.steamstatic.com/abc_full.jpg",
    );
  });

  it("shows the logged-in person icon for a Steam session with no avatar", () => {
    const nav = mountNav();
    updateAccountNavButton(
      userMe({
        steam: {
          steamId: "76561198024013188",
          personaName: null,
          avatarUrl: null,
        },
      }),
    );
    // No avatar to show, but still logged in — never the sign-in prompt.
    expect(hidden(nav.signInText)).toBe(true);
    expect(hidden(nav.avatar)).toBe(true);
    expect(hidden(nav.personIcon)).toBe(false);
    expect(hidden(nav.emailBadge)).toBe(true);
  });

  it("shows the email badge for an email session", () => {
    const nav = mountNav();
    updateAccountNavButton(userMe({ email: "player@example.com" }));
    expect(hidden(nav.signInText)).toBe(true);
    expect(hidden(nav.emailBadge)).toBe(false);
  });
});
