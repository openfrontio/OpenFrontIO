import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsPanel } from "../../../src/client/components/AccountSettingsPanel";
import { ownHiddenLevelBadge } from "../../../src/client/OwnLevelBadge";

type UserMePlayer = UserMeResponse["player"];
type UserMeUser = UserMeResponse["user"];

// Mock translateText as identity so key assertions are exact, mirroring
// AccountModal.rendering.test.ts.
vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

vi.mock("../../../src/client/Api", () => ({
  setMarketingConsent: vi.fn(async () => true),
  deleteAccount: vi.fn(async () => ({ ok: true })),
  getIdentityTokenAudiences: vi.fn(async () => []),
  setLevelVisibility: vi.fn(async (hidden: boolean) => ({ ok: true, hidden })),
  setSearchVisibility: vi.fn(async (hidden: boolean) => ({ ok: true, hidden })),
  getUserMe: vi.fn(async () => false),
}));

vi.mock("../../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));

vi.mock("../../../src/client/Auth", () => ({
  clearLocalSession: vi.fn(),
  linkGoogle: vi.fn(async () => true),
  sendMagicLink: vi.fn(async () => true),
}));

function makePlayer(overrides: Partial<UserMePlayer> = {}): UserMePlayer {
  return {
    publicId: "test-player",
    adfree: false,
    unlimitedRanked: false,
    canCreatePublicLobbies: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
    currency: { soft: 100, hard: 10 },
    ...overrides,
  } as UserMePlayer;
}

describe("AccountSettingsPanel — marketing-consent card", () => {
  let panel: AccountSettingsPanel;

  beforeEach(async () => {
    if (!customElements.get("account-settings-panel")) {
      customElements.define("account-settings-panel", AccountSettingsPanel);
    }
    panel = document.createElement(
      "account-settings-panel",
    ) as AccountSettingsPanel;
    document.body.appendChild(panel);
    await panel.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(panel);
    vi.clearAllMocks();
  });

  async function setState(
    player: UserMePlayer,
    user: UserMeUser,
  ): Promise<void> {
    panel.player = player;
    panel.user = user;
    await panel.updateComplete;
  }

  function findSwitch(): HTMLButtonElement | null {
    return panel.querySelector(
      'button[role="switch"]',
    ) as HTMLButtonElement | null;
  }

  // The bug (OPE-397): Steam-primary AND no email hits both suppressions at
  // once, collapsing the card's only control to nothing.
  it("renders the toggle DISABLED, with Steam-specific copy, for a Steam-primary user with no email", async () => {
    await setState(
      makePlayer({
        marketingConsent: { consented: "no_response", hasEmail: false },
      }),
      { steam: { steamId: "1", personaName: "P", avatarUrl: null } },
    );

    const text = panel.textContent ?? "";
    // The description must not instruct a remedy the build doesn't offer.
    expect(text).toContain("account_modal.marketing_no_email_steam");
    // Not the generic "link an email" copy — that instructs a remedy this
    // build doesn't offer to a Steam-primary player. (Its key is a prefix of
    // the Steam-specific one asserted above, so this can't use toContain.)
    expect(text).not.toMatch(/marketing_no_email(?!_steam)/);
    expect(text).not.toContain("account_modal.marketing_desc");

    // The toggle is present (not omitted) and disabled — the row stays
    // visually intact instead of collapsing to text.
    const toggle = findSwitch();
    expect(toggle).toBeTruthy();
    expect(toggle!.disabled).toBe(true);

    // No email-binding fallback either — Steam is primary, no linking UI.
    expect(panel.querySelector("input[type=email]")).toBeNull();
  });

  // Clicking a disabled control should never fire a consent request — belt
  // and braces alongside the `disabled` attribute (setConsent's own guard).
  it("does not call setMarketingConsent when the disabled Steam toggle is clicked", async () => {
    const { setMarketingConsent } = await import("../../../src/client/Api");
    await setState(
      makePlayer({
        marketingConsent: { consented: "no_response", hasEmail: false },
      }),
      { steam: { steamId: "1", personaName: "P", avatarUrl: null } },
    );

    findSwitch()!.click();
    await panel.updateComplete;

    expect(setMarketingConsent).not.toHaveBeenCalled();
  });

  // Unaffected combination: has email → the working, enabled toggle.
  it("renders a working enabled toggle when the account has an email", async () => {
    const { setMarketingConsent } = await import("../../../src/client/Api");
    await setState(
      makePlayer({
        marketingConsent: { consented: "denied", hasEmail: true },
      }),
      { email: "player@example.com" },
    );

    const text = panel.textContent ?? "";
    expect(text).toContain("account_modal.marketing_desc");
    expect(text).not.toContain("account_modal.marketing_no_email");

    const toggle = findSwitch();
    expect(toggle).toBeTruthy();
    expect(toggle!.disabled).toBe(false);

    toggle!.click();
    await panel.updateComplete;
    expect(setMarketingConsent).toHaveBeenCalledWith(true);
  });

  // Unaffected combination: no email, NOT Steam-primary → existing
  // email-binding UI (magic link + Google), toggle stays omitted.
  it("keeps the email-binding UI (no toggle) for a no-email, non-Steam user", async () => {
    await setState(
      makePlayer({
        marketingConsent: { consented: "no_response", hasEmail: false },
      }),
      {
        discord: {
          id: "1",
          avatar: null,
          username: "player",
          global_name: null,
          discriminator: "0",
        },
      },
    );

    const text = panel.textContent ?? "";
    expect(text).toContain("account_modal.marketing_no_email");
    expect(text).not.toContain("account_modal.marketing_no_email_steam");

    // No toggle at all in this branch — unchanged from before OPE-397.
    expect(findSwitch()).toBeNull();
    expect(panel.querySelector("input[type=email]")).toBeTruthy();
  });
});

describe("AccountSettingsPanel — privacy card (hide my level)", () => {
  let panel: AccountSettingsPanel;
  const progress = {
    prestige: 3,
    level: 96,
    xpInLevel: 10,
    xpForNext: 900,
    lifetimeXp: 1234567,
    legend: false,
    canPrestige: false,
  };

  beforeEach(async () => {
    if (!customElements.get("account-settings-panel")) {
      customElements.define("account-settings-panel", AccountSettingsPanel);
    }
    panel = document.createElement(
      "account-settings-panel",
    ) as AccountSettingsPanel;
    document.body.appendChild(panel);
    await panel.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(panel);
    vi.clearAllMocks();
  });

  async function show(player: UserMePlayer): Promise<void> {
    panel.player = player;
    panel.user = { email: "player@example.com" };
    await panel.updateComplete;
  }

  // Lets the mocked request settle, then the re-render.
  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
    await panel.updateComplete;
  }

  const levelSwitch = () =>
    panel.querySelector(
      'button[role="switch"][aria-label="account_modal.level_visibility_title"]',
    ) as HTMLButtonElement | null;
  const preview = () => panel.querySelector(".level-visibility-preview");

  it("renders no card when /users/@me has no levelHidden (older API)", async () => {
    await show(makePlayer({ progress, username: "Kestrel" }));

    expect(panel.textContent).not.toContain("account_modal.privacy_title");
    expect(levelSwitch()).toBeNull();
  });

  it("sits between the email-updates card and the delete card", async () => {
    await show(
      makePlayer({
        progress,
        levelHidden: false,
        marketingConsent: { consented: "approved", hasEmail: true },
      }),
    );

    const text = panel.textContent ?? "";
    const marketing = text.indexOf("account_modal.marketing_title");
    const privacy = text.indexOf("account_modal.privacy_title");
    const del = text.indexOf("account_modal.delete_account_title");
    expect(marketing).toBeGreaterThanOrEqual(0);
    expect(privacy).toBeGreaterThan(marketing);
    expect(del).toBeGreaterThan(privacy);
    expect(text).toContain("account_modal.level_visibility_desc");
  });

  it("while shown: switch on, and the badge in front of the name in the preview", async () => {
    await show(
      makePlayer({ progress, username: "Kestrel", levelHidden: false }),
    );

    const toggle = levelSwitch()!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(false);

    const strip = preview()!;
    expect(strip.getAttribute("aria-hidden")).toBe("true");
    expect(strip.textContent).toContain(
      "account_modal.level_visibility_others_see",
    );
    expect(strip.textContent).toContain("Kestrel");
    expect(strip.textContent).not.toContain(
      "account_modal.level_visibility_hidden",
    );
    const badge = strip.querySelector("level-badge") as HTMLElement & {
      level: number;
      prestige: number;
    };
    expect(badge.level).toBe(96);
    expect(badge.prestige).toBe(3);
    expect(badge.getAttribute("size")).toBe("24");
  });

  it("while hidden: switch off, the name alone and 'Level hidden'", async () => {
    await show(
      makePlayer({ progress, username: "Kestrel", levelHidden: true }),
    );

    expect(levelSwitch()!.getAttribute("aria-checked")).toBe("false");
    const strip = preview()!;
    expect(strip.querySelector("level-badge")).toBeNull();
    expect(strip.textContent).toContain("Kestrel");
    expect(strip.textContent).toContain(
      "account_modal.level_visibility_hidden",
    );
  });

  it("shows the switch without the preview when progression is off", async () => {
    await show(makePlayer({ username: "Kestrel", levelHidden: false }));

    expect(levelSwitch()).toBeTruthy();
    expect(preview()).toBeNull();
    expect(panel.querySelector("level-badge")).toBeNull();
  });

  it("turning it off: optimistic, disabled in flight, PUTs hidden=true", async () => {
    const { setLevelVisibility } = await import("../../../src/client/Api");
    let answer!: (r: { ok: true; hidden: boolean }) => void;
    vi.mocked(setLevelVisibility).mockImplementationOnce(
      () => new Promise((r) => (answer = r)),
    );
    const player = makePlayer({ progress, levelHidden: false });
    await show(player);

    levelSwitch()!.click();
    await panel.updateComplete;

    expect(setLevelVisibility).toHaveBeenCalledWith(true);
    // Optimistic: already off, on the cached profile object too.
    expect(levelSwitch()!.getAttribute("aria-checked")).toBe("false");
    expect(player.levelHidden).toBe(true);
    expect(preview()!.querySelector("level-badge")).toBeNull();
    // Disabled while in flight; another click sends nothing.
    expect(levelSwitch()!.disabled).toBe(true);
    levelSwitch()!.click();
    expect(setLevelVisibility).toHaveBeenCalledTimes(1);

    answer({ ok: true, hidden: true });
    await settle();
    expect(levelSwitch()!.disabled).toBe(false);
    expect(levelSwitch()!.getAttribute("aria-checked")).toBe("false");
    expect(player.levelHidden).toBe(true);
  });

  it("turning it back on PUTs hidden=false", async () => {
    const { setLevelVisibility } = await import("../../../src/client/Api");
    const player = makePlayer({ progress, levelHidden: true });
    await show(player);

    levelSwitch()!.click();
    await settle();

    expect(setLevelVisibility).toHaveBeenCalledWith(false);
    expect(levelSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(player.levelHidden).toBe(false);
    expect(preview()!.querySelector("level-badge")).toBeTruthy();
  });

  it("reverts and shows the error alert when the request fails", async () => {
    const { setLevelVisibility } = await import("../../../src/client/Api");
    const { showInGameAlert } = await import("../../../src/client/InGameModal");
    vi.mocked(setLevelVisibility).mockResolvedValueOnce({
      ok: false,
      code: "failed",
    });
    const player = makePlayer({ progress, levelHidden: false });
    await show(player);

    levelSwitch()!.click();
    await settle();

    expect(levelSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(levelSwitch()!.disabled).toBe(false);
    expect(player.levelHidden).toBe(false);
    expect(showInGameAlert).toHaveBeenCalledWith(
      "account_modal.level_visibility_failed",
    );
  });

  it("reverts without an alert when signed out (401)", async () => {
    const { setLevelVisibility } = await import("../../../src/client/Api");
    const { showInGameAlert } = await import("../../../src/client/InGameModal");
    vi.mocked(setLevelVisibility).mockResolvedValueOnce({
      ok: false,
      code: "logged_out",
    });
    const player = makePlayer({ progress, levelHidden: true });
    await show(player);

    levelSwitch()!.click();
    await settle();

    expect(player.levelHidden).toBe(true);
    expect(levelSwitch()!.getAttribute("aria-checked")).toBe("false");
    // logOut() already ran inside setLevelVisibility; the signed-out state
    // takes over from there.
    expect(showInGameAlert).not.toHaveBeenCalled();
  });

  it("refreshes the viewer's own-badge fallback once the change is saved", async () => {
    const { getUserMe } = await import("../../../src/client/Api");
    const player = makePlayer({ progress, levelHidden: false });
    // getUserMe() memoises the same profile object the panel shows.
    vi.mocked(getUserMe).mockResolvedValue({
      user: {},
      player,
    } as unknown as UserMeResponse);
    await show(player);
    expect(ownHiddenLevelBadge()).toBeUndefined();

    levelSwitch()!.click();
    await settle();
    expect(ownHiddenLevelBadge()).toEqual({
      level: 96,
      prestige: 3,
      legend: false,
    });

    levelSwitch()!.click();
    await settle();
    expect(ownHiddenLevelBadge()).toBeUndefined();
  });

  it("leaves the fallback alone when the change fails", async () => {
    const { getUserMe, setLevelVisibility } =
      await import("../../../src/client/Api");
    vi.mocked(setLevelVisibility).mockResolvedValueOnce({
      ok: false,
      code: "failed",
    });
    await show(makePlayer({ progress, levelHidden: false }));

    levelSwitch()!.click();
    await settle();
    expect(getUserMe).not.toHaveBeenCalled();
  });
});

describe("AccountSettingsPanel — privacy card (search engines)", () => {
  let panel: AccountSettingsPanel;

  beforeEach(async () => {
    if (!customElements.get("account-settings-panel")) {
      customElements.define("account-settings-panel", AccountSettingsPanel);
    }
    panel = document.createElement(
      "account-settings-panel",
    ) as AccountSettingsPanel;
    document.body.appendChild(panel);
    await panel.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(panel);
    vi.clearAllMocks();
  });

  async function show(player: UserMePlayer): Promise<void> {
    panel.player = player;
    panel.user = { email: "player@example.com" };
    await panel.updateComplete;
  }

  // Lets the mocked request settle, then the re-render.
  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
    await panel.updateComplete;
  }

  const searchSwitch = () =>
    panel.querySelector(
      'button[role="switch"][aria-label="account_modal.search_visibility_title"]',
    ) as HTMLButtonElement | null;
  const levelSwitch = () =>
    panel.querySelector(
      'button[role="switch"][aria-label="account_modal.level_visibility_title"]',
    ) as HTMLButtonElement | null;

  it("renders no search row when /users/@me has no searchHidden (older API)", async () => {
    await show(makePlayer({ levelHidden: false }));

    expect(levelSwitch()).toBeTruthy();
    expect(searchSwitch()).toBeNull();
    expect(panel.textContent).not.toContain(
      "account_modal.search_visibility_title",
    );
  });

  it("sits below the level row, under a divider", async () => {
    await show(makePlayer({ levelHidden: false, searchHidden: false }));

    const text = panel.textContent ?? "";
    const level = text.indexOf("account_modal.level_visibility_title");
    const search = text.indexOf("account_modal.search_visibility_title");
    expect(level).toBeGreaterThanOrEqual(0);
    expect(search).toBeGreaterThan(level);
    expect(text).toContain("account_modal.search_visibility_desc");
    const row = searchSwitch()!.closest("div.border-t");
    expect(row).toBeTruthy();
    expect(row!.contains(levelSwitch())).toBe(false);
  });

  it("shows the card with only the search row when levelHidden is absent", async () => {
    await show(makePlayer({ searchHidden: false }));

    expect(panel.textContent).toContain("account_modal.privacy_title");
    expect(searchSwitch()).toBeTruthy();
    expect(levelSwitch()).toBeNull();
    // Nothing above it to divide from.
    expect(searchSwitch()!.closest("div.border-t")).toBeNull();
  });

  it("is on when shown in search (the default) and off when hidden", async () => {
    await show(makePlayer({ searchHidden: false }));
    expect(searchSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(searchSwitch()!.disabled).toBe(false);

    await show(makePlayer({ searchHidden: true }));
    expect(searchSwitch()!.getAttribute("aria-checked")).toBe("false");
  });

  it("turning it off: optimistic, disabled in flight, PUTs hidden=true", async () => {
    const { setSearchVisibility, setLevelVisibility } =
      await import("../../../src/client/Api");
    let answer!: (r: { ok: true; hidden: boolean }) => void;
    vi.mocked(setSearchVisibility).mockImplementationOnce(
      () => new Promise((r) => (answer = r)),
    );
    const player = makePlayer({ levelHidden: false, searchHidden: false });
    await show(player);

    searchSwitch()!.click();
    await panel.updateComplete;

    expect(setSearchVisibility).toHaveBeenCalledWith(true);
    expect(setLevelVisibility).not.toHaveBeenCalled();
    // Optimistic: already off, on the cached profile object too.
    expect(searchSwitch()!.getAttribute("aria-checked")).toBe("false");
    expect(player.searchHidden).toBe(true);
    // Disabled while in flight; another click sends nothing. The level
    // switch is independent and stays usable.
    expect(searchSwitch()!.disabled).toBe(true);
    expect(levelSwitch()!.disabled).toBe(false);
    searchSwitch()!.click();
    expect(setSearchVisibility).toHaveBeenCalledTimes(1);

    answer({ ok: true, hidden: true });
    await settle();
    expect(searchSwitch()!.disabled).toBe(false);
    expect(searchSwitch()!.getAttribute("aria-checked")).toBe("false");
    expect(player.searchHidden).toBe(true);
    expect(player.levelHidden).toBe(false);
  });

  it("flipping the level switch writes only the level setting", async () => {
    const { setSearchVisibility, setLevelVisibility } =
      await import("../../../src/client/Api");
    let answer!: (r: { ok: true; hidden: boolean }) => void;
    vi.mocked(setLevelVisibility).mockImplementationOnce(
      () => new Promise((r) => (answer = r)),
    );
    const player = makePlayer({ levelHidden: false, searchHidden: false });
    await show(player);

    levelSwitch()!.click();
    await panel.updateComplete;

    expect(setLevelVisibility).toHaveBeenCalledWith(true);
    expect(setSearchVisibility).not.toHaveBeenCalled();
    expect(levelSwitch()!.disabled).toBe(true);
    expect(searchSwitch()!.disabled).toBe(false);
    expect(searchSwitch()!.getAttribute("aria-checked")).toBe("true");

    answer({ ok: true, hidden: true });
    await settle();
    expect(player.levelHidden).toBe(true);
    expect(player.searchHidden).toBe(false);
  });

  it("turning it back on PUTs hidden=false", async () => {
    const { setSearchVisibility } = await import("../../../src/client/Api");
    const player = makePlayer({ searchHidden: true });
    await show(player);

    searchSwitch()!.click();
    await settle();

    expect(setSearchVisibility).toHaveBeenCalledWith(false);
    expect(searchSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(player.searchHidden).toBe(false);
  });

  it("reverts and shows the error alert when the request fails", async () => {
    const { setSearchVisibility } = await import("../../../src/client/Api");
    const { showInGameAlert } = await import("../../../src/client/InGameModal");
    vi.mocked(setSearchVisibility).mockResolvedValueOnce({
      ok: false,
      code: "failed",
    });
    const player = makePlayer({ searchHidden: false });
    await show(player);

    searchSwitch()!.click();
    await settle();

    expect(searchSwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(searchSwitch()!.disabled).toBe(false);
    expect(player.searchHidden).toBe(false);
    expect(showInGameAlert).toHaveBeenCalledWith(
      "account_modal.search_visibility_failed",
    );
  });

  it("reverts without an alert when signed out (401)", async () => {
    const { setSearchVisibility } = await import("../../../src/client/Api");
    const { showInGameAlert } = await import("../../../src/client/InGameModal");
    vi.mocked(setSearchVisibility).mockResolvedValueOnce({
      ok: false,
      code: "logged_out",
    });
    const player = makePlayer({ searchHidden: true });
    await show(player);

    searchSwitch()!.click();
    await settle();

    expect(player.searchHidden).toBe(true);
    expect(searchSwitch()!.getAttribute("aria-checked")).toBe("false");
    // logOut() already ran inside setSearchVisibility; the signed-out state
    // takes over from there.
    expect(showInGameAlert).not.toHaveBeenCalled();
  });
});
