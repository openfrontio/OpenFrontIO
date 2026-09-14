import type { Octokit } from "@octokit/rest";
import { COMMENTS } from "./config";
import { type Action, applyActions, describeAction, getIssue } from "./github";
import { syncApprovalLabel } from "./rules/approval-label-sync";
import { enforceAssignmentInvariant } from "./rules/assignment-invariant";

export type EventName = "opened" | "assigned" | "milestoned" | "demilestoned";

export function isKnownEvent(name: string): name is EventName {
  return (
    name === "opened" ||
    name === "assigned" ||
    name === "milestoned" ||
    name === "demilestoned"
  );
}

export async function runEvent(
  octokit: Octokit,
  eventName: string,
  issueNumber: number,
  dryRun: boolean,
): Promise<void> {
  if (!isKnownEvent(eventName)) {
    console.log(
      `[issue-lifecycle] issue #${issueNumber} — event "${eventName}" not handled by this Action`,
    );
    return;
  }

  const issue = await getIssue(octokit, issueNumber);
  if (!issue) return;
  if (issue.is_pull_request) {
    console.log(`[issue-lifecycle] issue #${issueNumber} is a PR — skipping`);
    return;
  }

  const prefix = `[issue-lifecycle] issue #${issueNumber} (event: ${eventName})`;
  const buckets: { rule: string; actions: Action[] }[] = [];

  if (eventName === "assigned" || eventName === "demilestoned") {
    buckets.push({
      rule: "assignment-invariant",
      actions: enforceAssignmentInvariant(issue),
    });
  }

  if (
    eventName === "opened" ||
    eventName === "milestoned" ||
    eventName === "demilestoned"
  ) {
    buckets.push({
      rule: "approval-label-sync",
      actions: syncApprovalLabel(issue),
    });
  }

  if (eventName === "opened" && issue.milestone === null) {
    buckets.push({
      rule: "new-issue-greeting",
      actions: [
        {
          type: "comment",
          body: COMMENTS.NEW_ISSUE_NOT_APPROVED(issue.user?.login ?? "there"),
        },
      ],
    });
  }

  let acted = false;
  for (const { rule, actions } of buckets) {
    if (actions.length === 0) continue;
    acted = true;
    console.log(
      `${prefix} — rule: ${rule} — actions: ${actions.map(describeAction).join(", ")}`,
    );
    if (dryRun) {
      console.log(`${prefix} — DRY_RUN: not applied`);
      continue;
    }
    await applyActions(octokit, issueNumber, actions);
  }
  if (!acted) {
    console.log(`${prefix} — no actions needed`);
  }
}
