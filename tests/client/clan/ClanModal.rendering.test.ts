import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiMockFactory,
  authMockFactory,
  clanApiMockFactory,
  configLoaderMockFactory,
  crazyGamesSdkMockFactory,
  getElState,
  makeClan,
  setState,
  stubLocalStorage,
  utilsMockFactory,
  virtualizerMockFactory,
  waitForSubComponent,
} from "./ClanModalTestUtils";

vi.mock("@lit-labs/virtualizer/virtualize.js", () => virtualizerMockFactory());
vi.mock("../../../src/client/Api", () => apiMockFactory());
vi.mock("../../../src/client/ClanApi", () => clanApiMockFactory());
vi.mock("../../../src/client/Utils", () => utilsMockFactory());
vi.mock("../../../src/client/Auth", () => authMockFactory());
vi.mock("../../../src/core/configuration/ConfigLoader", () =>
  configLoaderMockFactory(),
);
vi.mock("../../../src/client/CrazyGamesSDK", () => crazyGamesSdkMockFactory());

stubLocalStorage();

import { ClanModal } from "../../../src/client/ClanModal";

describe("ClanModal — rendering", () => {
  let modal: ClanModal;

  beforeEach(async () => {
    if (!customElements.get("clan-modal")) {
      customElements.define("clan-modal", ClanModal);
    }
    modal = document.createElement("clan-modal") as ClanModal;
    // Use inline mode so no nested o-modal custom element is needed.
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.clearAllMocks();
  });

  // ── 1. renderClanCard: role badge vs open/invite badge ──────────────────

  describe("renderClanCard — role vs open/invite badge", () => {
    it("shows the role badge when a role is provided and hides open/invite badge", async () => {
      // Directly invoke renderClanCard via the instance and insert the result
      // into a container so we can query it. We do this by populating myClans
      // and myClanRoles state so the list view renders real cards.
      const { getUserMe } = await import("../../../src/client/Api");
      (getUserMe as ReturnType<typeof vi.fn>).mockResolvedValue({
        player: {
          publicId: "test-player",
          clans: [
            {
              tag: "TST",
              name: "Test Clan",
              role: "leader",
              joinedAt: "2024-01-01T00:00:00Z",
            },
          ],
          clanRequests: [],
          achievements: { singleplayerMap: [] },
        },
        user: { email: "test@test.com" },
      });

      // Open the modal so onOpen() → loadMyClans() runs
      modal.open();
      // Wait for loadMyClans async chain to complete
      await new Promise((r) => setTimeout(r, 0));
      await modal.updateComplete;

      // The my-clans list should be rendered. Find the role badge text.
      const text = modal.textContent ?? "";
      // Role "leader" should appear in the badge (translateText passes key through)
      expect(text).toContain("leader");
      // The open/invite badge should NOT appear alongside the role badge on the
      // same card. Since translateText returns the key, we check for the keys.
      // "clan_modal.open" would show when no role — it must NOT appear for a
      // clan where the user has a role.
      expect(text).not.toContain("clan_modal.open");
      expect(text).not.toContain("clan_modal.invite_only");
    });

    it("shows 'clan_modal.open' badge when clan is open and user has no role", async () => {
      const { fetchClans } = await import("../../../src/client/ClanApi");
      (fetchClans as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [makeClan({ tag: "OTH", name: "Other Clan", isOpen: true })],
        total: 1,
        page: 1,
        limit: 20,
      });
      (modal as unknown as { myClanRoles: Map<string, string> }).myClanRoles =
        new Map();
      setState(modal, "activeTab" as keyof ClanModal, "browse" as never);
      await waitForSubComponent(modal, "clan-browse-view");

      const text = modal.textContent ?? "";
      expect(text).toContain("clan_modal.open");
      expect(text).not.toContain("clan_modal.invite_only");
      expect(text).not.toContain("leader");
    });

    it("shows 'clan_modal.invite_only' badge when clan is closed and user has no role", async () => {
      const { fetchClans } = await import("../../../src/client/ClanApi");
      (fetchClans as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [makeClan({ tag: "INV", name: "Invite Clan", isOpen: false })],
        total: 1,
        page: 1,
        limit: 20,
      });
      (modal as unknown as { myClanRoles: Map<string, string> }).myClanRoles =
        new Map();
      setState(modal, "activeTab" as keyof ClanModal, "browse" as never);
      await waitForSubComponent(modal, "clan-browse-view");

      const text = modal.textContent ?? "";
      expect(text).toContain("clan_modal.invite_only");
      expect(text).not.toContain("clan_modal.open");
    });

    it("shows amber role badge class for leader", async () => {
      setState(modal, "activeTab" as keyof ClanModal, "browse" as never);
      setState(
        modal,
        "browseData" as keyof ClanModal,
        {
          results: [makeClan({ isOpen: true })],
          total: 1,
          page: 1,
          limit: 20,
        } as never,
      );
      // Force myClanRoles to include leader role for this clan's tag
      (modal as unknown as { myClanRoles: Map<string, string> }).myClanRoles =
        new Map([["TST", "leader"]]);
      setState(modal, "myClans" as keyof ClanModal, [makeClan()] as never);
      setState(modal, "activeTab" as keyof ClanModal, "my-clans" as never);
      await modal.updateComplete;

      // Find spans that contain the translated leader role — should have amber styling
      const spans = Array.from(modal.querySelectorAll("span"));
      const leaderSpan = spans.find((s) =>
        s.textContent?.trim().includes("role_leader"),
      );
      expect(leaderSpan).toBeTruthy();
      expect(leaderSpan!.className).toContain("amber");
    });

    it("shows blue role badge class for officer/member", async () => {
      (modal as unknown as { myClanRoles: Map<string, string> }).myClanRoles =
        new Map([["TST", "officer"]]);
      setState(modal, "myClans" as keyof ClanModal, [makeClan()] as never);
      setState(modal, "activeTab" as keyof ClanModal, "my-clans" as never);
      await modal.updateComplete;

      const spans = Array.from(modal.querySelectorAll("span"));
      const officerSpan = spans.find((s) =>
        s.textContent?.trim().includes("role_officer"),
      );
      expect(officerSpan).toBeTruthy();
      expect(officerSpan!.className).toContain("blue");
    });
  });

  // ── 2. My Clans tab passes role to renderClanCard ───────────────────────

  describe("My Clans tab passes role from myClanRoles map", () => {
    it("renders the user's role badge on a my-clan card", async () => {
      // Set up a clan in myClans and a matching entry in myClanRoles
      (modal as unknown as { myClanRoles: Map<string, string> }).myClanRoles =
        new Map([["TST", "leader"]]);
      setState(modal, "myClans" as keyof ClanModal, [makeClan()] as never);
      setState(modal, "activeTab" as keyof ClanModal, "my-clans" as never);
      await modal.updateComplete;

      const text = modal.textContent ?? "";
      // The role badge text must appear; the open badge must NOT.
      expect(text).toContain("leader");
      expect(text).not.toContain("clan_modal.open");
      expect(text).not.toContain("clan_modal.invite_only");
    });

    it("does NOT show a role badge when myClanRoles has no entry for the clan", async () => {
      const { fetchClans } = await import("../../../src/client/ClanApi");
      (fetchClans as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [makeClan({ tag: "INV", name: "Invite Clan", isOpen: false })],
        total: 1,
        page: 1,
        limit: 20,
      });
      (modal as unknown as { myClanRoles: Map<string, string> }).myClanRoles =
        new Map();
      setState(modal, "activeTab" as keyof ClanModal, "browse" as never);
      await waitForSubComponent(modal, "clan-browse-view");

      const text = modal.textContent ?? "";
      expect(text).not.toContain("leader");
      expect(text).not.toContain("officer");
      // invite_only badge should appear since isOpen is false and no role
      expect(text).toContain("clan_modal.invite_only");
    });
  });

  // ── 3. memberCount fallback — display "0" when undefined ───────────────

  describe("memberCount fallback", () => {
    it("shows 0 members in the clan card when memberCount is undefined", async () => {
      // translateText is mocked to return the key, so member_count key will appear.
      // We verify the count passed to it is 0 by checking the rendered output
      // does not contain "undefined".
      setState(
        modal,
        "myClans" as keyof ClanModal,
        [makeClan({ memberCount: undefined })] as never,
      );
      (modal as unknown as { myClanRoles: Map<string, string> }).myClanRoles =
        new Map();
      setState(modal, "activeTab" as keyof ClanModal, "my-clans" as never);
      await modal.updateComplete;

      expect(modal.textContent).not.toContain("undefined");
      // translateText mock swallows args and returns the key, so verify it
      // was called with count: 0 (the fallback) rather than count: undefined.
      const { translateText } = await import("../../../src/client/Utils");
      const calls = (translateText as ReturnType<typeof vi.fn>).mock.calls;
      const memberCountCall = calls.find(
        (c) => c[0] === "clan_modal.member_count",
      );
      expect(memberCountCall).toBeTruthy();
      expect(memberCountCall![1]).toEqual({ count: 0 });
    });

    it("shows 0 in the stats row of the detail view when memberCount is undefined", async () => {
      const { fetchClanDetail, fetchClanStats } =
        await import("../../../src/client/ClanApi");
      (fetchClanDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeClan({ memberCount: undefined }),
      );
      (fetchClanStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        clanTag: "TST",
        games: 0,
        wins: 0,
        losses: 0,
        teamTypeWL: {},
        teamCountWL: {},
      });
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "view" as keyof ClanModal, "detail" as never);
      await waitForSubComponent(modal, "clan-detail-view");

      expect(modal.textContent).not.toContain("undefined");
      // The stat box should contain "0" (from `clan.memberCount ?? 0`)
      expect(modal.textContent).toContain("0");
    });

    it("shows 0 in the manage members header when memberCount is undefined", async () => {
      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [],
        total: 0,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });
      setState(
        modal,
        "selectedClan" as keyof ClanModal,
        makeClan({ memberCount: undefined }) as never,
      );
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "myRole" as keyof ClanModal, "leader" as never);
      setState(modal, "view" as keyof ClanModal, "manage" as never);
      await waitForSubComponent(modal, "clan-manage-view");

      expect(modal.textContent).not.toContain("undefined");
    });
  });

  // ── 4. Toggle switch ARIA attributes ───────────────────────────────────

  describe("Open/Closed toggle ARIA attributes in manage view", () => {
    beforeEach(async () => {
      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [],
        total: 0,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });
      setState(
        modal,
        "selectedClan" as keyof ClanModal,
        makeClan({ isOpen: true }) as never,
      );
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "myRole" as keyof ClanModal, "leader" as never);
      setState(modal, "view" as keyof ClanModal, "manage" as never);
      await waitForSubComponent(modal, "clan-manage-view");
    });

    it("toggle button has role='switch'", () => {
      const toggle = modal.querySelector("[role='switch']");
      expect(toggle).toBeTruthy();
    });

    it("toggle button has aria-checked='true' when manageIsOpen is true", () => {
      const toggle = modal.querySelector("[role='switch']");
      expect(toggle?.getAttribute("aria-checked")).toBe("true");
    });

    it("toggle button has aria-checked='false' when manageIsOpen is false", async () => {
      const manageView = modal.querySelector("clan-manage-view")!;
      (manageView as unknown as { manageIsOpen: boolean }).manageIsOpen = false;
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      const toggle = modal.querySelector("[role='switch']");
      expect(toggle?.getAttribute("aria-checked")).toBe("false");
    });

    it("toggle button has an aria-label", () => {
      const toggle = modal.querySelector("[role='switch']");
      const label = toggle?.getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label!.length).toBeGreaterThan(0);
    });

    it("clicking the toggle flips manageIsOpen", async () => {
      const manageView = modal.querySelector("clan-manage-view")!;
      const toggle = modal.querySelector<HTMLButtonElement>("[role='switch']");
      expect(toggle).toBeTruthy();

      const before = getElState<boolean>(manageView, "manageIsOpen");
      toggle!.click();
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      const after = getElState<boolean>(manageView, "manageIsOpen");
      expect(after).toBe(!before);
    });

    it("aria-checked reflects toggled state after click", async () => {
      const manageView = modal.querySelector("clan-manage-view")!;
      const toggle = modal.querySelector<HTMLButtonElement>("[role='switch']");
      expect(toggle?.getAttribute("aria-checked")).toBe("true");

      toggle!.click();
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      const updatedToggle = modal.querySelector("[role='switch']");
      expect(updatedToggle?.getAttribute("aria-checked")).toBe("false");
    });
  });

  // ── 5. Ban list rendering ──────────────────────────────────────────────

  describe("Ban feature — bans view", () => {
    it("renders Banned Players button in manage view", async () => {
      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [],
        total: 0,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });
      setState(modal, "selectedClan" as keyof ClanModal, makeClan() as never);
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "myRole" as keyof ClanModal, "leader" as never);
      setState(modal, "view" as keyof ClanModal, "manage" as never);
      await waitForSubComponent(modal, "clan-manage-view");

      const text = modal.textContent ?? "";
      expect(text).toContain("clan_modal.banned_players");
    });

    it("renders ban list with unban button in bans view", async () => {
      const { fetchClanBans } = await import("../../../src/client/ClanApi");
      (fetchClanBans as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          {
            publicId: "banned-1",
            bannedBy: "officer-1",
            reason: "toxic behavior",
            createdAt: "2024-06-01T00:00:00.000Z",
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "view" as keyof ClanModal, "bans" as never);
      await waitForSubComponent(modal, "clan-bans-view");

      const text = modal.textContent ?? "";
      expect(text).toContain("banned-1");
      expect(text).toContain("officer-1");
      expect(text).toContain("clan_modal.unban");
      expect(text).toContain("clan_modal.ban_reason");
    });

    it("renders empty state when no bans", async () => {
      const { fetchClanBans } = await import("../../../src/client/ClanApi");
      (fetchClanBans as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [],
        total: 0,
        page: 1,
        limit: 20,
      });
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "view" as keyof ClanModal, "bans" as never);
      await waitForSubComponent(modal, "clan-bans-view");

      const text = modal.textContent ?? "";
      expect(text).toContain("clan_modal.no_bans");
    });
  });

  describe("Component basics", () => {
    it("is registered as a custom element", () => {
      expect(modal).toBeInstanceOf(ClanModal);
      expect(modal.tagName.toLowerCase()).toBe("clan-modal");
    });

    it("renders without shadow DOM (createRenderRoot returns this)", () => {
      // BaseModal.createRenderRoot returns `this`, so shadowRoot should be null
      expect(modal.shadowRoot).toBeNull();
    });

    it("opens and closes via public API", () => {
      expect((modal as unknown as { isModalOpen: boolean }).isModalOpen).toBe(
        false,
      );
      modal.open();
      expect((modal as unknown as { isModalOpen: boolean }).isModalOpen).toBe(
        true,
      );
      modal.close();
      expect((modal as unknown as { isModalOpen: boolean }).isModalOpen).toBe(
        false,
      );
    });
  });
});
