import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClanInfo, ClanMember } from "../../../src/client/ClanApi";
import {
  apiMockFactory,
  clanApiMockFactory,
  utilsMockFactory,
} from "./ClanModalTestUtils";

vi.mock("../../../src/client/Api", () => apiMockFactory());
vi.mock("../../../src/client/ClanApi", () => clanApiMockFactory());
vi.mock("../../../src/client/Utils", () => utilsMockFactory());

import { ClanDetailView } from "../../../src/client/components/clan/ClanDetailView";
import {
  membersHaveLevels,
  renderMemberRow,
} from "../../../src/client/components/clan/ClanShared";

type Level = Pick<ClanMember, "level" | "prestige" | "legend">;

function member(publicId: string, level?: Level): ClanMember {
  return {
    publicId,
    username: null,
    role: "member",
    joinedAt: "2024-01-01T00:00:00.000Z",
    ...level,
  };
}

const unprestiged: Level = { level: 7, prestige: 0, legend: false };
const prestiged: Level = { level: 33, prestige: 4, legend: false };

// What sits in front of each member's name: "badge", "slot", or "name" when
// the name comes first.
function leading(root: Element): Record<string, string> {
  return Object.fromEntries(
    Array.from(root.querySelectorAll("player-name")).map((el) => {
      const name = el as Element & { publicId: string };
      const first = name.parentElement?.firstElementChild;
      const kind =
        first?.tagName === "LEVEL-BADGE"
          ? "badge"
          : first?.hasAttribute("data-level-slot")
            ? "slot"
            : "name";
      return [name.publicId, kind];
    }),
  );
}

describe("membersHaveLevels", () => {
  it("is true when any member has a level, prestiged or not", () => {
    expect(membersHaveLevels([member("a"), member("b", unprestiged)])).toBe(
      true,
    );
  });

  it("is false when no member has a level", () => {
    expect(membersHaveLevels([member("a"), member("b")])).toBe(false);
    expect(membersHaveLevels([])).toBe(false);
  });
});

describe("renderMemberRow level badge", () => {
  const renderRow = (m: ClanMember, levelSlot?: boolean) => {
    const host = document.createElement("div");
    render(renderMemberRow(m, null, host, levelSlot), host);
    return host;
  };

  it("puts a 24px badge in front of the name of any member with a level", () => {
    for (const level of [unprestiged, prestiged]) {
      const host = renderRow(member("a", level), true);
      expect(leading(host)).toEqual({ a: "badge" });
      const badge = host.querySelector("level-badge") as Element & {
        level: number;
        prestige: number;
        legend: boolean;
      };
      expect(badge).toMatchObject(level);
      expect(badge.getAttribute("size")).toBe("24");
    }
  });

  it("keeps an empty, hidden slot for a member without a level when asked", () => {
    const host = renderRow(member("a"), true);
    expect(leading(host)).toEqual({ a: "slot" });
    const slot = host.querySelector("[data-level-slot]") as HTMLElement;
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.style.width).toBe("24px");
  });

  it("renders the name alone when no slot is asked for", () => {
    expect(leading(renderRow(member("a")))).toEqual({ a: "name" });
  });

  it("shows no badge for a member with a field dropped as malformed", () => {
    // The schema reads a malformed field as absent; a partial level must not
    // be drawn with a guessed prestige or legend flag.
    for (const partial of [
      { level: 33, legend: false },
      { level: 33, prestige: 4 },
      { prestige: 4, legend: true },
    ]) {
      expect(membersHaveLevels([member("a", partial)])).toBe(false);
      expect(leading(renderRow(member("a", partial), true))).toEqual({
        a: "slot",
      });
    }
  });

  it("staggers the badge", () => {
    const host = renderRow(member("a", prestiged), true);
    expect(host.querySelector("level-badge")!.hasAttribute("stagger")).toBe(
      true,
    );
  });

  it("keeps the name truncating beside the badge", () => {
    const host = renderRow(member("a", prestiged), true);
    const name = host.querySelector("player-name")!;
    // A flex item's min-width defaults to its content, which would stop the
    // truncating name from shrinking beside the badge.
    expect(name.classList.contains("min-w-0")).toBe(true);
    expect(name.parentElement!.classList.contains("min-w-0")).toBe(true);
    expect(name.parentElement!.classList.contains("flex")).toBe(true);
  });
});

describe("ClanDetailView member levels", () => {
  const clan: ClanInfo = {
    name: "Test Clan",
    tag: "TST",
    description: "A test clan",
    isOpen: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    memberCount: 3,
  };

  const mount = async (members: ClanMember[]) => {
    const { fetchClanMembers } = await import("../../../src/client/ClanApi");
    vi.mocked(fetchClanMembers).mockResolvedValue({
      results: members,
      total: members.length,
      page: 1,
      limit: 10,
      pendingRequests: 0,
    });
    const view = new ClanDetailView();
    view.clanTag = clan.tag;
    view.cachedClan = clan;
    view.cachedDetail = {
      tag: clan.tag,
      members,
      membersTotal: members.length,
      pendingRequestCount: 0,
    };
    view.myClanRoles = new Map([[clan.tag, "member"]]);
    view.detailTab = "members";
    document.body.appendChild(view);
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      await view.updateComplete;
    }
    return view;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("badges members with a level and lines the rest up with a slot", async () => {
    const view = await mount([
      member("lvl", unprestiged),
      member("pre", prestiged),
      member("none"),
    ]);
    expect(leading(view)).toEqual({ lvl: "badge", pre: "badge", none: "slot" });
  });

  it("decides the slot from the members on screen after a search", async () => {
    const view = await mount([member("lvl", unprestiged), member("none")]);
    (view as unknown as { memberSearch: string }).memberSearch = "none";
    await view.updateComplete;
    expect(leading(view)).toEqual({ none: "name" });
  });

  it("leaves the list unchanged when no member has a level", async () => {
    const view = await mount([member("a"), member("b")]);
    expect(leading(view)).toEqual({ a: "name", b: "name" });
    expect(view.querySelector("level-badge")).toBeNull();
  });
});
