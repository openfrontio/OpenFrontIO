import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const invalidateUserMeMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/Api", () => ({
  claimReward: vi.fn(),
  getUserMe: vi.fn(async () => false),
  invalidateUserMe: invalidateUserMeMock,
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));
vi.mock("../../src/client/ProgressionApi", () => ({
  fetchProgressionConfig: vi.fn(async () => false),
}));

import type {
  ProgressionConfig,
  PublicProgress,
  Reward,
  TrackFlare,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { ProgressionConfigSchema } from "@openfront/shared/ApiSchemas";
import {
  POP_CAP,
  ProfileProgression,
} from "../../src/client/components/ProfileProgression";
import {
  levelFlares,
  RewardTrack,
  rewardTrackModel,
  stripPercent,
  TRACK_LEVEL_LIMIT,
  trackEnd,
  trackHasRewards,
  trackMaxLevel,
} from "../../src/client/components/RewardTrack";

if (!customElements.get("profile-progression")) {
  customElements.define("profile-progression", ProfileProgression);
}
if (!customElements.get("reward-track")) {
  customElements.define("reward-track", RewardTrack);
}

// --- a config shaped like GET /public/progression/config -------------------
const capsAt = (level: number) =>
  level < 2
    ? 0
    : level <= 25
      ? 50
      : level <= 50
        ? 100
        : level <= 75
          ? 150
          : 200;
const plutoniumAt = (level: number) =>
  level >= 20 && (level - 20) % 10 === 0 ? 25 : 0;

const flare = (
  kind: string,
  level: number | null,
  prestige: number | null,
  type: string,
  name: string,
): TrackFlare => ({
  kind,
  level,
  prestige,
  flareName: `${type}:${name}`,
  cosmetic: { type, name, url: null },
});

const FLARES: TrackFlare[] = [
  flare("level", 10, 0, "flag", "obey_flag"),
  flare("level", 50, null, "effect", "firebird_trail"),
  flare("level", 60, 3, "crown", "third_run_crown"),
  flare("level", 75, 0, "crown", "dino_king"),
  flare("prestige", null, 5, "effect", "solar_corona"),
  flare("legend", null, null, "effect", "firebird"),
];

function config(extra: Partial<ProgressionConfig> = {}): ProgressionConfig {
  return ProgressionConfigSchema.parse({
    version: 3,
    maxLevel: 100,
    maxPrestige: 10,
    levels: Array.from({ length: 100 }, (_, i) => ({
      level: i + 1,
      xpToNext: 100,
      cumulativeXp: 0,
      caps: capsAt(i + 1),
      plutonium: plutoniumAt(i + 1),
    })),
    prestige: { caps: 2500 },
    flares: FLARES,
    ...extra,
  });
}

// The same config with another level cap: the curve and amounts run to it.
function cappedConfig(maxLevel: number): ProgressionConfig {
  return config({
    maxLevel,
    levels: Array.from({ length: maxLevel }, (_, i) => ({
      level: i + 1,
      xpToNext: 100,
      cumulativeXp: 0,
      caps: capsAt(i + 1),
      plutonium: plutoniumAt(i + 1),
    })),
  });
}

const progress = (prestige: number, level: number, legend = false) => ({
  prestige,
  level,
  lifetimeXp: 100000,
  legend,
});

let nextId = 1;
function reward(extra: Partial<Reward>): Reward {
  return {
    id: String(nextId++),
    currencyType: "soft",
    amount: "100",
    reason: "level_up",
    note: null,
    ...extra,
  };
}

// Wonder at P3 L47: L45-47 Caps and L40 Plutonium unclaimed, plus rewards
// the track must leave alone.
function ownerRewards(): Reward[] {
  return [
    reward({ id: "l45", level: 45, prestige: 3 }),
    reward({ id: "l46", level: 46, prestige: 3 }),
    reward({ id: "l47", level: 47, prestige: 3, reason: "level_milestone" }),
    reward({
      id: "l40pu",
      level: 40,
      prestige: 3,
      currencyType: "hard",
      amount: "25",
    }),
    // Another run's level reward: not this track's.
    reward({ id: "p2l99", level: 99, prestige: 2, amount: "200" }),
    reward({ id: "daily", reason: "subscription_daily", amount: "50" }),
    reward({ id: "win", reason: "game_win", amount: "75" }),
    reward({ id: "prestige", reason: "prestige", amount: "2500" }),
  ];
}

const view = (name: string, typeLabel: string) => ({
  name,
  typeLabel,
  preview: html`<i data-test-preview></i>`,
});

const NAMES: Record<string, [string, string]> = {
  "effect:firebird_trail": ["Firebird Trail", "Boat Trail"],
  "crown:third_run_crown": ["Third Run Crown", "Crown"],
  "flag:obey_flag": ["Obey", "Flag"],
  "crown:dino_king": ["Dino King", "Crown"],
  "effect:solar_corona": ["Solar Corona", "Nuke Explosion"],
  "effect:firebird": ["Firebird", "Nuke Trail"],
};
const describeCosmetic = async (f: TrackFlare) => {
  const [name, type] = NAMES[f.flareName] ?? ["?", ""];
  return view(name, type);
};

describe("trackHasRewards", () => {
  it("is false for a config without reward amounts or level flares", () => {
    const old = ProgressionConfigSchema.parse({
      version: 1,
      maxLevel: 100,
      maxPrestige: 10,
      levels: [{ level: 1, xpToNext: 100, cumulativeXp: 0 }],
    });
    expect(trackHasRewards(old)).toBe(false);
    expect(trackHasRewards(config())).toBe(true);
  });
});

describe("rewardTrackModel", () => {
  it("reads each level's Caps and Plutonium from the config", () => {
    const m = rewardTrackModel(progress(3, 47), config(), null);
    expect(m.nodes).toHaveLength(100);
    expect(m.nodes[0]).toMatchObject({ level: 1, caps: 0, plutonium: 0 });
    expect(m.nodes[39]).toMatchObject({ level: 40, caps: 100, plutonium: 25 });
    expect(m.nodes[99]).toMatchObject({ level: 100, caps: 200, plutonium: 25 });
    expect(m.nodes.filter((n) => n.milestone).map((n) => n.level)).toEqual([
      10, 25, 50, 75, 100,
    ]);
  });

  it("gives the owner each level's status from their unclaimed rewards", () => {
    const m = rewardTrackModel(progress(3, 47), config(), ownerRewards());
    const status = (level: number) => m.nodes[level - 1].status;
    expect(status(40)).toBe("ready");
    expect(status(45)).toBe("ready");
    expect(status(47)).toBe("ready");
    // Passed with no reward row: claimed already.
    expect(status(44)).toBe("claimed");
    expect(status(1)).toBe("claimed");
    expect(status(48)).toBe("locked");
    expect(status(100)).toBe("locked");
    expect(m.nodes[46].current).toBe(true);
    expect(m.owner).toBe(true);
  });

  it("ignores another run's level rewards", () => {
    const m = rewardTrackModel(progress(3, 100), config(), [
      reward({ id: "old", level: 99, prestige: 2 }),
    ]);
    expect(m.nodes[98].status).toBe("claimed");
    expect(m.claim?.ids).toEqual([]);
  });

  it("totals only this run's level rewards for Claim all", () => {
    const m = rewardTrackModel(progress(3, 47), config(), ownerRewards());
    expect(m.claim?.ids).toEqual(["l45", "l46", "l47", "l40pu"]);
    expect(m.claim?.caps).toBe(300n);
    expect(m.claim?.plutonium).toBe(25n);
  });

  it("has no claim status for a visitor", () => {
    const m = rewardTrackModel(progress(3, 47), config(), null);
    expect(m.owner).toBe(false);
    expect(m.claim).toBeNull();
    expect(m.nodes[10].status).toBe("passed");
    expect(m.nodes[60].status).toBe("locked");
  });

  it("puts this run's and every run's level cosmetics on the track", () => {
    const run3 = levelFlares(config(), 3);
    expect([...run3.keys()].sort((a, b) => a - b)).toEqual([50, 60]);
    const run0 = levelFlares(config(), 0);
    expect([...run0.keys()].sort((a, b) => a - b)).toEqual([10, 50, 75]);
    // A run-specific flare beats an every-run one at the same level.
    const both = config({
      flares: [
        flare("level", 50, null, "effect", "firebird_trail"),
        flare("level", 50, 3, "crown", "third_run_crown"),
      ],
    });
    expect(levelFlares(both, 3).get(50)?.flareName).toBe(
      "crown:third_run_crown",
    );
    expect(levelFlares(both, 4).get(50)?.flareName).toBe(
      "effect:firebird_trail",
    );
  });

  it("builds the track to the config's level cap, not the client's", () => {
    const raised = rewardTrackModel(progress(3, 115), cappedConfig(120), null);
    expect(raised.maxLevel).toBe(120);
    expect(raised.nodes).toHaveLength(120);
    expect(raised.nodes[119]).toMatchObject({ level: 120, caps: 200 });
    expect(raised.level).toBe(115);
    expect(stripPercent(120, 120)).toBe(100);
    expect(stripPercent(115, 120)).toBeCloseTo((114 / 119) * 100);

    const lowered = rewardTrackModel(progress(3, 70), cappedConfig(60), null);
    expect(lowered.nodes).toHaveLength(60);
    // A level past the cap is the cap.
    expect(lowered.level).toBe(60);
    expect(lowered.nodes[59].current).toBe(true);
  });

  it("falls back to the client's cap, and bounds a runaway one", () => {
    expect(trackMaxLevel(config({ maxLevel: 0 }))).toBe(100);
    expect(trackMaxLevel(config({ maxLevel: 1.5 }))).toBe(100);
    expect(trackMaxLevel(config({ maxLevel: 1e9 }))).toBe(TRACK_LEVEL_LIMIT);
  });

  it("shows the owner no claim status when level rewards don't say their level", () => {
    // An API that doesn't stamp level/prestige: the rows can't be placed, so
    // a passed level without one can't be read as claimed.
    const m = rewardTrackModel(progress(3, 47), config(), [
      reward({ id: "unplaced" }),
      reward({ id: "daily", reason: "subscription_daily" }),
    ]);
    expect(m.owner).toBe(true);
    expect(m.statuses).toBe(false);
    expect(m.claim).toBeNull();
    expect(m.nodes[10].status).toBe("passed");
    expect(m.nodes[60].status).toBe("locked");
    // Other kinds of reward never carry a level: they don't count.
    const ok = rewardTrackModel(progress(3, 47), config(), [
      reward({ id: "daily", reason: "subscription_daily" }),
    ]);
    expect(ok.statuses).toBe(true);
    expect(ok.nodes[10].status).toBe("claimed");
  });

  it("ends a run in the next rank, with its exclusive when there is one", () => {
    expect(trackEnd(config(), 4)).toEqual({
      legend: false,
      rank: 5,
      caps: 2500,
      flare: FLARES[4],
    });
    expect(trackEnd(config(), 3)).toMatchObject({
      legend: false,
      rank: 4,
      flare: null,
    });
    expect(trackEnd(config(), 10)).toEqual({
      legend: true,
      rank: 10,
      caps: null,
      flare: FLARES[5],
    });
  });
});

describe("<reward-track>", () => {
  async function mount(
    p: ReturnType<typeof progress>,
    rewards: Reward[] | null,
    cfg = config(),
  ): Promise<RewardTrack> {
    const el = document.createElement("reward-track") as RewardTrack;
    el.describeCosmetic = describeCosmetic;
    el.progress = p;
    el.config = cfg;
    el.rewards = rewards;
    document.body.appendChild(el);
    await el.updateComplete;
    // The cosmetics resolve a moment later.
    await vi.waitFor(async () => {
      await el.updateComplete;
      expect(el.textContent).not.toContain("?");
    });
    return el;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("titles the section for the run", async () => {
    const el = await mount(progress(3, 47), null);
    expect(el.querySelector("h3")?.textContent).toContain(
      'reward_track.title:{"prestige":3}',
    );
    const first = await mount(progress(0, 5), null);
    expect(first.querySelector("h3")?.textContent?.trim()).toBe(
      "reward_track.title_first_run",
    );
  });

  describe("strip", () => {
    it("marks Plutonium and cosmetic levels, with a tick every 10", async () => {
      const el = await mount(progress(3, 47), ownerRewards());
      const levels = (sel: string, attr: string) =>
        [...el.querySelectorAll(sel)].map((e) => Number(e.getAttribute(attr)));
      expect(levels("[data-strip-tick]", "data-strip-tick")).toEqual([
        10, 20, 30, 40, 50, 60, 70, 80, 90,
      ]);
      // 50 pays Plutonium too, but its cosmetic takes the marker.
      expect(levels("[data-strip-plutonium]", "data-strip-plutonium")).toEqual([
        20, 30, 40, 70, 80, 90, 100,
      ]);
      expect(levels("[data-strip-cosmetic]", "data-strip-cosmetic")).toEqual([
        50, 60,
      ]);
    });

    it("puts the knob and 'You' at the player's level, and the run's end", async () => {
      const el = await mount(progress(3, 47), ownerRewards());
      const knob = el.querySelector<HTMLElement>("[data-strip-knob]")!;
      expect(knob.style.left).toBe(`${stripPercent(47, 100)}%`);
      const you = el.querySelector<HTMLElement>("[data-strip-you]")!;
      expect(you.textContent).toBe('reward_track.strip_you:{"level":47}');
      expect(you.style.left).toBe(`${stripPercent(47, 100)}%`);
      expect(el.querySelector("[data-strip-end]")?.textContent).toBe(
        'reward_track.strip_end_prestige:{"level":100,"rank":4}',
      );
      expect(el.querySelector("[data-strip-start]")?.textContent).toBe(
        "reward_track.strip_start",
      );
    });

    it("merges the two labels past level 85", async () => {
      const at85 = await mount(progress(4, 85), []);
      expect(at85.querySelector("[data-strip-you]")).not.toBeNull();
      const el = await mount(progress(4, 96), []);
      expect(el.querySelector("[data-strip-you]")).toBeNull();
      expect(el.querySelector("[data-strip-end]")?.textContent).toBe(
        'reward_track.strip_you:{"level":96} · reward_track.strip_end_prestige:{"level":100,"rank":5}',
      );
    });

    it("ends a P10 run at Legend", async () => {
      const el = await mount(progress(10, 96), []);
      const end = el.querySelector("[data-strip-end]")!;
      expect(end.hasAttribute("data-legend")).toBe(true);
      expect(end.textContent).toContain("reward_track.strip_end_legend");
    });

    it("names the level, not 'You', for a visitor", async () => {
      const el = await mount(progress(3, 47), null);
      expect(el.querySelector("[data-strip-you]")?.textContent).toBe(
        'reward_track.strip_level:{"level":47}',
      );
    });
  });

  describe("track", () => {
    it("draws a node per level with its Caps and status", async () => {
      const el = await mount(progress(3, 47), ownerRewards());
      const nodes = el.querySelectorAll("[data-level]");
      expect(nodes).toHaveLength(100);
      const node = (level: number) =>
        el.querySelector<HTMLElement>(`[data-level="${level}"]`)!;
      expect(node(44).getAttribute("data-status")).toBe("claimed");
      expect(node(44).querySelector("[data-claimed]")).not.toBeNull();
      expect(node(45).querySelector("[data-ready]")).not.toBeNull();
      expect(node(48).querySelector("[data-locked]")).not.toBeNull();
      expect(node(45).querySelector("[data-node-caps]")?.textContent).toContain(
        "100",
      );
      expect(node(1).querySelector("[data-node-caps]")?.textContent).toContain(
        "—",
      );
      // The player's level: the big badge, "YOU" under it.
      const current = node(47);
      expect(current.hasAttribute("data-current")).toBe(true);
      expect(current.querySelector(".rt-you-ring level-badge")).not.toBeNull();
      expect(current.querySelector("[data-you]")?.textContent).toBe(
        "reward_track.you",
      );
    });

    it("rings a Plutonium level and gives it a +25 chip", async () => {
      const el = await mount(progress(3, 47), []);
      const node = el.querySelector(`[data-level="40"]`)!;
      expect(node.querySelector(".rt-dot[data-pu]")).not.toBeNull();
      expect(
        node.querySelector("[data-plutonium-chip]")?.textContent,
      ).toContain('reward_track.plus:{"amount":25}');
      expect(el.querySelector(`[data-level="41"] .rt-dot[data-pu]`)).toBeNull();
    });

    it("keeps the milestone levels' badges", async () => {
      const el = await mount(progress(3, 47), []);
      for (const level of [10, 25, 50, 75, 100]) {
        expect(
          el.querySelector(`[data-level="${level}"] level-badge`),
        ).not.toBeNull();
      }
      expect(el.querySelector(`[data-level="11"] level-badge`)).toBeNull();
    });

    it("calls out this run's and every run's cosmetics, Plutonium included", async () => {
      const el = await mount(progress(3, 47), []);
      const callouts = [...el.querySelectorAll("[data-callout]")];
      expect(callouts.map((c) => c.getAttribute("data-callout"))).toEqual([
        "50",
        "60",
      ]);
      const at50 = callouts[0];
      expect(at50.querySelector("[data-callout-name]")?.textContent).toBe(
        "Firebird Trail",
      );
      expect(
        at50.querySelector("[data-callout-type]")?.textContent?.trim(),
      ).toBe("Boat Trail");
      expect(at50.querySelector("[data-test-preview]")).not.toBeNull();
      expect(
        at50.querySelector("[data-callout-plutonium]")?.textContent,
      ).toContain('reward_track.plus:{"amount":25}');
      // L50's Plutonium rides in the callout rather than its own chip.
      expect(el.querySelector(`[data-plutonium-chip="50"]`)).toBeNull();
      expect(
        callouts[1].querySelector("[data-callout-plutonium]"),
      ).not.toBeNull();

      const firstRun = await mount(progress(0, 5), []);
      expect(
        [...firstRun.querySelectorAll("[data-callout]")].map((c) =>
          c.getAttribute("data-callout"),
        ),
      ).toEqual(["10", "50", "75"]);
    });

    it("shows the flare's own name until the catalog answers", async () => {
      const el = document.createElement("reward-track") as RewardTrack;
      el.describeCosmetic = () => new Promise(() => {});
      el.progress = progress(3, 47);
      el.config = config();
      el.rewards = null;
      document.body.appendChild(el);
      await el.updateComplete;
      expect(
        el.querySelector(`[data-callout="50"] [data-callout-name]`)
          ?.textContent,
      ).toBe("Firebird Trail");
    });
  });

  describe("level cap", () => {
    it("draws, scales and ends the track at the config's cap", async () => {
      const el = await mount(progress(10, 120, true), [], cappedConfig(120));
      expect(el.querySelectorAll("[data-level]")).toHaveLength(120);
      const strip = el.querySelector("[data-track-strip]")!;
      expect(strip.getAttribute("aria-valuemax")).toBe("120");
      expect(strip.getAttribute("aria-label")).toBe(
        'reward_track.strip_label:{"max":120}',
      );
      expect(
        el.querySelector<HTMLElement>("[data-strip-knob]")!.style.left,
      ).toBe("100%");
      expect(
        [...el.querySelectorAll("[data-strip-tick]")].map((t) =>
          Number(t.getAttribute("data-strip-tick")),
        ),
      ).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);
      expect(el.querySelector("[data-strip-end]")?.textContent).toContain(
        'reward_track.strip_end_legend:{"level":120}',
      );
      expect(el.querySelector<HTMLElement>(".rt-line")!.style.width).toBe(
        "calc(119 * var(--rt-w))",
      );
      // The Legend badge is the top level's (the player's), not 100's.
      const badge = (level: number) =>
        el.querySelector(`[data-level="${level}"] level-badge`) as
          | (HTMLElement & { legend: boolean })
          | null;
      expect(badge(100)?.legend).toBe(false);
      expect(badge(120)?.legend).toBe(true);
      const end = el.querySelector("[data-track-end]")!;
      expect(end.textContent).toContain(
        'reward_track.after_level:{"level":120}',
      );
      expect(
        (end.querySelector("level-badge") as HTMLElement & { level: number })
          .level,
      ).toBe(120);
    });

    it("draws no level past a lowered cap", async () => {
      const el = await mount(progress(3, 40), [], cappedConfig(60));
      expect(el.querySelectorAll("[data-level]")).toHaveLength(60);
      expect(el.querySelector(`[data-level="61"]`)).toBeNull();
      expect(
        el.querySelector("[data-track-strip]")!.getAttribute("aria-valuemax"),
      ).toBe("60");
    });
  });

  describe("end card", () => {
    it("tags the next rank's exclusive inside the card", async () => {
      const el = await mount(progress(4, 96), []);
      const end = el.querySelector("[data-track-end]")!;
      expect(end.hasAttribute("data-legend")).toBe(false);
      expect(end.querySelector("[data-end-title]")?.textContent).toContain(
        'progression.prestige:{"prestige":5}',
      );
      expect(end.querySelector("[data-end-caps]")?.textContent).toContain(
        'reward_track.caps_amount:{"amount":"2,500"}',
      );
      const badge = end.querySelector("level-badge") as HTMLElement & {
        level: number;
        prestige: number;
      };
      expect([badge.level, badge.prestige]).toEqual([1, 5]);
      const tag = end.querySelector("[data-end-tag]")!;
      expect(tag.querySelector("[data-end-tag-name]")?.textContent).toBe(
        "Solar Corona",
      );
      expect(tag.textContent).toContain("Nuke Explosion");
      expect(tag.querySelector("[data-end-tag-for]")?.textContent).toContain(
        'reward_track.prestige_reward:{"rank":5}',
      );
    });

    it("has no tag when the next rank has no exclusive", async () => {
      const el = await mount(progress(3, 96), []);
      const end = el.querySelector("[data-track-end]")!;
      expect(end.querySelector("[data-end-caps]")).not.toBeNull();
      expect(end.querySelector("[data-end-tag]")).toBeNull();
    });

    it("is the Legend card on a P10 run", async () => {
      const el = await mount(progress(10, 96), []);
      const end = el.querySelector("[data-track-end]")!;
      expect(end.hasAttribute("data-legend")).toBe(true);
      expect(end.querySelector("[data-end-title]")?.textContent).toContain(
        "progression.legend",
      );
      expect(end.querySelector("[data-end-sub]")?.textContent).toContain(
        "reward_track.legend_sub",
      );
      expect(end.querySelector("[data-end-caps]")).toBeNull();
      const badge = end.querySelector("level-badge") as HTMLElement & {
        legend: boolean;
      };
      expect(badge.legend).toBe(true);
      expect(end.querySelector("[data-end-tag-for]")?.textContent).toContain(
        "reward_track.legend_reward",
      );
    });

    it("has no Legend tag when staff set no Legend reward", async () => {
      const el = await mount(
        progress(10, 50),
        [],
        config({ flares: FLARES.filter((f) => f.kind !== "legend") }),
      );
      expect(el.querySelector("[data-end-tag]")).toBeNull();
    });
  });

  describe("owner and visitor", () => {
    it("shows the owner a claim bar and the status key", async () => {
      const el = await mount(progress(3, 47), ownerRewards());
      const bar = el.querySelector("[data-track-claim]")!;
      expect(bar.querySelector("[data-claim-count]")?.textContent).toContain(
        'reward_track.claim_count:{"count":4}',
      );
      expect(bar.querySelector("[data-claim-caps]")?.textContent).toBe(
        'reward_track.claim_caps:{"amount":"300"}',
      );
      expect(bar.querySelector("[data-claim-plutonium]")?.textContent).toBe(
        'reward_track.claim_plutonium:{"amount":"25"}',
      );
      const key = el.querySelector("[data-track-legend]")!;
      expect(key.textContent).toContain("reward_track.key_claimed");
      expect(key.textContent).toContain("reward_track.key_ready");
      expect(key.textContent).toContain("reward_track.key_locked");
    });

    it("leaves the Plutonium out of the claim bar when there's none", async () => {
      const el = await mount(progress(3, 47), [
        reward({ id: "a", level: 46, prestige: 3 }),
      ]);
      expect(el.querySelector("[data-claim-count]")?.textContent).toContain(
        '{"count":1}',
      );
      expect(el.querySelector("[data-claim-plutonium]")).toBeNull();
      expect(el.querySelector("[data-track-claim] plutonium-icon")).toBeNull();
    });

    it("has no claim bar with nothing to claim", async () => {
      const el = await mount(progress(3, 47), []);
      expect(el.querySelector("[data-track-claim]")).toBeNull();
      expect(el.querySelector("[data-track-legend]")).not.toBeNull();
    });

    it("shows the owner no statuses, and warns, when rewards don't say their level", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const el = await mount(progress(3, 47), [reward({ id: "unplaced" })]);
        expect(el.querySelector("[data-track-claim]")).toBeNull();
        expect(el.querySelector("[data-track-legend]")).toBeNull();
        expect(
          el.querySelector("[data-claimed], [data-ready], [data-locked]"),
        ).toBeNull();
        // Still their profile: "You" at their level.
        expect(el.querySelector("[data-you]")).not.toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it("shows a visitor the track without claim status", async () => {
      const el = await mount(progress(3, 47), null);
      expect(el.querySelector("[data-track-claim]")).toBeNull();
      expect(el.querySelector("[data-track-legend]")).toBeNull();
      expect(
        el.querySelector("[data-claimed], [data-ready], [data-locked]"),
      ).toBeNull();
      expect(el.querySelector("[data-you]")).toBeNull();
      // Passed levels are simply filled.
      expect(
        el.querySelector(`[data-level="12"] .rt-dot[data-passed]`),
      ).not.toBeNull();
      expect(
        el.querySelector(`[data-level="48"] .rt-dot[data-passed]`),
      ).toBeNull();
    });
  });

  it("leaves out the totals line, the run-1 note and an upcoming list", async () => {
    const el = await mount(progress(3, 47), ownerRewards());
    const text = el.textContent ?? "";
    for (const removed of [
      "this run",
      "this_run",
      "Run-1",
      "later runs",
      "first_run_note",
      "upcoming",
      "Upcoming",
    ]) {
      expect(text).not.toContain(removed);
    }
    expect(el.querySelector("[data-upcoming]")).toBeNull();
    // Nor do the strings exist to be shown.
    const en = (await import("../../resources/lang/en.json")).default as {
      reward_track: Record<string, string>;
    };
    const copy = Object.values(en.reward_track).join("\n");
    expect(copy).not.toMatch(/this run|Run-1|later runs|Upcoming/i);
  });
});

describe("<profile-progression> with the track", () => {
  function userMe(rewards: Reward[], publicId = "wonder01"): UserMeResponse {
    return {
      user: {},
      player: {
        publicId,
        rewards,
        currency: { soft: 100, hard: 5 },
      },
    } as unknown as UserMeResponse;
  }

  const P3: PublicProgress = {
    ...progress(3, 47),
    prestigeHistory: [
      { rank: 1, at: "2026-09-06T18:00:00.000Z" },
      { rank: 2, at: "2026-09-19T18:00:00.000Z" },
      { rank: 3, at: "2026-09-28T18:00:00.000Z" },
    ],
    milestones: [
      { prestige: 3, level: 10, at: "2026-09-29T12:00:00.000Z" },
      { prestige: 3, level: 25, at: "2026-10-01T12:00:00.000Z" },
    ],
  };

  let popKey = 0;

  async function mount(
    opts: {
      me?: UserMeResponse | false;
      popKey?: string;
      claim?: ProfileProgression["claim"];
      alert?: ProfileProgression["alert"];
    } = {},
  ): Promise<ProfileProgression> {
    const el = document.createElement(
      "profile-progression",
    ) as ProfileProgression;
    el.loadConfig = async () => config();
    el.loadUserMe = async () => opts.me ?? false;
    el.describeCosmetic = describeCosmetic;
    if (opts.claim) el.claim = opts.claim;
    if (opts.alert) el.alert = opts.alert;
    el.publicId = "wonder01";
    el.popKey = opts.popKey ?? `test-${popKey++}`;
    el.progress = P3;
    document.body.appendChild(el);
    await vi.waitFor(async () => {
      await el.updateComplete;
      const track = el.querySelector<RewardTrack>("reward-track");
      expect(track).not.toBeNull();
      await track!.updateComplete;
      expect(el.querySelector("[data-track-row]")).not.toBeNull();
    });
    // orderPop runs after the track's own render.
    await new Promise((r) => setTimeout(r, 0));
    return el;
  }

  beforeEach(() => {
    invalidateUserMeMock.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("puts the track above the prestige history and milestones", async () => {
    const el = await mount();
    const sections = [...el.querySelectorAll("section")].map((s) =>
      s.hasAttribute("data-reward-track")
        ? "track"
        : s.hasAttribute("data-prestige-history")
          ? "history"
          : "milestones",
    );
    expect(sections).toEqual(["track", "history", "milestones"]);
  });

  it("is a visitor's view for someone else's profile", async () => {
    const el = await mount({ me: userMe(ownerRewards(), "someone-else") });
    expect(el.querySelector("[data-track-claim]")).toBeNull();
    expect(el.querySelector("[data-ready]")).toBeNull();
  });

  it("is the owner's view on their own profile", async () => {
    const el = await mount({ me: userMe(ownerRewards()) });
    expect(el.querySelector("[data-track-claim]")).not.toBeNull();
    expect(el.querySelectorAll("[data-ready]")).toHaveLength(3);
  });

  it("reads the owner's rewards afresh, not the page's cached account", async () => {
    // The page's copy is from before levels 45-47 were reached: it has no
    // rows for them, which would read as claimed.
    const stale = userMe([]);
    const fresh = userMe(ownerRewards());
    let reads = 0;
    const el = document.createElement(
      "profile-progression",
    ) as ProfileProgression;
    el.loadConfig = async () => config();
    el.loadUserMe = async () => (++reads === 1 ? stale : fresh);
    el.describeCosmetic = describeCosmetic;
    el.publicId = "wonder01";
    el.popKey = `test-${popKey++}`;
    el.progress = P3;
    document.body.appendChild(el);
    await vi.waitFor(async () => {
      await el.updateComplete;
      expect(el.querySelector("[data-track-claim]")).not.toBeNull();
    });
    expect(invalidateUserMeMock).toHaveBeenCalledTimes(1);
    expect(reads).toBe(2);
    expect(el.querySelectorAll("[data-ready]")).toHaveLength(3);
  });

  it("doesn't re-read the account for someone else's profile", async () => {
    await mount({ me: userMe(ownerRewards(), "someone-else") });
    expect(invalidateUserMeMock).not.toHaveBeenCalled();
  });

  it("leaves the track out on a config without rewards", async () => {
    const el = document.createElement(
      "profile-progression",
    ) as ProfileProgression;
    el.loadConfig = async () =>
      ProgressionConfigSchema.parse({
        version: 1,
        maxLevel: 100,
        maxPrestige: 10,
        levels: [{ level: 1, xpToNext: 1, cumulativeXp: 0 }],
      });
    el.loadUserMe = async () => false;
    el.progress = P3;
    document.body.appendChild(el);
    await vi.waitFor(async () => {
      await el.updateComplete;
      expect(el.querySelector("[data-milestones]")).not.toBeNull();
    });
    expect(el.querySelector("reward-track")).toBeNull();
  });

  it("shows the rest without the track when the track can't be fetched", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = document.createElement(
      "profile-progression",
    ) as ProfileProgression;
    el.loadConfig = async () => config();
    el.loadUserMe = async () => false;
    el.loadTrackModule = () => Promise.reject(new Error("offline"));
    el.progress = P3;
    document.body.appendChild(el);
    await vi.waitFor(async () => {
      await el.updateComplete;
      expect(el.querySelector("[data-milestones]")).not.toBeNull();
    });
    expect(el.querySelector("[data-prestige-history]")).not.toBeNull();
    expect(el.querySelector("reward-track")).toBeNull();
  });

  it("fetches the track alongside the data it waits for", async () => {
    let answerConfig!: (c: ProgressionConfig) => void;
    const loadTrack = vi.fn(
      () => import("../../src/client/components/RewardTrack"),
    );
    const el = document.createElement(
      "profile-progression",
    ) as ProfileProgression;
    el.loadConfig = () => new Promise((resolve) => (answerConfig = resolve));
    el.loadUserMe = async () => false;
    el.loadTrackModule = loadTrack;
    el.progress = P3;
    document.body.appendChild(el);
    await el.updateComplete;
    // Asked for while the config is still out.
    expect(loadTrack).toHaveBeenCalledTimes(1);
    answerConfig(config());
    await vi.waitFor(async () => {
      await el.updateComplete;
      expect(el.querySelector("reward-track")).not.toBeNull();
    });
  });

  describe("Claim all", () => {
    it("claims only this run's level rewards, then updates and tells the page", async () => {
      const claim = vi.fn(async (id: string) => ({
        currency: { soft: 1000 + Number(id.length), hard: 40 },
      }));
      const el = await mount({ me: userMe(ownerRewards()), claim });
      const changed = vi.fn();
      el.addEventListener("rewards-changed", (e) =>
        changed((e as CustomEvent).detail),
      );
      el.querySelector<HTMLElement>("[data-claim-all]")!.click();
      await vi.waitFor(() => expect(changed).toHaveBeenCalled());
      expect(claim.mock.calls.map((c) => c[0])).toEqual([
        "l45",
        "l46",
        "l47",
        "l40pu",
      ]);
      expect(invalidateUserMeMock).toHaveBeenCalled();
      const detail = changed.mock.calls[0][0];
      expect(detail.currency).toEqual({ soft: 1005, hard: 40 });
      expect(detail.rewards.map((r: Reward) => r.id)).toEqual([
        "p2l99",
        "daily",
        "win",
        "prestige",
      ]);
      await vi.waitFor(async () => {
        await el.querySelector<RewardTrack>("reward-track")!.updateComplete;
        expect(el.querySelector("[data-track-claim]")).toBeNull();
      });
      expect(el.querySelector("[data-ready]")).toBeNull();
      expect(
        el.querySelector(`[data-level="45"] [data-claimed]`),
      ).not.toBeNull();
    });

    it("stops claiming once the tab is closed, and reloads if it's back", async () => {
      const answers: Array<() => void> = [];
      const claim = vi.fn(
        (_id: string) =>
          new Promise<{ currency: { soft: number; hard: number } }>((resolve) =>
            answers.push(() => resolve({ currency: { soft: 1, hard: 1 } })),
          ),
      );
      const alert = vi.fn(async () => {});
      let reads = 0;
      const el = await mount({ me: userMe(ownerRewards()), claim, alert });
      el.loadUserMe = async () => {
        reads++;
        return userMe(ownerRewards().filter((r) => r.id !== "l45"));
      };
      const changed = vi.fn();
      el.addEventListener("rewards-changed", changed);
      el.querySelector<HTMLElement>("[data-claim-all]")!.click();
      await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
      invalidateUserMeMock.mockClear();
      el.remove();
      answers[0]();
      await new Promise((r) => setTimeout(r, 0));
      // The claim in flight finished; no more were sent, nothing was shown.
      expect(claim).toHaveBeenCalledTimes(1);
      expect(invalidateUserMeMock).toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
      expect(reads).toBe(0);

      // Shown again: the track is read afresh, and Claim all works.
      document.body.appendChild(el);
      await vi.waitFor(async () => {
        await el.updateComplete;
        await el.querySelector<RewardTrack>("reward-track")?.updateComplete;
        expect(el.querySelector("[data-claim-count]")?.textContent).toContain(
          '{"count":3}',
        );
      });
      expect(reads).toBeGreaterThan(0);
      const button = el.querySelector("[data-claim-all]") as HTMLElement & {
        disable: boolean;
      };
      expect(button.disable).toBe(false);
    });

    it("stops and says so when a claim fails", async () => {
      const claim = vi.fn(async (id: string) =>
        id === "l46" ? (false as const) : { currency: { soft: 1, hard: 1 } },
      );
      const alert = vi.fn(async () => {});
      const el = await mount({ me: userMe(ownerRewards()), claim, alert });
      el.querySelector<HTMLElement>("[data-claim-all]")!.click();
      await vi.waitFor(() => expect(alert).toHaveBeenCalled());
      expect(alert).toHaveBeenCalledWith("account_modal.claim_failed");
      expect(claim.mock.calls.map((c) => c[0])).toEqual(["l45", "l46"]);
      await el.querySelector<RewardTrack>("reward-track")!.updateComplete;
      // Only L45 went through.
      expect(
        el.querySelector(`[data-level="45"] [data-claimed]`),
      ).not.toBeNull();
      expect(el.querySelector(`[data-level="46"] [data-ready]`)).not.toBeNull();
    });
  });

  describe("pop-in", () => {
    const POP_ORDER =
      "[data-track-claim], [data-track-strip], [data-track-row], [data-track-legend], [data-prestige-tile], [data-milestone-run] > h4, [data-milestone]";

    it("numbers every item in one sequence, in document order, capped", async () => {
      const el = await mount({ me: userMe(ownerRewards()) });
      expect(el.classList.contains("pp-anim")).toBe(true);
      const items = [...el.querySelectorAll<HTMLElement>("[data-pp]")];
      // Exactly the items, in document order: claim bar, strip, track, key,
      // the three tiles, the run's heading, its five milestones.
      expect(items).toEqual([...el.querySelectorAll(POP_ORDER)]);
      expect(items).toHaveLength(13);
      expect(items.map((i) => i.style.getPropertyValue("--i"))).toEqual(
        items.map((_, n) => String(Math.min(n, POP_CAP))),
      );
      expect(items[0].hasAttribute("data-track-claim")).toBe(true);
    });

    it("starts the next milestone's ring after its own pop", async () => {
      const el = await mount({ me: userMe(ownerRewards()) });
      const next = el.querySelector("[data-next-milestone]")!;
      expect(next.getAttribute("data-milestone")).toBe("50");
      const items = [...el.querySelectorAll("[data-pp]")];
      const at = Math.min(items.indexOf(next), POP_CAP);
      expect(el.style.getPropertyValue("--ring-delay")).toBe(
        `${at * 55 + 380}ms`,
      );
    });

    it("uses one keyframe that fills both ways, with nothing !important", async () => {
      await mount();
      const css =
        document.getElementById("profile-progression-styles")?.textContent ??
        "";
      expect(css).toMatch(
        /\.pp-anim \[data-pp\] \{\s*animation: pp-pop 380ms [^;]* both;\s*animation-delay: calc\(var\(--i, 0\) \* 55ms\);/,
      );
      expect(css.match(/@keyframes pp-pop/g)).toHaveLength(1);
      expect(css).not.toContain("!important");
      expect(css).toMatch(/prefers-reduced-motion: reduce/);
    });

    it("pops in once per key: shown again, it's at rest", async () => {
      const first = await mount({ popKey: "profile-7" });
      expect(first.classList.contains("pp-anim")).toBe(true);
      first.remove();
      const again = await mount({ popKey: "profile-7" });
      expect(again.classList.contains("pp-anim")).toBe(false);
      expect(
        again
          .querySelector<HTMLElement>("[data-pp]")!
          .style.getPropertyValue("--i"),
      ).toBe("");
      // A new opening pops in again.
      const reopened = await mount({ popKey: "profile-8" });
      expect(reopened.classList.contains("pp-anim")).toBe(true);
    });

    it("remembers only the latest opening", async () => {
      (await mount({ popKey: "profile-20" })).remove();
      (await mount({ popKey: "profile-21" })).remove();
      // Openings only count up, so an older key is never seen again; one
      // that were would pop in, as nothing is kept for it.
      const older = await mount({ popKey: "profile-20" });
      expect(older.classList.contains("pp-anim")).toBe(true);
    });

    it("doesn't pop in under reduced motion", async () => {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query.includes("reduce"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })) as unknown as typeof window.matchMedia;
      try {
        const el = await mount();
        expect(el.classList.contains("pp-anim")).toBe(false);
      } finally {
        window.matchMedia = original;
      }
    });
  });
});
