import { describe, expect, it, vi } from "vitest";
import {
  checkApprovedWork,
  checkBypass,
  checkRepoAccess,
  checkSmallFix,
  evaluate,
  parseLinkedIssues,
  type IssueMetadata,
  type PRMetadata,
} from "../scripts/pr-gate/rules";

describe("parseLinkedIssues", () => {
  it("returns empty for null or empty body", () => {
    expect(parseLinkedIssues(null)).toEqual([]);
    expect(parseLinkedIssues("")).toEqual([]);
  });

  it("returns empty when no keyword is present", () => {
    expect(parseLinkedIssues("Just a description")).toEqual([]);
    expect(parseLinkedIssues("See #5 for details")).toEqual([]);
  });

  it("matches every standard closing keyword", () => {
    const keywords = [
      "close",
      "closes",
      "closed",
      "fix",
      "fixes",
      "fixed",
      "resolve",
      "resolves",
      "resolved",
    ];
    keywords.forEach((kw, i) => {
      const n = 10 + i;
      expect(parseLinkedIssues(`${kw} #${n}`)).toEqual([n]);
    });
  });

  it("is case-insensitive", () => {
    expect(parseLinkedIssues("CLOSES #5")).toEqual([5]);
    expect(parseLinkedIssues("Fixes #6")).toEqual([6]);
    expect(parseLinkedIssues("rEsOlVeD #7")).toEqual([7]);
  });

  it("matches references anywhere in the body", () => {
    expect(parseLinkedIssues("Some text\n\nFixes #42\n\nMore text")).toEqual([
      42,
    ]);
  });

  it("returns multiple unique issue numbers", () => {
    expect(parseLinkedIssues("Closes #1, fixes #2, resolves #3")).toEqual([
      1, 2, 3,
    ]);
  });

  it("dedupes repeated references", () => {
    expect(parseLinkedIssues("Closes #5 and fixes #5")).toEqual([5]);
  });

  it("ignores references inside fenced code blocks", () => {
    const body = "```\nCloses #5\n```\nFixes #6";
    expect(parseLinkedIssues(body)).toEqual([6]);
  });

  it("ignores references inside inline code", () => {
    expect(parseLinkedIssues("`Closes #5` and Fixes #6")).toEqual([6]);
  });

  it("ignores cross-repo references", () => {
    expect(parseLinkedIssues("Closes openfront/OpenFrontIO#5")).toEqual([]);
  });

  it("does not match keyword without # number", () => {
    expect(parseLinkedIssues("This closes the discussion")).toEqual([]);
  });

  it("does not match keyword as substring of a larger word", () => {
    expect(parseLinkedIssues("Disclosed #5")).toEqual([]);
    expect(parseLinkedIssues("Prefixed #5")).toEqual([]);
  });
});

const makePR = (overrides: Partial<PRMetadata> = {}): PRMetadata => ({
  number: 1,
  body: null,
  user: { login: "alice" },
  labels: [],
  ...overrides,
});

describe("checkBypass", () => {
  it("passes when bypass-pr-check label is present", () => {
    const r = checkBypass(makePR({ labels: ["bypass-pr-check"] }));
    expect(r.action).toBe("pass");
  });

  it("returns next when label is absent", () => {
    expect(checkBypass(makePR()).action).toBe("next");
  });

  it("returns next when other labels present but not bypass", () => {
    expect(checkBypass(makePR({ labels: ["bug", "small-fix"] })).action).toBe(
      "next",
    );
  });
});

describe("checkRepoAccess", () => {
  it("passes for admin, maintain, write permissions", async () => {
    for (const permission of ["admin", "maintain", "write"]) {
      const get = vi.fn(async () => permission);
      const r = await checkRepoAccess(makePR(), get);
      expect(r.action).toBe("pass");
    }
  });

  it("returns next for untrusted permissions", async () => {
    for (const permission of ["read", "none", "triage"]) {
      const get = vi.fn(async () => permission);
      const r = await checkRepoAccess(makePR(), get);
      expect(r.action).toBe("next");
    }
  });
});

describe("checkSmallFix", () => {
  it("passes at exactly 50 lines and applies small-fix label", () => {
    const r = checkSmallFix([{ additions: 25, deletions: 25 }]);
    expect(r.action).toBe("pass");
    if (r.action === "pass") expect(r.labelToAdd).toBe("small-fix");
  });

  it("passes for deletion-only diffs under the threshold", () => {
    expect(checkSmallFix([{ additions: 0, deletions: 40 }]).action).toBe(
      "pass",
    );
  });

  it("returns next at 51 lines", () => {
    expect(checkSmallFix([{ additions: 51, deletions: 0 }]).action).toBe(
      "next",
    );
  });

  it("sums additions and deletions across files", () => {
    expect(
      checkSmallFix([
        { additions: 30, deletions: 0 },
        { additions: 25, deletions: 0 },
      ]).action,
    ).toBe("next");
  });

  it("counts deletions toward the cap", () => {
    expect(checkSmallFix([{ additions: 0, deletions: 60 }]).action).toBe(
      "next",
    );
  });

  it("passes for an empty diff", () => {
    expect(checkSmallFix([]).action).toBe("pass");
  });
});

const makeIssue = (overrides: Partial<IssueMetadata> = {}): IssueMetadata => ({
  number: 5,
  labels: ["approved"],
  assignees: [{ login: "alice" }],
  ...overrides,
});

describe("checkApprovedWork", () => {
  it("returns next when no issues are linked, without fetching", async () => {
    const get = vi.fn();
    const r = await checkApprovedWork(makePR({ body: null }), get);
    expect(r.action).toBe("next");
    expect(get).not.toHaveBeenCalled();
  });

  it("passes when issue has approved label and author is assigned", async () => {
    const get = vi.fn(async () => makeIssue());
    const r = await checkApprovedWork(makePR({ body: "Closes #5" }), get);
    expect(r.action).toBe("pass");
  });

  it("returns next when issue lacks the approved label", async () => {
    const get = vi.fn(async () =>
      makeIssue({ labels: ["bug", "good-first-issue"] }),
    );
    expect(
      (await checkApprovedWork(makePR({ body: "Closes #5" }), get)).action,
    ).toBe("next");
  });

  it("returns next when issue has no labels", async () => {
    const get = vi.fn(async () => makeIssue({ labels: [] }));
    expect(
      (await checkApprovedWork(makePR({ body: "Closes #5" }), get)).action,
    ).toBe("next");
  });

  it("returns next when author is not in assignees", async () => {
    const get = vi.fn(async () => makeIssue({ assignees: [{ login: "bob" }] }));
    expect(
      (await checkApprovedWork(makePR({ body: "Closes #5" }), get)).action,
    ).toBe("next");
  });

  it("returns next when issue fetch returns null (404)", async () => {
    const get = vi.fn(async () => null);
    expect(
      (await checkApprovedWork(makePR({ body: "Closes #5" }), get)).action,
    ).toBe("next");
  });

  it("passes if any of multiple linked issues qualifies", async () => {
    const get = vi.fn(async (n: number) => {
      if (n === 5) return makeIssue({ number: 5, labels: [] });
      if (n === 6) return makeIssue({ number: 6 });
      return null;
    });
    const r = await checkApprovedWork(
      makePR({ body: "Closes #5, fixes #6" }),
      get,
    );
    expect(r.action).toBe("pass");
  });
});

describe("evaluate (priority ordering)", () => {
  it("rule 0 — bypass label overrides everything", async () => {
    const r = await evaluate(
      makePR({ labels: ["bypass-pr-check"] }),
      [{ additions: 5000, deletions: 0 }],
      async () => null,
      async () => "none",
    );
    expect(r.action).toBe("pass");
  });

  it("rule 1 — repo write access with a huge PR passes", async () => {
    const r = await evaluate(
      makePR(),
      [{ additions: 5000, deletions: 0 }],
      async () => null,
      async () => "write",
    );
    expect(r.action).toBe("pass");
  });

  it("rule 3 — small PR from non-member passes with small-fix label", async () => {
    const r = await evaluate(
      makePR(),
      [{ additions: 10, deletions: 5 }],
      async () => null,
      async () => "none",
    );
    expect(r.action).toBe("pass");
    if (r.action === "pass") expect(r.labelToAdd).toBe("small-fix");
  });

  it("rule 2 — non-member with approved-labelled issue + assignee passes despite large diff", async () => {
    const r = await evaluate(
      makePR({ body: "Closes #5" }),
      [{ additions: 200, deletions: 50 }],
      async () => makeIssue(),
      async () => "none",
    );
    expect(r.action).toBe("pass");
  });

  it("close — large diff, no qualifying issue", async () => {
    const r = await evaluate(
      makePR(),
      [{ additions: 200, deletions: 50 }],
      async () => null,
      async () => "none",
    );
    expect(r.action).toBe("close");
  });
});
