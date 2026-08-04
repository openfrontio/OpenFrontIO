import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiMockFactory,
  authMockFactory,
  clanApiMockFactory,
  crazyGamesSdkMockFactory,
  flushAsync,
  getElState,
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
vi.mock("../../../src/client/CrazyGamesSDK", () => crazyGamesSdkMockFactory());

stubLocalStorage();

// jsdom has no IntersectionObserver; the game-history view wires one up for
// its infinite-scroll sentinel on every render.
class FakeIntersectionObserver {
  constructor(_callback: IntersectionObserverCallback) {}
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds = [];
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

import type { ClanInfo } from "../../../src/client/ClanApi";
import { fetchClanDetail } from "../../../src/client/ClanApi";
import { ClanModal } from "../../../src/client/ClanModal";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("ClanModal — player-profile handoff", () => {
  let modal: ClanModal;
  let profileModal: HTMLElement;
  let returnedTo: string[];
  let returnedOrigins: (string | null)[];

  beforeEach(async () => {
    if (!customElements.get("clan-modal")) {
      customElements.define("clan-modal", ClanModal);
    }
    returnedTo = [];
    returnedOrigins = [];

    // Stand-in for the profile modal.
    profileModal = document.createElement("player-profile-modal");
    (profileModal as HTMLElement & { returnFromClan: unknown }).returnFromClan =
      (publicId: string, origin: string | null) => {
        returnedTo.push(publicId);
        returnedOrigins.push(origin);
      };
    // Called when a member's name is clicked.
    (profileModal as HTMLElement & { openFromClan: unknown }).openFromClan =
      () => {};
    document.body.appendChild(profileModal);

    modal = document.createElement("clan-modal") as ClanModal;
    // Inline mode so no nested o-modal custom element is needed.
    modal.setAttribute("inline", "");
    document.body.appendChild(modal);
    await modal.updateComplete;

    // Each clan resolves to its own detail so tests can tell them apart.
    asMock(fetchClanDetail).mockImplementation(async (tag: string) => ({
      name: `Clan ${tag}`,
      tag,
      description: "",
      isOpen: true,
      createdAt: "2024-01-01T00:00:00Z",
      memberCount: 5,
    }));
  });

  afterEach(() => {
    modal.remove();
    profileModal.remove();
    vi.clearAllMocks();
  });

  function detailView(): HTMLElement {
    return modal.querySelector("clan-detail-view") as HTMLElement;
  }

  // The detail view fires this when its clan fails to load.
  function dispatchNavigateBack() {
    detailView().dispatchEvent(
      new CustomEvent("navigate-back", { bubbles: true, composed: true }),
    );
  }

  it("shows the second clan when one is opened from a profile", async () => {
    modal.open({ clan: "AAA" });
    await waitForSubComponent(modal, "clan-detail-view");
    expect(getElState<ClanInfo>(detailView(), "selectedClan").tag).toBe("AAA");

    // loadMyClans()'s spinner replaces the detail view, so the second clan
    // always lands on a freshly mounted one.
    modal.openFromProfile("BBB", "player-1", null);
    await flushAsync(modal, detailView());

    expect(getElState(detailView(), "clanTag")).toBe("BBB");
    expect(fetchClanDetail).toHaveBeenLastCalledWith("BBB");
    expect(getElState<ClanInfo>(detailView(), "selectedClan").tag).toBe("BBB");
  });

  it("routes a failed clan load back to the profile that opened it", async () => {
    modal.openFromProfile("BBB", "player-1", null);
    await waitForSubComponent(modal, "clan-detail-view");

    dispatchNavigateBack();
    await flushAsync(modal);

    expect(returnedTo).toEqual(["player-1"]);
  });

  it("leaves a failed clan load on the clan list when no profile opened it", async () => {
    modal.open({ clan: "AAA" });
    await waitForSubComponent(modal, "clan-detail-view");

    dispatchNavigateBack();
    await flushAsync(modal);

    expect(returnedTo).toEqual([]);
    expect(getElState(modal, "view")).toBe("list");
    expect(getElState(modal, "selectedClanTag")).toBe("");
  });

  it("routes leaving the clan back to the profile that opened it", async () => {
    modal.openFromProfile("BBB", "player-1", null);
    await waitForSubComponent(modal, "clan-detail-view");

    detailView().dispatchEvent(
      new CustomEvent("clan-left", {
        detail: { tag: "BBB" },
        bubbles: true,
        composed: true,
      }),
    );
    await flushAsync(modal);

    expect(returnedTo).toEqual(["player-1"]);
  });

  it("routes disbanding the clan back to the profile that opened it", async () => {
    modal.openFromProfile("BBB", "player-1", null);
    await waitForSubComponent(modal, "clan-detail-view");
    setState(modal, "myRole" as keyof ClanModal, "leader" as never);
    setState(modal, "view" as keyof ClanModal, "manage" as never);
    const manageView = await waitForSubComponent(modal, "clan-manage-view");

    manageView.dispatchEvent(
      new CustomEvent("clan-disbanded", {
        detail: { tag: "BBB" },
        bubbles: true,
        composed: true,
      }),
    );
    await flushAsync(modal);

    expect(returnedTo).toEqual(["player-1"]);
  });

  // Clicking a member's name. Raised by the detail and game-history views.
  function dispatchViewProfile(
    publicId: string,
    selector = "clan-detail-view",
  ) {
    modal.querySelector(selector)!.dispatchEvent(
      new CustomEvent("view-profile", {
        detail: { publicId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  it("returns a member's profile to the clan's Members tab", async () => {
    modal.open({ clan: "AAA" });
    await waitForSubComponent(modal, "clan-detail-view");
    modal.setActiveTab("members");
    await flushAsync(modal, detailView());

    dispatchViewProfile("player-P");
    await flushAsync(modal);
    // The profile modal took over the page; the clan survives underneath.
    expect(getElState(modal, "selectedClanTag")).toBe("AAA");

    modal.returnFromPlayerProfile();
    await flushAsync(modal);

    expect(getElState(modal, "selectedClanTag")).toBe("AAA");
    expect(getElState(modal, "activeTab")).toBe("members");
  });

  it("returns a profile opened from a sub-view to that sub-view", async () => {
    // Manage/transfer/requests/bans have no tab of their own, so the Members
    // tab fallback would drop the user a level up from where they clicked.
    modal.open({ clan: "AAA" });
    await waitForSubComponent(modal, "clan-detail-view");
    setState(modal, "myRole" as keyof ClanModal, "leader" as never);
    setState(modal, "view" as keyof ClanModal, "manage" as never);
    await waitForSubComponent(modal, "clan-manage-view");

    dispatchViewProfile("player-P", "clan-manage-view");
    await flushAsync(modal);

    modal.returnFromPlayerProfile();
    await flushAsync(modal);

    expect(getElState(modal, "selectedClanTag")).toBe("AAA");
    expect(getElState(modal, "view")).toBe("manage");
  });

  it("returns a member's profile to the clan's Game History tab", async () => {
    modal.open({ clan: "AAA" });
    await waitForSubComponent(modal, "clan-detail-view");
    modal.setActiveTab("game-history");
    await waitForSubComponent(modal, "clan-game-history-view");

    dispatchViewProfile("player-P", "clan-game-history-view");
    await flushAsync(modal);

    modal.returnFromPlayerProfile();
    await flushAsync(modal);

    expect(getElState(modal, "selectedClanTag")).toBe("AAA");
    expect(getElState(modal, "activeTab")).toBe("game-history");
  });

  it("lands on the clan list when a profile detoured through its own clan", async () => {
    // Clan A → member profile → that profile's clan B → Back → Back. Only the
    // innermost hop is remembered, so A is gone by then — the Back must still
    // land somewhere usable rather than on an empty page.
    modal.open({ clan: "AAA" });
    await waitForSubComponent(modal, "clan-detail-view");

    dispatchViewProfile("player-P");
    await flushAsync(modal);
    modal.openFromProfile("BBB", "player-P", null);
    await flushAsync(modal, detailView());

    // B's Back goes to the profile that opened it, resetting this modal.
    dispatchNavigateBack();
    await flushAsync(modal);
    expect(returnedTo).toEqual(["player-P"]);
    expect(getElState(modal, "selectedClanTag")).toBe("");

    modal.returnFromPlayerProfile();
    await flushAsync(modal);

    expect(modal.isOpen()).toBe(true);
    expect(getElState(modal, "view")).toBe("list");
    expect(getElState(modal, "activeTab")).toBe("my-clans");
  });
});
