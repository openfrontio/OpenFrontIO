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
  const ZERO = { wins: 0, losses: 0 } as const;
  const stats: ClanMemberStats = {
    total: { wins: 7, losses: 5 },
    ffa: { wins: 2, losses: 4 },
    team: { wins: 5, losses: 1 },
    hvn: { ...ZERO },
    duos: { wins: 1, losses: 0 },
    trios: { wins: 4, losses: 1 },
    quads: { ...ZERO },
    "2": { ...ZERO },
    "3": { ...ZERO },
    "4": { ...ZERO },
    "5": { ...ZERO },
    "6": { ...ZERO },
    "7": { ...ZERO },
    ranked: { ...ZERO },
    "1v1": { ...ZERO },
  };

  async function renderTo(
    result: ReturnType<typeof renderMemberStats>,
  ): Promise<HTMLElement> {
    const host = document.createElement("div");
    render(result, host);
    document.body.appendChild(host);
    // Allow Lit to upgrade the <clan-stats-breakdown> custom element.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    return host;
  }

  function findExpandableButton(
    host: HTMLElement,
    labelKey: string,
  ): HTMLButtonElement | undefined {
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((b) => (b.textContent ?? "").includes(labelKey));
  }

  async function expandTotal(host: HTMLElement) {
    const btn = findExpandableButton(host, "clan_modal.stats_total");
    btn!.click();
    await new Promise((r) => setTimeout(r, 0));
  }

  it("renders nothing when stats is undefined", async () => {
    const host = await renderTo(renderMemberStats(undefined));
    expect(host.textContent?.trim()).toBe("");
  });

  it("collapses everything except the total row by default", async () => {
    const host = await renderTo(renderMemberStats(stats));
    const text = host.textContent ?? "";
    expect(text).toContain("clan_modal.stats_total");
    expect(text).not.toContain("clan_modal.stats_ffa");
    expect(text).not.toContain("clan_modal.stats_team");
    expect(text).not.toContain("clan_modal.stats_hvn");
    expect(text).not.toContain("clan_modal.stats_ranked");
  });

  it("renders W/L labels inside bar segments and the win-rate per bucket", async () => {
    const host = await renderTo(renderMemberStats(stats));
    await expandTotal(host);
    const text = host.textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("2W");
    expect(text).toContain("4L");
    expect(text).toContain("5W");
    expect(text).toContain("1L");
    expect(text).toContain("33%");
    expect(text).toContain("83%");
    expect(text).toContain("—");
  });

  it("renders a proportional win-loss bar when there are games", async () => {
    const host = await renderTo(renderMemberStats(stats));
    await expandTotal(host);
    const bars = host.querySelectorAll<HTMLDivElement>("[style*='width']");
    // Top-level rows after expanding Total: total, ffa, team, hvn, ranked (5).
    // Ranked and hvn have 0 games → no segments. Others contribute 2 each.
    expect(bars.length).toBe(6);
    const widths = Array.from(bars).map((b) =>
      (b.getAttribute("style") ?? "").replace(/\s+/g, ""),
    );
    expect(widths[0]).toContain("width:58.33");
    expect(widths[1]).toContain("width:41.66");
    expect(widths[2]).toContain("width:33.33");
    expect(widths[3]).toContain("width:66.66");
  });

  it("includes the visible top-level translated bucket labels", async () => {
    const host = await renderTo(renderMemberStats(stats));
    await expandTotal(host);
    const text = host.textContent ?? "";
    expect(text).toContain("clan_modal.stats_total");
    expect(text).toContain("clan_modal.stats_ffa");
    expect(text).toContain("clan_modal.stats_team");
    expect(text).toContain("clan_modal.stats_hvn");
    expect(text).toContain("clan_modal.stats_ranked");
    // 1v1 lives under the ranked dropdown — hidden until expanded.
    expect(text).not.toContain("clan_modal.stats_1v1");
  });

  it("reveals team sub-buckets when the team row is expanded", async () => {
    const host = await renderTo(renderMemberStats(stats));
    await expandTotal(host);
    const teamButton = findExpandableButton(host, "clan_modal.stats_team");
    expect(teamButton).toBeDefined();
    expect(teamButton!.disabled).toBe(false);
    teamButton!.click();
    await new Promise((r) => setTimeout(r, 0));
    const text = host.textContent ?? "";
    expect(text).toContain("clan_modal.stats_duos");
    expect(text).toContain("clan_modal.stats_trios");
    // Buckets with no games are hidden.
    expect(text).not.toContain("clan_modal.stats_quads");
  });

  it("does not render an expandable button for ranked when no breakdown has games", async () => {
    const host = await renderTo(renderMemberStats(stats));
    await expandTotal(host);
    const expandableLabels = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).map((b) => b.textContent ?? "");
    expect(
      expandableLabels.some((t) => t.includes("clan_modal.stats_ranked")),
    ).toBe(false);
    // Sanity: team is still expandable since it has sub-bucket games.
    expect(
      expandableLabels.some((t) => t.includes("clan_modal.stats_team")),
    ).toBe(true);
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
