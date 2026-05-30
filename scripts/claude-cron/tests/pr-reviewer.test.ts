import { describe, expect, it } from "vitest";
import {
  extractLinkedIssueNumber,
  isReviewPendingFromReviews,
} from "../pr-reviewer";

describe("extractLinkedIssueNumber", () => {
  it("matches 'Fixes #123'", () => {
    expect(extractLinkedIssueNumber("Fixes #123")).toBe(123);
  });

  it("matches 'closes #45'", () => {
    expect(extractLinkedIssueNumber("This PR closes #45 by adding...")).toBe(
      45,
    );
  });

  it("matches 'Resolves #99'", () => {
    expect(extractLinkedIssueNumber("Summary\n\nResolves #99")).toBe(99);
  });

  it("matches 'fixed #7'", () => {
    expect(extractLinkedIssueNumber("fixed #7")).toBe(7);
  });

  it("prefers the first match when multiple keywords are present", () => {
    expect(extractLinkedIssueNumber("Fixes #10\n\nAlso closes #20")).toBe(10);
  });

  it("returns null when no linking keyword is found", () => {
    expect(extractLinkedIssueNumber("Just a refactor")).toBeNull();
    expect(
      extractLinkedIssueNumber("Reference to #50 but no keyword"),
    ).toBeNull();
  });

  it("returns null for empty body", () => {
    expect(extractLinkedIssueNumber("")).toBeNull();
  });
});

describe("isReviewPendingFromReviews", () => {
  const HEAD = "abc123";
  const OLD = "def456";

  it("pending when maintainer has no reviews at all", () => {
    expect(isReviewPendingFromReviews([], "evan", HEAD)).toBe(true);
  });

  it("pending when only OTHER reviewers have reviewed the head", () => {
    const reviews = [{ user_login: "alice", commit_id: HEAD }];
    expect(isReviewPendingFromReviews(reviews, "evan", HEAD)).toBe(true);
  });

  it("pending when maintainer reviewed an OLD commit (new commits pushed)", () => {
    const reviews = [{ user_login: "evan", commit_id: OLD }];
    expect(isReviewPendingFromReviews(reviews, "evan", HEAD)).toBe(true);
  });

  it("not pending when maintainer has reviewed the current head", () => {
    const reviews = [
      { user_login: "evan", commit_id: OLD },
      { user_login: "evan", commit_id: HEAD },
    ];
    expect(isReviewPendingFromReviews(reviews, "evan", HEAD)).toBe(false);
  });

  it("not pending if maintainer has at least one review on head (even if also reviewed older commits)", () => {
    const reviews = [
      { user_login: "alice", commit_id: HEAD },
      { user_login: "evan", commit_id: HEAD },
    ];
    expect(isReviewPendingFromReviews(reviews, "evan", HEAD)).toBe(false);
  });
});
