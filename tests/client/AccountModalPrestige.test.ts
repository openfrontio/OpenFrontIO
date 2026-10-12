import type {
  PrestigeResponse,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks as in AccountModal.rendering.test.ts.
vi.mock("../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => false as const),
  invalidateUserMe: vi.fn(),
  fetchPlayerById: vi.fn(async () => null),
  setMarketingConsent: vi.fn(async () => true),
  getApiBase: vi.fn(() => ""),
}));

vi.mock("../../src/client/Auth", () => ({
  discordLogin: vi.fn(),
  googleLogin: vi.fn(),
  linkGoogle: vi.fn(async () => true),
  linkSteam: vi.fn(async () => true),
  steamLogin: vi.fn(),
  logOut: vi.fn(async () => true),
  reauthAfterCrazyGamesChange: vi.fn(async () => false),
  sendMagicLink: vi.fn(async () => true),
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  showToast: vi.fn(),
  getDiscordAvatarUrl: vi.fn(() => null),
  copyToClipboard: vi.fn(),
  renderNumber: vi.fn((n: number) => String(n)),
  getMapName: vi.fn((m: string) => m),
  renderDuration: vi.fn(() => ""),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    getUserProfile: vi.fn(async () => null),
    showAuthPrompt: vi.fn(async () => null),
    isAvailable: false,
  },
}));

vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics: vi.fn(async () => null),
  translateCosmetic: vi.fn((v: unknown) => v),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
});

import { AccountModal } from "../../src/client/AccountModal";
import { getUserMe, invalidateUserMe } from "../../src/client/Api";
import type { PrestigeFlow } from "../../src/client/components/PrestigeFlow";
import { showInGameAlert } from "../../src/client/InGameModal";

const AT_100 = {
  prestige: 3,
  level: 100,
  xpInLevel: 0,
  xpForNext: 0,
  lifetimeXp: 820000,
  legend: false,
  canPrestige: true,
};
const AFTER = { ...AT_100, prestige: 4, level: 1, xpForNext: 150 };
const REWARD = {
  id: "r1",
  currencyType: "soft" as const,
  amount: "5000",
  reason: "prestige",
  note: null,
};

function userMe(
  progress: typeof AT_100,
  rewards: (typeof REWARD)[] = [],
): UserMeResponse {
  return {
    user: { discord: { id: "1", username: "lewis" } },
    player: {
      publicId: "me",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [], player: [] },
      friends: [],
      subscription: null,
      currency: { soft: 100, hard: 10 },
      progress,
      rewards,
    },
  } as unknown as UserMeResponse;
}

describe("AccountModal — after a prestige", () => {
  let modal: AccountModal;
  let broadcasts: UserMeResponse[];
  const onUserMe = (e: Event) =>
    broadcasts.push((e as CustomEvent<UserMeResponse>).detail);

  beforeEach(async () => {
    if (!customElements.get("account-modal")) {
      customElements.define("account-modal", AccountModal);
    }
    broadcasts = [];
    document.addEventListener("userMeResponse", onUserMe);
    modal = document.createElement("account-modal") as AccountModal;
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    await modal.updateComplete;
    // Signed in at level 100, the reward already listed.
    (modal as unknown as { userMeResponse: UserMeResponse }).userMeResponse =
      userMe(AT_100, [REWARD]);
    (modal as unknown as { isLoadingUser: boolean }).isLoadingUser = false;
    modal.requestUpdate();
    await modal.updateComplete;
  });

  afterEach(() => {
    document.removeEventListener("userMeResponse", onUserMe);
    modal.remove();
    vi.clearAllMocks();
  });

  const flow = () => modal.querySelector("prestige-flow")!;
  const own = () =>
    (modal as unknown as { userMeResponse: UserMeResponse }).userMeResponse;
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;
  };

  it("tells the rewards panel a linked account is signed in", () => {
    const panel = modal.querySelector("rewards-panel") as unknown as {
      signedIn: boolean;
    } | null;
    expect(panel).not.toBeNull();
    expect(panel!.signedIn).toBe(true);
  });

  it("opens the prestige flow on the press", async () => {
    // Already on its way: the card offers Prestige.
    await modal.loadPrestigeFlow();
    expect(customElements.get("prestige-flow")).toBeDefined();
    modal
      .querySelector("profile-card")!
      .dispatchEvent(
        new CustomEvent("prestige-request", { bubbles: true, composed: true }),
      );
    await vi.waitFor(() =>
      expect((flow() as unknown as PrestigeFlow).isOpen).toBe(true),
    );
  });

  it("fetches the prestige flow when /users/@me lands, not on render", async () => {
    const load = vi.fn(async () => undefined);
    modal.loadPrestigeFlow = load;
    modal.requestUpdate();
    await modal.updateComplete;
    expect(modal.querySelector("profile-card")).not.toBeNull();
    expect(load).not.toHaveBeenCalled();

    // Opening reads /users/@me: a player who can prestige.
    vi.mocked(getUserMe).mockResolvedValueOnce(userMe(AT_100));
    modal.open();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await settle();
    modal.requestUpdate();
    await modal.updateComplete;
    expect(load).toHaveBeenCalledTimes(1);

    // A broadcast /users/@me (the header's re-read, a sign-in) too.
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: userMe(AT_100) }),
    );
    expect(load).toHaveBeenCalledTimes(2);

    // Not for a player who can't.
    document.dispatchEvent(
      new CustomEvent("userMeResponse", {
        detail: userMe({ ...AFTER, canPrestige: false }),
      }),
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("says so when the prestige flow can't be fetched", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    modal.loadPrestigeFlow = () => Promise.reject(new Error("offline"));
    modal
      .querySelector("profile-card")!
      .dispatchEvent(
        new CustomEvent("prestige-request", { bubbles: true, composed: true }),
      );
    await vi.waitFor(() =>
      expect(showInGameAlert).toHaveBeenCalledWith("prestige.load_failed"),
    );
  });

  it("shows the new rank, lists a replayed reward once, and tells the header", async () => {
    vi.mocked(getUserMe).mockResolvedValueOnce(userMe(AFTER, [REWARD]));
    flow().dispatchEvent(
      new CustomEvent<PrestigeResponse>("prestiged", {
        detail: { progress: AFTER, rewards: [REWARD] },
      }),
    );
    await settle();

    expect(own().player.progress).toEqual(AFTER);
    expect(own().player.rewards).toHaveLength(1);
    expect(invalidateUserMe).toHaveBeenCalled();
    // The header's account menu re-renders on this event.
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].player.progress).toEqual(AFTER);
  });

  it("reloads and says so when the server refuses", async () => {
    vi.mocked(getUserMe).mockResolvedValueOnce(userMe(AFTER));
    flow().dispatchEvent(new CustomEvent("prestige-stale"));
    await settle();

    expect(broadcasts).toHaveLength(1);
    expect(own().player.progress).toEqual(AFTER);
    expect(showInGameAlert).toHaveBeenCalledWith("prestige.stale");
  });

  it("asks for a reload when the account can't be re-read", async () => {
    vi.mocked(getUserMe).mockResolvedValueOnce(false);
    flow().dispatchEvent(new CustomEvent("prestige-stale"));
    await settle();

    // Nothing is broadcast: a failed read must not look like signing out.
    expect(broadcasts).toHaveLength(0);
    expect(showInGameAlert).toHaveBeenCalledWith("prestige.stale_failed");
  });
});
