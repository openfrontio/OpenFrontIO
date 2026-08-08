import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClanInfo,
  ClanMember,
  ClanMembersResponse,
  ClanMemberStats,
} from "../../../src/client/ClanApi";
import {
  apiMockFactory,
  clanApiMockFactory,
  setElState,
  utilsMockFactory,
} from "./ClanModalTestUtils";

vi.mock("../../../src/client/Api", () => apiMockFactory());
vi.mock("../../../src/client/ClanApi", () => clanApiMockFactory());
vi.mock("../../../src/client/Utils", () => utilsMockFactory());

import { ClanDetailView } from "../../../src/client/components/clan/ClanDetailView";
import { ClanManageView } from "../../../src/client/components/clan/ClanManageView";
import { ClanTransferView } from "../../../src/client/components/clan/ClanTransferView";

const TARGET_ID = "d3G1QO8Z";
const PAGE_MEMBER_ID = "page-five-member";
const OLDER_RESULT_ID = `${TARGET_ID}-older`;
const NEWER_RESULT_ID = `${TARGET_ID}-newer`;
const ZERO_WL = { wins: 0, losses: 0 } as const;
const ZERO_STATS: ClanMemberStats = {
  total: ZERO_WL,
  ffa: ZERO_WL,
  team: ZERO_WL,
  hvn: ZERO_WL,
  duos: ZERO_WL,
  trios: ZERO_WL,
  quads: ZERO_WL,
  "2": ZERO_WL,
  "3": ZERO_WL,
  "4": ZERO_WL,
  "5": ZERO_WL,
  "6": ZERO_WL,
  "7": ZERO_WL,
  ranked: ZERO_WL,
  "1v1": ZERO_WL,
};

const clan: ClanInfo = {
  name: "Test Clan",
  tag: "TST",
  description: "A test clan",
  isOpen: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  memberCount: 100,
};

function member(publicId: string, role: ClanMember["role"] = "member") {
  return {
    publicId,
    username: null,
    role,
    joinedAt: "2024-01-01T00:00:00.000Z",
    stats: ZERO_STATS,
  } satisfies ClanMember;
}

type MemberView = HTMLElement & {
  updateComplete: Promise<boolean>;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function memberResponse(
  members: ClanMember[],
  page = 1,
  total = members.length,
): ClanMembersResponse {
  return {
    results: members,
    total,
    page,
    limit: 10,
    pendingRequests: 0,
  };
}

function createDetailView(): MemberView {
  const view = new ClanDetailView();
  view.clanTag = clan.tag;
  view.cachedClan = clan;
  view.cachedDetail = {
    tag: clan.tag,
    members: [member(PAGE_MEMBER_ID)],
    membersTotal: 100,
    pendingRequestCount: 0,
  };
  view.myClanRoles = new Map([[clan.tag, "leader"]]);
  view.detailTab = "members";
  return view;
}

function createManageView(): MemberView {
  const view = new ClanManageView();
  view.clanTag = clan.tag;
  view.selectedClan = clan;
  view.myPublicId = "leader-id";
  view.myRole = "leader";
  return view;
}

function createTransferView(): MemberView {
  const view = new ClanTransferView();
  view.clanTag = clan.tag;
  view.selectedClan = clan;
  return view;
}

const MEMBER_VIEW_CASES = [
  { label: "members", create: createDetailView },
  { label: "manage", create: createManageView },
  { label: "transfer", create: createTransferView },
];

async function settle(view: MemberView) {
  for (let i = 0; i < 3; i++) {
    await Promise.resolve();
    await view.updateComplete;
  }
}

async function putOnPageFive(view: MemberView) {
  document.body.appendChild(view);
  await settle(view);
  setElState(view, "members", [member(PAGE_MEMBER_ID)]);
  setElState(view, "membersTotal", 100);
  setElState(view, "memberPage", 5);
  await view.updateComplete;
  expect(view.textContent).toContain(PAGE_MEMBER_ID);
  expect(view.textContent).toContain("5 / 10");
}

async function searchForTarget(view: MemberView) {
  const input = memberSearchInput(view);
  input.value = TARGET_ID;
  input.dispatchEvent(new Event("input", { bubbles: true }));

  await vi.advanceTimersByTimeAsync(200);
  await settle(view);

  expect(view.textContent).toContain(TARGET_ID);
  expect(view.textContent).not.toContain(PAGE_MEMBER_ID);
  expect(view.textContent).not.toContain("5 / 10");
}

function memberSearchInput(view: MemberView): HTMLInputElement {
  const input = view.querySelector<HTMLInputElement>(
    'input[placeholder="clan_modal.search_members_placeholder"]',
  );
  expect(input).not.toBeNull();
  return input!;
}

function enterSearch(view: MemberView, search: string) {
  const input = memberSearchInput(view);
  input.value = search;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function nextPageButton(view: MemberView): HTMLButtonElement {
  const button = Array.from(
    view.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === ">");
  expect(button).not.toBeUndefined();
  return button!;
}

describe("clan member search pagination", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    const { fetchClanMembers } = await import("../../../src/client/ClanApi");
    vi.mocked(fetchClanMembers).mockImplementation(
      async (_tag, page = 1, limit = 20, _sort, _order, search) => {
        if (page === 1 && search === TARGET_ID) {
          return {
            results: [member(TARGET_ID)],
            total: 1,
            page: 1,
            limit,
            pendingRequests: 0,
          };
        }
        return {
          results: [member(PAGE_MEMBER_ID)],
          total: 100,
          page,
          limit,
          pendingRequests: 0,
        };
      },
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("searches the full roster from page one in the members view", async () => {
    const view = new ClanDetailView();
    view.clanTag = clan.tag;
    view.cachedClan = clan;
    view.cachedDetail = {
      tag: clan.tag,
      members: [member(PAGE_MEMBER_ID)],
      membersTotal: 100,
      pendingRequestCount: 0,
    };
    view.myClanRoles = new Map([[clan.tag, "leader"]]);
    view.detailTab = "members";

    await putOnPageFive(view);
    await searchForTarget(view);
    view.detailTab = "overview";
    await view.updateComplete;
    expect(view.textContent).toContain("100");
  });

  it("searches the full roster from page one in the manage view", async () => {
    const view = new ClanManageView();
    view.clanTag = clan.tag;
    view.selectedClan = clan;
    view.myPublicId = "leader-id";
    view.myRole = "leader";

    await putOnPageFive(view);
    const memberCountUpdates: number[] = [];
    view.addEventListener("clan-updated", (event) => {
      memberCountUpdates.push(
        (event as CustomEvent<{ memberCount: number }>).detail.memberCount,
      );
    });
    await searchForTarget(view);
    expect(memberCountUpdates).toEqual([]);
  });

  it("searches the full roster from page one in the transfer view", async () => {
    const view = new ClanTransferView();
    view.clanTag = clan.tag;
    view.selectedClan = clan;

    await putOnPageFive(view);
    await searchForTarget(view);
  });

  it.each(MEMBER_VIEW_CASES)(
    "ignores stale same-search responses in the $label view",
    async ({ create }) => {
      const view = create();
      await putOnPageFive(view);

      const older = deferred<ClanMembersResponse | false>();
      const newer = deferred<ClanMembersResponse | false>();
      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      vi.mocked(fetchClanMembers).mockReset();
      vi.mocked(fetchClanMembers)
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);

      enterSearch(view, TARGET_ID);
      await vi.advanceTimersByTimeAsync(200);
      nextPageButton(view).click();

      newer.resolve(memberResponse([member(NEWER_RESULT_ID)], 6, 100));
      await settle(view);
      expect(view.textContent).toContain(NEWER_RESULT_ID);
      expect(view.textContent).toContain("6 / 10");

      older.resolve(memberResponse([member(OLDER_RESULT_ID)]));
      await settle(view);
      expect(view.textContent).toContain(NEWER_RESULT_ID);
      expect(view.textContent).not.toContain(OLDER_RESULT_ID);
      expect(view.textContent).toContain("6 / 10");
    },
  );

  it.each([
    { label: "manage", create: createManageView },
    { label: "transfer", create: createTransferView },
  ])(
    "preserves a refined empty-result search in the $label view",
    async ({ create }) => {
      const view = create();
      await putOnPageFive(view);

      const refined = deferred<ClanMembersResponse | false>();
      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      vi.mocked(fetchClanMembers).mockReset();
      vi.mocked(fetchClanMembers)
        .mockResolvedValueOnce(memberResponse([]))
        .mockReturnValueOnce(refined.promise);

      enterSearch(view, "missing-one");
      await vi.advanceTimersByTimeAsync(200);
      await settle(view);
      expect(memberSearchInput(view).value).toBe("missing-one");

      enterSearch(view, "missing-two");
      await vi.advanceTimersByTimeAsync(200);
      refined.resolve(memberResponse([]));
      await settle(view);

      expect(memberSearchInput(view).value).toBe("missing-two");
    },
  );

  it.each(MEMBER_VIEW_CASES)(
    "rerenders the filtered fallback when search fails in the $label view",
    async ({ create }) => {
      const view = create();
      await putOnPageFive(view);

      const { fetchClanMembers } = await import("../../../src/client/ClanApi");
      vi.mocked(fetchClanMembers).mockReset();
      vi.mocked(fetchClanMembers).mockResolvedValue(false);

      enterSearch(view, "definitely-not-present");
      await vi.advanceTimersByTimeAsync(200);
      await settle(view);

      expect(view.textContent).not.toContain(PAGE_MEMBER_ID);
      expect(memberSearchInput(view).value).toBe("definitely-not-present");
    },
  );
});
