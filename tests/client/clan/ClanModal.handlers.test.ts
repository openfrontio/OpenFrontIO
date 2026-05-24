import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiMockFactory,
  authMockFactory,
  clanApiMockFactory,
  configLoaderMockFactory,
  crazyGamesSdkMockFactory,
  flushAsync,
  getElState,
  makeClan,
  setElState,
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

import type { ClanInfo } from "../../../src/client/ClanApi";
import { ClanModal } from "../../../src/client/ClanModal";

describe("ClanModal — handlers", () => {
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

  describe("handleApprove increments selectedClan.memberCount", () => {
    it("increments memberCount by 1 after successful approveClanRequest", async () => {
      const { approveClanRequest, fetchClanRequests } =
        await import("../../../src/client/ClanApi");
      (approveClanRequest as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (fetchClanRequests as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          { publicId: "applicant-1", createdAt: "2024-06-01T00:00:00Z" },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });

      const clan = makeClan({ memberCount: 5 });
      setState(modal, "selectedClan" as keyof ClanModal, clan as never);
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "view" as keyof ClanModal, "requests" as never);
      await waitForSubComponent(modal, "clan-requests-view");

      // Click the approve button for the pending applicant
      const approveButtons = Array.from(
        modal.querySelectorAll("button"),
      ).filter((b) => b.textContent?.includes("clan_modal.approve"));
      expect(approveButtons.length).toBeGreaterThan(0);
      approveButtons[0].click();

      // Wait for the async handleApprove to complete
      await flushAsync(modal);

      expect(approveClanRequest).toHaveBeenCalledWith("TST", "applicant-1");
      // ClanModal's selectedClan.memberCount should be incremented via request-approved event
      const updatedClan = (modal as unknown as { selectedClan: ClanInfo })
        .selectedClan;
      expect(updatedClan?.memberCount).toBe(6);
    });

    it("does not increment memberCount when approveClanRequest fails", async () => {
      const { approveClanRequest, fetchClanRequests } =
        await import("../../../src/client/ClanApi");
      (approveClanRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
        error: "clan_modal.error_generic",
      });
      (fetchClanRequests as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          { publicId: "applicant-1", createdAt: "2024-06-01T00:00:00Z" },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });

      const clan = makeClan({ memberCount: 5 });
      setState(modal, "selectedClan" as keyof ClanModal, clan as never);
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "view" as keyof ClanModal, "requests" as never);
      await waitForSubComponent(modal, "clan-requests-view");

      const approveButtons = Array.from(
        modal.querySelectorAll("button"),
      ).filter((b) => b.textContent?.includes("clan_modal.approve"));
      approveButtons[0].click();

      await flushAsync(modal);

      const updatedClan = (modal as unknown as { selectedClan: ClanInfo })
        .selectedClan;
      // memberCount must remain at 5 — the failure path must not mutate it
      expect(updatedClan?.memberCount).toBe(5);
    });

    it("treats undefined memberCount as 0 and increments to 1", async () => {
      const { approveClanRequest, fetchClanRequests } =
        await import("../../../src/client/ClanApi");
      (approveClanRequest as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (fetchClanRequests as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          { publicId: "applicant-1", createdAt: "2024-06-01T00:00:00Z" },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });

      const clan = makeClan({ memberCount: undefined });
      setState(modal, "selectedClan" as keyof ClanModal, clan as never);
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "view" as keyof ClanModal, "requests" as never);
      await waitForSubComponent(modal, "clan-requests-view");

      const approveButtons = Array.from(
        modal.querySelectorAll("button"),
      ).filter((b) => b.textContent?.includes("clan_modal.approve"));
      approveButtons[0].click();

      await flushAsync(modal);

      const updatedClan = (modal as unknown as { selectedClan: ClanInfo })
        .selectedClan;
      expect(updatedClan?.memberCount).toBe(1);
    });
  });

  describe("Ban feature — manage view", () => {
    let manageView: Element;

    beforeEach(async () => {
      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          {
            role: "member",
            joinedAt: "2024-03-01T00:00:00Z",
            publicId: "target-player",
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });

      setState(
        modal,
        "selectedClan" as keyof ClanModal,
        makeClan({ memberCount: 5 }) as never,
      );
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "myRole" as keyof ClanModal, "leader" as never);
      setState(modal, "view" as keyof ClanModal, "manage" as never);
      manageView = await waitForSubComponent(modal, "clan-manage-view");
    });

    it("renders a Ban button for non-leader members in manage view", () => {
      const banButtons = Array.from(modal.querySelectorAll("button")).filter(
        (b) => b.textContent?.trim() === "clan_modal.ban",
      );
      expect(banButtons.length).toBeGreaterThan(0);
    });

    it("handleBan calls banClanMember after confirm-dialog confirm", async () => {
      const { banClanMember } = await import("../../../src/client/ClanApi");
      (banClanMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      // Step 1: Click Ban button to open confirm dialog
      const banButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.ban",
      );
      banButton!.click();
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      // Step 2: Find the confirm-dialog and fire its confirm event with reason text
      const dialog = modal.querySelector("confirm-dialog");
      expect(dialog).toBeTruthy();
      dialog!.dispatchEvent(
        new CustomEvent("confirm", { detail: { text: "bad behavior" } }),
      );

      await flushAsync(manageView);

      expect(banClanMember).toHaveBeenCalledWith(
        "TST",
        "target-player",
        "bad behavior",
      );
    });

    it("handleBan aborts when confirm-dialog cancel is clicked", async () => {
      const { banClanMember } = await import("../../../src/client/ClanApi");

      // Step 1: Click Ban button to open confirm dialog
      const banButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.ban",
      );
      banButton!.click();
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      // Step 2: Fire cancel event
      const dialog = modal.querySelector("confirm-dialog");
      expect(dialog).toBeTruthy();
      dialog!.dispatchEvent(new CustomEvent("cancel"));

      await flushAsync(manageView);

      expect(banClanMember).not.toHaveBeenCalled();
    });

    it("handleBan sends undefined reason when confirm text is empty", async () => {
      const { banClanMember } = await import("../../../src/client/ClanApi");
      (banClanMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      // Step 1: Click Ban button
      const banButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.ban",
      );
      banButton!.click();
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      // Step 2: Confirm with empty text
      const dialog = modal.querySelector("confirm-dialog");
      dialog!.dispatchEvent(
        new CustomEvent("confirm", { detail: { text: "  " } }),
      );

      await flushAsync(manageView);

      expect(banClanMember).toHaveBeenCalledWith(
        "TST",
        "target-player",
        undefined,
      );
    });

    it("handleBan syncs memberCount via clan-updated event on success", async () => {
      const { banClanMember, fetchClanMembers } =
        await import("../../../src/client/ClanApi");
      (banClanMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      // Server returns the post-ban member total (was 5, now 4).
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [],
        total: 4,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });

      // Step 1: Click Ban button
      const banButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.ban",
      );
      banButton!.click();
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      // Step 2: Confirm
      const dialog = modal.querySelector("confirm-dialog");
      dialog!.dispatchEvent(
        new CustomEvent("confirm", { detail: { text: "reason" } }),
      );

      await flushAsync(manageView, modal);

      // ClanManageView's loadMembers dispatches clan-updated when memberCount differs,
      // which ClanModal handles by updating selectedClan.
      const updatedClan = (modal as unknown as { selectedClan: ClanInfo })
        .selectedClan;
      expect(updatedClan?.memberCount).toBe(4);
    });
  });

  describe("handleUnban", () => {
    it("removes ban from list and decrements total on success", async () => {
      const { unbanClanMember, fetchClanBans } =
        await import("../../../src/client/ClanApi");
      (unbanClanMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (fetchClanBans as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          {
            publicId: "banned-1",
            bannedBy: "officer-1",
            reason: null,
            createdAt: "2024-06-01T00:00:00.000Z",
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });

      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "view" as keyof ClanModal, "bans" as never);
      const bansView = await waitForSubComponent(modal, "clan-bans-view");

      const unbanButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.unban",
      );
      expect(unbanButton).toBeTruthy();
      unbanButton!.click();

      await flushAsync(bansView);

      expect(unbanClanMember).toHaveBeenCalledWith("TST", "banned-1");
      const bansTotal = getElState<number>(bansView, "bansTotal");
      expect(bansTotal).toBe(0);
    });
  });

  describe("handleKick", () => {
    let manageView: Element;

    beforeEach(async () => {
      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          {
            role: "member",
            joinedAt: "2024-03-01T00:00:00Z",
            publicId: "target-player",
          },
        ],
        total: 5,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });

      setState(
        modal,
        "selectedClan" as keyof ClanModal,
        makeClan({ memberCount: 5 }) as never,
      );
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "myRole" as keyof ClanModal, "leader" as never);
      setState(modal, "view" as keyof ClanModal, "manage" as never);
      manageView = await waitForSubComponent(modal, "clan-manage-view");
    });

    it("calls kickMember and syncs memberCount on success", async () => {
      const { kickMember, fetchClanMembers } =
        await import("../../../src/client/ClanApi");
      (kickMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [],
        total: 4,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });

      const kickButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.kick",
      );
      kickButton!.click();
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      const dialog = modal.querySelector("confirm-dialog");
      dialog!.dispatchEvent(new CustomEvent("confirm"));

      await flushAsync(manageView, modal);

      expect(kickMember).toHaveBeenCalledWith("TST", "target-player");
      // ClanManageView's loadMembers dispatches clan-updated when total differs (5→4),
      // which ClanModal handles by updating selectedClan.
      expect(
        (modal as unknown as { selectedClan: ClanInfo }).selectedClan
          ?.memberCount,
      ).toBe(4);
    });

    it("does not mutate state when kickMember fails", async () => {
      const { kickMember, fetchClanMembers } =
        await import("../../../src/client/ClanApi");
      (kickMember as ReturnType<typeof vi.fn>).mockResolvedValue({
        error: "clan_modal.error_generic",
      });
      const fetchSpy = fetchClanMembers as ReturnType<typeof vi.fn>;
      fetchSpy.mockClear();

      const kickButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.kick",
      );
      kickButton!.click();
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      modal
        .querySelector("confirm-dialog")!
        .dispatchEvent(new CustomEvent("confirm"));

      await flushAsync(manageView);

      expect(kickMember).toHaveBeenCalledWith("TST", "target-player");
      // Failed call must not refresh the member page or change memberCount.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        (modal as unknown as { selectedClan: ClanInfo }).selectedClan
          ?.memberCount,
      ).toBe(5);
    });
  });

  describe("handleDisband", () => {
    let manageView: Element;

    beforeEach(async () => {
      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [],
        total: 3,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });

      setState(
        modal,
        "selectedClan" as keyof ClanModal,
        makeClan({ memberCount: 3 }) as never,
      );
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "myRole" as keyof ClanModal, "leader" as never);
      setState(
        modal,
        "myClans" as keyof ClanModal,
        [makeClan({ memberCount: 3 })] as never,
      );
      setState(
        modal,
        "myClanRoles" as keyof ClanModal,
        new Map([["TST", "leader"]]) as never,
      );
      setState(modal, "view" as keyof ClanModal, "manage" as never);
      manageView = await waitForSubComponent(modal, "clan-manage-view");
    });

    it("calls disbandClan, clears selection, and returns to list on success", async () => {
      const { disbandClan } = await import("../../../src/client/ClanApi");
      (disbandClan as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      // Open the disband confirm dialog on the manage view.
      setElState(manageView, "confirmAction", "disband");
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      const dialog = modal.querySelector("confirm-dialog");
      expect(dialog).toBeTruthy();
      dialog!.dispatchEvent(new CustomEvent("confirm"));

      await flushAsync(modal);

      expect(disbandClan).toHaveBeenCalledWith("TST");
      const m = modal as unknown as {
        selectedClan: ClanInfo | null;
        myRole: string | null;
        view: string;
        myClans: ClanInfo[];
      };
      expect(m.selectedClan).toBeNull();
      expect(m.myRole).toBeNull();
      expect(m.view).toBe("list");
      expect(m.myClans.find((c) => c.tag === "TST")).toBeUndefined();
    });

    it("preserves selection when disbandClan fails", async () => {
      const { disbandClan } = await import("../../../src/client/ClanApi");
      (disbandClan as ReturnType<typeof vi.fn>).mockResolvedValue({
        error: "clan_modal.error_generic",
      });

      setElState(manageView, "confirmAction", "disband");
      await (manageView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      const dialog = modal.querySelector("confirm-dialog");
      expect(dialog).toBeTruthy();
      dialog!.dispatchEvent(new CustomEvent("confirm"));

      await flushAsync(manageView, modal);

      const m = modal as unknown as {
        selectedClan: ClanInfo | null;
        view: string;
      };
      expect(disbandClan).toHaveBeenCalledWith("TST");
      // Selection and view stay intact so the user can retry.
      expect(m.selectedClan?.tag).toBe("TST");
      expect(m.view).toBe("manage");
    });
  });

  describe("handleDeny", () => {
    let requestsView: Element;

    beforeEach(async () => {
      const { fetchClanRequests } = await import("../../../src/client/ClanApi");
      (fetchClanRequests as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          { publicId: "applicant-1", createdAt: "2024-06-01T00:00:00Z" },
          { publicId: "applicant-2", createdAt: "2024-06-02T00:00:00Z" },
        ],
        total: 2,
        page: 1,
        limit: 20,
      });

      setState(modal, "selectedClan" as keyof ClanModal, makeClan() as never);
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "view" as keyof ClanModal, "requests" as never);
      requestsView = await waitForSubComponent(modal, "clan-requests-view");
    });

    it("removes the request and decrements totals on success", async () => {
      const { denyClanRequest } = await import("../../../src/client/ClanApi");
      (denyClanRequest as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const denyButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("clan_modal.deny"),
      );
      denyButton!.click();

      await flushAsync(requestsView);

      expect(denyClanRequest).toHaveBeenCalledWith("TST", "applicant-1");
      const requests = getElState<{ publicId: string }[]>(
        requestsView,
        "requests",
      );
      const requestsTotal = getElState<number>(requestsView, "requestsTotal");
      expect(requests.map((r) => r.publicId)).toEqual(["applicant-2"]);
      expect(requestsTotal).toBe(1);
    });

    it("does not mutate state when denyClanRequest fails", async () => {
      const { denyClanRequest } = await import("../../../src/client/ClanApi");
      (denyClanRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
        error: "clan_modal.error_generic",
      });

      const denyButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("clan_modal.deny"),
      );
      denyButton!.click();

      await flushAsync(requestsView);

      expect(denyClanRequest).toHaveBeenCalled();
      const requests = getElState<{ publicId: string }[]>(
        requestsView,
        "requests",
      );
      const requestsTotal = getElState<number>(requestsView, "requestsTotal");
      expect(requests).toHaveLength(2);
      expect(requestsTotal).toBe(2);
    });
  });

  describe("handleJoin", () => {
    beforeEach(async () => {
      const { fetchClanDetail, fetchClanStats } =
        await import("../../../src/client/ClanApi");
      (fetchClanDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeClan({ isOpen: true, memberCount: 5 }),
      );
      (fetchClanStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "myClanRoles" as keyof ClanModal, new Map() as never);
      setState(modal, "view" as keyof ClanModal, "detail" as never);
      await waitForSubComponent(modal, "clan-detail-view");
    });

    it("switches detail view into member mode immediately after open-clan join", async () => {
      const { joinClan, fetchClanMembers } =
        await import("../../../src/client/ClanApi");
      (joinClan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: "joined",
      });
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          {
            role: "member",
            joinedAt: "2024-01-01T00:00:00Z",
            publicId: "test-player",
          },
        ],
        total: 6,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });

      const joinButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.join_clan",
      );
      joinButton!.click();

      await flushAsync(modal);

      expect(joinClan).toHaveBeenCalledWith("TST");
      expect(fetchClanMembers).toHaveBeenCalledWith(
        "TST",
        1,
        10,
        "default",
        "asc",
      );

      const leaveButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.leave_clan",
      );
      expect(leaveButton).toBeTruthy();

      const m = modal as unknown as {
        myClanRoles: Map<string, string>;
      };
      expect(m.myClanRoles.get("TST")).toBe("member");
    });
  });

  describe("handleLeave", () => {
    beforeEach(async () => {
      const { fetchClanDetail, fetchClanMembers, fetchClanStats } =
        await import("../../../src/client/ClanApi");
      (fetchClanDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeClan(),
      );
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          {
            role: "member",
            joinedAt: "2024-01-01T00:00:00Z",
            publicId: "test-player",
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });
      (fetchClanStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(
        modal,
        "myClanRoles" as keyof ClanModal,
        new Map([["TST", "member"]]) as never,
      );
      setState(modal, "view" as keyof ClanModal, "detail" as never);
      await waitForSubComponent(modal, "clan-detail-view");
    });

    it("calls leaveClan, removes role, and returns to list on success", async () => {
      const { leaveClan } = await import("../../../src/client/ClanApi");
      (leaveClan as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const leaveButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.leave_clan",
      );
      leaveButton!.click();

      await flushAsync(modal);

      expect(leaveClan).toHaveBeenCalledWith("TST");
      const m = modal as unknown as {
        selectedClan: ClanInfo | null;
        myRole: string | null;
        view: string;
        myClanRoles: Map<string, string>;
      };
      expect(m.selectedClan).toBeNull();
      expect(m.myRole).toBeNull();
      expect(m.view).toBe("list");
      expect(m.myClanRoles.has("TST")).toBe(false);
    });

    it("preserves selection when leaveClan fails", async () => {
      const { leaveClan } = await import("../../../src/client/ClanApi");
      (leaveClan as ReturnType<typeof vi.fn>).mockResolvedValue({
        error: "clan_modal.error_generic",
      });

      const leaveButton = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "clan_modal.leave_clan",
      );
      leaveButton!.click();

      await flushAsync(modal);

      const m = modal as unknown as {
        selectedClanTag: string;
        view: string;
        myClanRoles: Map<string, string>;
      };
      expect(leaveClan).toHaveBeenCalledWith("TST");
      expect(m.selectedClanTag).toBe("TST");
      expect(m.view).toBe("detail");
      expect(m.myClanRoles.get("TST")).toBe("member");
    });
  });

  describe("Transfer leadership — confirm flow", () => {
    let transferView: Element;

    beforeEach(async () => {
      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      (fetchClanMembers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        results: [
          {
            role: "member",
            joinedAt: "2024-01-01T00:00:00Z",
            publicId: "target-player",
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        pendingRequests: 0,
      });

      setState(
        modal,
        "selectedClan" as keyof ClanModal,
        makeClan({ memberCount: 2 }) as never,
      );
      setState(modal, "selectedClanTag" as keyof ClanModal, "TST" as never);
      setState(modal, "myRole" as keyof ClanModal, "leader" as never);
      setState(modal, "view" as keyof ClanModal, "transfer" as never);
      transferView = await waitForSubComponent(modal, "clan-transfer-view");

      // Set the transfer target and open confirm dialog on the transfer view
      setElState(transferView, "transferTarget", "target-player");
      setElState(transferView, "confirmAction", "transfer");
      await (transferView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;
    });

    it("clears confirmAction and removes the dialog after confirming", async () => {
      const { transferLeadership } =
        await import("../../../src/client/ClanApi");
      (transferLeadership as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const dialog = modal.querySelector("confirm-dialog");
      expect(dialog).toBeTruthy();

      dialog!.dispatchEvent(new CustomEvent("confirm"));

      // Let handleTransfer's awaits settle.
      await flushAsync(transferView);

      expect(transferLeadership).toHaveBeenCalledWith("TST", "target-player");
      expect(
        getElState<string | null>(transferView, "confirmAction"),
      ).toBeNull();
      expect(modal.querySelector("confirm-dialog")).toBeNull();
    });

    it("clears confirmAction when cancel is clicked, without calling the API", async () => {
      const { transferLeadership } =
        await import("../../../src/client/ClanApi");

      const dialog = modal.querySelector("confirm-dialog");
      expect(dialog).toBeTruthy();

      dialog!.dispatchEvent(new CustomEvent("cancel"));
      await (transferView as HTMLElement & { updateComplete: Promise<boolean> })
        .updateComplete;

      expect(transferLeadership).not.toHaveBeenCalled();
      expect(
        getElState<string | null>(transferView, "confirmAction"),
      ).toBeNull();
      expect(modal.querySelector("confirm-dialog")).toBeNull();
    });
  });
});
