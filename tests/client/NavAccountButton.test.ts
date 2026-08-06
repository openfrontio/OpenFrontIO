import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateAccountNavButton } from "../../src/client/NavAccountButton";
import { getDiscordAvatarUrl } from "../../src/client/Utils";
import type { DiscordUser, UserMeResponse } from "../../src/core/ApiSchemas";

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

const discordUser: DiscordUser = {
  id: "1",
  avatar: "abc",
  username: "JishDiscord",
  global_name: "Jish",
  discriminator: "0",
};

const hidden = (el: Element) => el.classList.contains("hidden");

describe("updateAccountNavButton", () => {
  let nav: ReturnType<typeof mountNav>;
  beforeEach(() => {
    nav = mountNav();
  });

  it("shows the sign-in prompt for a signed-out user", () => {
    updateAccountNavButton(false);
    expect(hidden(nav.signInText)).toBe(false);
    expect(hidden(nav.avatar)).toBe(true);
  });

  it("shows the Steam avatar (not the sign-in prompt) for a Steam session", () => {
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
    updateAccountNavButton(userMe({ email: "player@example.com" }));
    expect(hidden(nav.signInText)).toBe(true);
    expect(hidden(nav.emailBadge)).toBe(false);
  });

  it("prefers the Discord avatar over Steam for a linked account", () => {
    updateAccountNavButton(
      userMe({
        discord: discordUser,
        steam: {
          steamId: "76561198024013188",
          personaName: "Jish",
          avatarUrl: "https://avatars.steamstatic.com/abc_full.jpg",
        },
      }),
    );
    // Discord is checked first, so its avatar wins — not the Steam one.
    expect(hidden(nav.avatar)).toBe(false);
    expect(nav.avatar.getAttribute("src")).toBe(
      "https://cdn/discord-avatar.png",
    );
  });

  it("keeps a Discord user with no resolvable avatar logged in", () => {
    // A modern Discord account (no discriminator) with no custom avatar yields
    // no URL — it must still read as logged in, not fall through to sign-in.
    vi.mocked(getDiscordAvatarUrl).mockReturnValueOnce(null);
    updateAccountNavButton(userMe({ discord: discordUser }));
    expect(hidden(nav.signInText)).toBe(true);
    expect(hidden(nav.personIcon)).toBe(false);
    expect(hidden(nav.avatar)).toBe(true);
  });
});
