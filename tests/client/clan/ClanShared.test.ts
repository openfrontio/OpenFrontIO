import { render } from "lit";
import { describe, expect, it } from "vitest";
import type {
  ClanJoinRequest,
  ClanMember,
  ClanMemberStats,
} from "../../../src/client/ClanApi";
import {
  filterMembersBySearch,
  filterRequestsBySearch,
  renderMemberStats,
} from "../../../src/client/components/clan/ClanShared";

const members: ClanMember[] = [
  { publicId: "Alice123", role: "leader", joinedAt: "2024-01-01T00:00:00Z" },
  { publicId: "Bob456", role: "officer", joinedAt: "2024-02-01T00:00:00Z" },
  { publicId: "Charlie789", role: "member", joinedAt: "2024-03-01T00:00:00Z" },
];

const requests: ClanJoinRequest[] = [
  { publicId: "Dave111", createdAt: "2024-04-01T00:00:00Z" },
  { publicId: "Eve222", createdAt: "2024-05-01T00:00:00Z" },
];

describe("filterMembersBySearch", () => {
  it("returns all members when search is empty", () => {
    expect(filterMembersBySearch(members, "")).toEqual(members);
  });

  it("matches by publicId (case-insensitive)", () => {
    const result = filterMembersBySearch(members, "alice");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Alice123");
  });

  it("matches by role", () => {
    const result = filterMembersBySearch(members, "officer");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Bob456");
  });

  it("matches partial publicId", () => {
    const result = filterMembersBySearch(members, "456");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Bob456");
  });

  it("returns empty array when nothing matches", () => {
    expect(filterMembersBySearch(members, "zzz")).toEqual([]);
  });

  it("matches 'member' role without matching 'leader' or 'officer'", () => {
    const result = filterMembersBySearch(members, "member");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Charlie789");
  });
});

describe("renderMemberStats", () => {
  const stats: ClanMemberStats = {
    total: { wins: 7, losses: 5 },
    ffa: { wins: 2, losses: 4 },
    team: { wins: 5, losses: 1 },
    hvn: { wins: 0, losses: 0 },
    ranked: { wins: 0, losses: 0 },
    "1v1": { wins: 0, losses: 0 },
  };

  function renderTo(result: ReturnType<typeof renderMemberStats>): HTMLElement {
    const host = document.createElement("div");
    render(result, host);
    return host;
  }

  it("renders nothing when stats is undefined", () => {
    const host = renderTo(renderMemberStats(undefined));
    expect(host.textContent?.trim()).toBe("");
  });

  it("renders W/L labels inside bar segments and the win-rate per bucket", () => {
    const host = renderTo(renderMemberStats(stats));
    const text = host.textContent?.replace(/\s+/g, " ") ?? "";
    // Each bucket with games shows `{wins}W` and `{losses}L` inside segments
    expect(text).toContain("2W");
    expect(text).toContain("4L");
    expect(text).toContain("5W");
    expect(text).toContain("1L");
    // Win-rate, and em-dash placeholder for empty bucket
    expect(text).toContain("33%");
    expect(text).toContain("83%");
    expect(text).toContain("—");
  });

  it("renders a proportional win-loss bar when there are games", () => {
    const host = renderTo(renderMemberStats(stats));
    const bars = host.querySelectorAll<HTMLDivElement>("[style*='width']");
    // Two segments per bucket with games (total: 2, ffa: 2, team: 2). Ranked
    // and 1v1 have 0 games → no segments.
    expect(bars.length).toBe(6);
    const widths = Array.from(bars).map((b) =>
      (b.getAttribute("style") ?? "").replace(/\s+/g, ""),
    );
    // total: 7/12 ≈ 58.3% wins, 41.7% losses
    expect(widths[0]).toContain("width:58.33");
    expect(widths[1]).toContain("width:41.66");
    // ffa: 2/6 ≈ 33.3% wins, 66.7% losses
    expect(widths[2]).toContain("width:33.33");
    expect(widths[3]).toContain("width:66.66");
  });

  it("includes all six translated bucket labels", () => {
    const host = renderTo(renderMemberStats(stats));
    const text = host.textContent ?? "";
    expect(text).toContain("clan_modal.stats_total");
    expect(text).toContain("clan_modal.stats_ffa");
    expect(text).toContain("clan_modal.stats_team");
    expect(text).toContain("clan_modal.stats_hvn");
    expect(text).toContain("clan_modal.stats_ranked");
    expect(text).toContain("clan_modal.stats_1v1");
  });
});

describe("filterRequestsBySearch", () => {
  it("returns all requests when search is empty", () => {
    expect(filterRequestsBySearch(requests, "")).toEqual(requests);
  });

  it("matches by publicId (case-insensitive)", () => {
    const result = filterRequestsBySearch(requests, "dave");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Dave111");
  });

  it("matches partial publicId", () => {
    const result = filterRequestsBySearch(requests, "222");
    expect(result).toHaveLength(1);
    expect(result[0]!.publicId).toBe("Eve222");
  });

  it("returns empty array when nothing matches", () => {
    expect(filterRequestsBySearch(requests, "zzz")).toEqual([]);
  });
});
