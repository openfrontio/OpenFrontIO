import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiMockFactory,
  authMockFactory,
  flushAsync,
  utilsMockFactory,
} from "./ClanModalTestUtils";

vi.mock("../../../src/client/Api", () => apiMockFactory());
vi.mock("../../../src/client/Auth", () => authMockFactory());
vi.mock("../../../src/client/Utils", () => utilsMockFactory());
import { translateText } from "../../../src/client/Utils";
vi.mock("../../../src/client/ClanApi", () => ({
  fetchClanMapActivity: vi.fn(),
  fetchClanMapActivityMembers: vi.fn(),
}));

import type {
  MapActivityEvent,
  MapActivityMember,
  MapActivityPage,
} from "../../../src/client/ClanApi";
import {
  fetchClanMapActivity,
  fetchClanMapActivityMembers,
} from "../../../src/client/ClanApi";
import { ClanMapActivityView } from "../../../src/client/components/clan/ClanMapActivityView";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const player = { id: "p1", username: "alice" };
const now = new Date().toISOString();

const sailing = {
  kind: "ship_sailing" as const,
  at: now,
  player,
  troops: 3000,
  toX: 1012,
  toY: 620,
  arrivesAt: now,
};

const allKinds: MapActivityEvent[] = [
  {
    kind: "claimed",
    at: now,
    player,
    pixels: 12,
    neutral: 8,
    takenFrom: [{ clan: { tag: "LUX", color: 0x5b4be0 }, pixels: 4 }],
    x: 2380,
    y: 1150,
  },
  {
    kind: "unclaimed",
    at: now,
    player,
    pixels: 4,
    refundTroops: 2000,
    x: 1,
    y: 2,
  },
  {
    kind: "bought_troops",
    at: now,
    player: { id: null, username: null },
    troops: 50000,
    caps: "500",
  },
  {
    kind: "ship_landed",
    at: now,
    player,
    troops: 3000,
    toX: 2401,
    toY: 1166,
    outcome: "captured",
  },
  {
    kind: "lost",
    at: now,
    clan: { tag: "LUX", color: null },
    player: { id: "p9", username: "Velyx" },
    pixels: 15,
    x: 2378,
    y: 1148,
  },
  {
    kind: "siege",
    at: now,
    clan: { tag: null, color: null },
    pixels: 32,
    x: 3,
    y: 4,
  },
];

const pageOf = (
  events: MapActivityEvent[],
  more: Partial<MapActivityPage> = {},
): MapActivityPage => ({
  summary: { gained: 412, lost: 47, shipsAtSea: 1, nextLandingAt: now },
  atSea: [sailing],
  events,
  nextBefore: null,
  ...more,
});

const member = (
  overrides: Partial<MapActivityMember> = {},
): MapActivityMember => ({
  player,
  role: "officer",
  claimed: 0,
  caps: "0",
  shipsSent: 0,
  shipsLanded: 0,
  lastActiveAt: null,
  ...overrides,
});

async function mount() {
  if (!customElements.get("clan-map-activity-view")) {
    customElements.define("clan-map-activity-view", ClanMapActivityView);
  }
  const el = document.createElement(
    "clan-map-activity-view",
  ) as ClanMapActivityView;
  el.clanTag = "OF";
  document.body.appendChild(el);
  await flushAsync(el);
  return el;
}

const tab = (el: Element, tabs: string, key: string) =>
  el.querySelector<HTMLButtonElement>(`[data-tabs=${tabs}] [data-tab=${key}]`)!;

describe("ClanMapActivityView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asMock(fetchClanMapActivity).mockResolvedValue(pageOf(allKinds));
    asMock(fetchClanMapActivityMembers).mockResolvedValue({
      period: "7d",
      members: [],
    });
  });

  afterEach(() => document.body.replaceChildren());

  it("loads the first page of everything on mount", async () => {
    await mount();
    expect(fetchClanMapActivity).toHaveBeenCalledWith("OF", { filter: "all" });
  });

  it("shows the 24-hour summary, the ships at sea and every kind of event", async () => {
    const el = await mount();
    expect(el.querySelectorAll("[data-stat]")).toHaveLength(3);
    expect(el.querySelector("[data-stat=ships]")!.textContent).toContain("1");
    const atSea = el.querySelector("[data-group=at-sea]")!;
    expect(atSea.querySelector("[data-kind=ship_sailing]")).not.toBeNull();
    for (const kind of [
      "claimed",
      "unclaimed",
      "bought_troops",
      "ship_landed",
      "lost",
      "siege",
    ]) {
      expect(el.querySelector(`[data-kind=${kind}]`), kind).not.toBeNull();
    }
    expect(el.textContent).toContain("clan_modal.map_activity_claimed");
    expect(el.textContent).toContain("clan_modal.map_activity_siege");
    // Deleted player and deleted clan get labels, not links.
    expect(
      el.querySelector("[data-kind=bought_troops]")!.textContent,
    ).toContain("clan_modal.map_activity_deleted_player");
    expect(el.querySelector("[data-kind=siege]")!.textContent).toContain(
      "clan_modal.map_activity_deleted_clan",
    );
    // Troops bought show the caps spent.
    expect(
      el.querySelector("[data-kind=bought_troops] currency-display"),
    ).not.toBeNull();
  });

  it("passes counts as numbers, so the translation pluralises and formats them", async () => {
    await mount();
    expect(translateText).toHaveBeenCalledWith(
      "clan_modal.map_activity_bought",
      expect.objectContaining({ troops: 50000 }),
    );
    expect(translateText).toHaveBeenCalledWith(
      "clan_modal.map_activity_troops_aboard",
      { troops: 3000 },
    );
    expect(translateText).toHaveBeenCalledWith(
      "clan_modal.map_activity_refunded",
      { troops: 2000 },
    );
  });

  it("puts the player or clan in the sentence through a {name} / {clan} slot", async () => {
    const el = await mount();
    const call = asMock(translateText).mock.calls.find(
      ([key]) => key === "clan_modal.map_activity_claimed",
    )!;
    expect(call[1]).toEqual({ count: 12, name: expect.any(String) });
    expect(
      asMock(translateText).mock.calls.find(
        ([key]) => key === "clan_modal.map_activity_siege",
      )![1],
    ).toEqual({ count: 32, clan: expect.any(String) });
    // The mock translation drops the slot; the name is still shown.
    expect(el.querySelector("[data-kind=claimed] player-name")).not.toBeNull();
  });

  it("shows only the time under a day divider, without repeating the day", async () => {
    const el = await mount();
    expect(el.textContent).not.toContain("history_today_at");
    expect(el.textContent).not.toContain("history_date_at");
    // A boat landing today: "Lands at …", no "Today" in the middle.
    expect(translateText).toHaveBeenCalledWith(
      "clan_modal.map_activity_ship_lands",
      { time: expect.any(String) },
    );
  });

  it("opens the map from a row's own button, and the name stays a separate button", async () => {
    const el = await mount();
    const at: unknown[] = [];
    const profiles: string[] = [];
    el.addEventListener("view-on-map", (e) =>
      at.push((e as CustomEvent).detail),
    );
    el.addEventListener("view-profile", (e) =>
      profiles.push((e as CustomEvent<{ publicId: string }>).detail.publicId),
    );
    const view = (kind: string) =>
      el.querySelector<HTMLButtonElement>(
        `[data-kind=${kind}] button[data-view-on-map]`,
      )!;
    view("claimed").click();
    view("ship_sailing").click();
    expect(at).toEqual([
      { x: 2380, y: 1150 },
      { x: 1012, y: 620 },
    ]);
    // A real button, so Enter and Space work natively, with a label.
    expect(view("claimed").getAttribute("aria-label")).toBe(
      "clan_modal.map_activity_view_at",
    );
    // No button inside a button: the name sits beside the row's button.
    expect(el.querySelector("[data-view-on-map] player-name")).toBeNull();
    expect(el.querySelector("[role=button]")).toBeNull();
    el.querySelector<HTMLButtonElement>(
      "[data-kind=claimed] player-name button",
    )!.click();
    expect(profiles).toEqual(["p1"]);
    expect(at).toHaveLength(2);
    // Troop purchases have no place on the map.
    expect(
      el.querySelector("[data-kind=bought_troops] [data-view-on-map]"),
    ).toBeNull();
  });

  it("a Load more cut short by switching filter doesn't leave Load more disabled", async () => {
    asMock(fetchClanMapActivity).mockResolvedValueOnce(
      pageOf([allKinds[0]], { nextBefore: "2026-11-01T00:00:00.000Z" }),
    );
    const el = await mount();
    let finish!: (v: MapActivityPage) => void;
    asMock(fetchClanMapActivity).mockReturnValueOnce(
      new Promise<MapActivityPage>((r) => (finish = r)),
    );
    el.querySelector<HTMLButtonElement>("[data-load-more]")!.click();
    await flushAsync(el);
    expect(
      el.querySelector<HTMLButtonElement>("[data-load-more]")!.disabled,
    ).toBe(true);
    // Switch away mid-load, then back.
    asMock(fetchClanMapActivity).mockResolvedValueOnce(pageOf([allKinds[4]]));
    tab(el, "filter", "lost").click();
    await flushAsync(el);
    finish(pageOf([allKinds[5]], { atSea: [] }));
    await flushAsync(el);
    // (Were All refetched, it would still have more pages.)
    asMock(fetchClanMapActivity).mockResolvedValue(
      pageOf([allKinds[0]], { nextBefore: "2026-11-01T00:00:00.000Z" }),
    );
    tab(el, "filter", "all").click();
    await flushAsync(el);
    const more = el.querySelector<HTMLButtonElement>("[data-load-more]")!;
    expect(more.disabled).toBe(false);
    // The abandoned page wasn't appended.
    expect(el.querySelector("[data-kind=siege]")).toBeNull();
  });

  it("keeps each filter's loaded pages, so switching back doesn't refetch", async () => {
    asMock(fetchClanMapActivity).mockResolvedValueOnce(
      pageOf([allKinds[0]], { nextBefore: "2026-11-01T00:00:00.000Z" }),
    );
    const el = await mount();
    asMock(fetchClanMapActivity).mockResolvedValueOnce(
      pageOf([allKinds[5]], { atSea: [] }),
    );
    el.querySelector<HTMLButtonElement>("[data-load-more]")!.click();
    await flushAsync(el);
    asMock(fetchClanMapActivity).mockResolvedValueOnce(pageOf([allKinds[4]]));
    tab(el, "filter", "lost").click();
    await flushAsync(el);
    tab(el, "mode", "members").click();
    await flushAsync(el);
    tab(el, "mode", "recent").click();
    await flushAsync(el);
    tab(el, "filter", "all").click();
    await flushAsync(el);
    // First page, Load more, Lost: nothing again for switching back.
    expect(fetchClanMapActivity).toHaveBeenCalledTimes(3);
    expect(el.querySelector("[data-kind=claimed]")).not.toBeNull();
    expect(el.querySelector("[data-kind=siege]")).not.toBeNull();
  });

  it("asks a signed-out player to sign in, with no retry", async () => {
    asMock(fetchClanMapActivity).mockResolvedValueOnce({
      error: "signed_out",
    });
    const el = await mount();
    expect(
      el.querySelector("[data-state='clan_modal.map_activity_signed_out']"),
    ).not.toBeNull();
    expect(el.querySelector("[data-state] button")).toBeNull();
  });

  it("refetches for a filter, and hides the ships at sea under Lost", async () => {
    const el = await mount();
    asMock(fetchClanMapActivity).mockResolvedValueOnce(pageOf([allKinds[4]]));
    tab(el, "filter", "lost").click();
    await flushAsync(el);
    expect(fetchClanMapActivity).toHaveBeenLastCalledWith("OF", {
      filter: "lost",
    });
    expect(el.querySelector("[data-group=at-sea]")).toBeNull();
  });

  it("loads more with the cursor and appends", async () => {
    asMock(fetchClanMapActivity).mockResolvedValueOnce(
      pageOf([allKinds[0]], { nextBefore: "2026-11-01T00:00:00.000Z" }),
    );
    const el = await mount();
    asMock(fetchClanMapActivity).mockResolvedValueOnce(
      pageOf([allKinds[5]], { atSea: [] }),
    );
    el.querySelector<HTMLButtonElement>("[data-load-more]")!.click();
    await flushAsync(el);
    expect(fetchClanMapActivity).toHaveBeenLastCalledWith("OF", {
      filter: "all",
      before: "2026-11-01T00:00:00.000Z",
    });
    expect(el.querySelector("[data-kind=claimed]")).not.toBeNull();
    expect(el.querySelector("[data-kind=siege]")).not.toBeNull();
    // That was the last page.
    expect(el.querySelector("[data-load-more]")).toBeNull();
  });

  it("offers the map when there is no activity at all", async () => {
    asMock(fetchClanMapActivity).mockResolvedValueOnce(
      pageOf([], { atSea: [] }),
    );
    const el = await mount();
    const at: unknown[] = [];
    el.addEventListener("view-on-map", (e) =>
      at.push((e as CustomEvent).detail),
    );
    expect(
      el.querySelector("[data-state='clan_modal.map_activity_empty']"),
    ).not.toBeNull();
    el.querySelector<HTMLButtonElement>("[data-state] button")!.click();
    expect(at).toEqual([null]);
  });

  it("says nothing was lost when the Lost filter is empty", async () => {
    const el = await mount();
    asMock(fetchClanMapActivity).mockResolvedValueOnce(
      pageOf([], { atSea: [] }),
    );
    tab(el, "filter", "lost").click();
    await flushAsync(el);
    expect(el.textContent).toContain("clan_modal.map_activity_empty_lost");
  });

  it("shows the members-only notice on 403, and a retry when it fails", async () => {
    asMock(fetchClanMapActivity).mockResolvedValueOnce({ error: "forbidden" });
    let el = await mount();
    expect(el.textContent).toContain("clan_modal.map_activity_members_only");
    el.remove();

    asMock(fetchClanMapActivity).mockResolvedValueOnce({ error: "failed" });
    el = await mount();
    expect(el.textContent).toContain("clan_modal.map_activity_unavailable");
    el.querySelector<HTMLButtonElement>("[data-state] button")!.click();
    await flushAsync(el);
    expect(el.querySelector("[data-kind=claimed]")).not.toBeNull();
  });

  describe("By member", () => {
    const members = [
      member({
        player: { id: "a", username: "quiet" },
        role: "officer",
        lastActiveAt: null,
      }),
      member({
        player: { id: "b", username: "builder" },
        role: "leader",
        claimed: 412,
        caps: "2400",
        shipsSent: 5,
        shipsLanded: 4,
        lastActiveAt: "2026-11-11T14:48:00.000Z",
      }),
      member({
        player: { id: "c", username: "buyer" },
        role: null,
        caps: "9000",
        lastActiveAt: "2026-11-09T20:15:00.000Z",
      }),
    ];

    async function openMembers() {
      asMock(fetchClanMapActivityMembers).mockResolvedValue({
        period: "7d",
        members,
      });
      const el = await mount();
      tab(el, "mode", "members").click();
      await flushAsync(el);
      return el;
    }

    const order = (el: Element) =>
      [...el.querySelectorAll("[data-member]")].map((m) =>
        m.getAttribute("data-member"),
      );

    it("lists members by last active, with no activity last", async () => {
      const el = await openMembers();
      expect(fetchClanMapActivityMembers).toHaveBeenCalledWith("OF", "7d");
      expect(order(el)).toEqual(["b", "c", "a"]);
      expect(el.querySelector("[data-member=a]")!.textContent).toContain(
        "clan_modal.map_activity_none_7d",
      );
      // Someone who has left is marked.
      expect(el.querySelector("[data-member=c] [data-left]")).not.toBeNull();
      expect(el.querySelector("[data-member=b] [data-left]")).toBeNull();
    });

    it("re-sorts locally and refetches for a period", async () => {
      const el = await openMembers();
      const sort = el.querySelector<HTMLSelectElement>("[data-select=sort]")!;
      sort.value = "caps";
      sort.dispatchEvent(new Event("change"));
      await flushAsync(el);
      expect(order(el)).toEqual(["c", "b", "a"]);
      expect(fetchClanMapActivityMembers).toHaveBeenCalledTimes(1);

      const period = el.querySelector<HTMLSelectElement>(
        "[data-select=period]",
      )!;
      period.value = "30d";
      period.dispatchEvent(new Event("change"));
      await flushAsync(el);
      expect(fetchClanMapActivityMembers).toHaveBeenLastCalledWith("OF", "30d");
      // Back to 7 days: already loaded.
      period.value = "7d";
      period.dispatchEvent(new Event("change"));
      await flushAsync(el);
      expect(fetchClanMapActivityMembers).toHaveBeenCalledTimes(2);
    });

    it("says 'today at' for activity today, and just the date before that", async () => {
      await openMembers();
      const keys = asMock(translateText).mock.calls.map(([key]) => key);
      expect(keys).not.toContain("clan_modal.map_activity_active");
      expect(keys).toContain("clan_modal.map_activity_active_date");
      asMock(fetchClanMapActivityMembers).mockResolvedValue({
        period: "7d",
        members: [member({ lastActiveAt: new Date().toISOString() })],
      });
      const el = await mount();
      tab(el, "mode", "members").click();
      await flushAsync(el);
      expect(translateText).toHaveBeenCalledWith(
        "clan_modal.map_activity_active_today",
        { time: expect.any(String) },
      );
    });

    it("says when no one was active", async () => {
      const el = await mount();
      tab(el, "mode", "members").click();
      await flushAsync(el);
      expect(el.querySelector("[data-state=members-empty]")).not.toBeNull();
    });
  });
});
