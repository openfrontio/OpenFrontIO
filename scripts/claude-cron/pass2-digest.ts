import type Anthropic from "@anthropic-ai/sdk";
import type { Octokit } from "@octokit/rest";
import { composeDigest, type DigestInputs } from "./claude";
import { DIGEST_ISSUE_NUMBER, MAX_CALLS_PER_RUN, REPO } from "./config";
import { gatherDigestInputs, renderFallbackDigest } from "./digest-formatter";
import type { TriagePassResult } from "./pass1-triage";
import { reviewAllPRsAwaitingReview } from "./pr-reviewer";

export type DigestPassResult = {
  markdown: string;
  prReviewCallCount: number;
  composedByClaude: boolean;
  posted: boolean;
};

export type RunDigestArgs = {
  octokit: Octokit;
  anthropic: Anthropic;
  triagePass: TriagePassResult;
  now: Date;
  dryRun: boolean;
  remainingClaudeCalls: number;
};

export async function runDigestPass(
  args: RunDigestArgs,
): Promise<DigestPassResult> {
  const { octokit, anthropic, triagePass, now, dryRun, remainingClaudeCalls } =
    args;

  // Phase 2a — review every open PR awaiting maintainer review.
  const { reviews, callCount: prReviewCallCount } =
    await reviewAllPRsAwaitingReview(octokit, anthropic, {
      maxCalls: Math.max(0, remainingClaudeCalls - 1),
    });

  // Gather all inputs for the digest composer.
  const inputs = await gatherDigestInputs({
    octokit,
    now,
    triagePass,
    prReviews: reviews,
  });

  // Phase 2b — compose the digest markdown via Claude (with fallback).
  let markdown: string;
  let composedByClaude = false;
  try {
    const result = await composeDigest(anthropic, inputs);
    markdown = result.value.markdown;
    composedByClaude = true;
    console.log(
      `[claude-cron] digest composed — tokens in=${result.usage.input_tokens} out=${result.usage.output_tokens}`,
    );
  } catch (err) {
    console.error(
      `[claude-cron] digest composition failed; using deterministic fallback: ${err}`,
    );
    markdown = renderFallbackDigest(inputs);
  }

  let posted = false;
  if (dryRun) {
    console.log(`[claude-cron] DRY_RUN: digest (not posted):\n\n${markdown}\n`);
  } else {
    posted = await postDigestToTrackingIssue(octokit, markdown);
  }

  return { markdown, prReviewCallCount, composedByClaude, posted };
}

async function postDigestToTrackingIssue(
  octokit: Octokit,
  markdown: string,
): Promise<boolean> {
  if (DIGEST_ISSUE_NUMBER === 0) {
    console.warn(
      `[claude-cron] DIGEST_ISSUE_NUMBER is unset in config.ts; logging digest instead of posting`,
    );
    console.log(markdown);
    return false;
  }
  try {
    const { data: tracking } = await octokit.rest.issues.get({
      ...REPO,
      issue_number: DIGEST_ISSUE_NUMBER,
    });
    if (tracking.state === "closed") {
      console.error(
        `[claude-cron] tracking issue #${DIGEST_ISSUE_NUMBER} is closed; not posting. Reopen or update DIGEST_ISSUE_NUMBER.`,
      );
      return false;
    }
  } catch (err) {
    console.error(
      `[claude-cron] could not fetch tracking issue #${DIGEST_ISSUE_NUMBER}: ${err}`,
    );
    return false;
  }
  await octokit.rest.issues.createComment({
    ...REPO,
    issue_number: DIGEST_ISSUE_NUMBER,
    body: markdown,
  });
  console.log(
    `[claude-cron] digest posted to tracking issue #${DIGEST_ISSUE_NUMBER}`,
  );
  return true;
}

export { DIGEST_ISSUE_NUMBER, MAX_CALLS_PER_RUN };
export type { DigestInputs };
