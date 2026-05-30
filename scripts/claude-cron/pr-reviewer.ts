import type Anthropic from "@anthropic-ai/sdk";
import type { Octokit } from "@octokit/rest";
import { reviewPR, type PRReview } from "./claude";
import { MAINTAINER_LOGIN } from "./config";
import {
  fetchPRDiff,
  getIssue,
  listOpenPRs,
  listPullReviews,
  type Issue,
  type PullRequest,
} from "./github";

export type PRReviewRecord = {
  pr: PullRequest;
  review: PRReview;
};

export function extractLinkedIssueNumber(prBody: string): number | null {
  // Match common close-keyword references: "Fixes #123", "Closes #45", etc.
  // Per GitHub linking syntax; we ignore cross-repo references for simplicity.
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*[:#]?\s*#(\d+)\b/gi;
  const matches = [...prBody.matchAll(re)];
  if (matches.length === 0) return null;
  // If multiple, prefer the first — usually the primary linked issue.
  return parseInt(matches[0][1], 10);
}

// Pure predicate so the SHA-comparison logic is unit-testable.
// Reviewed = maintainer has at least one review on the current head commit.
// Comparing review.commit_id to pr.head_sha (instead of timestamps vs
// pr.updated_at) avoids re-flagging PRs whose only change since the review
// is a label, comment, or title edit.
export function isReviewPendingFromReviews(
  reviews: { user_login: string | null; commit_id: string | null }[],
  maintainerLogin: string,
  headSha: string,
): boolean {
  const byMaintainer = reviews.filter((r) => r.user_login === maintainerLogin);
  if (byMaintainer.length === 0) return true;
  return !byMaintainer.some((r) => r.commit_id === headSha);
}

export async function isMaintainerReviewPending(
  octokit: Octokit,
  pr: PullRequest,
): Promise<boolean> {
  const reviews = await listPullReviews(octokit, pr.number);
  return isReviewPendingFromReviews(reviews, MAINTAINER_LOGIN, pr.head_sha);
}

export async function listPRsAwaitingMaintainerReview(
  octokit: Octokit,
): Promise<PullRequest[]> {
  const allOpen = await listOpenPRs(octokit);
  const result: PullRequest[] = [];
  for (const pr of allOpen) {
    if (pr.draft) continue;
    try {
      if (await isMaintainerReviewPending(octokit, pr)) {
        result.push(pr);
      }
    } catch (err) {
      console.warn(
        `[claude-cron] PR #${pr.number} — error checking reviews; including in digest just in case: ${err}`,
      );
      result.push(pr);
    }
  }
  return result;
}

async function fetchLinkedIssue(
  octokit: Octokit,
  pr: PullRequest,
): Promise<Issue | null> {
  const issueNumber = extractLinkedIssueNumber(pr.body);
  if (issueNumber === null) return null;
  const issue = await getIssue(octokit, issueNumber);
  if (!issue) return null;
  if (issue.is_pull_request) return null;
  return issue;
}

export async function reviewAllPRsAwaitingReview(
  octokit: Octokit,
  anthropic: Anthropic,
  opts: { maxCalls: number },
): Promise<{ reviews: PRReviewRecord[]; callCount: number }> {
  const prs = await listPRsAwaitingMaintainerReview(octokit);
  console.log(
    `[claude-cron] PR review phase — open PRs awaiting maintainer review: ${prs.length}`,
  );

  const reviews: PRReviewRecord[] = [];
  let callCount = 0;
  let consecutiveFailures = 0;

  for (const pr of prs) {
    if (callCount >= opts.maxCalls) {
      console.warn(
        `[claude-cron] PR review phase — hit maxCalls cap (${opts.maxCalls}); stopping`,
      );
      break;
    }
    if (consecutiveFailures >= 3) {
      console.error(
        `[claude-cron] PR review phase — 3 consecutive failures; stopping`,
      );
      break;
    }

    try {
      const diff = await fetchPRDiff(octokit, pr.number);
      const linkedIssue = await fetchLinkedIssue(octokit, pr);
      const result = await reviewPR(anthropic, pr, diff, linkedIssue);
      callCount += 1;
      consecutiveFailures = 0;
      console.log(
        `[claude-cron] PR #${pr.number} — review: risk=${result.value.risk} tests=${result.value.tests_present} scope=${result.value.scope_match} tokens in=${result.usage.input_tokens} out=${result.usage.output_tokens}`,
      );
      reviews.push({ pr, review: result.value });
    } catch (err) {
      consecutiveFailures += 1;
      console.error(
        `[claude-cron] PR #${pr.number} — review error (consecutive=${consecutiveFailures}): ${err}`,
      );
    }
  }

  return { reviews, callCount };
}
