import type Anthropic from "@anthropic-ai/sdk";
import type { Octokit } from "@octokit/rest";
import { classifyIssue, type TriageDecision } from "./claude";
import {
  AUTO_CLOSE_CLASSIFICATIONS,
  type AutoCloseClassification,
  type Classification,
  CLOSE_COMMENT_BY_CLASSIFICATION,
  CLOSE_LABEL_BY_CLASSIFICATION,
  COMMENTS,
  ENABLE_TRANSLATION_CLOSE,
  LABELS,
  MAX_CALLS_PER_RUN,
  RECENT_ISSUES_CONTEXT_SIZE,
} from "./config";
import {
  type Action,
  applyActions,
  describeAction,
  type Issue,
  listOpenIssues,
} from "./github";

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const AUTO_CLOSE_SET = new Set<string>(AUTO_CLOSE_CLASSIFICATIONS);

export type TriagePassResult = {
  processed: number;
  closed: number;
  kept: number;
  callCount: number;
  recordsByNumber: Map<number, TriageRecord>;
};

export type TriageRecord = {
  issue: Issue;
  decision: TriageDecision;
  appliedActions: Action[];
};

export function isTriageCandidate(issue: Issue): boolean {
  if (issue.is_pull_request) return false;
  if (issue.state !== "open") return false;
  if (issue.labels.includes(LABELS.CLAUDE_TRIAGED)) return false;
  if (TRUSTED_ASSOCIATIONS.has(issue.author_association)) return false;
  if (issue.labels.some((l) => l.startsWith("auto-closed-"))) return false;
  return true;
}

export function isOrgMemberIssueNeedingTag(issue: Issue): boolean {
  if (issue.is_pull_request) return false;
  if (issue.state !== "open") return false;
  if (issue.labels.includes(LABELS.CLAUDE_TRIAGED)) return false;
  if (!TRUSTED_ASSOCIATIONS.has(issue.author_association)) return false;
  return true;
}

/**
 * Auto-close categories require `confidence: high` to act. Anything below is
 * downgraded to `uncertain` so the maintainer can decide. This is the
 * asymmetric-cost rule: closing in error is worse than leaving open in error.
 */
export function downgradeIfLowConfidence(
  decision: TriageDecision,
): TriageDecision {
  if (
    AUTO_CLOSE_SET.has(decision.classification) &&
    decision.confidence !== "high"
  ) {
    return {
      classification: "uncertain",
      confidence: decision.confidence,
      reasoning: `${decision.reasoning} (downgraded from ${decision.classification} due to confidence=${decision.confidence})`,
    };
  }
  return decision;
}

/**
 * Translate a triage decision into a list of GitHub actions. Pure function;
 * does no I/O. The `claude-triaged` label is always appended last so
 * re-running the cron doesn't re-process this issue.
 */
export function decisionToActions(
  decision: TriageDecision,
  issue: Issue,
): Action[] {
  const author = issue.user?.login ?? "there";
  const actions: Action[] = [];

  switch (decision.classification) {
    case "bug":
      actions.push({ type: "add_label", label: LABELS.BUG });
      if (decision.suggested_area) {
        actions.push({ type: "add_label", label: decision.suggested_area });
      }
      actions.push({ type: "add_label", label: LABELS.CLAUDE_APPROVED });
      break;

    case "qol-improvement":
      actions.push({ type: "add_label", label: LABELS.QOL_IMPROVEMENT });
      if (decision.suggested_area) {
        actions.push({ type: "add_label", label: decision.suggested_area });
      }
      actions.push({ type: "add_label", label: LABELS.CLAUDE_APPROVED });
      break;

    case "duplicate":
      actions.push({ type: "add_label", label: LABELS.POSSIBLE_DUPLICATE });
      if (decision.duplicate_of) {
        actions.push({
          type: "comment",
          body: COMMENTS.POSSIBLE_DUPLICATE(author, decision.duplicate_of),
        });
      }
      break;

    case "needs-info":
      actions.push({ type: "add_label", label: LABELS.NEEDS_INFO });
      if (
        decision.clarifying_questions &&
        decision.clarifying_questions.length > 0
      ) {
        actions.push({
          type: "comment",
          body: COMMENTS.NEEDS_INFO(author, decision.clarifying_questions),
        });
      }
      break;

    case "uncertain":
    case "security":
      // Security is intentionally not auto-closed: closing doesn't make a
      // GitHub issue private. We route to claude-uncertain (no comment, no
      // close) so the maintainer can manually delete, contact the reporter
      // privately, or otherwise handle it discreetly.
      actions.push({
        type: "add_label",
        label: LABELS.CLAUDE_UNCERTAIN,
      });
      break;

    case "feature":
    case "question":
    case "support":
    case "billing":
    case "translation": {
      const cls = decision.classification as AutoCloseClassification;
      if (cls === "translation" && !ENABLE_TRANSLATION_CLOSE) {
        actions.push({
          type: "add_label",
          label: LABELS.CLAUDE_UNCERTAIN,
        });
        break;
      }
      actions.push({
        type: "add_label",
        label: CLOSE_LABEL_BY_CLASSIFICATION[cls],
      });
      actions.push({
        type: "comment",
        body: CLOSE_COMMENT_BY_CLASSIFICATION[cls](author),
      });
      actions.push({ type: "close", reason: "not_planned" });
      break;
    }
  }

  // Idempotency marker: always last, so we don't re-process this issue tomorrow.
  actions.push({ type: "add_label", label: LABELS.CLAUDE_TRIAGED });
  return actions;
}

export function classificationClosesIssue(
  classification: Classification,
): boolean {
  if (!AUTO_CLOSE_SET.has(classification)) return false;
  if (classification === "translation") return ENABLE_TRANSLATION_CLOSE;
  return true;
}

const MAX_CONSECUTIVE_FAILURES = 3;

export async function runTriagePass(
  octokit: Octokit,
  anthropic: Anthropic,
  opts: { dryRun: boolean },
): Promise<TriagePassResult> {
  const allOpenIssues = await listOpenIssues(octokit);
  const candidates = allOpenIssues.filter(isTriageCandidate);
  const orgMemberIssues = allOpenIssues.filter(isOrgMemberIssueNeedingTag);
  const contextIssues = allOpenIssues.slice(0, RECENT_ISSUES_CONTEXT_SIZE);

  console.log(
    `[claude-cron] triage pass — total_open=${allOpenIssues.length} candidates=${candidates.length} org_member=${orgMemberIssues.length}`,
  );

  const records = new Map<number, TriageRecord>();
  let processed = 0;
  let closed = 0;
  let kept = 0;
  let callCount = 0;
  let consecutiveFailures = 0;

  // First, handle org-member issues — no Claude call. Mark them claude-approved + claude-triaged.
  for (const issue of orgMemberIssues) {
    const actions: Action[] = [
      { type: "add_label", label: LABELS.CLAUDE_APPROVED },
      { type: "add_label", label: LABELS.CLAUDE_TRIAGED },
    ];
    const synthDecision: TriageDecision = {
      classification: "qol-improvement",
      confidence: "high",
      reasoning:
        "Org member — assumed approved by default; skipped Claude call.",
    };
    logActions(issue.number, "org-member-skip", actions);
    if (!opts.dryRun) {
      try {
        await applyActions(octokit, issue.number, actions);
      } catch (err) {
        console.error(
          `[claude-cron] issue #${issue.number} — apply error: ${err}`,
        );
      }
    } else {
      console.log(
        `[claude-cron] issue #${issue.number} — DRY_RUN: not applied`,
      );
    }
    records.set(issue.number, {
      issue,
      decision: synthDecision,
      appliedActions: actions,
    });
    processed += 1;
    kept += 1;
  }

  // Then, candidates needing Claude classification.
  for (const issue of candidates) {
    if (callCount >= MAX_CALLS_PER_RUN) {
      console.warn(
        `[claude-cron] hit MAX_CALLS_PER_RUN cap (${MAX_CALLS_PER_RUN}); stopping triage pass`,
      );
      break;
    }
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(
        `[claude-cron] ${MAX_CONSECUTIVE_FAILURES} consecutive Claude failures; aborting triage pass`,
      );
      break;
    }

    let rawDecision: TriageDecision;
    try {
      const result = await classifyIssue(anthropic, issue, contextIssues);
      callCount += 1;
      rawDecision = result.value;
      consecutiveFailures = 0;
      console.log(
        `[claude-cron] issue #${issue.number} — tokens in=${result.usage.input_tokens} out=${result.usage.output_tokens}`,
      );
    } catch (err) {
      consecutiveFailures += 1;
      console.error(
        `[claude-cron] issue #${issue.number} — Claude error (consecutive=${consecutiveFailures}): ${err}`,
      );
      continue;
    }

    const decision = downgradeIfLowConfidence(rawDecision);
    if (decision !== rawDecision) {
      console.log(
        `[claude-cron] issue #${issue.number} — downgraded ${rawDecision.classification}/${rawDecision.confidence} -> uncertain`,
      );
    }
    console.log(
      `[claude-cron] issue #${issue.number} — classification=${decision.classification} confidence=${decision.confidence} — ${decision.reasoning}`,
    );

    const actions = decisionToActions(decision, issue);
    logActions(issue.number, decision.classification, actions);

    if (!opts.dryRun) {
      try {
        await applyActions(octokit, issue.number, actions);
      } catch (err) {
        console.error(
          `[claude-cron] issue #${issue.number} — apply error: ${err}`,
        );
      }
    } else {
      console.log(
        `[claude-cron] issue #${issue.number} — DRY_RUN: not applied`,
      );
    }

    records.set(issue.number, { issue, decision, appliedActions: actions });
    processed += 1;
    if (classificationClosesIssue(decision.classification)) closed += 1;
    else kept += 1;
  }

  return { processed, closed, kept, callCount, recordsByNumber: records };
}

function logActions(
  issueNumber: number,
  label: string,
  actions: Action[],
): void {
  const summary = actions.map(describeAction).join(", ");
  console.log(
    `[claude-cron] issue #${issueNumber} — ${label} — actions: ${summary}`,
  );
}
