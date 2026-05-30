import { describe, expect, it } from "vitest";
import type { DigestInputs } from "../claude";
import {
  ageDays,
  formatIsoDate,
  renderFallbackDigest,
  truncateForDiscord,
} from "../digest-formatter";

function emptyInputs(): DigestInputs {
  return {
    today: "2026-05-29",
    triageReadyInWindow: [],
    needsMaintainerTriage: [],
    needsInfoCount: 0,
    staleClosingSoon: [],
    awaitingMilestone: [],
    prReviews: [],
    triageSummary: { processed: 0, closed: 0, kept: 0 },
  };
}

describe("formatIsoDate", () => {
  it("renders YYYY-MM-DD", () => {
    expect(formatIsoDate(new Date("2026-05-29T12:34:56Z"))).toBe("2026-05-29");
  });
});

describe("renderFallbackDigest", () => {
  it("includes only sections with content", () => {
    const out = renderFallbackDigest(emptyInputs());
    expect(out).toContain("# Daily Triage — 2026-05-29");
    expect(out).not.toContain("🟢 Newly classified");
    expect(out).not.toContain("🟡 Needs your judgment");
    expect(out).not.toContain("🔴 Auto-closing");
    expect(out).not.toContain("🟠 Awaiting your milestone");
    expect(out).not.toContain("🔵 PRs needing review");
  });

  it("emits the newly-classified section with each issue", () => {
    const out = renderFallbackDigest({
      ...emptyInputs(),
      triageReadyInWindow: [
        {
          number: 100,
          title: "Crash on right-click",
          author: "alice",
          area: "area:client",
        },
        { number: 101, title: "Hotkey for chat", author: "bob", area: null },
      ],
    });
    expect(out).toContain("🟢 Newly classified by Claude (2)");
    expect(out).toContain(
      "#100 [area:client] — Crash on right-click (by @alice)",
    );
    expect(out).toContain("#101 — Hotkey for chat (by @bob)");
  });

  it("emits the needs-judgment section with reasoning when present", () => {
    const out = renderFallbackDigest({
      ...emptyInputs(),
      needsMaintainerTriage: [
        { number: 5, title: "ambiguous report", reasoning: "could be PEBKAC" },
        { number: 6, title: "no reasoning case" },
      ],
    });
    expect(out).toContain("🟡 Needs your judgment (2)");
    expect(out).toContain("#5 — ambiguous report _(could be PEBKAC)_");
    expect(out).toContain("#6 — no reasoning case");
  });

  it("emits the awaiting-milestone section with all entries, tags, and age", () => {
    const out = renderFallbackDigest({
      ...emptyInputs(),
      awaitingMilestone: [
        {
          number: 45,
          title: "Crash on right-click",
          ageDays: 21,
          primaryLabel: "bug",
          area: "area:client",
        },
        {
          number: 76,
          title: "Add chat hotkey",
          ageDays: 12,
          primaryLabel: "qol-improvement",
          area: null,
        },
        {
          number: 99,
          title: "Just opened",
          ageDays: 0,
          primaryLabel: null,
          area: null,
        },
      ],
    });
    expect(out).toContain("🟠 Awaiting your milestone (3)");
    expect(out).toContain(
      "#45 [bug, area:client] — 21d — Crash on right-click",
    );
    expect(out).toContain("#76 [qol-improvement] — 12d — Add chat hotkey");
    expect(out).toContain("#99 — 0d — Just opened");
  });

  it("emits the PR review section with risk/tests/scope summary", () => {
    const out = renderFallbackDigest({
      ...emptyInputs(),
      prReviews: [
        {
          pr: { number: 220, title: "tick refactor", author: "carol" },
          review: {
            summary: "refactors tick loop",
            risk: "high",
            tests_present: "yes",
            scope_match: "matches",
          },
        },
      ],
    });
    expect(out).toContain("🔵 PRs needing review (1)");
    expect(out).toContain(
      "#220 by @carol — refactors tick loop · risk: high · tests: yes · scope: matches",
    );
  });

  it("appends a needs-info count when nonzero", () => {
    const out = renderFallbackDigest({ ...emptyInputs(), needsInfoCount: 4 });
    expect(out).toContain("4 issues waiting on reporter");
  });

  it("omits needs-info line when count is zero", () => {
    expect(renderFallbackDigest(emptyInputs())).not.toContain(
      "waiting on reporter",
    );
  });

  it("always tags itself as the fallback", () => {
    expect(renderFallbackDigest(emptyInputs())).toContain("Fallback digest");
  });
});

describe("ageDays", () => {
  it("rounds down to whole days", () => {
    const now = new Date("2026-05-30T12:00:00Z");
    expect(ageDays("2026-05-30T11:00:00Z", now)).toBe(0);
    expect(ageDays("2026-05-29T11:00:00Z", now)).toBe(1);
    expect(ageDays("2026-05-09T12:00:00Z", now)).toBe(21);
  });

  it("returns 0 for future-dated input (clock skew)", () => {
    const now = new Date("2026-05-30T12:00:00Z");
    expect(ageDays("2026-06-01T00:00:00Z", now)).toBe(0);
  });

  it("returns 0 for unparseable input", () => {
    expect(ageDays("not-a-date", new Date())).toBe(0);
  });
});

describe("truncateForDiscord", () => {
  it("returns the input unchanged when under the limit", () => {
    expect(truncateForDiscord("short")).toBe("short");
  });

  it("truncates and appends a marker when over the limit", () => {
    const long = "a".repeat(2000);
    const out = truncateForDiscord(long, 100);
    expect(out.endsWith("…(truncated)")).toBe(true);
    expect(out.length).toBeLessThan(long.length);
  });
});
