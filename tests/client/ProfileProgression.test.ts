import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

import {
  formatProgressDate,
  milestoneRuns,
  prestigeTiles,
  ProfileProgression,
} from "../../src/client/components/ProfileProgression";
import {
  type PublicProgress,
  PublicProgressSchema,
} from "../../src/core/ApiSchemas";

if (!customElements.get("profile-progression")) {
  customElements.define("profile-progression", ProfileProgression);
}

const base = {
  prestige: 3,
  level: 47,
  lifetimeXp: 125400,
  legend: false,
};

function progress(extra: Partial<PublicProgress> = {}): PublicProgress {
  return { ...base, ...extra };
}

const localDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

describe("PublicProgressSchema history and milestones", () => {
  it("parses a response without either list (an older API)", () => {
    const parsed = PublicProgressSchema.parse(base);
    expect(parsed.prestigeHistory).toBeUndefined();
    expect(parsed.milestones).toBeUndefined();
    expect(parsed.level).toBe(47);
  });

  it("parses both lists", () => {
    const data = {
      ...base,
      prestigeHistory: [
        { rank: 1, at: "2026-09-06T10:00:00.000Z" },
        { rank: 2, at: "2026-09-19T10:00:00.000Z" },
      ],
      milestones: [
        { prestige: 2, level: 10, at: "2026-09-20T10:00:00.000Z" },
        { prestige: 3, level: 10, at: "2026-09-29T10:00:00.000Z" },
      ],
    };
    expect(PublicProgressSchema.parse(data)).toEqual(data);
  });

  it("reads a malformed list as absent and keeps the rest", () => {
    const parsed = PublicProgressSchema.parse({
      ...base,
      prestigeHistory: [{ rank: "one", at: 5 }],
      milestones: "nope",
    });
    expect(parsed.prestigeHistory).toBeUndefined();
    expect(parsed.milestones).toBeUndefined();
    expect(parsed.prestige).toBe(3);
  });
});

describe("formatProgressDate", () => {
  it("formats in the viewer's locale, day month year", () => {
    expect(formatProgressDate("2026-09-06T10:00:00.000Z")).toBe(
      localDate("2026-09-06T10:00:00.000Z"),
    );
  });

  it("returns null for a date it can't read", () => {
    expect(formatProgressDate("not a date")).toBeNull();
  });
});

describe("prestigeTiles", () => {
  it("is empty before the first prestige", () => {
    expect(
      prestigeTiles(progress({ prestige: 0, prestigeHistory: [] })),
    ).toEqual([]);
  });

  it("has one dated tile per rank entered, in rank order", () => {
    expect(
      prestigeTiles(
        progress({
          prestigeHistory: [
            { rank: 2, at: "2026-09-19T00:00:00.000Z" },
            { rank: 1, at: "2026-09-06T00:00:00.000Z" },
            { rank: 3, at: "2026-09-28T00:00:00.000Z" },
          ],
        }),
      ),
    ).toEqual([
      { rank: 1, at: "2026-09-06T00:00:00.000Z" },
      { rank: 2, at: "2026-09-19T00:00:00.000Z" },
      { rank: 3, at: "2026-09-28T00:00:00.000Z" },
    ]);
  });

  it("still lists every rank, undated, when the history is missing", () => {
    expect(prestigeTiles(progress({ prestige: 2 }))).toEqual([
      { rank: 1, at: null },
      { rank: 2, at: null },
    ]);
  });
});

describe("milestoneRuns", () => {
  const milestones = [
    { prestige: 2, level: 10, at: "2026-09-20T00:00:00.000Z" },
    { prestige: 2, level: 25, at: "2026-09-21T00:00:00.000Z" },
    { prestige: 2, level: 100, at: "2026-09-27T00:00:00.000Z" },
    { prestige: 0, level: 10, at: "2026-08-01T00:00:00.000Z" },
    { prestige: 3, level: 10, at: "2026-09-29T00:00:00.000Z" },
    { prestige: 3, level: 25, at: "2026-10-01T00:00:00.000Z" },
  ];

  it("groups by run, newest first, the current run first", () => {
    const runs = milestoneRuns(progress({ milestones }));
    expect(runs.map((r) => [r.prestige, r.current])).toEqual([
      [3, true],
      [2, false],
      [0, false],
    ]);
  });

  it("gives the current run every milestone, unreached ones as not yet", () => {
    const [current] = milestoneRuns(progress({ milestones }));
    expect(current.slots).toEqual([
      { level: 10, reached: true, at: "2026-09-29T00:00:00.000Z" },
      { level: 25, reached: true, at: "2026-10-01T00:00:00.000Z" },
      { level: 50, reached: false, at: null },
      { level: 75, reached: false, at: null },
      { level: 100, reached: false, at: null },
    ]);
  });

  it("shows only what an earlier run reached, in level order", () => {
    const runs = milestoneRuns(progress({ milestones }));
    expect(runs[1].slots.map((s) => s.level)).toEqual([10, 25, 100]);
    expect(runs[2].slots.map((s) => s.level)).toEqual([10]);
  });

  it("counts a milestone the level passed even without a record", () => {
    const [current] = milestoneRuns(progress({ level: 60 }));
    expect(current.slots.map((s) => [s.level, s.reached, s.at])).toEqual([
      [10, true, null],
      [25, true, null],
      [50, true, null],
      [75, false, null],
      [100, false, null],
    ]);
  });

  it("drops levels that aren't milestones, runs past the current one, and repeats", () => {
    const runs = milestoneRuns(
      progress({
        prestige: 1,
        level: 5,
        milestones: [
          { prestige: 1, level: 30, at: "2026-09-01T00:00:00.000Z" },
          { prestige: 4, level: 10, at: "2026-09-01T00:00:00.000Z" },
          { prestige: 0, level: 10, at: "2026-08-01T00:00:00.000Z" },
          { prestige: 0, level: 10, at: "2026-08-09T00:00:00.000Z" },
        ],
      }),
    );
    expect(runs.map((r) => r.prestige)).toEqual([1, 0]);
    expect(runs[0].slots.every((s) => !s.reached)).toBe(true);
    expect(runs[1].slots).toEqual([
      { level: 10, reached: true, at: "2026-08-01T00:00:00.000Z" },
    ]);
  });
});

describe("<profile-progression>", () => {
  async function render(p: PublicProgress): Promise<ProfileProgression> {
    const el = document.createElement(
      "profile-progression",
    ) as ProfileProgression;
    el.progress = p;
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  }

  it("shows a tile per prestige rank with its badge and date", async () => {
    const el = await render(
      progress({
        prestigeHistory: [
          { rank: 1, at: "2026-09-06T12:00:00.000Z" },
          { rank: 2, at: "2026-09-19T12:00:00.000Z" },
          { rank: 3, at: "2026-09-28T12:00:00.000Z" },
        ],
      }),
    );
    const tiles = el.querySelectorAll("[data-prestige-tile]");
    expect(tiles).toHaveLength(3);
    const second = tiles[1];
    const badge = second.querySelector("level-badge") as HTMLElement & {
      level: number;
      prestige: number;
      size: number;
    };
    expect([badge.level, badge.prestige, badge.size]).toEqual([1, 2, 36]);
    expect(second.textContent).toContain('progression.prestige:{"prestige":2}');
    expect(second.querySelector("[data-date]")?.textContent).toBe(
      localDate("2026-09-19T12:00:00.000Z"),
    );
    expect(el.querySelector("[data-no-prestige]")).toBeNull();
    el.remove();
  });

  it("says so when the player hasn't prestiged", async () => {
    const el = await render(progress({ prestige: 0, level: 12 }));
    expect(el.querySelectorAll("[data-prestige-tile]")).toHaveLength(0);
    expect(el.querySelector("[data-no-prestige]")?.textContent).toContain(
      "player_profile.no_prestige",
    );
    el.remove();
  });

  it("labels the runs and fades the current run's milestones still ahead", async () => {
    const el = await render(
      progress({
        milestones: [
          { prestige: 2, level: 10, at: "2026-09-20T12:00:00.000Z" },
          { prestige: 3, level: 10, at: "2026-09-29T12:00:00.000Z" },
          { prestige: 3, level: 25, at: "2026-10-01T12:00:00.000Z" },
        ],
      }),
    );
    const runs = [...el.querySelectorAll("[data-milestone-run]")];
    expect(runs.map((r) => r.getAttribute("data-milestone-run"))).toEqual([
      "3",
      "2",
    ]);
    expect(runs[0].hasAttribute("data-current-run")).toBe(true);
    expect(runs[0].querySelector("h4")?.textContent).toContain(
      'player_profile.current_run_prestige:{"prestige":3}',
    );
    expect(runs[1].querySelector("h4")?.textContent).toContain(
      'progression.prestige:{"prestige":2}',
    );

    const slots = [...runs[0].querySelectorAll("[data-milestone]")];
    expect(slots.map((s) => s.getAttribute("data-milestone"))).toEqual([
      "10",
      "25",
      "50",
      "75",
      "100",
    ]);
    expect(slots[1].querySelector("[data-caption]")?.textContent?.trim()).toBe(
      localDate("2026-10-01T12:00:00.000Z"),
    );
    const ahead = slots[2];
    expect(ahead.hasAttribute("data-reached")).toBe(false);
    expect(ahead.className).toContain("opacity-30");
    expect(ahead.textContent).toContain("player_profile.milestone_not_yet");
    const badge = slots[0].querySelector("level-badge") as HTMLElement & {
      level: number;
      prestige: number;
      size: number;
    };
    expect([badge.level, badge.prestige, badge.size]).toEqual([10, 3, 40]);

    // An earlier run shows only what it reached.
    expect(runs[1].querySelectorAll("[data-milestone]")).toHaveLength(1);
    el.remove();
  });

  it("calls the run 'Current run' before any prestige", async () => {
    const el = await render(progress({ prestige: 0, level: 3 }));
    expect(el.querySelector("[data-current-run] h4")?.textContent?.trim()).toBe(
      "player_profile.current_run",
    );
    el.remove();
  });

  it("names a Legend's run for it, with the Legend badge at 100", async () => {
    const el = await render(
      progress({ prestige: 10, level: 100, legend: true }),
    );
    const run = el.querySelector("[data-current-run]")!;
    expect(run.querySelector("h4")?.textContent).toContain(
      'player_profile.legend_run:{"prestige":10}',
    );
    expect(
      run.querySelectorAll("[data-milestone]:not([data-reached])"),
    ).toHaveLength(0);
    const badges = [...run.querySelectorAll("level-badge")] as (HTMLElement & {
      level: number;
      legend: boolean;
    })[];
    expect(badges.map((b) => [b.level, b.legend])).toEqual([
      [10, false],
      [25, false],
      [50, false],
      [75, false],
      [100, true],
    ]);
    el.remove();
  });
});
