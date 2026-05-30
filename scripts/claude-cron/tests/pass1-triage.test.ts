import { describe, expect, it } from "vitest";
import type { TriageDecision } from "../claude";
import { ENABLE_TRANSLATION_CLOSE, LABELS } from "../config";
import type { Issue } from "../github";
import {
  classificationClosesIssue,
  decisionToActions,
  downgradeIfLowConfidence,
  isOrgMemberIssueNeedingTag,
  isTriageCandidate,
} from "../pass1-triage";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 1,
    title: "Test issue",
    body: "Test body",
    state: "open",
    labels: [],
    user: { login: "alice" },
    author_association: "NONE",
    created_at: "2026-05-29T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    is_pull_request: false,
    ...overrides,
  };
}

describe("isTriageCandidate", () => {
  it("accepts a clean open issue from an outside contributor", () => {
    expect(isTriageCandidate(makeIssue())).toBe(true);
  });

  it("rejects pull requests", () => {
    expect(isTriageCandidate(makeIssue({ is_pull_request: true }))).toBe(false);
  });

  it("rejects closed issues", () => {
    expect(isTriageCandidate(makeIssue({ state: "closed" }))).toBe(false);
  });

  it("rejects already-triaged issues", () => {
    expect(
      isTriageCandidate(makeIssue({ labels: [LABELS.CLAUDE_TRIAGED] })),
    ).toBe(false);
  });

  it("rejects issues from org members", () => {
    for (const assoc of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      expect(isTriageCandidate(makeIssue({ author_association: assoc }))).toBe(
        false,
      );
    }
  });

  it("rejects issues that have any auto-closed-* label", () => {
    expect(
      isTriageCandidate(makeIssue({ labels: ["auto-closed-feature"] })),
    ).toBe(false);
    expect(
      isTriageCandidate(makeIssue({ labels: ["auto-closed-support"] })),
    ).toBe(false);
  });
});

describe("isOrgMemberIssueNeedingTag", () => {
  it("flags org-member issues without claude-triaged", () => {
    expect(
      isOrgMemberIssueNeedingTag(makeIssue({ author_association: "MEMBER" })),
    ).toBe(true);
  });

  it("does not flag org-member issues already tagged", () => {
    expect(
      isOrgMemberIssueNeedingTag(
        makeIssue({
          author_association: "MEMBER",
          labels: [LABELS.CLAUDE_TRIAGED],
        }),
      ),
    ).toBe(false);
  });

  it("does not flag outside-contributor issues", () => {
    expect(
      isOrgMemberIssueNeedingTag(makeIssue({ author_association: "NONE" })),
    ).toBe(false);
  });
});

describe("downgradeIfLowConfidence", () => {
  const cases: Array<{
    classification: TriageDecision["classification"];
    confidence: TriageDecision["confidence"];
    expectDowngrade: boolean;
  }> = [
    { classification: "feature", confidence: "low", expectDowngrade: true },
    { classification: "feature", confidence: "medium", expectDowngrade: true },
    { classification: "feature", confidence: "high", expectDowngrade: false },
    { classification: "question", confidence: "medium", expectDowngrade: true },
    { classification: "support", confidence: "low", expectDowngrade: true },
    { classification: "billing", confidence: "high", expectDowngrade: false },
    { classification: "security", confidence: "low", expectDowngrade: false },
    { classification: "security", confidence: "high", expectDowngrade: false },
    {
      classification: "translation",
      confidence: "medium",
      expectDowngrade: true,
    },
    { classification: "bug", confidence: "low", expectDowngrade: false },
    {
      classification: "qol-improvement",
      confidence: "low",
      expectDowngrade: false,
    },
    {
      classification: "needs-info",
      confidence: "medium",
      expectDowngrade: false,
    },
    { classification: "duplicate", confidence: "low", expectDowngrade: false },
    { classification: "uncertain", confidence: "low", expectDowngrade: false },
  ];

  for (const c of cases) {
    it(`${c.classification} @ ${c.confidence} → ${c.expectDowngrade ? "downgrade" : "keep"}`, () => {
      const input: TriageDecision = {
        classification: c.classification,
        confidence: c.confidence,
        reasoning: "test",
      };
      const out = downgradeIfLowConfidence(input);
      if (c.expectDowngrade) {
        expect(out.classification).toBe("uncertain");
        expect(out.reasoning).toContain("downgraded");
      } else {
        expect(out).toBe(input);
      }
    });
  }
});

describe("decisionToActions", () => {
  it("bug → bug + area + claude-approved + claude-triaged", () => {
    const actions = decisionToActions(
      {
        classification: "bug",
        confidence: "high",
        reasoning: "x",
        suggested_area: "area:client",
      },
      makeIssue(),
    );
    const labelsAdded = actions
      .filter((a) => a.type === "add_label")
      .map((a) => (a as { label: string }).label);
    expect(labelsAdded).toEqual([
      LABELS.BUG,
      "area:client",
      LABELS.CLAUDE_APPROVED,
      LABELS.CLAUDE_TRIAGED,
    ]);
    expect(actions.find((a) => a.type === "close")).toBeUndefined();
    expect(actions.find((a) => a.type === "comment")).toBeUndefined();
  });

  it("bug without area still claude-approved and triaged", () => {
    const actions = decisionToActions(
      { classification: "bug", confidence: "high", reasoning: "x" },
      makeIssue(),
    );
    const labelsAdded = actions
      .filter((a) => a.type === "add_label")
      .map((a) => (a as { label: string }).label);
    expect(labelsAdded).toEqual([
      LABELS.BUG,
      LABELS.CLAUDE_APPROVED,
      LABELS.CLAUDE_TRIAGED,
    ]);
  });

  it("qol-improvement mirrors bug structure with qol label", () => {
    const actions = decisionToActions(
      {
        classification: "qol-improvement",
        confidence: "high",
        reasoning: "x",
        suggested_area: "area:core",
      },
      makeIssue(),
    );
    const labelsAdded = actions
      .filter((a) => a.type === "add_label")
      .map((a) => (a as { label: string }).label);
    expect(labelsAdded).toEqual([
      LABELS.QOL_IMPROVEMENT,
      "area:core",
      LABELS.CLAUDE_APPROVED,
      LABELS.CLAUDE_TRIAGED,
    ]);
  });

  it("duplicate adds possible-duplicate, posts dup comment, does NOT close", () => {
    const actions = decisionToActions(
      {
        classification: "duplicate",
        confidence: "high",
        reasoning: "x",
        duplicate_of: 42,
      },
      makeIssue(),
    );
    const labels = actions
      .filter((a) => a.type === "add_label")
      .map((a) => (a as { label: string }).label);
    expect(labels).toContain(LABELS.POSSIBLE_DUPLICATE);
    expect(labels).toContain(LABELS.CLAUDE_TRIAGED);
    const comment = actions.find((a) => a.type === "comment");
    expect(comment).toBeDefined();
    expect((comment as { body: string }).body).toContain("#42");
    expect(actions.find((a) => a.type === "close")).toBeUndefined();
  });

  it("needs-info includes only the questions Claude provided", () => {
    const actions = decisionToActions(
      {
        classification: "needs-info",
        confidence: "high",
        reasoning: "x",
        clarifying_questions: ["Which browser?", "What did you click?"],
      },
      makeIssue(),
    );
    const comment = actions.find((a) => a.type === "comment");
    expect(comment).toBeDefined();
    expect((comment as { body: string }).body).toContain("Which browser?");
    expect((comment as { body: string }).body).toContain("What did you click?");
  });

  it("needs-info with no questions adds label but skips comment", () => {
    const actions = decisionToActions(
      { classification: "needs-info", confidence: "high", reasoning: "x" },
      makeIssue(),
    );
    expect(actions.find((a) => a.type === "comment")).toBeUndefined();
  });

  it("each auto-close classification adds correct label, comment, close", () => {
    const expectations: Array<{
      cls: TriageDecision["classification"];
      label: string;
    }> = [
      { cls: "feature", label: LABELS.AUTO_CLOSED_FEATURE },
      { cls: "question", label: LABELS.AUTO_CLOSED_QUESTION },
      { cls: "support", label: LABELS.AUTO_CLOSED_SUPPORT },
      { cls: "billing", label: LABELS.AUTO_CLOSED_BILLING },
    ];
    for (const { cls, label } of expectations) {
      const actions = decisionToActions(
        { classification: cls, confidence: "high", reasoning: "x" },
        makeIssue(),
      );
      const labels = actions
        .filter((a) => a.type === "add_label")
        .map((a) => (a as { label: string }).label);
      expect(labels).toContain(label);
      expect(labels).toContain(LABELS.CLAUDE_TRIAGED);
      expect(actions.find((a) => a.type === "comment")).toBeDefined();
      expect(actions.find((a) => a.type === "close")).toBeDefined();
    }
  });

  it("security is never auto-closed; routes to claude-uncertain (no comment, no close)", () => {
    const actions = decisionToActions(
      { classification: "security", confidence: "high", reasoning: "x" },
      makeIssue(),
    );
    const labels = actions
      .filter((a) => a.type === "add_label")
      .map((a) => (a as { label: string }).label);
    expect(labels).toEqual([LABELS.CLAUDE_UNCERTAIN, LABELS.CLAUDE_TRIAGED]);
    expect(actions.find((a) => a.type === "close")).toBeUndefined();
    expect(actions.find((a) => a.type === "comment")).toBeUndefined();
  });

  it("translation auto-closes only when ENABLE_TRANSLATION_CLOSE is true", () => {
    const actions = decisionToActions(
      { classification: "translation", confidence: "high", reasoning: "x" },
      makeIssue(),
    );
    if (ENABLE_TRANSLATION_CLOSE) {
      expect(actions.find((a) => a.type === "close")).toBeDefined();
    } else {
      expect(actions.find((a) => a.type === "close")).toBeUndefined();
      const labels = actions
        .filter((a) => a.type === "add_label")
        .map((a) => (a as { label: string }).label);
      expect(labels).toContain(LABELS.CLAUDE_UNCERTAIN);
    }
  });

  it("uncertain adds claude-uncertain and claude-triaged only", () => {
    const actions = decisionToActions(
      { classification: "uncertain", confidence: "low", reasoning: "x" },
      makeIssue(),
    );
    const labels = actions
      .filter((a) => a.type === "add_label")
      .map((a) => (a as { label: string }).label);
    expect(labels).toEqual([LABELS.CLAUDE_UNCERTAIN, LABELS.CLAUDE_TRIAGED]);
    expect(actions.find((a) => a.type === "close")).toBeUndefined();
    expect(actions.find((a) => a.type === "comment")).toBeUndefined();
  });

  it("always ends with the claude-triaged label", () => {
    const all: TriageDecision["classification"][] = [
      "bug",
      "qol-improvement",
      "duplicate",
      "needs-info",
      "feature",
      "question",
      "support",
      "billing",
      "security",
      "translation",
      "uncertain",
    ];
    for (const cls of all) {
      const actions = decisionToActions(
        { classification: cls, confidence: "high", reasoning: "x" },
        makeIssue(),
      );
      const lastAddLabel = [...actions]
        .reverse()
        .find((a) => a.type === "add_label");
      expect((lastAddLabel as { label: string }).label).toBe(
        LABELS.CLAUDE_TRIAGED,
      );
    }
  });
});

describe("classificationClosesIssue", () => {
  it("auto-close categories return true (translation depends on flag)", () => {
    expect(classificationClosesIssue("feature")).toBe(true);
    expect(classificationClosesIssue("question")).toBe(true);
    expect(classificationClosesIssue("support")).toBe(true);
    expect(classificationClosesIssue("billing")).toBe(true);
    expect(classificationClosesIssue("translation")).toBe(
      ENABLE_TRANSLATION_CLOSE,
    );
  });

  it("non-close categories return false (including security)", () => {
    expect(classificationClosesIssue("bug")).toBe(false);
    expect(classificationClosesIssue("qol-improvement")).toBe(false);
    expect(classificationClosesIssue("duplicate")).toBe(false);
    expect(classificationClosesIssue("needs-info")).toBe(false);
    expect(classificationClosesIssue("uncertain")).toBe(false);
    expect(classificationClosesIssue("security")).toBe(false);
  });
});
